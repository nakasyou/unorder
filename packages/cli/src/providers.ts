import { describeProvider } from '@unorder/core'
import { createSaizeriya } from '@unorder/saizeriya'
import { createSushiro } from '@unorder/sushiro'

/** Every built-in provider is bundled into the CLI and MCP server. */
export const providers = [createSaizeriya(), createSushiro()] as const

export type BuiltinProvider = (typeof providers)[number]
export type BuiltinProviderId = 'saizeriya' | 'sushiro'

export const findProvider = (id: string): BuiltinProvider | undefined =>
  providers.find((provider) => describeProvider(provider).id === id)

export const asDescribableProviders = () => providers
