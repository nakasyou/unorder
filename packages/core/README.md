# @unorder/core

Provider-independent types, schemas, errors, and the typed provider runtime for
unorder. This package has no runtime dependencies.

## What is here

- Branded identifiers (`ShopId`, `TableId`, `MenuItemId`, `OrderId`, ...)
- Normalized domain types (`Shop`, `Menu`, `MenuItem`, `Cart`, `Order`, `Bill`,
  `Receipt`, `Session`, `Money`)
- Lightweight JSON-Schema-like input/output descriptions and validation
- A JSON-serializable error hierarchy (`UnorderError` and friends)
- `defineProvider` (type-only identity), `defineMethod`, and `defineStandardMethod`
- `createProviderRuntime` / `createProviderInstance` for the shared runtime
- `createClient` / `proxyClient` for typed nested method calls
- `exportSession` for versioned session serialization
- `describeMethods` / `formatProviderHelp` for CLI and MCP generation
- Static/dynamic menu-source helpers (`listMenuItems`, `filterMenuItems`)
- Versioned `SessionExport` and `SessionStore` interfaces

## Example

```ts
import {
  createClient,
  createProviderRuntime,
  defineProvider,
  defineStandardMethod,
  s,
} from '@unorder/core'

interface State {
  token: string
}

const provider = defineProvider<'demo', State, { label: string }, typeof methods>({
  id: 'demo',
  displayName: 'Demo',
  description: 'Example provider',
  stateVersion: 1,
  config: s.object({ label: s.string() }),
  serializeState: (state) => state,
  methods,
})

const runtime = createProviderRuntime(provider)
const output = await runtime.call('menu.list', { query: 'pasta' })
const session = runtime.exportSession()

const instance = createProviderInstance(provider)
const client = createClient(instance)
await client.order.send({ note: 'no onions' })
```

`defineProvider` only preserves method/state/config types and returns its input
unchanged. `createProviderRuntime` merges config, accepts an injectable `fetch`
and clock, and can be seeded with a `SessionExport`. `createProviderInstance`
returns an object whose only public property is `call`; metadata stays available
through core introspection helpers.

Provider method handlers receive a context with the current state, provider
config, an injectable `fetch`, and a clock. Session-required methods fail with
`AuthRequiredError` before the handler runs. Unknown methods fail with
`UnsupportedError`, and schema violations fail with `InvalidInputError`.

## Sessions

`session.export` is provided automatically for every provider; providers do not
implement it. `exportSession(provider, state)` wraps serialized state in a
versioned `unorder.session` envelope. Providers may supply a minimal
`serializeState` hook and `validateState` / `migrateState` for imports.

The standard method surface is declared once in `src/standard.ts`; providers reuse
the schemas and descriptions through `defineStandardMethod`. Extensions should use
an `x-<provider>.` namespace so the standard surface stays stable.
