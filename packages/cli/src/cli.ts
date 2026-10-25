#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import {
  describeMethods,
  describeProviders,
  InvalidInputError,
  serializeError,
} from '@unorder/core'
import { createUsage, CLI_VERSION } from './help'
import { executeMethod } from './execute'
import { parseArguments } from './options'
import { findProvider, providers } from './providers'
import { FileSessionStore, defaultStatePath } from './state-store'
import { startMcpServer } from './mcp'

const writeJSON = (value: unknown) => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

const writeError = (error: unknown) => {
  writeJSON({ error: serializeError(error) })
}

const readInput = (jsonArgument: string | undefined): unknown => {
  let text: string
  if (jsonArgument === undefined) {
    text = '{}'
  } else if (jsonArgument === '-') {
    text = readFileSync(0, 'utf8')
  } else {
    text = jsonArgument
  }
  if (text.trim() === '') {
    return {}
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new InvalidInputError('Input is not valid JSON', { cause: error })
  }
}

const providerSummaries = () =>
  describeProviders(providers).map(({ methods, ...summary }) => ({
    ...summary,
    methodCount: methods.length,
  }))

export const run = async (argv: readonly string[]): Promise<number> => {
  try {
    const parsed = parseArguments(argv)
    if (parsed.help) {
      process.stdout.write(createUsage())
      return 0
    }
    if (parsed.version) {
      process.stdout.write(`${CLI_VERSION}\n`)
      return 0
    }

    switch (parsed.command) {
      case undefined:
      case 'help':
        process.stdout.write(createUsage())
        return 0
      case 'providers':
        writeJSON(providerSummaries())
        return 0
      case 'methods': {
        const providerId = parsed.positionals[0]
        if (providerId) {
          const provider = findProvider(providerId)
          if (!provider) {
            throw new InvalidInputError(`Unknown provider: ${providerId}`)
          }
          writeJSON(describeMethods(provider))
          return 0
        }
        writeJSON(providers.flatMap((provider) => describeMethods(provider)))
        return 0
      }
      case 'run': {
        let [provider, method, ...jsonParts] = parsed.positionals
        if (provider && method === undefined && provider.includes('.')) {
          const separator = provider.indexOf('.')
          method = provider.slice(separator + 1)
          provider = provider.slice(0, separator)
        }
        if (!provider) {
          throw new InvalidInputError('run requires a provider id')
        }
        if (!method) {
          throw new InvalidInputError('run requires a method name')
        }
        const input = readInput(jsonParts.length === 0 ? undefined : jsonParts.join(' '))
        const result = await executeMethod({
          providerId: provider,
          method,
          input,
          store: new FileSessionStore(parsed.options.state),
          overrides: {
            ...(parsed.options.menuUrl ? { menuUrl: parsed.options.menuUrl } : {}),
            ...(parsed.options.menuFile ? { menuFile: parsed.options.menuFile } : {}),
          },
        })
        writeJSON(result.output)
        return 0
      }
      case 'mcp':
        await startMcpServer({
          overrides: {
            ...(parsed.options.menuUrl ? { menuUrl: parsed.options.menuUrl } : {}),
            ...(parsed.options.menuFile ? { menuFile: parsed.options.menuFile } : {}),
          },
        })
        return 0
      default:
        throw new InvalidInputError(`Unknown command: ${parsed.command}`)
    }
  } catch (error) {
    writeError(error)
    return 1
  }
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const code = await run(process.argv.slice(2))
  process.exitCode = code
}

export { defaultStatePath }
