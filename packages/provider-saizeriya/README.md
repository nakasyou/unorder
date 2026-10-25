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
- Cart add/remove/clear
- Order submission, submitted-order history, bill/account summary, receipt data,
  staff calls, and Saizeriya-specific checks
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
import { saizeriya } from '@unorder/saizeriya'

const runtime = saizeriya.createRuntime({
  config: {
    // Choose one of:
    menuUrl: 'https://example.com/menu.json',
    menuFile: './menu.json',
    menuItems: [{ code: '1202', name: '小エビのサラダ', price: 350 }],

    language: '1',
  },
})
```

`menuItems` wins over `menuFile`, which wins over `menuUrl`.

## Usage

```ts
const runtime = saizeriya.createRuntime({ config: { menuFile: './menu.json' } })

const menu = await runtime.call('menu.list', { query: 'パスタ' })
const session = await runtime.call('session.open', {
  qrUrl: 'https://example.com/saizeriya3/qr?table=...',
  peopleCount: 2,
})

await runtime.call('cart.add', { itemId: '1202', quantity: 1 })
const cart = await runtime.call('cart.list', {})
```

The runtime exposes the standard methods plus these Saizeriya extensions:

- `x-saizeriya.people.set`
- `x-saizeriya.item.lookup`
- `x-saizeriya.history.reorder`
- `x-saizeriya.check.order`
- `x-saizeriya.check.last-order`
- `x-saizeriya.check.midnight`
- `x-saizeriya.alcohol.confirm`

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
