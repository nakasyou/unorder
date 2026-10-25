# unorder design

## Goals

unorder separates **provider-independent ordering semantics** from **provider
protocol details**. A caller should be able to browse shops and menus, join a
waitlist, read a queue, build a cart, submit an order, and read a bill with the
same method names and normalized domain types, regardless of whether a provider
enumerates menus dynamically or serves a pinned snapshot.

The CLI and MCP server are thin adapters over the same provider registry. There is
no UI layer.

## Method registry and naming

Methods are dot-separated names. The standard surface is declared once in
`packages/core/src/standard.ts`:

| Area        | Methods                                                                             |
| ----------- | ----------------------------------------------------------------------------------- |
| Session     | `session.open`, `session.update`, `session.close` (plus automatic `session.export`) |
| Menu        | `menu.list`, `menu.get`                                                             |
| Shop        | `shop.list`, `shop.get`                                                             |
| Queue       | `queue.get`                                                                         |
| Waitlist    | `waitlist.join`, `waitlist.cancel`, `waitlist.status`                               |
| Reservation | `reservation.slots`, `reservation.list`                                             |
| Cart        | `cart.list`, `cart.add`, `cart.remove`, `cart.clear`, `cart.validate`               |
| Order       | `order.reorder`, `order.send`, `order.list`, `order.validate`                       |
| Billing     | `bill.get`, `receipt.get`                                                           |
| Service     | `staff.call`                                                                        |

`menu.list` was chosen over `order.list` for menu enumeration because
`order.list` means submitted-order history, while `cart.list` means the current
unsubmitted cart. `cart.validate` and `order.validate` expose read-only
precondition checks without submitting anything.

Every standard method is optional per provider. A provider that cannot support a
method omits it, and the runtime raises `UnsupportedError` for that name. Support
is reflected by method lists, `describeProvider().capabilities`, CLI help, MCP
tools, and the typed `MethodMap` client.

Providers do not add provider-specific extension namespaces. When an app
concept does not fit the current surface, it is either normalized into a core
type and standard method or kept private:

- party size changes use `session.update`
- live item lookup uses `menu.get` with `live: true`
- history reorder uses `order.reorder`
- order precondition checks use `order.validate` / `cart.validate`
- shop search and lookup use `shop.list` / `shop.get`
- queue lanes use `queue.get`
- tickets use `waitlist.join` / `waitlist.cancel` / `waitlist.status`
- reservation slots and records use `reservation.slots` / `reservation.list`
- takeout wait estimates use `Shop.waitEstimates` and `queue.get`
- display-only feature flags, app config, and local table labels are private;
  table labels are set through `session.update`

`defineProvider` is an identity helper that captures the method map as a generic
parameter. It does no runtime work. This gives
`runtime.call('cart.add', { itemId: '1202' })` a typed input and output. The runtime
also exposes an untyped `invoke(name, input)` for CLI/MCP dispatch, which validates
the same schemas before calling the handler.

`session.export` is not part of a provider's method map. Core adds it to every
provider and descriptor and implements it with `exportSession`. Providers only
optionally expose `serializeState` (state to JSON data) and `validateState` /
`migrateState` for imports.

## Provider runtime

A provider definition is plain metadata, not a connection:

- `id`, `displayName`, `description`, `version`
- `stateVersion`, config schema, menu capability
- methods with input/output schemas, summaries, descriptions, session requirement,
  and MCP annotations
- optional `serializeState` / `validateState` / `migrateState`

The shared behavior lives in `createProviderRuntime` and `createProviderInstance`.
The runtime merges config, accepts an injectable `fetch` and clock, and can be
seeded with a `SessionExport`. Handlers receive a context with the current state,
`setState`, and `requireState`. Session serialization is a core function rather
than a handler or runtime concern. The runtime enforces required sessions and
validates input before dispatch:

- missing method → `UnsupportedError` (`unsupported`)
- bad input → `InvalidInputError` (`invalid_input`)
- closed session → `AuthRequiredError` (`auth_required`)
- server failure → `ProviderError` (`provider_error`)
- transport failure → `NetworkError` (`network`)

Every `UnorderError` has a stable `code` and a `toJSON()` payload, so the CLI and
MCP server can return the same error shape.

`createProviderInstance(definition)` returns a call-only object type,
`{ call(method, input) }`. Method metadata, state, config, and the runtime are kept
in a core-private `WeakMap`, so CLI help and MCP can introspect the instance
without exposing those internals. Provider packages export
`create<Provider>(config?)` built on this helper.

## Typed Proxy client

`createClient(instance)` (alias `proxyClient`) wraps a provider instance in a Proxy.
Dot-separated method names become nested properties:

```ts
const client = createClient(createSushiro())
await client.session.open({ qrUrl, peopleCount: 2 })
const shops = await client.shop.list({ near: { latitude, longitude } })
const cart = await client.cart.list({})
```

The client type is derived recursively from the provider's `MethodMap`, so
`order.send` becomes `client.order.send(input): Promise<Order>` and
`waitlist.join` becomes `client.waitlist.join(input): Promise<WaitlistTicket>`.
Calling an unknown method still reaches the runtime and fails with
`UnsupportedError`.

