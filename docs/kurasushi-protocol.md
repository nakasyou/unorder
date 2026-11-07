# Kurasushi EPARK protocol notes

Inspected web bundles: `index.9a84c92c.js` and `history-web.d05fc9a6.js` from
`https://kurasushi-so.epark.jp/`, supplied in the 2026-11-07 HAR.
The upload ends in the middle of its final request; 192 complete entries were
recovered. Only complete entries were treated as observations. No original HAR,
credentials, or third-party bundles are committed.

## Reproduce the inspection

From the repository root, with a local HAR:

```bash
python packages/provider-kurasushi/scripts/inspect-har.py /path/to/capture.har /tmp/kura-js
# Format each extracted file without adding it to the workspace or bypassing ignore rules:
pnpm exec vp fmt --stdin-filepath=research.js < /tmp/kura-js/4-index.9a84c92c.js > /tmp/kura-app.formatted.js
```

The script recovers complete entries from a truncated HAR, extracts first-party
application bundles, and prints endpoint paths without credentials, headers,
query values, request bodies, or API response bodies. The formatted main bundle
has roughly 14,000 lines; this is useful for tracing the webpack module exports,
Vuex auth/seat/menu stores, and the Order component.

## Request contracts

API origin: `https://api-app.smart-order.epark.jp`. All requests use
`Language-Id: ja` and `soAuthToken` (empty on initial QR authentication).
POST requests use JSON. Date strings are Japan local time `YYYY-MM-DD HH:mm:ss`.
No automatic retry is used by the provider.

| Endpoint under `/app_order/`                | Evidence                                  | Contract                                                                                                                                   |
| ------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST auth/web/v1/`                         | HAR token reauthentication + JS QR branch | `{qrCode, checkedInAt, requestedAt, reserve: []}` → `{accessToken}`; QR comes from URL query `id`                                          |
| `GET seat/status/v1/`                       | HAR + JS                                  | Includes `shopId`, `seatNo`, `checkedInAt`, `orderRestriction`; value 3 restricts ordering                                                 |
| `GET shops/v1/{shopId}`                     | HAR + JS                                  | Includes `id`, `name` and order/display settings                                                                                           |
| `GET menus/v1/{shopId}/{seatNo}`            | HAR + JS                                  | Category array: `{categoryId, name, itemList: [{itemCode, name, price, itemImage, unit, ...}]}`                                            |
| `GET items/v1/{shopId}/{seatNo}/{itemCode}` | JS Order.fetchMenuDetail                  | Detail includes `name`, `price`, `toppings`, `cautionaryNote`, `itemImage`, `unit`, `calorie`                                              |
| `POST add/v1/{shopId}/{seatNo}`             | JS Order.doOrder                          | `{itemCode, toppings: [toppingCode], quantity, influxType: 0, influxSource: categoryId, orderedAt, requestedAt, reserve: []}` → `{result}` |
| `GET histories/v1/`                         | JS history-web.fetchHistory               | Query `shopId`, `seatNo`, `checkedInAt` in `YYYYMMDDHHmmss`; response `{list: [...]}`                                                      |

The Order component uses item ids from router parameters (strings), numeric topping
codes, one selection per `toppingGroup`, and defaults marked `defaultSelect === 0`.
Its quantity selector is bounded by `maxSameTimeOrderCount: 4`. Standard menu
navigation has `influxType: 0` and `influxSource` equal to the active category id.

`add` result 1 marks completion. The other branches display modals for a limit
(result 2), an order restriction (3), and stockout (4). Any other result remains
uncertain. HTTP success alone does not establish that an order succeeded.

The app also exposes `pay`, `selfcheck`, staff calls, cancellation, lottery, and
other state-changing endpoints. They are outside this provider's supported
surface. In particular, history reading does not call any billing endpoint.

## Verification boundary

Tests use small synthetic fixtures with the field shapes observed above. They
verify QR validation, Japan timestamps, token headers, menu deduplication,
topping defaults, exact order bodies, rejected/partial submissions, uncertain
results, session restoration, serialized sends, CLI persistence, and MCP discovery.
No live order, staff call, checkout, or payment was sent during development.
