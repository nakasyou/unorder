import { UnsupportedError } from '@unorder/core'
import type { SessionStore } from '@unorder/core'
import type { BuiltinProvider } from './providers'
import { findProvider } from './providers'

export interface ProviderConfigOverrides {
  readonly menuUrl?: string
  readonly menuFile?: string
}

export interface ExecuteOptions {
  readonly providerId: string
  readonly method: string
  readonly input: unknown
  readonly store: SessionStore
  readonly overrides?: ProviderConfigOverrides
  /** Injection point for tests and embedders. */
  readonly fetch?: typeof globalThis.fetch
}

export interface ExecuteResult {
  readonly output: unknown
  readonly session: 'saved' | 'cleared' | 'unchanged'
}

/** Builds provider config, preferring CLI flags over environment variables. */
export const providerConfig = (
  providerId: string,
  overrides: ProviderConfigOverrides = {},
): Record<string, unknown> | undefined => {
  if (providerId !== 'saizeriya') {
    return undefined
  }
  const menuUrl =
    overrides.menuUrl ?? process.env.UNORDER_SAIZERIYA_MENU_URL ?? process.env.UNORDER_MENU_URL
  const menuFile =
    overrides.menuFile ?? process.env.UNORDER_SAIZERIYA_MENU_FILE ?? process.env.UNORDER_MENU_FILE
  return {
    ...(menuUrl ? { menuUrl } : {}),
    ...(menuFile ? { menuFile } : {}),
  }
}

export const resolveProvider = (providerId: string): BuiltinProvider => {
  const provider = findProvider(providerId)
  if (!provider) {
    throw new UnsupportedError(`Unknown provider: ${providerId}`)
  }
  return provider
}

/** Runs one method with persisted CLI state. */
export const executeMethod = async (options: ExecuteOptions): Promise<ExecuteResult> => {
  const provider = resolveProvider(options.providerId)
  const existing = await options.store.load(provider.id)
  const config = providerConfig(provider.id, options.overrides)
  const runtime = provider.createRuntime({
    ...(existing ? { session: existing } : {}),
    ...(config ? { config: config as never } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  })

  const output = await runtime.invoke(options.method, options.input ?? {})
  if (runtime.isOpen()) {
    await options.store.save(runtime.exportSession())
    return { output, session: 'saved' }
  }
  if (existing) {
    await options.store.clear(provider.id)
    return { output, session: 'cleared' }
  }
  return { output, session: 'unchanged' }
}
