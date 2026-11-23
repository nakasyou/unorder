# @unorder/sushiro

Unofficial Sushiro mobile ordering provider based on an observed `mo.sushiro.jp` browser HAR.

## Observed API surface

| Method | HTTP endpoint | Status |
| --- | --- | --- |
| `session.open` | `GET /v1/session` | Supported with an existing session token |
| `menu.list`, `menu.get` | `GET /v1/menu` | Supported |
| `cart.list`, `cart.add`, `cart.remove`, `cart.clear` | Local only | Supported |
| `order.send` | `POST /v1/mobile/order` | Supported; requires explicit authorization |
| `order.list` | Local state only | Supported |
| `order.detail` | `GET /v1/mobile/order/detail` | Read-only table order detail, quantity, prices, served flag and total |
| `session.status` | `GET /v1/session` | Read-only ordering availability, checkout status, and device count |

The capture showed `GET /v1/config?q=...` and `GET /v1/session`, but did **not** show the complete QR-to-token exchange. The `q` parameter is **not** equivalent to the `Authorization` token. Consequently, this provider deliberately does **not** accept a QR `q` value as authentication. Supply an **existing, personally authorized** bearer token in a temporary input URL instead, and do not share or log it:

```ts
import { createSushiro } from '@unorder/sushiro'
const sushiro = createSushiro()
await sushiro.call('session.open', {
  qrUrl: 'https://mo.sushiro.jp/?token=YOUR_OWN_SESSION_TOKEN',
})
const result = await sushiro.call('menu.list', { query: 'サーモン' })
```

This `?token=` input is an **Unorder-only convenience format**, not an official Sushiro QR URL.

`menu.get` returns selectable option IDs of the form `group:index`. Selecting `optionId: '1:2'` chooses the second value in option group 1. Unspecified groups retain menu defaults. The captured order payload carries each selection as `{additional_info_index, additional_info_id}`.

Order submission is not idempotent. An order is marked `unknown` **before** the HTTP request so a timeout cannot trigger an automatic retry. Review the restaurant's own history to resolve uncertain results. The implementation does not attempt checkout, payment, staff calls, rate-limit bypass, or reverse engineering of undocumented authentication.

No raw HAR, QR codes, bearer tokens, or customer/session identifiers are included in this repository. All tests use mock HTTP responses and never send an actual restaurant order.

## Verification

```sh
pnpm install
pnpm exec vp check
pnpm exec vp test
pnpm exec vp run -r pack
```

## Limitations

- Only the response shapes in one observed capture were used; behavior can change between stores and releases.
- Availability, discounts, and quantity constraints require further integration testing against approved non-production test infrastructure.
- The newer HAR confirms table-level order detail, not individual order IDs or authoritative order-batch reconciliation. `order.list` remains locally tracked batches, and `order.detail` reports table-level upstream data.
- `served_flag === 1` is interpreted as served in the normalized response; callers may inspect future versions for flag changes.
- Checkout actions are not verified by the provided HAR and are not exposed.
