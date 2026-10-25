import type { SessionExport } from './session'
import type {
  AnyMethodMap,
  MethodInput,
  MethodOutput,
  ProviderDefinitionInput,
  ProviderInstance,
} from './provider'
import { createProviderInstance, isProviderInstance, resolveProviderDefinition } from './provider'

type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : never

type MethodPath<Name extends string, Input, Output> = Name extends `${infer Head}.${infer Rest}`
  ? { readonly [Key in Head]: MethodPath<Rest, Input, Output> }
  : { readonly [Key in Name]: (input: Input) => Promise<Output> }

/**
 * Recursively maps dot-separated method names to nested, typed callable
 * properties, e.g. `order.send` becomes `client.order.send(input)`.
 */
export type MethodClient<Methods extends AnyMethodMap> = UnionToIntersection<
  | {
      [Name in keyof Methods & string]: MethodPath<
        Name,
        MethodInput<Methods[Name]>,
        MethodOutput<Methods[Name]>
      >
    }[keyof Methods & string]
  | MethodPath<'session.export', Record<string, never>, SessionExport>
>

export type ClientFor<Methods extends AnyMethodMap> = MethodClient<Methods>

const proxyFor = (
  instance: ProviderInstance<AnyMethodMap>,
  names: ReadonlySet<string>,
): unknown => {
  const makeUnknown = (path: string): unknown =>
    new Proxy(() => undefined, {
      get(_target, property) {
        if (typeof property !== 'string') {
          return undefined
        }
        return makeUnknown(path ? `${path}.${property}` : property)
      },
      apply(_target, _thisArg, args: unknown[]) {
        return instance.call(path as never, (args[0] ?? {}) as never)
      },
    })

  const make = (path: string): unknown =>
    new Proxy(() => undefined, {
      get(_target, property) {
        if (typeof property !== 'string') {
          return undefined
        }
        const next = path ? `${path}.${property}` : property
        if (names.has(next)) {
          return (input: unknown) => instance.call(next as never, (input ?? {}) as never)
        }
        if ([...names].some((name) => name.startsWith(`${next}.`))) {
          return make(next)
        }
        return makeUnknown(next)
      },
    })
  return make('')
}

export function createClient<Id extends string, State, Config, Methods extends AnyMethodMap>(
  provider: ProviderDefinitionInput<Id, State, Config, Methods>,
): MethodClient<Methods>
export function createClient<Methods extends AnyMethodMap>(
  provider: ProviderInstance<Methods>,
): MethodClient<Methods>
export function createClient(provider: unknown): unknown {
  const definition = resolveProviderDefinition(
    provider as
      | ProviderDefinitionInput<string, unknown, unknown, AnyMethodMap>
      | ProviderInstance<AnyMethodMap>,
  )
  const instance = isProviderInstance(provider)
    ? provider
    : createProviderInstance(
        provider as ProviderDefinitionInput<string, unknown, unknown, AnyMethodMap>,
      )
  return proxyFor(instance, new Set([...Object.keys(definition.methods), 'session.export']))
}

/** Alias for `createClient` that emphasizes the proxy behavior. */
export const proxyClient = createClient
