import type { MethodAnnotations, ProviderCapabilities, SessionRequirement } from './provider'
import type { Schema } from './schema'

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

/** Describes one method in a transport-neutral shape. */
export const describeMethod = (
  provider: DescribableProvider,
  name: string,
): MethodDescriptor | undefined => {
  const method = provider.methods[name]
  if (!method) {
    return undefined
  }
  return {
    provider: provider.id,
    name: method.name,
    fullName: `${provider.id}.${method.name}`,
    summary: method.summary,
    description: method.description,
    input: method.input,
    output: method.output,
    session: method.session,
    annotations: method.annotations,
  }
}

/** Describes every method a provider exposes; used by CLI help and MCP tools/list. */
export const describeMethods = (provider: DescribableProvider): readonly MethodDescriptor[] =>
  Object.keys(provider.methods)
    .sort()
    .flatMap((name) => {
      const descriptor = describeMethod(provider, name)
      return descriptor ? [descriptor] : []
    })

export const describeProvider = (provider: DescribableProvider): ProviderDescriptor => ({
  id: provider.id,
  displayName: provider.displayName,
  description: provider.description,
  version: provider.version,
  capabilities: provider.capabilities,
  methods: describeMethods(provider),
})

export const describeProviders = (
  providers: readonly DescribableProvider[],
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
export const formatProviderHelp = (providers: readonly DescribableProvider[]): string => {
  const lines: string[] = []
  lines.push('Providers:')
  for (const provider of providers) {
    lines.push(
      `  ${provider.id} — ${provider.displayName} (${provider.capabilities.methods.length} methods)`,
      `    ${provider.description}`,
    )
  }
  lines.push('', 'Methods:')
  for (const provider of providers) {
    lines.push(`  [${provider.id}]`)
    for (const method of describeMethods(provider)) {
      lines.push(`    ${method.fullName}  ${method.summary}`)
      lines.push(`      input: ${formatSchema(method.input)}`)
      if (method.session === 'required') {
        lines.push('      session: required')
      }
    }
  }
  return lines.join('\n')
}
