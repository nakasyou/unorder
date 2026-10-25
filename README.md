# unorder

> [!WARNING]
> unorder is an unofficial interoperability project. It is not affiliated with,
> endorsed by, or supported by Saizeriya, Sushiro, or Akindo Sushiro. Use it only
> with sessions and accounts you are allowed to use, and do not use it to
> disrupt, overload, bypass, or otherwise misuse a real restaurant service.

unorder is a UI-less, provider-independent ordering SDK. It normalizes ordering,
shop, queue, waitlist, and reservation operations behind stable dot-separated
method names, ships a CLI for scripted use, and exposes every method to AI agents
through a stdio MCP server.

## Packages

| Package              | Description                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `@unorder/core`      | Provider-independent domain types, schemas, errors, standard methods, runtime, and Proxy client.       |
| `@unorder/saizeriya` | Unofficial Saizeriya provider, a pinned static menu snapshot, and a small dependency-free HTML parser. |
| `@unorder/sushiro`   | Unofficial Sushiro provider for shops, queues, waitlists, reservations, dynamic menus, and takeout.    |
| `@unorder/cli`       | The `unorder` binary (`run`, `mcp`, `providers`, `methods`, `--help`).                                 |

Providers have no third-party runtime dependencies. They use Node's standard
`fetch`, filesystem APIs where needed, and in-repository parsers. Browser
automation and Playwright are intentionally not part of this project.

## Requirements

- Node.js 22.18 or newer (`.node-version` records 22.20.0)
- pnpm 10.34.6 (`packageManager` in `package.json`)

## Setup

```bash
pnpm install
vp check
vp test
vp run -r pack
```

`vp` is provided by the root `vite-plus` dev dependency. If your shell does not
have a global `vp`, run it through pnpm (`pnpm exec vp ...`) or use Vite+'s local
CLI wrapper.

## CLI

Build once, then run the bundled binary:

```bash
pnpm run pack
node packages/cli/dist/cli.mjs --help

# Static menu, no session or network required
node packages/cli/dist/cli.mjs run saizeriya menu.list '{"limit":5}' \
  --menu-file packages/provider-saizeriya/data/menu.json --state /tmp/unorder-state.json

# Read-only Sushiro shop search and dynamic menu
node packages/cli/dist/cli.mjs run sushiro shop.list \
  '{"near":{"latitude":35.68,"longitude":139.76},"limit":3}' --state /tmp/unorder-state.json
UNORDER_SUSHIRO_STORE_ID=874 node packages/cli/dist/cli.mjs run sushiro menu.list \
  '{"limit":5}' --state /tmp/unorder-state.json
```

By default, static menus are fetched from the pinned raw GitHub URL:

<https://raw.githubusercontent.com/nakasyou/unorder/main/packages/provider-saizeriya/data/menu.json>

Override it with `--menu-url` / `UNORDER_SAIZERIYA_MENU_URL`, or work offline with
`--menu-file` / `UNORDER_SAIZERIYA_MENU_FILE`.

CLI results are JSON on stdout. Errors are also JSON on stdout, for example:

```json
{
  "error": {
    "code": "auth_required",
    "message": "saizeriya.cart.list requires an open session; call session.open first"
  }
}
```

Diagnostics belong on stderr. The `run` command accepts JSON as the third argument
or `-` to read JSON from stdin.

### State

Providers keep resolved session data (tokens, cookies, party size, selected shop,
cart lines, submitted-order history, waitlist identity) in provider state. `run`
loads and saves a single-process-independent state file:

- default: `$XDG_CONFIG_HOME/unorder/sessions.json` (or `~/.config/unorder/sessions.json`)
- override: `--state <file>` or `UNORDER_STATE`
- format: a versioned `unorder.session` envelope per provider

Serialization is always the core function `exportSession(provider, state?)`. The
CLI calls it directly; the provider runtime does not expose an export method.
The MCP server keeps state in process memory instead.

### MCP

```bash
node packages/cli/dist/cli.mjs mcp --menu-file packages/provider-saizeriya/data/menu.json
```

The server speaks newline-delimited JSON-RPC over stdio and implements
`initialize`, `ping`, `tools/list`, `tools/call`, and `shutdown`. Tool names are
`<provider>.<method>`, such as `saizeriya.menu.list`, `sushiro.shop.list`, and
`saizeriya.order.send`. Input schemas are generated from the same descriptors used
by `unorder --help`.

## Library

