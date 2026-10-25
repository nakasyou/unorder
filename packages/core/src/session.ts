import type { UnorderError } from './errors'
import type { MethodAnnotations, SessionRequirement } from './provider'
import type { Schema } from './schema'
import { s } from './schema'

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

/** JSON schema for the automatically provided `session.export` output. */
export const sessionExportSchema: Schema = s.object(
  {
    format: s.string({ enum: ['unorder.session'] }),
    version: s.integer({ minimum: 1, maximum: 1 }),
    provider: s.string(),
    stateVersion: s.integer({ minimum: 1 }),
    createdAt: s.string(),
    updatedAt: s.string(),
    state: s.unknown({ description: 'Provider-specific state, or null when closed' }),
    metadata: s.optional(s.unknown()),
  },
  { additionalProperties: true },
)

/**
 * Metadata for the provider-independent `session.export` method. Core adds this
 * method to every provider; providers no longer implement it themselves.
 */
export const sessionExportMethodSpec: {
  readonly summary: string
  readonly description: string
  readonly input: Schema
  readonly output: Schema
  readonly session: SessionRequirement
  readonly annotations: MethodAnnotations
} = {
  summary: 'Export the versioned session envelope.',
  description:
    'Returns a JSON-serializable session snapshot suitable for a state file or another process.',
  input: s.object({}),
  output: sessionExportSchema,
  session: 'none',
  annotations: { readOnlyHint: true, destructiveHint: false },
}
