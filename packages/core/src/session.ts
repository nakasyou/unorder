import type { UnorderError } from './errors'

/**
 * Versioned, JSON-serializable session envelope. The `state` shape belongs to
 * the provider and is intentionally opaque to the CLI and MCP layers.
 */
export interface SessionExport<State = unknown> {
  readonly format: 'unorder.session'
  readonly version: 1
  readonly provider: string
  readonly stateVersion: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly state: State | null
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface SessionStore {
  load(provider: string): Promise<SessionExport | null>
  save(session: SessionExport): Promise<void>
  clear(provider: string): Promise<void>
}

export const isSessionExport = (value: unknown): value is SessionExport => {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<SessionExport>
  return (
    candidate.format === 'unorder.session' &&
    candidate.version === 1 &&
    typeof candidate.provider === 'string' &&
    typeof candidate.stateVersion === 'number' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    'state' in candidate
  )
}

/** A tiny in-memory store used by MCP and tests. */
export class MemorySessionStore implements SessionStore {
  readonly #sessions = new Map<string, SessionExport>()

  async load(provider: string): Promise<SessionExport | null> {
    return this.#sessions.get(provider) ?? null
  }

  async save(session: SessionExport): Promise<void> {
    this.#sessions.set(session.provider, session)
  }

  async clear(provider: string): Promise<void> {
    this.#sessions.delete(provider)
  }
}

export type SessionStoreError = UnorderError
