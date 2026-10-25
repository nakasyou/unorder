import type { DescribableProvider } from '@unorder/core'
import { saizeriya } from '@unorder/saizeriya'

/** Every built-in provider is bundled into the CLI and MCP server. */
export const providers = [saizeriya] as const

export type BuiltinProvider = (typeof providers)[number]
export type BuiltinProviderId = BuiltinProvider['id']

export const findProvider = (id: string): BuiltinProvider | undefined =>
  providers.find((provider) => provider.id === id)

export const asDescribableProviders = (): readonly DescribableProvider[] => providers
