# @unorder/core

Provider-independent types, schemas, errors, and the typed provider runtime for
unorder. This package has no runtime dependencies.

## What is here

- Branded identifiers (`ShopId`, `TableId`, `MenuItemId`, `OrderId`, ...)
- Normalized domain types (`Shop`, `Menu`, `MenuItem`, `Cart`, `Order`, `Bill`,
  `Receipt`, `Session`, `Money`)
- Lightweight JSON-Schema-like input/output descriptions and validation
- A JSON-serializable error hierarchy (`UnorderError` and friends)
- `defineProvider`, `defineMethod`, and `defineStandardMethod`
- `describeMethods` / `formatProviderHelp` for CLI and MCP generation
- Static/dynamic menu-source helpers (`listMenuItems`, `filterMenuItems`)
- Versioned `SessionExport` and `SessionStore` interfaces

## Example

```ts
import { defineProvider, defineStandardMethod, s } from '@unorder/core'

interface State {
  token: string
}

const provider = defineProvider<'demo', State, { label: string }, typeof methods>({
  id: 'demo',
  displayName: 'Demo',
  description: 'Example provider',
  stateVersion: 1,
  config: s.object({ label: s.string() }),
  methods,
})

const runtime = provider.createRuntime()
const output = await runtime.call('menu.list', { query: 'pasta' })
const session = runtime.exportSession()
```

Provider method handlers receive a context with the current state, provider config,
an injectable `fetch`, and a clock. Session-required methods fail with
`AuthRequiredError` before the handler runs. Unknown methods fail with
`UnsupportedError`, and schema violations fail with `InvalidInputError`.

The standard method surface is declared once in `src/standard.ts`; providers reuse
the schemas and descriptions through `defineStandardMethod`. Extensions should use
an `x-<provider>.</provider>` namespace so the standard surface stays stable.
