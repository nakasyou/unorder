# @unorder/core

Provider-independent types, schemas, errors, and the typed provider runtime for
unorder. This package has no runtime dependencies.

## What is here

- Branded identifiers (`ShopId`, `TableId`, `MenuItemId`, `OrderId`, ...)
- Normalized domain types (`Shop`, `Queue`, `WaitlistTicket`, `Reservation`,
  `Menu`, `MenuItem`, `Cart`, `Order`, `Bill`, `Receipt`, `Session`, `Money`)
- Shared paging (`Page`) and location (`GeoPoint`) types
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
  exportSession,
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
const session = exportSession(provider, runtime.getState())

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

## Standard methods

The standard surface is declared once in `src/standard.ts`; providers reuse the
schemas and descriptions through `defineStandardMethod`. It covers session, menu,
shop, queue, waitlist, reservation, cart, order, billing, and service methods. See
the root README for the full table.

There are no `x-<provider>.*` extension methods. When a provider has a new
concept, extend the core domain types and add a provider-neutral standard method,
or keep the concept private.

## Sessions

`session.export` is provided automatically for every provider; providers do not
implement it. `exportSession(provider, state?)` wraps serialized state in a
versioned `unorder.session` envelope and is the only serializer. Providers may
supply a minimal `serializeState` hook and `validateState` / `migrateState` for
imports. `ProviderRuntime` deliberately has no `exportSession` method.
