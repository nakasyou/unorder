# unorder

> [!WARNING]
> unorder is an unofficial interoperability project. It is not affiliated with,
> endorsed by, or supported by Saizeriya. Use it only with sessions and accounts
> you are allowed to use, and do not use it to disrupt, overload, bypass, or
> otherwise misuse a real restaurant service.

unorder is a UI-less, provider-independent ordering SDK. It normalizes ordering
operations behind stable dot-separated method names, ships a CLI for scripted use,
and exposes every method to AI agents through a stdio MCP server.

## Packages

| Package              | Description                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `@unorder/core`      | Provider-independent domain types, schemas, errors, menu helpers, typed runtime, and Proxy client.     |
| `@unorder/saizeriya` | Unofficial Saizeriya provider, a pinned static menu snapshot, and a small dependency-free HTML parser. |
| `@unorder/cli`       | The `unorder` binary (`run`, `mcp`, `providers`, `methods`, `--help`).                                 |

Providers have no third-party runtime dependencies. The Saizeriya provider uses
Node's standard `fetch`, filesystem APIs, and an in-repository HTML parser. Browser
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

The Saizeriya provider keeps QR resolution results, tokens, cookies, party size,
cart lines, and submitted-order history in session state. `run` loads and saves a
single-process-independent state file:

- default: `$XDG_CONFIG_HOME/unorder/sessions.json` (or `~/.config/unorder/sessions.json`)
- override: `--state <file>` or `UNORDER_STATE`
- format: a versioned `unorder.session` envelope per provider

The MCP server keeps state in process memory instead.

### MCP

```bash
node packages/cli/dist/cli.mjs mcp --menu-file packages/provider-saizeriya/data/menu.json
```

The server speaks newline-delimited JSON-RPC over stdio and implements
`initialize`, `ping`, `tools/list`, `tools/call`, and `shutdown`. Tool names are
`<provider>.<method>`, such as `saizeriya.menu.list` and `saizeriya.order.send`.
Input schemas are generated from the same descriptors used by `unorder --help`.

## Library

```ts
import { createClient, createProviderRuntime } from '@unorder/core'
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
const exported = runtime.exportSession()
const restored = createProviderRuntime(provider, { session: exported })
```

`createSaizeriya(config)` returns a call-only provider object. `createClient`
turns its dot-separated method names into typed nested properties, including
provider extensions such as `client['x-saizeriya'].people.set(...)`.
`defineProvider` is a type-only identity helper; `createProviderRuntime` and
`createProviderInstance` contain the shared runtime behavior.

Calling `order.send`, `bill.get`, `receipt.get`, or `staff.call` against a live
session has real-world effects. Tests in this repository use a local mock server
only and never send orders to a real restaurant.

## Methods

Every provider exposes a subset of:

`session.open`, `session.close`, `menu.list`, `menu.get`, `cart.list`,
`cart.add`, `cart.remove`, `cart.clear`, `order.send`, `order.list`, `bill.get`,
`staff.call`, `receipt.get`.

`session.export` is provided automatically by core for every provider. It
serializes provider state through the optional `serializeState` hook and returns
a versioned `unorder.session` envelope.

Provider-specific extensions use the `x-<provider>.` namespace, for example
`x-saizeriya.people.set`. See `unorder --help` or `unorder methods saizeriya`.

## Design

See [docs/design.md](docs/design.md) for the type model, method registry, menu
source abstraction, and session envelope.

## License

MIT. See [LICENSE](LICENSE).
