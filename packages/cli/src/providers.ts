import { describeProvider } from '@unorder/core'
import { createKurasushi } from '@unorder/kurasushi'
import { createSushiro } from '@unorder/sushiro'
import { createSaizeriya } from '@unorder/saizeriya'

/** Every built-in provider is bundled into the CLI and MCP server. */
export const providers = [createSaizeriya(), createKurasushi(), createSushiro()] as const

export type BuiltinProvider = (typeof providers)[number]
export type BuiltinProviderId = 'saizeriya' | 'kurasushi' | 'sushiro'

export const findProvider = (id: string): BuiltinProvider | undefined =>
  providers.find((provider) => describeProvider(provider).id === id)

export const asDescribableProviders = () => providers
