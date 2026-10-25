import { InvalidInputError } from '@unorder/core'

export interface GlobalOptions {
  readonly state?: string
  readonly menuUrl?: string
  readonly menuFile?: string
}

export interface ParsedArguments {
  readonly command?: string
  readonly positionals: readonly string[]
  readonly options: GlobalOptions
  readonly help: boolean
  readonly version: boolean
}

const optionValue = (args: readonly string[], index: number, name: string): [string, number] => {
  const value = args[index + 1]
  if (value === undefined) {
    throw new InvalidInputError(`${name} requires a value`)
  }
  return [value, index + 1]
}

export const parseArguments = (args: readonly string[]): ParsedArguments => {
  const positionals: string[] = []
  const options: { state?: string; menuUrl?: string; menuFile?: string } = {}
  let help = false
  let version = false

  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === undefined) {
      continue
    }
    if (argument === '--help' || argument === '-h') {
      help = true
      continue
    }
    if (argument === '--version' || argument === '-v') {
      version = true
      continue
    }
    if (argument === '--state' || argument === '--menu-url' || argument === '--menu-file') {
      const [value, next] = optionValue(args, index, argument)
      if (argument === '--state') {
        options.state = value
      } else if (argument === '--menu-url') {
        options.menuUrl = value
      } else {
        options.menuFile = value
      }
      index = next
      continue
    }
    const equals = argument.indexOf('=')
    if (equals > 0) {
      const name = argument.slice(0, equals)
      const value = argument.slice(equals + 1)
      if (name === '--state') {
        options.state = value
        continue
      }
      if (name === '--menu-url') {
        options.menuUrl = value
        continue
      }
      if (name === '--menu-file') {
        options.menuFile = value
        continue
      }
    }
    positionals.push(argument)
  }

  return {
    ...(positionals[0] ? { command: positionals[0] } : {}),
    positionals: positionals.slice(1),
    options,
    help,
    version,
  }
}
