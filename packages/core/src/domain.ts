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
  readonly extensions?: Readonly<Record<string, unknown>>
}

export interface Menu {
  readonly items: readonly MenuItem[]
  readonly categories: readonly string[]
  readonly source: Source
  readonly fetchedAt?: string
}

export interface Shop {
  readonly id: ShopId
  readonly name?: string
  readonly brand?: string
  readonly raw?: unknown
}

/** Alias kept for callers that prefer restaurant terminology. */
export type Restaurant = Shop

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
  readonly extensions?: Readonly<Record<string, unknown>>
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
