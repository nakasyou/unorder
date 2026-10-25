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

/** Any method map, used by APIs that only need names and runtime handlers. */
export type AnyMethodMap = Record<string, AnyMethodDefinition<any, any>>

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
  readonly shops: boolean
  readonly queue: boolean
  readonly waitlist: boolean
  readonly reservations: boolean
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

export interface ProviderRuntime<Id extends string, State, Methods extends AnyMethodMap> {
  readonly providerId: Id
  readonly methods: Methods
  call<Name extends keyof Methods & string>(
    name: Name,
    input: MethodInput<Methods[Name]>,
  ): Promise<MethodOutput<Methods[Name]>>
  call(name: 'session.export', input?: Record<string, never>): Promise<SessionExport<State>>
  invoke(name: string, input?: unknown): Promise<unknown>
  getState(): State | null
  isOpen(): boolean
  importSession(session: SessionExport): void
}

/**
 * The public surface of a provider instance. Runtime state, method metadata,
 * configuration, and the underlying client stay inside the closure.
 */
export interface ProviderInstance<Methods extends AnyMethodMap> {
  call<Name extends keyof Methods & string>(
    name: Name,
    input: MethodInput<Methods[Name]>,
  ): Promise<MethodOutput<Methods[Name]>>
  call(name: 'session.export', input?: Record<string, never>): Promise<SessionExport<unknown>>
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
  /** Converts state to JSON-serializable data for `SessionExport.state`. */
  readonly serializeState?: (state: State) => unknown
}

export type ProviderDefinition<
  Id extends string,
  State,
  Config,
  Methods extends MethodMap<State, Config>,
> = ProviderDefinitionInput<Id, State, Config, Methods>

/** Backwards-compatible alias for provider metadata. */
export type Provider<
  Id extends string,
  State,
  Config,
  Methods extends MethodMap<State, Config>,
> = ProviderDefinition<Id, State, Config, Methods>

/**
 * Declares a provider definition. This is intentionally an identity function:
 * all runtime behavior lives in `createProviderRuntime` / `createProviderInstance`.
 * The generic parameters exist only to preserve method, state, and config types.
 */
export const defineProvider = <
  const Id extends string,
  State,
  Config,
  const Methods extends MethodMap<State, Config>,
>(
  definition: ProviderDefinitionInput<Id, State, Config, Methods>,
): ProviderDefinition<Id, State, Config, Methods> => definition

interface InstanceInternals {
  readonly definition: ProviderDefinitionInput<any, any, any, any>
  readonly runtime: ProviderRuntime<any, any, any>
  readonly options: ProviderCreateOptions<unknown>
}

const instanceInternals = new WeakMap<object, InstanceInternals>()

const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null

const isDefinition = (value: object): value is ProviderDefinitionInput<any, any, any, any> =>
  'methods' in value && 'stateVersion' in value && 'id' in value

/** Resolves a definition from either a definition or a call-only instance. */
export const resolveProviderDefinition = (
  provider: ProviderDefinitionInput<any, any, any, any> | ProviderInstance<any>,
): ProviderDefinitionInput<any, any, any, any> => {
  if (isObject(provider) && isDefinition(provider)) {
    return provider
  }
  if (isObject(provider)) {
    const internal = instanceInternals.get(provider)
    if (internal) {
      return internal.definition
    }
  }
  throw new InvalidInputError('Value is not an unorder provider or provider instance')
}

const runtimeForInstance = (provider: unknown): ProviderRuntime<any, any, any> | undefined =>
  isObject(provider) ? instanceInternals.get(provider)?.runtime : undefined

export const isProviderInstance = (value: unknown): value is ProviderInstance<any> =>
  isObject(value) && instanceInternals.has(value)

const methodNames = (
  definition: ProviderDefinitionInput<any, any, any, any>,
): readonly string[] => {
  const names = Object.keys(definition.methods)
  if (!names.includes('session.export')) {
    names.push('session.export')
  }
  return names.sort()
}

const deriveCapabilities = (
  definition: ProviderDefinitionInput<any, any, any, any>,
): ProviderCapabilities => {
  const names = methodNames(definition)
  return {
    methods: names,
    menu: definition.menus ?? 'none',
    shops: names.includes('shop.list') || names.includes('shop.get'),
    queue: names.includes('queue.get'),
    waitlist:
      names.includes('waitlist.join') ||
      names.includes('waitlist.cancel') ||
      names.includes('waitlist.status'),
    reservations: names.includes('reservation.slots') || names.includes('reservation.list'),
    ordering: names.includes('order.send'),
    billing: names.includes('bill.get') || names.includes('receipt.get'),
    calls: names.includes('staff.call'),
  }
}

export const getProviderCapabilities = (
  provider: ProviderDefinitionInput<any, any, any, any> | ProviderInstance<any>,
): ProviderCapabilities => deriveCapabilities(resolveProviderDefinition(provider))

