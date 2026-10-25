import type { CartLineId, MenuItemId, OrderId, SessionId, ShopId, TableId } from './brand'

/** Currency amounts are always minor units for the currency (yen for JPY). */
export interface Money {
  readonly amount: number
  readonly currency: string
}

/** Creates a Money value. `JPY` is the default because it is the initial provider. */
export const money = (amount: number, currency = 'JPY'): Money => ({ amount, currency })

export const addMoney = (left: Money, right: Money): Money => {
  if (left.currency !== right.currency) {
    throw new TypeError(`Cannot add ${left.currency} and ${right.currency}`)
  }
  return money(left.amount + right.amount, left.currency)
}

export const multiplyMoney = (value: Money, quantity: number): Money =>
  money(value.amount * quantity, value.currency)

/** Where a menu snapshot came from. */
export type Source =
  | {
      readonly kind: 'static'
      readonly url?: string
      readonly file?: string
      readonly fetchedAt?: string
    }
  | { readonly kind: 'dynamic'; readonly providerId?: string }
  | { readonly kind: 'injected'; readonly label?: string }

/**
 * A menu source description. Static sources can point at a URL, a local file,
 * or an injected array. Dynamic sources are implemented by a provider method.
 */
export type MenuSource =
  | {
      readonly kind: 'static'
      readonly location:
        | { readonly kind: 'url'; readonly url: string }
        | { readonly kind: 'file'; readonly path: string }
        | { readonly kind: 'inline'; readonly label?: string }
    }
  | { readonly kind: 'dynamic'; readonly providerId: string }

export type MenuItemAvailability = 'available' | 'sold_out' | 'unknown'

export interface MenuItemOption {
  readonly id: string
  readonly name: string
  readonly priceDelta?: Money
  readonly required?: boolean
  readonly minimum?: number
  readonly maximum?: number
  readonly raw?: unknown
}

export interface MenuItem {
  readonly id: MenuItemId
  readonly name: string
  readonly kana?: string
  readonly price: Money
  readonly category?: string
  readonly tags: readonly string[]
  readonly imageUrl?: string
  readonly description?: string
  readonly options?: readonly MenuItemOption[]
  readonly availability: MenuItemAvailability
  readonly source: 'static' | 'dynamic'
  /** Provider-specific payload kept for callers that need to inspect raw data. */
  readonly raw?: unknown
}

export interface Menu {
  readonly items: readonly MenuItem[]
  readonly categories: readonly string[]
  readonly source: Source
  readonly fetchedAt?: string
}

export interface GeoPoint {
  readonly latitude: number
  readonly longitude: number
}

export type ShopStatus = 'open' | 'closed' | 'temporarily_closed' | 'unknown'

/** Normalized services a shop may offer. */
export type ShopService = 'dine_in' | 'takeout' | 'queue' | 'reservation'

export interface WaitEstimate {
  readonly service?: ShopService
  /** Provider-defined lane or seating category, such as `table` or `counter`. */
  readonly lane?: string
  readonly minutes?: number
  /** Number of parties or tickets currently waiting. */
  readonly parties?: number
  readonly updatedAt?: string
  readonly raw?: unknown
}

export interface OpeningHours {
  /** ISO weekday name, such as `monday`, or a provider-defined label. */
  readonly day?: string
  readonly opens?: string
  readonly closes?: string
  readonly raw?: unknown
}

export interface Shop {
  readonly id: ShopId
  readonly name?: string
  readonly brand?: string
  readonly address?: string
  readonly area?: string
  readonly location?: GeoPoint
  /** Straight-line distance from the requested location, in meters. */
  readonly distanceMeters?: number
  readonly status?: ShopStatus
  /** Original provider status label kept alongside the normalized status. */
  readonly statusRaw?: string
  readonly services?: readonly ShopService[]
  /** Wait estimates by service and lane. */
  readonly waitEstimates?: readonly WaitEstimate[]
  readonly openingHours?: readonly OpeningHours[]
  readonly raw?: unknown
}

/** Alias kept for callers that prefer restaurant terminology. */
export type Restaurant = Shop

export interface Page<Item> {
  readonly items: readonly Item[]
  readonly total: number
  readonly offset: number
  readonly limit: number
  readonly hasMore: boolean
}

export interface QueueLane {
  readonly id?: string
  readonly name?: string
  readonly service?: ShopService
  /** Number of parties or tickets waiting in this lane. */
  readonly waiting?: number
  /** Queue numbers currently shown for this lane. */
  readonly numbers?: readonly string[]
  readonly wait?: WaitEstimate
  readonly raw?: unknown
}

