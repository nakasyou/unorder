# @unorder/kurasushi

Unofficial provider for the Japanese くら寿司 EPARK smart-order web app.
No third-party runtime dependencies. Node.js 22.18+ is required.

```ts
import { createKurasushi } from '@unorder/kurasushi'

const kura = createKurasushi()
await kura.call('session.open', {
  qrUrl: 'https://kurasushi-so.epark.jp/?id=YOUR_QR_VALUE',
})
const menu = await kura.call('menu.list', { query: '茶碗蒸し' })
const item = await kura.call('menu.get', { id: menu.items[0]!.id })
await kura.call('cart.add', { itemId: item.id, quantity: 1 })
// Sends a real order. Obtain explicit approval before executing against a live table.
// await kura.call('order.send', {})
```

## Reuse sessions in SDK applications

Use `openKurasushi` with the same `SessionStore` across connections. It restores
an existing session first and uses `qrUrl` only when there is no open session.
Calls save state automatically, including partial/uncertain results on failure;
`session.close` clears the store. A failed token is reported explicitly and never
silently retried using an old QR.

```ts
import { MemorySessionStore } from '@unorder/core'
import { openKurasushi } from '@unorder/kurasushi'

const store = new MemorySessionStore() // Retain this store across connections.
const first = await openKurasushi({ store, qrUrl: currentQrUrl })
await first.call('menu.list', {})
const next = await openKurasushi({ store }) // Reuses the token; no QR authentication.
await next.call('menu.list', { query: 'サーモン' })
```

`MemorySessionStore` survives only as long as its process. To survive process
restarts, supply a durable implementation of core's `SessionStore` (`load`,
`save`, `clear`). The CLI already uses a file-backed store. The synchronous
`createKurasushi({ session, store })` constructor remains available for explicit
restoration and automatic saves; without `store`, callers own export/persistence.

The browser saves its token in a host-only `KRSO_token` cookie for 1/8 day
(about three hours), with Secure and SameSite=Strict. It sends that value to the
API as `soAuthToken`, not as a cross-host Cookie header. The SDK preserves the
same bearer-token semantics in its session state. Requests include the web app's
Origin and Referer. There is no invented Cookie header or shared browser jar.

Authentication errors retain `details.status` and `details.endpoint`, so 401 and
403 are distinguishable. `KurasushiAuthError` extends core's `AuthRequiredError`.
A known server code is exposed as `details.serverCode`; code 403-1 additionally
reports “お席が見つかりませんでした。” This is not automatically labelled a token
expiry. Raw response bodies, tokens, and QR values are excluded from errors.
An HTTP 202 authentication response is reported as pending, not as a valid session.

CLI and MCP include this provider as `kurasushi`:

```bash
unorder run kurasushi session.open '{"qrUrl":"https://kurasushi-so.epark.jp/?id=YOUR_QR_VALUE"}'
unorder run kurasushi menu.list '{"query":"茶碗蒸し"}'
unorder methods kurasushi
```

## Supported methods

| Methods                                              | Behavior                                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `session.open`, `session.close`, `session.export`    | Authenticate from the QR `id`, discard local state, export sensitive session state |
| `menu.list`, `menu.get`                              | Session-bound dynamic menu; item detail includes topping options                   |
| `cart.list`, `cart.add`, `cart.remove`, `cart.clear` | Local unsubmitted cart; additions never send orders                                |
| `order.send`                                         | Sequential per-line submissions, maximum 4 units per line                          |
| `order.list`                                         | Local submitted and uncertain batches, newest first                                |
| `history.get`                                        | Upstream history for the entire table, including other terminals                   |

Only seated sessions are supported. Party size, preorder seats, notes, reorder
flags, option quantities, staff calls, billing, and checkout are unsupported.
`session.close` only discards local state; it does not check out or deauthorize the table.
Availability is `unknown`: the captured menu has no stock field. API rejection
is authoritative. `menu.list` uses the standard search, category, tags, and paging
semantics, and fetches a fresh menu on each call (`refresh` is redundant).
Duplicate entries in the “すべて” category are merged into the specific category.

Topping defaults follow the web app's `defaultSelect === 0` convention.
`cart.add.optionId` overrides one topping group; remaining groups use defaults.
Groups without a default require a selection. The standard method can override
one group per line; multiple explicit group overrides are unsupported. Topping
codes and selected option names are retained in the cart. Cart and order totals
are estimates based on the item price when staged, not the restaurant's bill.

## Failure and concurrency behavior

One cart is submitted as several upstream requests. Successful lines are removed
and recorded immediately. Rejection results 2/3/4 stop submission and retain the
rejected line and remaining cart. Earlier confirmed orders are preserved.

A transport error, invalid JSON, HTTP failure, or unrecognized result after a
submission leaves an `unknown` order and removes that line from the cart. There
is no automatic retry. Further sends are blocked until the caller inspects
`history.get` / the official table display and explicitly closes and reopens the
session. Reopening does not restore the old cart or history. Do not reconstruct
and resend an uncertain order without checking whether it arrived.

Methods on one provider instance are serialized. CLI state is saved even when a
method throws, so partial success and uncertainty survive the next invocation.
A CLI state file must have a single writer; separate processes/instances are not
coordinated. Abrupt process termination before saving state cannot guarantee
exactly-once ordering; check upstream history before retrying after a crash.

Session exports include the bearer token. Keep raw HARs, QR values, session
exports, and extracted research files out of version control. Normal session.open
results and error messages exclude tokens and QR values.

## Verification and protocol evidence

See [the protocol notes](../../docs/kurasushi-protocol.md). Implementation is based
on a supplied HAR and its public JavaScript bundles, not official API documentation.
Unit tests use an injected mock fetch and never contact a live restaurant.
Authentication/menu responses were captured; item detail, order submission, and
history contracts were reconstructed from JavaScript and have not been verified
against a live table.
