import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'
import { createToolDefinitions, startMcpServer } from '../src/mcp'
import { providers } from '../src/providers'

const menuFile = fileURLToPath(new URL('../../provider-saizeriya/data/menu.json', import.meta.url))

const runMcp = async (messages: readonly unknown[]) => {
  const input = new PassThrough()
  const output = new PassThrough()
  let buffer = ''
  output.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
  })
  const closed = startMcpServer({ input, output, overrides: { menuFile } })
  for (const message of messages) {
    input.write(`${JSON.stringify(message)}\n`)
  }
  input.end()
  await closed
  return buffer
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe('MCP server', () => {
  it('generates one tool per provider method', () => {
    const tools = createToolDefinitions()
    const expected = providers.reduce(
      (total, provider) => total + Object.keys(provider.methods).length,
      0,
    )
    expect(tools).toHaveLength(expected)
    expect(tools.map((tool) => tool.name)).toContain('saizeriya.order.send')
    expect(tools.map((tool) => tool.name)).toContain('sushiro.menu.list')
    expect(tools.find((tool) => tool.name === 'saizeriya.menu.list')?.inputSchema).toMatchObject({
      type: 'object',
      properties: { query: { type: 'string' } },
    })
  })

  it('handles initialize, tools/list, and tools/call over stdio', async () => {
    const messages = await runMcp([
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'saizeriya.menu.list', arguments: { query: 'ティラミス', limit: 1 } },
      },
      { jsonrpc: '2.0', id: 4, method: 'ping' },
      { jsonrpc: '2.0', method: 'exit' },
    ])

    const initialize = messages.find((message) => message.id === 1)
    expect(initialize?.result).toMatchObject({
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: false } },
    })

    const list = messages.find((message) => message.id === 2)
    const listResult = list?.result as { tools: { name: string }[] } | undefined
    const expected = providers.reduce(
      (total, provider) => total + Object.keys(provider.methods).length,
      0,
    )
    expect(listResult?.tools).toHaveLength(expected)

    const call = messages.find((message) => message.id === 3)
    const callResult = call?.result as { content: { text: string }[] } | undefined
    const parsed = JSON.parse(callResult?.content[0]?.text ?? '{}') as { items: { id: string }[] }
    expect(parsed.items[0]?.id).toBe('3201')
    expect(messages.find((message) => message.id === 4)?.result).toEqual({})
  })

  it('returns tool errors as MCP tool results', async () => {
    const messages = await runMcp([
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'saizeriya.menu.get', arguments: { id: 'nope' } },
      },
      { jsonrpc: '2.0', method: 'exit' },
    ])
    expect(messages[0]?.result).toMatchObject({ isError: true })
  })
})