export interface Queue {
  readonly shopId: ShopId
  readonly lanes: readonly QueueLane[]
  readonly updatedAt?: string
  readonly raw?: unknown
}

export type WaitlistStatus = 'waiting' | 'called' | 'seated' | 'cancelled' | 'expired' | 'unknown'

export interface WaitlistTicket {
  readonly id?: string
  readonly number?: string
  readonly shopId: ShopId
  readonly status: WaitlistStatus
  readonly statusRaw?: string
  readonly partySize?: number
  readonly service?: ShopService
  readonly lane?: string
  readonly estimatedWaitMinutes?: number
  /** Position in the queue when the provider reports it. */
  readonly position?: number
  readonly issuedAt?: string
  readonly raw?: unknown
}

export type ReservationStatus = 'confirmed' | 'pending' | 'cancelled' | 'expired' | 'unknown'

export interface ReservationSlot {
  readonly shopId: ShopId
  readonly service?: ShopService
  /** ISO 8601 local date-time without a timezone. */
  readonly start: string
  /** ISO 8601 local date-time without a timezone. */
  readonly end: string
  readonly available: boolean
  /** Original provider availability label. */
  readonly status?: string
  readonly raw?: unknown
}

export interface Reservation {
  readonly id?: string
  readonly shopId: ShopId
  readonly status: ReservationStatus
  readonly statusRaw?: string
  readonly partySize?: number
  readonly start?: string
  readonly end?: string
  readonly raw?: unknown
}

export interface OrderValidation {
  readonly ok: boolean
  readonly issues: readonly string[]
  readonly checks?: Readonly<Record<string, boolean>>
  readonly raw?: unknown
}

export interface Table {
  readonly id: TableId
  readonly name?: string
}

export interface SelectedOption {
  readonly optionId: string
  readonly name?: string
  readonly quantity: number
  readonly priceDelta?: Money
}

export interface CartLine {
  readonly id: CartLineId
  readonly itemId: MenuItemId
  readonly name: string
  readonly unitPrice: Money
  readonly quantity: number
  readonly options?: readonly SelectedOption[]
  readonly reorder?: boolean
  readonly raw?: unknown
}

export interface Cart {
  readonly lines: readonly CartLine[]
  readonly itemCount: number
  readonly subtotal: Money
  readonly updatedAt?: string
}

export type OrderStatus =
  | 'draft'
  | 'submitted'
  | 'preparing'
  | 'served'
  | 'cancelled'
  | 'completed'
  | 'unknown'

export interface OrderLine {
  readonly itemId: MenuItemId
  readonly name: string
  readonly quantity: number
  readonly unitPrice: Money
  readonly total: Money
  readonly options?: readonly SelectedOption[]
  readonly reorder?: boolean
  readonly raw?: unknown
}

export interface Order {
  readonly id: OrderId
  readonly status: OrderStatus
  readonly lines: readonly OrderLine[]
  readonly itemCount: number
  readonly total: Money
  readonly submittedAt?: string
  readonly raw?: unknown
}

export interface BillLine {
  readonly itemId?: MenuItemId
  readonly name: string
  readonly quantity: number
  readonly total: Money
  readonly raw?: unknown
}

export interface Bill {
  readonly lines: readonly BillLine[]
  readonly itemCount: number
  readonly total: Money
  readonly controlNo?: string
  readonly dummyNo?: string
  readonly raw?: unknown
}

/** Billing and account are the same domain concept under different names. */
export type Account = Bill

export interface Receipt {
  readonly barcodeValue?: string
  readonly barcodeImageUrl?: string
  readonly tableId?: TableId
  readonly total?: Money
  readonly raw?: unknown
}

export interface Session {
  readonly provider: string
  readonly sessionId?: SessionId
  readonly shop?: Shop
  readonly table?: Table
  readonly peopleCount?: number
  readonly page?: string
  readonly openedAt: string
  readonly updatedAt: string
  readonly raw?: unknown
}

export const calculateCart = (
  lines: readonly CartLine[],
  currency = lines[0]?.unitPrice.currency ?? 'JPY',
): Cart => ({
  lines,
  itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
  subtotal: lines.reduce(
    (sum, line) => addMoney(sum, multiplyMoney(line.unitPrice, line.quantity)),
    money(0, currency),
  ),
})
