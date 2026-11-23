import { brand, money, ProviderError } from '@unorder/core'
import type { BillLine, MenuItemId } from '@unorder/core'

interface ResponseObject { [key: string]: unknown }
const object = (value: unknown): ResponseObject => {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new ProviderError('Invalid Sushiro order detail response')
  return value as ResponseObject
}
const integer = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new ProviderError('Invalid Sushiro order detail numeric field')
  return value
}

export interface SushiroOrderDetailLine {
  readonly pluId: number
  readonly quantity: number
  readonly unitPrice: number
  readonly currentPrice: number
  readonly served: boolean
  readonly discountsId: number | null
}

export interface SushiroOrderDetail {
  readonly tableId: number
  readonly itemCount: number
  readonly total: ReturnType<typeof money>
  readonly lines: readonly SushiroOrderDetailLine[]
}

/** Read-only table order detail; the endpoint does not identify individual order batches. */
export const parseSushiroOrderDetail = (raw: unknown): SushiroOrderDetail => {
  const root = object(raw)
  if (!Array.isArray(root.order_items)) throw new ProviderError('Invalid Sushiro order_items')
  const lines = root.order_items.map((entry: unknown): SushiroOrderDetailLine => {
    const row = object(entry)
    const discount = object(row.item_discounts)
    const discountId = discount.item_discounts_id == null ? null : integer(discount.item_discounts_id)
    const flag = integer(row.served_flag)
    if (flag !== 0 && flag !== 1) throw new ProviderError('Unknown Sushiro served flag')
    return {
      pluId: integer(row.plu_id),
      quantity: integer(row.qty),
      unitPrice: integer(row.unit_price),
      currentPrice: integer(row.current_price),
      served: flag === 1,
      discountsId: discountId,
    }
  })
  return {
    tableId: integer(root.table_id),
    itemCount: lines.reduce((sum, item) => sum + item.quantity, 0),
    total: money(integer(root.total_amount)),
    lines,
  }
}

/** Normalized lines can also be used by future checkout/account integrations. */
export const detailToBillLines = (detail: SushiroOrderDetail): BillLine[] =>
  detail.lines.map((line) => ({
    itemId: brand<MenuItemId>(String(line.pluId)),
    name: String(line.pluId),
    quantity: line.quantity,
    total: money(line.currentPrice * line.quantity),
  }))
