import { AuthRequiredError, InvalidInputError, UnsupportedError } from './errors'
import type { Schema } from './schema'
import { validateSchema } from './schema'
import type { SessionExport } from './session'
import { isSessionExport } from './session'

export type SessionRequirement = 'none' | 'optional' | 'required'

export interface MethodAnnotations {
  readonly readOnlyHint?: boolean
  readonly destructiveHint?: boolean
  readonly idempotentHint?: boolean
  readonly openWorldHint?: boolean
}

export interface MethodContext<State, Config> {
  readonly config: Config
  readonly fetch: typeof globalThis.fetch
  readonly now: () => Date
  /** Current session state, or null before session.open / after session.close. */
  readonly state: State | null
  setState(state: State | null): void
  requireState(): State
  exportSession(): SessionExport<State>
}

export type MethodHandler<State, Config, Input, Output> = (
  context: MethodContext<State, Config>,
  input: Input,
) => Output | Promise<Output>

declare const methodInputType: unique symbol
declare const methodOutputType: unique symbol

/** A single callable provider method. */
export interface MethodDefinition<
  State = unknown,
  Config = unknown,
  Input = unknown,
  Output = unknown,
> {
  readonly name: string
  readonly summary: string
  readonly description: string
  readonly input: Schema
  readonly output: Schema
  readonly session: SessionRequirement
  readonly annotations: MethodAnnotations
  readonly handler: MethodHandler<State, Config, Input, Output>
  /** Phantom type used to recover Input without depending on handler variance. */
  readonly [methodInputType]?: Input
  /** Phantom type used to recover Output without depending on handler variance. */
  readonly [methodOutputType]?: Output
}

/** Internal erased form used by the runtime. */
export type AnyMethodDefinition<State, Config> = Omit<
  MethodDefinition<State, Config, unknown, unknown>,
  'handler'
> & {
  readonly handler: MethodHandler<State, Config, never, unknown>
}

export type MethodMap<State, Config> = Record<string, AnyMethodDefinition<State, Config>>

export type MethodInput<Definition> = Definition extends {
  readonly [methodInputType]?: infer Input
}
  ? Input
  : never

export type MethodOutput<Definition> = Definition extends {
  readonly [methodOutputType]?: infer Output
}
  ? Output
  : never

/** Helper that preserves the handler input/output types for custom methods. */
export const defineMethod = <State, Config, Input, Output>(
  definition: MethodDefinition<State, Config, Input, Output>,
): MethodDefinition<State, Config, Input, Output> => definition

export type MenuCapability = 'none' | 'static' | 'dynamic' | 'both'

export interface ProviderCapabilities {
  readonly methods: readonly string[]
  readonly menu: MenuCapability
  readonly ordering: boolean
  readonly billing: boolean
  readonly calls: boolean
}

export interface ProviderCreateOptions<Config> {
  readonly config?: Partial<Config>
  readonly fetch?: typeof globalThis.fetch
  readonly now?: () => Date
  readonly session?: SessionExport
}

export interface ProviderRuntime<Id extends string, State, Methods> {
  readonly providerId: Id
  readonly methods: Methods
  call<Name extends keyof Methods & string>(
    name: Name,
    input: MethodInput<Methods[Name]>,
  ): Promise<MethodOutput<Methods[Name]>>
  invoke(name: string, input?: unknown): Promise<unknown>
  getState(): State | null
  isOpen(): boolean
  exportSession(): SessionExport<State>
  importSession(session: SessionExport): void
}

export interface ProviderDefinitionInput<
  Id extends string,
  State,
  Config,
  Methods extends MethodMap<State, Config>,
> {
  readonly id: Id
  readonly displayName: string
  readonly description: string
  readonly version?: string
  readonly stateVersion: number
  readonly config?: Schema
  readonly defaultConfig?: Partial<Config>
  readonly menus?: MenuCapability
  readonly methods: Methods
  /** Rehydrates provider state loaded from a session envelope. */
  readonly validateState?: (raw: unknown) => State
  /** Migrates older provider state to the current `stateVersion`. */
  readonly migrateState?: (raw: unknown, fromVersion: number) => State
}

export interface Provider<
  Id extends string,
  State,
  Config,
  Methods extends MethodMap<State, Config>,
> {
  readonly id: Id
  readonly displayName: string
  readonly description: string
  readonly version: string
  readonly stateVersion: number
  readonly config: Schema
  readonly capabilities: ProviderCapabilities
  readonly methods: Methods
  createRuntime(options?: ProviderCreateOptions<Config>): ProviderRuntime<Id, State, Methods>
}

const cloneValue = <Value>(value: Value): Value => {
  if (value === undefined) {
    return value
  }
  return structuredClone(value)
}

const iso = (now: () => Date) => now().toISOString()

const deriveCapabilities = <State, Config>(
  methods: MethodMap<State, Config>,
  menus: MenuCapability,
): ProviderCapabilities => {
  const names = Object.keys(methods)
  return {
    methods: names,
    menu: menus,
    ordering: names.includes('order.send'),
    billing: names.includes('bill.get') || names.includes('receipt.get'),
    calls: names.includes('staff.call'),
  }
}

/**
 * Defines a provider with a typed method map. The returned object is metadata
 * plus a factory; it does not open a network connection or hold session state.
 */
