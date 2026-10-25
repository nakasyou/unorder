# Sushiro app protocol notes

This document describes the unofficial HTTP surface implemented by
`@unorder/sushiro`. It is reconstructed from the public Android app
`jp.co.akindo_sushiro.sushiroapp` version 6.0.7 (versionCode 60701) and from
read-only requests against the production endpoints.

Confidence labels:

- **Confirmed** — reproduced with a read-only request from this repository's
  research environment, or read directly from a shipped app asset.
- **Inferred** — recovered from the app's Dart AOT code or the Android manifest
  but not exercised against production (usually because the request has side
  effects).
- **Not present** — the app has no such flow, so this provider does not fake it.

## App shape

- **Confirmed** Android + Flutter app. The Dart snapshot is
  `lib/arm64-v8a/libapp.so`; the Android wrapper is `classes.dex`.
- **Confirmed** the app does not implement table QR ordering. It supports store
  search, live queues, queue tickets (`今から行く`), advance reservations
  (`後から行く`), takeout ordering through a WebView, member/point features, and
  a menu-browsing WebView.
- **Confirmed** package id: `jp.co.akindo_sushiro.sushiroapp`. Deep-link scheme:
  `sushiroapp`.
- **Not present** in-store cart/order/bill/receipt/staff-call API. Those are not
  exposed by this provider. Menu browsing is informational only.

## Environments

`assets/flutter_assets/assets/env/environment.json` ships dev, UAT, and
production values. The provider defaults to Japan production:

| Name                | URL                                                         |
| ------------------- | ----------------------------------------------------------- |
| CRM API             | `https://sushipass.akindo-sushiro.co.jp/api/2.0`            |
| Web / menu          | `https://www.akindo-sushiro.co.jp/appsv2`                   |
| Takeout (net order) | `https://takeout.akindo-sushiro.co.jp`                      |
| Menu detail         | `https://www.akindo-sushiro.co.jp/appsv2/menu/menu_detail/` |

Region segments from the same file: `ja`, `sg`, `tw`, `hk`, `th`, `id`, `my`.
The provider only changes the `region` query parameter; it does not maintain a
separate host table for every region yet. Override `crmBaseUrl`,
`menuBaseUrl`, and `takeoutBaseUrl` in config when needed.

## Request conventions

- **Confirmed** most CRM endpoints are plain `GET` JSON with no app-specific
  headers. A normal `User-Agent` works.
- **Confirmed** ticket creation/cancel requests are
  `application/x-www-form-urlencoded` POSTs. The app's Dart code builds a
  `Map<String, String>` and passes it to `package:http`'s `post`, which sets the
  form content type.
- **Confirmed** the takeout wait-time endpoint uses
  `Authorization: Bearer <netorder_api_token>`. The token is shipped in the
  public app asset. The provider includes it as a default and allows an
  override.
- **Inferred** authenticated CRM calls (login, `remote_auth/*`, reservation
  creation for later) use HTTP Basic auth derived from the logged-in account.
  This provider does not implement account login, so it does not call those
  endpoints.
- **Confirmed** a persistent device `guid` is sent with ticket and slot
  requests. In this provider the GUID is generated with `crypto.randomUUID()`
  unless supplied in config or session state.

## Implemented endpoints

### Store search and status

| Method | Endpoint                                                       | Status    | Notes                                                            |
| ------ | -------------------------------------------------------------- | --------- | ---------------------------------------------------------------- |
| `GET`  | `/api/2.0/info/storelist?latitude&longitude&numresults&region` | Confirmed | Nearby stores. Returns an array.                                 |
| `GET`  | `/api/2.0/info/storelist?guid&region`                          | Confirmed | Full store list (roughly 1 MB in Japan).                         |
| `GET`  | `/api/2.0/info/store?storeid&region`                           | Confirmed | One store.                                                       |
| `GET`  | `/api/2.0/info/multiplestoredetails?storeids=1,2&region`       | Confirmed | Exact lookup by store ids.                                       |
| `GET`  | `/api/2.0/info/storewaitingtimeconfig?stores=1,2&region`       | Confirmed | Wait-time display flags.                                         |
| `GET`  | `/api/2.0/remote/groupqueues?storeid&region`                   | Confirmed | Queue numbers by lane.                                           |
| `GET`  | `/api/2.0/remote/storequeue?storeid&region`                    | Confirmed | Simple queue array (not used directly; `groupqueues` is richer). |
| `GET`  | `/api/2.0/remote/storequeuecount?storeid&ticketNo&region`      | Confirmed | Scalar count for a ticket number.                                |
| `GET`  | `/api/2.0/info/config?region`                                  | Confirmed | App version policy and feature flags.                            |

Confirmed store fields include `id`, `storeStatus`, `name`, `nameKana`,
`nameEn`, `address`, `area`, `latitude`, `longitude`, `distance`, `wait`,
`waitingGroup`, `waitTimeCap`, `netTicketStatus`, `reservationStatus`,
`checkinStatus`, `requireNetTicketLogin`, `tableType` capacities, and region
flags. The CRM `id` is the store id used by tickets and the menu detail page.

### Tickets and reservations