export interface SessionExportOptions {
  readonly createdAt?: string
  readonly updatedAt?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

const cloneValue = <Value>(value: Value): Value => {
  if (value === undefined) {
    return value
  }
  return structuredClone(value)
}

/**
 * Serializes provider state into the versioned, JSON-serializable session
 * envelope. Providers only supply the optional `serializeState` hook.
 */
export const exportSession = <State>(
  provider: ProviderDefinitionInput<any, State, any, any> | ProviderInstance<any>,
  state?: State | null,
  options: SessionExportOptions = {},
): SessionExport<State> => {
  const definition = resolveProviderDefinition(provider)
  const runtime = runtimeForInstance(provider)
  const current = state === undefined ? (runtime?.getState() as State | null | undefined) : state
  const actualState = current === undefined ? null : current
  const now = new Date().toISOString()
  const serialized =
    actualState === null
      ? null
      : definition.serializeState
        ? definition.serializeState(actualState)
        : actualState
  return {
    format: 'unorder.session',
    version: 1,
    provider: definition.id,
    stateVersion: definition.stateVersion,
    createdAt: options.createdAt ?? now,
    updatedAt: options.updatedAt ?? now,
    state: actualState === null ? null : (cloneValue(serialized) as State),
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
  }
}

const buildRuntime = <Id extends string, State, Config, Methods extends MethodMap<State, Config>>(
  definition: ProviderDefinitionInput<Id, State, Config, Methods>,
  options: ProviderCreateOptions<Config>,
): ProviderRuntime<Id, State, Methods> => {
  const methods = definition.methods
  const defaultConfig = (definition.defaultConfig ?? {}) as Partial<Config>
  const config = { ...defaultConfig, ...options.config } as Config
  const fetchImpl = options.fetch ?? globalThis.fetch
  const now = options.now ?? (() => new Date())
  const timestamps = { createdAt: now().toISOString(), updatedAt: now().toISOString() }
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

  const exportCurrentSession = (): SessionExport<State> =>
    exportSession(definition, state, {
      createdAt: timestamps.createdAt,
      updatedAt: timestamps.updatedAt,
    }) as SessionExport<State>

  const getMethod = (name: string): AnyMethodDefinition<State, Config> => {
    const method = methods[name]
    if (!method) {
      throw new UnsupportedError(
        `Provider "${definition.id}" does not support the "${name}" method`,
        {
          details: {
            provider: definition.id,
            method: name,
            available: methodNames(definition),
          },
        },
      )
    }
    return method
  }

  const invoke = async (name: string, input: unknown = {}): Promise<unknown> => {
    if (name === 'session.export') {
      return exportCurrentSession()
    }
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
          timestamps.createdAt = now().toISOString()
        }
        state = next
        timestamps.updatedAt = now().toISOString()
      },
      requireState() {
        if (state === null) {
          throw new AuthRequiredError(
            `${definition.id}.${name} requires an open session; call session.open first`,
          )
        }
        return state
      },
    }

    const output = await method.handler(context, normalizedInput as never)
    if (state !== null) {
      timestamps.updatedAt = now().toISOString()
    }
    return output
  }

  const runtime = {
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
    importSession(session: SessionExport) {
      const next = ensureImportedState(session)
      state = next
      timestamps.createdAt = session.createdAt
      timestamps.updatedAt = session.updatedAt
    },
  } as ProviderRuntime<Id, State, Methods>

  return runtime
}

export function createProviderRuntime<
  Id extends string,
  State,
  Config,
  Methods extends MethodMap<State, Config>,
>(
  definition: ProviderDefinitionInput<Id, State, Config, Methods>,
  options?: ProviderCreateOptions<Config>,
): ProviderRuntime<Id, State, Methods>
export function createProviderRuntime<Methods extends AnyMethodMap>(
  instance: ProviderInstance<Methods>,
  options?: ProviderCreateOptions<unknown>,
): ProviderRuntime<string, unknown, Methods>
export function createProviderRuntime(
  provider: ProviderDefinitionInput<any, any, any, any> | ProviderInstance<any>,
  options: ProviderCreateOptions<unknown> = {},
): ProviderRuntime<any, any, any> {
  const definition = resolveProviderDefinition(provider)
  const internal = isObject(provider) ? instanceInternals.get(provider) : undefined
  if (internal) {
    if (Object.keys(options).length === 0) {
      return internal.runtime
    }
    const config = {
      ...(internal.options.config as object | undefined),
      ...(options.config as object | undefined),
    }
    const merged = {
      ...internal.options,
      ...options,
      ...(Object.keys(config).length > 0 ? { config } : {}),
    }
    return buildRuntime(definition, merged) as ProviderRuntime<any, any, any>
  }
  return buildRuntime(definition, options)
}

/**
 * Creates a call-only provider object. Metadata and session management are
 * available through core helpers such as `describeProvider`, `exportSession`,
 * and `createProviderRuntime`.
 */
export const createProviderInstance = <
  Id extends string,
  State,
  Config,
  Methods extends MethodMap<State, Config>,
>(
  definition: ProviderDefinitionInput<Id, State, Config, Methods>,
  options: ProviderCreateOptions<Config> = {},
): ProviderInstance<Methods> => {
  const runtime = buildRuntime(definition, options)
  const instance: ProviderInstance<Methods> = {
    call(name: string, input?: unknown) {
      return runtime.invoke(name, input) as never
    },
  } as ProviderInstance<Methods>
  instanceInternals.set(instance, {
    definition: definition as ProviderDefinitionInput<any, any, any, any>,
    runtime: runtime as ProviderRuntime<any, any, any>,
    options: options as ProviderCreateOptions<unknown>,
  })
  return instance
}

/** Alias for `createProviderInstance`. */
export const instantiate = createProviderInstance

export const hasMethod = (
  provider: ProviderDefinitionInput<any, any, any, any> | ProviderInstance<any>,
  name: string,
): boolean => methodNames(resolveProviderDefinition(provider)).includes(name)

export const hasCapability = (
  provider: ProviderDefinitionInput<any, any, any, any> | ProviderInstance<any>,
  name: string,
): boolean => getProviderCapabilities(provider).methods.includes(name)