export const defineProvider = <
  const Id extends string,
  State,
  Config,
  const Methods extends MethodMap<State, Config>,
>(
  definition: ProviderDefinitionInput<Id, State, Config, Methods>,
): Provider<Id, State, Config, Methods> => {
  const methods = definition.methods
  const defaultConfig = (definition.defaultConfig ?? {}) as Partial<Config>
  const capabilities = deriveCapabilities(methods, definition.menus ?? 'none')

  return {
    id: definition.id,
    displayName: definition.displayName,
    description: definition.description,
    version: definition.version ?? '0.1.0',
    stateVersion: definition.stateVersion,
    config: definition.config ?? { type: 'unknown' },
    capabilities,
    methods,
    createRuntime(options = {}) {
      const config = { ...defaultConfig, ...options.config } as Config
      const fetchImpl = options.fetch ?? globalThis.fetch
      const now = options.now ?? (() => new Date())
      const timestamps = { createdAt: iso(now), updatedAt: iso(now) }
      let state: State | null = null

      const ensureImportedState = (session: SessionExport): State | null => {
        if (!isSessionExport(session)) {
          throw new InvalidInputError('Session envelope is not a valid unorder.session value')
        }
        if (session.provider !== definition.id) {
          throw new InvalidInputError(
            `Session belongs to provider "${session.provider}", not "${definition.id}"`,
          )
        }
        if (session.state === null) {
          return null
        }
        if (session.stateVersion > definition.stateVersion) {
          throw new InvalidInputError(
            `Session state version ${session.stateVersion} is newer than supported version ${definition.stateVersion}`,
          )
        }
        let raw: unknown = session.state
        if (session.stateVersion < definition.stateVersion) {
          if (!definition.migrateState) {
            throw new InvalidInputError(
              `No migration from session state version ${session.stateVersion} to ${definition.stateVersion}`,
            )
          }
          raw = definition.migrateState(raw, session.stateVersion)
        }
        return definition.validateState ? definition.validateState(raw) : (raw as State)
      }

      if (options.session) {
        state = ensureImportedState(options.session)
        timestamps.createdAt = options.session.createdAt
        timestamps.updatedAt = options.session.updatedAt
      }

      const exportSession = (): SessionExport<State> => ({
        format: 'unorder.session',
        version: 1,
        provider: definition.id,
        stateVersion: definition.stateVersion,
        createdAt: timestamps.createdAt,
        updatedAt: timestamps.updatedAt,
        state: state === null ? null : cloneValue(state),
      })

      const getMethod = (name: string): AnyMethodDefinition<State, Config> => {
        const method = methods[name]
        if (!method) {
          throw new UnsupportedError(
            `Provider "${definition.id}" does not support the "${name}" method`,
            { details: { provider: definition.id, method: name, available: capabilities.methods } },
          )
        }
        return method
      }

      const invoke = async (name: string, input: unknown = {}): Promise<unknown> => {
        const method = getMethod(name)
        const normalizedInput = input ?? {}
        const issues = validateSchema(method.input, normalizedInput)
        if (issues.length > 0) {
          throw new InvalidInputError(
            `Invalid input for ${definition.id}.${name}: ${issues[0]?.message ?? 'invalid value'}`,
            { details: { provider: definition.id, method: name, issues } },
          )
        }
        if (method.session === 'required' && state === null) {
          throw new AuthRequiredError(
            `${definition.id}.${name} requires an open session; call session.open first`,
          )
        }

        const context: MethodContext<State, Config> = {
          config,
          fetch: fetchImpl,
          now,
          get state() {
            return state
          },
          setState(next) {
            if (state === null && next !== null) {
              timestamps.createdAt = iso(now)
            }
            state = next
            timestamps.updatedAt = iso(now)
          },
          requireState() {
            if (state === null) {
              throw new AuthRequiredError(
                `${definition.id}.${name} requires an open session; call session.open first`,
              )
            }
            return state
          },
          exportSession,
        }

        const output = await method.handler(context, normalizedInput as never)
        if (state !== null) {
          timestamps.updatedAt = iso(now)
        }
        return output
      }

      return {
        providerId: definition.id,
        methods,
        async call<Name extends keyof Methods & string>(
          name: Name,
          input: MethodInput<Methods[Name]>,
        ): Promise<MethodOutput<Methods[Name]>> {
          return (await invoke(name, input)) as MethodOutput<Methods[Name]>
        },
        invoke,
        getState: () => (state === null ? null : cloneValue(state)),
        isOpen: () => state !== null,
        exportSession,
        importSession(session) {
          const next = ensureImportedState(session)
          state = next
          timestamps.createdAt = session.createdAt
          timestamps.updatedAt = session.updatedAt
        },
      }
    },
  }
}

export const hasMethod = <State, Config, Methods extends MethodMap<State, Config>>(
  provider: Pick<Provider<string, State, Config, Methods>, 'methods'>,
  name: string,
): boolean => name in provider.methods

export const hasCapability = <State, Config, Methods extends MethodMap<State, Config>>(
  provider: Pick<Provider<string, State, Config, Methods>, 'capabilities'>,
  name: string,
): boolean => provider.capabilities.methods.includes(name)
