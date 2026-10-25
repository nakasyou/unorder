# @unorder/sushiro

Unofficial, unaffiliated Sushiro provider for unorder.

> [!WARNING]
> This package is **not** affiliated with, endorsed by, or supported by Sushiro
> or Akindo Sushiro. It is an unofficial interoperability project built from a
> public APK for personal use with sessions and stores you are allowed to use.
> Do not use it to disrupt, overload, bypass, or misuse a real restaurant
> service, and do not send ticket or reservation requests without explicit
> human approval.

## Features

- Store search by location, exact store ids, or the full store list
- Current wait minutes, waiting groups, and ticket/reservation availability
- Live queue groups per store
- Anonymous ticket status, queue tickets, reservations, and paper-ticket entry
- Server-rendered menu parsing (dynamic, per store)
- Takeout pickup wait times
- No third-party runtime dependencies (only `@unorder/core` and Node/Web APIs)
- Injectable `fetch` and `now` for tests

This app has **no in-store table ordering API**. The provider therefore does not
expose `cart.*`, `order.*`, `bill.get`, `receipt.get`, or `staff.call`. Its menu
methods are informational only.

## Usage

```ts
import { sushiro } from '@unorder/sushiro'

const runtime = sushiro.createRuntime({
  config: { storeId: '874', guid: crypto.randomUUID(), peopleCount: 2 },
})

const shops = await runtime.call('x-sushiro.shop.list', {
  latitude: 35.681236,
  longitude: 139.767125,
  numResults: 5,
})
console.log(shops.items.map((shop) => `${shop.id} ${shop.name} ~${shop.waitMinutes}分`))

const menu = await runtime.call('menu.list', { query: 'サーモン', limit: 10 })
console.log(menu.items.map((item) => `${item.id} ${item.name}`))

const slots = await runtime.call('x-sushiro.ticket.slots', {
  date: '2026-10-25',
  availableOnly: true,
})
```

`createSushiro(config?, options?)` returns a call-only instance:

```ts
import { createSushiro } from '@unorder/sushiro'

const client = createSushiro({ storeId: '874' })
const { items } = await client.call('x-sushiro.takeout.wait-time', {})
```

### Sessions

`session.open` selects a store and creates or restores the local GUID. It does
not create a ticket. Pass a deep link or a URL containing a numeric **CRM** store
id (the id returned by `x-sushiro.shop.list`), not the older web shop id:

```ts
await runtime.call('session.open', {
  qrUrl: 'sushiroapp://store/874',
  peopleCount: 2,
})
```

The exported session contains `guid`, `region`, `tableType`, and the selected
store. Use the same exported state to check ticket status in another process.

## Methods

Standard:

- `session.open`, `session.close`, `session.export`
- `menu.list`, `menu.get`

Sushiro extensions:

- `x-sushiro.shop.list`
- `x-sushiro.shop.get`
- `x-sushiro.shop.queue`
- `x-sushiro.shop.waiting`
- `x-sushiro.ticket.status`
- `x-sushiro.ticket.slots`
- `x-sushiro.ticket.check-in-count`
- `x-sushiro.ticket.issue` — **real ticket, destructive**
- `x-sushiro.ticket.cancel` — **real cancellation, destructive**
- `x-sushiro.ticket.enter` — **registers a store-issued ticket, destructive**
- `x-sushiro.takeout.wait-time`
- `x-sushiro.app.config`
- `x-sushiro.table.set` — local-only label for scripts

## Configuration

| Option           | Default                                                     |
| ---------------- | ----------------------------------------------------------- |
| `region`         | `ja`                                                        |
| `storeId`        | none; required for menu methods without a session           |
| `guid`           | generated per runtime                                       |
| `peopleCount`    | none                                                        |
| `tableType`      | `T`                                                         |
| `crmBaseUrl`     | `https://sushipass.akindo-sushiro.co.jp/api/2.0`            |
| `menuBaseUrl`    | `https://www.akindo-sushiro.co.jp/appsv2/menu/menu_detail/` |
| `takeoutBaseUrl` | `https://takeout.akindo-sushiro.co.jp`                      |
| `takeoutToken`   | public bearer token shipped in the Android app              |
| `userAgent`      | `unorder-sushiro/0.1 (unofficial interoperability client)`  |

See [docs/protocol.md](docs/protocol.md) for the reconstructed API, confirmed
versus inferred details, and the APK provenance.

## Development

```bash
vp test
vp -C packages/provider-sushiro pack
```

Tests use an in-memory mock `fetch`. They never contact a real Sushiro server.
