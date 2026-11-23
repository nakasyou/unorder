# @unorder/sushiro

Unofficial Sushiro mobile ordering provider based on an observed `mo.sushiro.jp` browser HAR.

## Observed API surface

| Method | HTTP endpoint | Status |
| --- | --- | --- |
| `session.open` | `GET /v1/config?q=...`, `POST /v1/mobile/order/start`, `GET /v1/session` | Official opaque URL supported provisionally; start response not captured |
| `menu.list`, `menu.get` | `GET /v1/menu` | Supported |
| `cart.list`, `cart.add`, `cart.remove`, `cart.clear` | Local only | Supported |
| `order.send` | `POST /v1/mobile/order` | Supported; requires explicit authorization |
| `order.list` | Local state only | Supported |
| `order.detail` | `GET /v1/mobile/order/detail` | Read-only table order detail, quantity, prices, served flag and total |
| `session.status` | `GET /v1/session` | Read-only ordering availability, checkout status, and device count |

## Starting from an official QR URL

The captured HTML page responds with HTTP 200 and does not set cookies or redirect. Bundled frontend JavaScript reads the **raw query string** after `?`, calls `GET /v1/config?q=...`, then runs a `POST /v1/mobile/order/start` mutation when the user starts the session. Later requests use an `Authorization` header holding the session token. The URL parameter is **not** the token.

```ts
import { createSushiro } from '@unorder/sushiro'
const sushiro = createSushiro()
await sushiro.call('session.open', {
  qrUrl: 'https://mo.sushiro.jp/?YOUR_OWN_OPAQUE_QR_VALUE',
})
const result = await sushiro.call('menu.list', { query: 'サーモン' })
```

**Important:** The HAR did not capture `POST /v1/mobile/order/start` or its response. Frontend JavaScript confirms the endpoint and that the request body is the raw opaque URL value as a plain-text request body, but the response field `token` remains an **unverified assumption**. This implementation fails closed when the expected token is absent, does not retry start automatically, and validates the resulting session against the configured shop/table. Starting may register an additional device; it is not a read-only operation.

For backwards compatibility only, an existing authorized token may be supplied through `?token=...` to bypass the start step. This is an Unorder input convention, **not** the official Sushiro QR format. Do not log or share QR links or tokens: treat both as credentials.

No cookies, redirects, or credential exports are involved in the implementation.

 and `/` in the raw query are preserved. `URLSearchParams` must not decode the original query before sending it to the config/start endpoints.

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

- Two captured HAR files and the bundled frontend scripts were inspected; behavior can change between stores and releases.
- Availability, discounts, and quantity constraints require further integration testing against approved non-production test infrastructure.
- The newer HAR confirms table-level order detail, not individual order IDs or authoritative order-batch reconciliation. `order.list` remains locally tracked batches, and `order.detail` reports table-level upstream data.
- `served_flag === 1` is interpreted as served in the normalized response; callers may inspect future versions for flag changes.
- Checkout actions are not verified by the provided HAR and are not exposed.
