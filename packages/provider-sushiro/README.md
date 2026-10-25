# @unorder/sushiro

Unofficial, unaffiliated Sushiro provider for unorder.

> [!WARNING]
> This package is **not** affiliated with, endorsed by, or supported by Sushiro
> or Akindo Sushiro. It is an unofficial interoperability project built from a
> public APK for personal use with sessions and stores you are allowed to use.
> Do not use it to disrupt, overload, bypass, or misuse a real restaurant
> service, and do not send waitlist or reservation requests without explicit
> human approval.

## Features

- Shop search by location, exact ids, or the full list
- Normalized address, geo point, distance, status, services, and wait estimates
  (including takeout pickup waits)
- Live queue lanes per shop
- Anonymous ticket status, waitlist join/cancel, and paper-ticket registration
- Server-rendered menu parsing (dynamic, per store)
- Reservation slot browsing and reservation records
- No third-party runtime dependencies (only `@unorder/core` and Node/Web APIs)
- Injectable `fetch` and `now` for tests

This app has **no in-store table ordering API**. The provider therefore does not
expose `cart.*`, `order.*`, `bill.get`, `receipt.get`, or `staff.call`. Its menu
methods are informational only.

## Usage

```ts
import { createClient, exportSession } from '@unorder/core'
import { createSushiro } from '@unorder/sushiro'

const provider = createSushiro({ storeId: '874', peopleCount: 2 })
const client = createClient(provider)

const shops = await client.shop.list({
  near: { latitude: 35.681236, longitude: 139.767125 },
  limit: 5,
})
console.log(shops.items.map((shop) => `${shop.id} ${shop.name}`))

const menu = await client.menu.list({ query: 'サーモン', limit: 10 })
const queue = await client.queue.get({ shopId: '874' })

// Real-world action: require explicit human approval.
const ticket = await client.waitlist.join({ partySize: 2 })

const exported = exportSession(provider)
```

`createSushiro(config?, options?)` returns a call-only instance. The returned
object exposes only `call(method, input)`; metadata and serialization stay in core
helpers. It accepts either provider config directly (`createSushiro({ storeId })`)
or core create options (`createSushiro({ config, fetch, session })`).

### Sessions

`session.open` selects a shop and creates or restores the local GUID. It does not
create a ticket. Pass a deep link or a URL containing a numeric **CRM** store id
(the id returned by `shop.list` / `shop.get`), not the older web shop id:

```ts
await client.session.open({
  qrUrl: 'sushiroapp://store/874',
  peopleCount: 2,
})
```

`session.update` changes the party size or records a local table label. The
exported session contains the GUID and selected shop/table in provider state. Use
`exportSession(provider)` from core to write it to another process.

## Standard methods

- `session.open`, `session.update`, `session.close`, `session.export`
- `menu.list`, `menu.get`
- `shop.list`, `shop.get`
- `queue.get`
- `waitlist.status`, `waitlist.join` — **real ticket, destructive**
- `waitlist.cancel` — **real cancellation, destructive**
- `reservation.slots`, `reservation.list`

There is no `x-sushiro.*` extension namespace. The app-specific concepts map as
follows:

| App feature                     | Standard surface                               |
| ------------------------------- | ---------------------------------------------- |
| Store search / status           | `shop.list`, `shop.get`                        |
| Group queues                    | `queue.get`                                    |
| Takeout wait                    | `Shop.waitEstimates` with `service: 'takeout'` |
| `今から行く` ticket             | `waitlist.join`                                |
| Store-issued paper ticket       | `waitlist.join` with `number`                  |
| Ticket status                   | `waitlist.status`                              |
| Ticket cancellation             | `waitlist.cancel`                              |
| `後から行く` slot browsing      | `reservation.slots`                            |
| Reservations attached to a GUID | `reservation.list`                             |
| Local table label               | `session.update`                               |

Display-only waiting configuration, app config, and per-ticket check-in counts are
private provider details and are not exposed as methods.

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