```ts
import { createClient, createProviderRuntime, exportSession } from '@unorder/core'
import { createSaizeriya } from '@unorder/saizeriya'

const provider = createSaizeriya({
  menuFile: './packages/provider-saizeriya/data/menu.json',
})
const client = createClient(provider)

const menu = await client.menu.list({ query: 'パスタ', limit: 10 })
console.log(menu.items.map((item) => `${item.id} ${item.name}`))

const session = await client.session.open({
  qrUrl: 'https://example.com/saizeriya3/qr?table=...',
  peopleCount: 2,
})

await client.cart.add({ itemId: '1202', quantity: 1 })
const cart = await client.cart.list({})
console.log(cart.itemCount, cart.subtotal)

// `provider` only exposes `call`; core helpers hold runtime/session operations.
const runtime = createProviderRuntime(provider)
const exported = exportSession(provider, runtime.getState())
const restored = createProviderRuntime(provider, { session: exported })
```

`createSaizeriya(config?)` returns a call-only provider object. `createClient`
turns its dot-separated method names into typed nested properties, for example
`client.shop.list(...)`, `client.waitlist.join(...)`, and
`client.session.export(...)`. `defineProvider` is a type-only identity helper;
`createProviderRuntime` and `createProviderInstance` contain the shared runtime
behavior.

Calling `order.send`, `bill.get`, `receipt.get`, or `staff.call` against a live
session has real-world effects. `waitlist.join` and `waitlist.cancel` also create
or cancel real queue tickets. Tests in this repository use local mocks only and
never send orders or tickets to a real restaurant.

## Methods

Providers expose the subset of this provider-neutral surface that they can
support. Unsupported methods fail with `UnsupportedError`.

| Area        | Methods                                                               |
| ----------- | --------------------------------------------------------------------- |
| Session     | `session.open`, `session.update`, `session.close`, `session.export`   |
| Menu        | `menu.list`, `menu.get`                                               |
| Shop        | `shop.list`, `shop.get`                                               |
| Queue       | `queue.get`                                                           |
| Waitlist    | `waitlist.join`, `waitlist.cancel`, `waitlist.status`                 |
| Reservation | `reservation.slots`, `reservation.list`                               |
| Cart        | `cart.list`, `cart.add`, `cart.remove`, `cart.clear`, `cart.validate` |
| Order       | `order.reorder`, `order.send`, `order.list`, `order.validate`         |
| Billing     | `bill.get`, `receipt.get`                                             |
| Service     | `staff.call`                                                          |

`session.export` is provided automatically by core for every provider. It wraps
provider state through the optional `serializeState` hook and returns a versioned
`unorder.session` envelope.

There is no `x-<provider>.*` namespace. Provider concepts are either normalized
into core types and standard methods, or kept private. See
[AGENTS.md](AGENTS.md) and [docs/design.md](docs/design.md).

### Saizeriya

Saizeriya implements session, menu, cart, order, billing, and service methods,
including `session.update`, `order.reorder`, `cart.validate`, and
`order.validate`. Live item availability is available through
`menu.get` with `live: true`. Restricted-item confirmation remains a private
provider detail.

### Sushiro

The Sushiro app supports shop search, live queues, queue tickets, advance
reservations, a menu WebView, and takeout. It has no in-store table ordering API,
so `@unorder/sushiro` does not expose `cart.*`, `order.*`, `bill.get`,
`receipt.get`, or `staff.call`.

```ts
import { createClient } from '@unorder/core'
import { createSushiro } from '@unorder/sushiro'

const client = createClient(createSushiro({ storeId: '874' }))
const shops = await client.shop.list({
  near: { latitude: 35.681236, longitude: 139.767125 },
  limit: 5,
})
console.log(shops.items.map((shop) => `${shop.id} ${shop.name}`))

const menu = await client.menu.list({ query: 'サーモン', limit: 10 })
const queue = await client.queue.get({ shopId: '874' })

// Real-world action: require explicit human approval.
const ticket = await client.waitlist.join({ partySize: 2 })
```

Sushiro maps its app features to the standard surface:

| Standard method          | Sushiro behavior                                             |
| ------------------------ | ------------------------------------------------------------ |
| `shop.list` / `shop.get` | CRM shop search and lookup with waits (including takeout)    |
| `queue.get`              | Live group queue lanes                                       |
| `waitlist.status`        | Anonymous tickets and local tickets                          |
| `waitlist.join`          | Issue a ticket, or register an existing number with `number` |
| `waitlist.cancel`        | Cancel the current anonymous ticket                          |
| `reservation.slots`      | Reservation time-slot browsing                               |
| `reservation.list`       | Reservations attached to the anonymous GUID                  |
| `session.update`         | Party size and a local table label                           |

Advance reservation creation needs an authenticated account and is not
implemented; only slot browsing is exposed. `waitlist.join` and
`waitlist.cancel` are real-world actions and must only be used with explicit
human approval. See
[packages/provider-sushiro/docs/protocol.md](packages/provider-sushiro/docs/protocol.md).

## Design

See [docs/design.md](docs/design.md) for the type model, method registry, menu
source abstraction, and session envelope.

## License

MIT. See [LICENSE](LICENSE).
