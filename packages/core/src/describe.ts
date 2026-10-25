import type {
  AnyMethodMap,
  MethodAnnotations,
  ProviderCapabilities,
  ProviderDefinitionInput,
  ProviderInstance,
  SessionRequirement,
} from './provider'
import { getProviderCapabilities, resolveProviderDefinition } from './provider'
import type { Schema } from './schema'
import { sessionExportMethodSpec } from './session'

export interface DescribableMethod {
  readonly name: string
  readonly summary: string
  readonly description: string
  readonly input: Schema
  readonly output: Schema
  readonly session: SessionRequirement
  readonly annotations: MethodAnnotations
}

export interface DescribableProvider {
  readonly id: string
  readonly displayName: string
  readonly description: string
  readonly version: string
  readonly capabilities: ProviderCapabilities
  readonly methods: Readonly<Record<string, DescribableMethod>>
}

export interface MethodDescriptor {
  readonly provider: string
  readonly name: string
  readonly fullName: string
  readonly summary: string
  readonly description: string
  readonly input: Schema
  readonly output: Schema
  readonly session: SessionRequirement
  readonly annotations: MethodAnnotations
}

export interface ProviderDescriptor {
  readonly id: string
  readonly displayName: string
  readonly description: string
  readonly version: string
  readonly capabilities: ProviderCapabilities
  readonly methods: readonly MethodDescriptor[]
}

type Describable =
  | ProviderDefinitionInput<string, unknown, unknown, AnyMethodMap>
  | ProviderInstance<AnyMethodMap>

/** Describes one method in a transport-neutral shape. */
export const describeMethod = (
  provider: Describable,
  name: string,
): MethodDescriptor | undefined => {
  const definition = resolveProviderDefinition(provider)
  if (name === 'session.export' && !definition.methods[name]) {
    return {
      provider: definition.id,
      name,
      fullName: `${definition.id}.${name}`,
      ...sessionExportMethodSpec,
    }
  }
  const method = definition.methods[name]
  if (!method) {
    return undefined
  }
  return {
    provider: definition.id,
    name: method.name,
    fullName: `${definition.id}.${method.name}`,
    summary: method.summary,
    description: method.description,
    input: method.input,
    output: method.output,
    session: method.session,
    annotations: method.annotations,
  }
}

const namesOf = (provider: Describable): readonly string[] => {
  const definition = resolveProviderDefinition(provider)
  const names = Object.keys(definition.methods)
  if (!names.includes('session.export')) {
    names.push('session.export')
  }
  return names.sort()
}

/** Describes every method a provider exposes; used by CLI help and MCP tools/list. */
export const describeMethods = (provider: Describable): readonly MethodDescriptor[] =>
  namesOf(provider).flatMap((name) => {
    const descriptor = describeMethod(provider, name)
    return descriptor ? [descriptor] : []
  })

export const describeProvider = (provider: Describable): ProviderDescriptor => {
  const definition = resolveProviderDefinition(provider)
  return {
    id: definition.id,
    displayName: definition.displayName,
    description: definition.description,
    version: definition.version ?? '0.1.0',
    capabilities: getProviderCapabilities(provider),
    methods: describeMethods(provider),
  }
}

export const describeProviders = (
  providers: readonly Describable[],
): readonly ProviderDescriptor[] => providers.map(describeProvider)

const schemaType = (schema: Schema): string => {
  if ('anyOf' in schema) {
    return schema.anyOf.map(schemaType).join(' | ')
  }
  if (schema.type === 'array') {
    return `${schemaType(schema.items)}[]`
  }
  if (schema.type === 'object') {
    const required = new Set(schema.required ?? [])
    const members = Object.entries(schema.properties).map(([key, property]) => {
      const suffix = required.has(key) ? '' : '?'
      return `${key}${suffix}: ${schemaType(property)}`
    })
    return members.length > 0 ? `{ ${members.join(', ')} }` : '{}'
  }
  if (schema.type === 'string' && schema.enum) {
    return schema.enum.map((value) => JSON.stringify(value)).join(' | ')
  }
  return schema.type
}

/** Compact, human-readable schema summary for `unorder --help`. */
export const formatSchema = (schema: Schema): string => schemaType(schema)

/** Formats every provider and method as plain text for terminal help. */
export const formatProviderHelp = (providers: readonly Describable[]): string => {
  const lines: string[] = []
  lines.push('Providers:')
  for (const provider of providers) {
    const descriptor = describeProvider(provider)
    lines.push(
      `  ${descriptor.id} — ${descriptor.displayName} (${descriptor.capabilities.methods.length} methods)`,
      `    ${descriptor.description}`,
    )
  }
  lines.push('', 'Methods:')
  for (const provider of providers) {
    const descriptor = describeProvider(provider)
    lines.push(`  [${descriptor.id}]`)
    for (const method of descriptor.methods) {
      lines.push(`    ${method.fullName}  ${method.summary}`)
      lines.push(`      input: ${formatSchema(method.input)}`)
      if (method.session === 'required') {
        lines.push('      session: required')
      }
    }
  }
  return lines.join('\n')
}
