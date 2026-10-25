import type { Readable, Writable } from 'node:stream'
import { createInterface } from 'node:readline'
import { describeMethods, serializeError } from '@unorder/core'
import type { MethodDescriptor, Schema } from '@unorder/core'
import type { ProviderConfigOverrides } from './execute'
import { providerConfig } from './execute'
import type { BuiltinProvider } from './providers'
import { providers as defaultProviders } from './providers'

const SUPPORTED_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'] as const

interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: unknown
}

export interface McpTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Schema
  readonly annotations: MethodDescriptor['annotations']
}

const toolDescription = (method: MethodDescriptor): string => {
  const warnings: string[] = []
  if (method.name === 'order.send' || method.annotations.destructiveHint) {
    warnings.push('This action can affect a live restaurant session. Require explicit approval.')
  }
  if (method.session === 'required') {
    warnings.push('Requires an open session (call session.open first).')
  }
  return [method.summary, method.description, ...warnings].filter(Boolean).join('\n\n')
}

/** Builds MCP tool definitions from the same descriptors used by CLI help. */
export const createToolDefinitions = (
  providerList: readonly BuiltinProvider[] = defaultProviders,
): McpTool[] =>
  providerList.flatMap((provider) =>
    describeMethods(provider).map((method) => ({
      name: method.fullName,
      description: toolDescription(method),
      inputSchema: method.input,
      annotations: method.annotations,
    })),
  )

const describeMethodMap = (providerList: readonly BuiltinProvider[]) =>
  new Map(
    providerList.flatMap((provider) =>
      describeMethods(provider).map((method) => [method.fullName, method] as const),
    ),
  )

export interface McpServerOptions {
  readonly input?: Readable
  readonly output?: Writable
  readonly providers?: readonly BuiltinProvider[]
  readonly overrides?: ProviderConfigOverrides
  readonly fetch?: typeof globalThis.fetch
}

/**
 * Minimal newline-delimited JSON-RPC MCP server. It intentionally implements
 * only initialize, ping, tools/list, tools/call, and shutdown.
 */
export const startMcpServer = async (options: McpServerOptions = {}): Promise<void> => {
  const providerList = options.providers ?? defaultProviders
  const providerById = new Map<string, BuiltinProvider>(
    providerList.map((provider) => [provider.id, provider]),
  )
  const tools = createToolDefinitions(providerList)
  const toolMethods = describeMethodMap(providerList)
  const runtimes = new Map<string, ReturnType<BuiltinProvider['createRuntime']>>()
  const output = options.output ?? process.stdout
  const input = options.input ?? process.stdin

  const send = (message: unknown) => {
    output.write(`${JSON.stringify(message)}\n`)
  }

  const respond = (id: JsonRpcRequest['id'], result: unknown) => {
    send({ jsonrpc: '2.0', id: id ?? null, result })
  }

  const respondError = (
    id: JsonRpcRequest['id'],
    code: number,
    message: string,
    data?: unknown,
  ) => {
    send({
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code, message, ...(data === undefined ? {} : { data }) },
    })
  }

  const runtimeFor = (provider: BuiltinProvider) => {
    const existing = runtimes.get(provider.id)
    if (existing) {
      return existing
    }
    const config = providerConfig(provider.id, options.overrides)
    const runtime = provider.createRuntime(config ? { config: config as never } : {})
    runtimes.set(provider.id, runtime)
    return runtime
  }

  const callTool = async (name: string, args: unknown) => {
    const method = toolMethods.get(name)
    if (!method) {
      throw new Error(`Unknown tool: ${name}`)
    }
    const provider = providerById.get(method.provider)
    if (!provider) {
      throw new Error(`Unknown provider: ${method.provider}`)
    }
    const runtime = runtimeFor(provider)
    return await runtime.invoke(method.name, args ?? {})
  }

  const handleRequest = async (request: JsonRpcRequest): Promise<boolean> => {
    const hasId = Object.hasOwn(request, 'id')
    const method = request.method

    if (method === 'initialize') {
      const params =
        typeof request.params === 'object' && request.params !== null
          ? (request.params as Record<string, unknown>)
          : {}
      const requested =
        typeof params.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05'
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(
        requested as (typeof SUPPORTED_PROTOCOL_VERSIONS)[number],
      )
        ? requested
        : '2024-11-05'
      respond(request.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'unorder', version: '0.1.0' },
        instructions:
          'Use saizeriya.menu.list to read the static menu. Actions such as order.send, bill.get, receipt.get, and staff.call affect a real restaurant session.',
      })
      return true
    }

    if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
      return true
    }

    if (method === 'ping') {
      if (hasId) {
        respond(request.id, {})
      }
      return true
    }

    if (method === 'tools/list') {
      respond(request.id, { tools })
      return true
    }

    if (method === 'tools/call') {
      if (!hasId) {
        return true
      }
      const params =
        typeof request.params === 'object' && request.params !== null
          ? (request.params as Record<string, unknown>)
          : {}
      const name = params.name
      if (typeof name !== 'string') {
        respondError(request.id, -32602, 'tools/call requires a string name')
        return true
      }
      const args = params.arguments
      if (
        args !== undefined &&
        (typeof args !== 'object' || args === null || Array.isArray(args))
      ) {
        respondError(request.id, -32602, 'tools/call arguments must be an object')
        return true
      }
      try {
        const result = await callTool(name, args)
        const text = JSON.stringify(result, null, 2) ?? 'null'
        respond(request.id, { content: [{ type: 'text', text }] })
      } catch (error) {
        respond(request.id, {
          content: [{ type: 'text', text: JSON.stringify({ error: serializeError(error) }) }],
          isError: true,
        })
      }
      return true
    }

    if (method === 'shutdown') {
      if (hasId) {
        respond(request.id, null)
      }
      return true
    }

    if (method === 'exit') {
      return false
    }

    if (hasId) {
      respondError(request.id, -32601, `Method not found: ${method ?? '(missing)'}`)
    }
    return true
  }

  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })
  let done = false
  let finish = () => {}
  let queue: Promise<void> = Promise.resolve()
  const closed = new Promise<void>((resolve) => {
    finish = resolve
    lines.on('close', () => {
      void queue.then(() => finish())
    })
  })

  lines.on('line', (line) => {
    queue = queue.then(async () => {
      if (done) {
        return
      }
      const trimmed = line.trim()
      if (!trimmed) {
        return
      }
      let request: JsonRpcRequest
      try {
        request = JSON.parse(trimmed) as JsonRpcRequest
      } catch {
        respondError(null, -32700, 'Parse error')
        return
      }
      if (typeof request !== 'object' || request === null) {
        respondError(null, -32600, 'Invalid request')
        return
      }
      const continueReading = await handleRequest(request)
      if (!continueReading) {
        done = true
        lines.close()
      }
    })
  })

  await closed
}
