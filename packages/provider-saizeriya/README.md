# @unorder/saizeriya

Unofficial Saizeriya provider for unorder.

> This package is not affiliated with or endorsed by Saizeriya. It is intended for
> interoperability research and personal use with sessions you are allowed to use.
> It must not be used to disrupt or overload a real service.

## Features

- Resolve a QR/deep-link URL and keep the table session state (cookies, token,
  session id, party size, cart, submitted history)
- Static menu listing from a pinned JSON snapshot, a URL, a local file, or
  injected entries
- Cart add/remove/clear and pre-submission validation
- Order submission, submitted-order history, reorder, bill/account summary,
  receipt data, staff calls, and provider-neutral order checks
- No third-party runtime dependencies (only `@unorder/core` and Node standard APIs)
- An in-repository HTML parser, so no `node-html-parser`

## Menu snapshot

`data/menu.json` is copied from the public betterzeriya menu snapshot. It contains
the original `code`, `name`, `kana`, `price`, `category`, `tags`, and `imageUrl`
fields. Image binaries are not included.

The default remote source is:

`https://raw.githubusercontent.com/nakasyou/unorder/main/packages/provider-saizeriya/data/menu.json`

Configuration options:

```ts
import { createSaizeriya } from '@unorder/saizeriya'

const provider = createSaizeriya({
  // Choose one of:
  menuUrl: 'https://example.com/menu.json',
  menuFile: './menu.json',
  menuItems: [{ code: '1202', name: '小エビのサラダ', price: 350 }],

  language: '1',
})
```

`menuItems` wins over `menuFile`, which wins over `menuUrl`.

## Usage

```ts
import { createClient, exportSession } from '@unorder/core'
import { createSaizeriya } from '@unorder/saizeriya'

const provider = createSaizeriya({ menuFile: './menu.json' })
const client = createClient(provider)

const menu = await client.menu.list({ query: 'パスタ' })
const session = await client.session.open({
  qrUrl: 'https://example.com/saizeriya3/qr?table=...',
  peopleCount: 2,
})

await client.session.update({ peopleCount: 3 })
await client.cart.add({ itemId: '1202', quantity: 1 })
const validation = await client.order.validate({})
const cart = await client.cart.list({})
const exported = exportSession(provider)
```

`createSaizeriya(config?, options?)` returns an object that exposes only
`call(method, input)`. State, method metadata, configuration, and the HTTP
client remain private. Use `createClient` from `@unorder/core` for typed nested
calls, or `createProviderRuntime` when you need `getState` or `importSession`.
The lower-level `createSaizeriyaClient` export is the public HTTP client surface;
navigation helpers such as `goToMenu` and `getState` are internal.

## Standard methods

The provider implements the standard session, menu, cart, order, billing, and
service methods. Relevant details:

- `session.update` changes the party size after the session is open.
- `menu.get` with `live: true` queries live item availability; without it, the
  method reads the configured menu snapshot.
- `order.reorder` re-adds a previously ordered item to the unsubmitted cart.
- `cart.validate` and `order.validate` check ordering, last-order, and
  midnight-charge state without submitting anything.
- Restricted-item (alcohol) confirmation is handled privately by the provider and
  is not exposed as a provider-specific method.

There is no `x-saizeriya.*` extension namespace.

## Not ported

The upstream Playwright/browser-mode client is intentionally not ported. This
provider calls the HTTP form/Ajax endpoints directly with Node's `fetch`. Browser
automation would add a large runtime dependency and is outside the zero-dependency
goal.

## Development

```bash
vp -C packages/provider-saizeriya pack
vp test
```

The `scripts/get-all-menu.ts` discovery script is a development-only port. It sends
real requests when run manually and is never part of the test suite. Run it with
`pnpm run get-menu` only when you understand the traffic it generates.

Tests use an in-memory mock server. They never contact a live restaurant.