| Method | Endpoint                                                                      | Status                 | Notes                                                                                                                                                     |
| ------ | ----------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/2.0/remote/opentickets?guid&region`                                     | Confirmed              | Anonymous status. Returns `TICKETS`, `LOCALTICKETS`, `RESERVATIONS`.                                                                                      |
| `GET`  | `/api/2.0/info/reservationtimeslots?storeid&numpersons&guid&tabletype&region` | Confirmed              | Array of slots with `availability`.                                                                                                                       |
| `POST` | `/api/2.0/remote/newticket`                                                   | Inferred (side effect) | `今から行く` ticket. Form body: `guid`, `storeid`, `adult`, `child`, `tabletype`, `region`, optional `googleregistrationid`, optional `activecustomerid`. |
| `POST` | `/api/2.0/remote/cancel`                                                      | Inferred (side effect) | Cancel a `今から行く` ticket. Form body: `guid`, `region`.                                                                                                |
| `PUT`  | `/api/2.0/remote/watchticket`                                                 | Inferred (side effect) | Register a store-issued paper ticket. Form body: `guid`, `region`, `googleregistrationid`, `storeid`, `ticketnum`.                                        |
| `GET`  | `/api/2.0/remote_auth/opentickets?region`                                     | Inferred               | Logged-in ticket status. Not implemented (needs authentication).                                                                                          |
| `POST` | `/api/2.0/remote_auth/newreservation`                                         | Inferred               | Advance reservation. Not implemented (needs login and Basic auth).                                                                                        |

Table types seen in the app: `T` (table), `C` (counter), `P` (pair).

Confirmed slot objects look like:

```json
{
  "storeId": "874",
  "date": "20261025",
  "start": "184500",
  "end": "190000",
  "availability": "AVAILABLE"
}
```

`availability` is a string (for example `UNAVAILABLE` or `AVAILABLE`). The app's
dummy data and UI also use ticket statuses such as `WAITING`, `SEATED`,
`CANCELLED`, and `MISSED`.

### Takeout

| Method | Endpoint                                                     | Status    | Notes                                                  |
| ------ | ------------------------------------------------------------ | --------- | ------------------------------------------------------ |
| `GET`  | `/sushipass/api/estimatedReceivingTime?store_id=<id>`        | Confirmed | Single-store pickup wait.                              |
| `GET`  | `/sushipass/api/estimatedReceivingTimeList?store_id=<id,id>` | Confirmed | Multi-store pickup wait.                               |
| `GET`  | `/sushipass/api/customerOrders?crm_id=<id>`                  | Inferred  | Order list; requires a member CRM id. Not implemented. |

Confirmed response:

```json
{
  "status": "succeeded",
  "message": "",
  "data": { "minutes": "15", "store_id": "874" },
  "paging": { "total_counts": 0, "limit": 0, "page": 0 }
}
```

The wait time is a string in the original payload; the provider normalizes it to
a number and keeps the original object in `raw`.

### Menu

- **Confirmed** the app opens a WebView for menu browsing. There is no JSON menu
  endpoint in the app for the public menu.
- **Confirmed** the menu detail page is server-rendered HTML at
  `/appsv2/menu/menu_detail/?s_id=<store id>`. Using the CRM store id (for
  example `874`) returns that store's menu. An unknown id falls back to a
  generic menu, so the provider does not use the page to validate store ids.
- **Confirmed** the HTML contains category tabs (`.category-tab__item`) and one
  `.swiper-slide` per category. Each item has `data-target` (item id),
  `.menu-item__name`, `.menu-item__price`, `.menu-item__calorie`,
  `.menu-item__annotation`, and `.menu-item__img`.
- The provider parses this HTML with a dependency-free regex parser, normalizes
  ids/prices/categories, and keeps the original text in `raw`. Items with no
  price are marked `sold_out` when the annotation says so, otherwise `unknown`.

## Standard method mapping

| Endpoint area            | Standard method(s)                        |
| ------------------------ | ----------------------------------------- |
| Store search and status  | `shop.list`, `shop.get`                   |
| Group queues             | `queue.get`                               |
| Takeout wait             | `Shop.waitEstimates` (`service: takeout`) |
| Anonymous tickets        | `waitlist.status`                         |
| New ticket               | `waitlist.join`                           |
| Paper ticket             | `waitlist.join` with `number`             |
| Cancel ticket            | `waitlist.cancel`                         |
| Reservation slots        | `reservation.slots`                       |
| Reservation records      | `reservation.list`                        |
| Display config / app cfg | private                                   |

## Not implemented

- **In-store table ordering / cart / order / bill / receipt / staff call.** The
  Android app has no such native API. Do not invent an ordering flow.
- **Account login, member details, coupons, points, favorites, push.** These
  exist but require credentials or user-specific state and are out of scope.
- **Advance reservations (`後から行く`).** The endpoint is known, but it needs
  authenticated requests. Only slot browsing is exposed.
- **Takeout order creation.** The app uses a WebView and member login; no
  ordering request is implemented here.

## Safety

- Tests use a mock `fetch` and never contact a real Sushiro endpoint.
- `waitlist.join` and `waitlist.cancel` are real-world side effects. They are
  marked destructive and open-world; callers must require explicit human
  approval. `waitlist.join({ number })` registers a store-issued paper ticket.
- Do not use this provider to bypass rate limits, automate bulk requests, or
  disrupt a restaurant.
