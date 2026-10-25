import {
  createProviderRuntime,
  exportSession,
  InvalidInputError,
  UnsupportedError,
} from '@unorder/core'
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
  if (providerId === 'saizeriya') {
    const menuUrl =
      overrides.menuUrl ?? process.env.UNORDER_SAIZERIYA_MENU_URL ?? process.env.UNORDER_MENU_URL
    const menuFile =
      overrides.menuFile ?? process.env.UNORDER_SAIZERIYA_MENU_FILE ?? process.env.UNORDER_MENU_FILE
    return {
      ...(menuUrl ? { menuUrl } : {}),
      ...(menuFile ? { menuFile } : {}),
    }
  }
  if (providerId === 'sushiro') {
    const people = process.env.UNORDER_SUSHIRO_PEOPLE
    const peopleCount = people && /^\d+$/.test(people) ? Number.parseInt(people, 10) : undefined
    return {
      ...(process.env.UNORDER_SUSHIRO_STORE_ID
        ? { storeId: process.env.UNORDER_SUSHIRO_STORE_ID }
        : {}),
      ...(process.env.UNORDER_SUSHIRO_REGION ? { region: process.env.UNORDER_SUSHIRO_REGION } : {}),
      ...(process.env.UNORDER_SUSHIRO_GUID ? { guid: process.env.UNORDER_SUSHIRO_GUID } : {}),
      ...(process.env.UNORDER_SUSHIRO_TAKEOUT_TOKEN
        ? { takeoutToken: process.env.UNORDER_SUSHIRO_TAKEOUT_TOKEN }
        : {}),
      ...(process.env.UNORDER_SUSHIRO_TABLE_TYPE
        ? { tableType: process.env.UNORDER_SUSHIRO_TABLE_TYPE }
        : {}),
      ...(peopleCount === undefined ? {} : { peopleCount }),
    }
  }
  return undefined
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
  const existing = await options.store.load(options.providerId)
  if (options.method === 'session.export' && !existing) {
    throw new InvalidInputError(
      `No session is stored for provider "${options.providerId}"; open a session before exporting`,
    )
  }
  const config = providerConfig(options.providerId, options.overrides)
  const runtime = createProviderRuntime(provider, {
    ...(existing ? { session: existing } : {}),
    ...(config ? { config: config as never } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  })

  const output = await runtime.invoke(options.method, options.input ?? {})
  if (runtime.isOpen()) {
    const state = runtime.getState()
    await options.store.save(
      exportSession(provider, state, existing ? { createdAt: existing.createdAt } : {}),
    )
    return { output, session: 'saved' }
  }
  if (existing) {
    await options.store.clear(options.providerId)
    return { output, session: 'cleared' }
  }
  return { output, session: 'unchanged' }
}