## Domain model

The domain types normalize provider data while preserving an escape hatch:

- IDs are branded strings (`ShopId`, `MenuItemId`, ...), preventing accidental
  mixing at compile time.
- Prices are `Money { amount, currency }`; yen is the default.
- `MenuItem` includes `availability`, `source`, optional options/modifiers, image,
  tags, and `raw`.
- `Shop` includes `address`, `location` (`GeoPoint`), `distanceMeters`,
  normalized `status` plus `statusRaw`, `services`, service-specific
  `waitEstimates`, and `openingHours`.
- `Queue` contains normalized `QueueLane` entries with waiting counts, numbers,
  and optional wait estimates.
- `WaitlistTicket` captures waitlist numbers, status, party size, lane, and
  estimated wait. `ReservationSlot` and `Reservation` cover reservation browsing
  and reservation records.
- `Page<Item>` is the shared paging shape for shop and reservation lists.
- Cart and order lines carry normalized quantities and totals.
- `Session` describes provider, shop, table, party size, page, and timestamps;
  provider-specific state stays in `SessionExport.state` and opaque provider
  payloads stay in `raw`.
- `Source` records whether menu data was static, dynamic, or injected.

Provider-specific values that cannot be generalized are not added to public
types. The original payload remains available in `raw` for callers that need it.

## Menus: static and dynamic

`MenuSource` models both cases:

- static: URL, local file, or injected entries
- dynamic: a provider implementation

`MenuListInput` is shared: free-text query, category, tags, availability, paging
(`limit` / `offset`), and an optional `refresh`. `listMenuItems` applies normalized
matching (NFKC + lowercase) and returns the same `MenuListResult` for every
provider. `menu.get` accepts `live: true` when a provider can query live item
availability; otherwise it reads the same snapshot as `menu.list`.

Saizeriya currently uses a static snapshot because the upstream service has no
menu enumeration API; the input/output contract is ready for a dynamic provider
later. Sushiro parses its server-rendered menu page.

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

`exportSession(provider, state?, options?)` is the only public serializer. It
calls the provider's optional `serializeState` hook, adds `format`, `version`,
`provider`, `stateVersion`, and timestamps, and returns the envelope. The CLI,
embedders, and tests call this function directly. The CLI stores one envelope per
provider in a state file (`~/.config/unorder/sessions.json` by default, overridable
with `--state`). This makes one command = one process viable, including cookies
and tokens. Providers can migrate older `stateVersion` values through
`migrateState`. MCP keeps runtimes in memory. `unorder run <provider>
session.export` still works through the automatic method; without a stored session
the CLI returns an `invalid_input` error envelope.

## Saizeriya specifics

`createSaizeriya(config?, options?)` returns a call-only provider instance. The
Saizeriya package exports individual functions and types (`createSaizeriya`,
`processQR`, `openSaizeriyaState`, `createSaizeriyaClient`, menu helpers, state
types) and keeps HTML parsing, cookie transport, and internal client navigation
(`goToMenu`, `getState`, ...) private to the package.

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

Party-size changes use `session.update`. Live item availability uses `menu.get`
with `live: true`. `order.reorder` performs the reorder navigation and adds the
item back to the unsubmitted cart. `order.validate` and `cart.validate` report
ordering, last-order, and midnight-charge state without submitting anything.
Restricted-item confirmation remains private to the provider.

The static menu is a pinned JSON copy in `packages/provider-saizeriya/data/menu.json`;
the default remote URL points at the `main` branch of this repository and can be
overridden for offline use.

## Sushiro specifics

The Sushiro app is a Flutter client around the Sushiro CRM API. Its in-store
ordering happens on the tablet, not in the app, so the provider exposes shop
search, queues, waitlists, reservations, takeout wait times, and a dynamic menu
instead of `cart.*` / `order.*`.

`shop.list` supports a nearby search, exact ids, a text query, and paging. The
normalized `Shop` includes address, geo point, distance in meters, status,
services, and wait estimates. Takeout pickup waits are merged into
`Shop.waitEstimates` and are fetched best-effort so a takeout outage does not
break shop search. `queue.get` normalizes the CRM group queues into lanes.
`waitlist.*` maps the anonymous ticket endpoints; `reservation.slots` and
`reservation.list` map slot browsing and reservation records. Display-only
waiting configuration, app config, and per-ticket check-in counts are private.

Ticket creation/cancellation uses the same form endpoints as the app and is
marked destructive. The menu is parsed from the server-rendered `menu_detail` HTML
for the selected CRM store id; the parser is a small in-repository regex parser
with no runtime dependency. See
`packages/provider-sushiro/docs/protocol.md` for confirmed versus inferred
endpoints.

## CLI and MCP generation

`describeMethods` accepts either a provider definition or a call-only instance and
returns transport-neutral descriptors. The CLI uses them for `--help`,
`providers`, and `methods`. The MCP server maps them to `tools/list`, prefixing tool
names with the provider id. Both paths therefore see the same automatic
`session.export` method, input schemas, session requirements, and
destructive-action annotations.
