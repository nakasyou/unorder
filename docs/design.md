# unorder design

## Goals

unorder separates **provider-independent ordering semantics** from **provider
protocol details**. A caller should be able to list a menu, build a cart, submit an
order, and read a bill with the same method names and normalized domain types,
regardless of whether a provider enumerates menus dynamically or serves a pinned
snapshot.

The CLI and MCP server are thin adapters over the same provider registry. There is
no UI layer.

## Method registry and naming

Methods are dot-separated names. The standard surface is declared once in
`packages/core/src/standard.ts`:

| Area    | Methods                                              |
| ------- | ---------------------------------------------------- |
| Session | `session.open`, `session.close`, `session.export`    |
| Menu    | `menu.list`, `menu.get`                              |
| Cart    | `cart.list`, `cart.add`, `cart.remove`, `cart.clear` |
| Order   | `order.send`, `order.list` (submitted orders)        |
| Billing | `bill.get`, `receipt.get`                            |
| Service | `staff.call`                                         |

`menu.list` was chosen over `order.list` for menu enumeration because
`order.list` means submitted-order history, while `cart.list` means the current
unsubmitted cart. Provider extensions use an `x-<provider>.` namespace, for example
`x-saizeriya.people.set`.

`defineProvider` captures the method map as a generic parameter. This gives
`runtime.call('cart.add', { itemId: '1202' })` a typed input and output. The runtime
also exposes an untyped `invoke(name, input)` for CLI/MCP dispatch, which validates
the same schemas before calling the handler.

## Provider runtime

A provider definition is metadata plus a factory, not a connection:

- `id`, `displayName`, `description`, `version`
- `stateVersion`, config schema, menu capability
- methods with input/output schemas, summaries, descriptions, session requirement,
  and MCP annotations
- optional `validateState` / `migrateState`

`createRuntime` merges config, accepts an injectable `fetch` and clock, and can be
seeded with a `SessionExport`. Handlers receive a context with the current state,
`setState` / `requireState`, and `exportSession`. The runtime enforces required
sessions and validates input before dispatch:

- missing method → `UnsupportedError` (`unsupported`)
- bad input → `InvalidInputError` (`invalid_input`)
- closed session → `AuthRequiredError` (`auth_required`)
- server failure → `ProviderError` (`provider_error`)
- transport failure → `NetworkError` (`network`)

Every `UnorderError` has a stable `code` and a `toJSON()` payload, so the CLI and
MCP server can return the same error shape.

## Domain model

The domain types normalize provider data while preserving an escape hatch:

- IDs are branded strings (`ShopId`, `MenuItemId`, ...), preventing accidental
  mixing at compile time.
- Prices are `Money { amount, currency }`; yen is the default.
- `MenuItem` includes `availability`, `source`, optional options/modifiers, image,
  tags, and `raw` / `extensions`.
- Cart and order lines carry normalized quantities and totals.
- `Session` describes provider, shop, table, party size, page, and timestamps;
  provider-specific state stays in `SessionExport.state`.
- `Source` records whether menu data was static, dynamic, or injected.

## Menus: static and dynamic

`MenuSource` models both cases:

- static: URL, local file, or injected entries
- dynamic: a provider implementation

`MenuListInput` is shared: free-text query, category, tags, availability, paging
(`limit` / `offset`), and an optional `refresh`. `listMenuItems` applies normalized
matching (NFKC + lowercase) and returns the same `MenuListResult` for every
provider. Saizeriya currently uses a static snapshot because the upstream service
has no menu enumeration API; the input/output contract is ready for a dynamic
provider later.

## Session persistence

`SessionExport` is versioned and JSON-serializable:

```json
{
  "format": "unorder.session",
  "version": 1,
  "provider": "saizeriya",
  "stateVersion": 1,
  "createdAt": "...",
  "updatedAt": "...",
  "state": { "...provider-specific...": true }
}
```

The CLI stores one envelope per provider in a state file
(`~/.config/unorder/sessions.json` by default, overridable with `--state`). This
makes one command = one process viable, including cookies and tokens. Providers can
migrate older `stateVersion` values through `migrateState`. MCP keeps runtimes in
memory.

## Saizeriya specifics

The Saizeriya provider ports the HTTP form flow from `pnsk-lab/saizeriya`:

1. Resolve the QR URL and read the landing page.
2. Track `nextId`, token, session id, shop/table ids, and cookies.
3. Post page forms for party size, cart additions, order submission, history,
   account, and receipt.
4. Call the JSON command endpoints for item lookup, staff calls, and state checks.

The HTML parser is a small in-repository implementation that supports the selectors
needed by the client (hidden inputs, form classes, table rows, receipt hooks). It is
not a general-purpose browser DOM. Playwright/browser mode was intentionally not
ported.

The static menu is a pinned JSON copy in `packages/provider-saizeriya/data/menu.json`;
the default remote URL points at the `main` branch of this repository and can be
overridden for offline use.

## CLI and MCP generation

`describeMethods` returns transport-neutral descriptors. The CLI uses them for
`--help`, `providers`, and `methods`. The MCP server maps them to `tools/list`,
prefixing tool names with the provider id. Both paths therefore see the same input
schemas, session requirements, and destructive-action annotations.
