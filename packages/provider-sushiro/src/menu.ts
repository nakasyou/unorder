import { brand, money, ProviderError } from '@unorder/core'
import type { MenuItem, MenuItemId, MenuItemOption } from '@unorder/core'

type Row = Record<string, unknown>
const obj = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {}
const localized = (v: unknown): string => { const o = obj(v); return typeof o.ja === 'string' ? o.ja.replace(/\r?\n/g, ' ').trim() : '' }
const num = (v: unknown): number | null => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : []

export const parseSushiroMenu = (raw: unknown): MenuItem[] => {
  const root = obj(raw)
  if (!Array.isArray(root.categories)) throw new ProviderError('Invalid Sushiro categories')
  const groups = obj(root.option_groups)
  const items: MenuItem[] = []
  const seen = new Set<string>()
  for (const category of root.categories) {
    const c = obj(category)
    for (const sub of array(c.sub_categories)) {
      const s = obj(sub)
      for (const entry of array(s.items)) {
        const r = obj(entry), id = num(r.id), price = num(r.price)
        if (id === null || price === null || seen.has(String(id))) continue
        seen.add(String(id))
        const choices: MenuItemOption[] = []
        for (const [groupId] of Object.entries(obj(r.options))) {
          const group = obj(groups[groupId])
          for (const [index, value] of Object.entries(obj(group.options))) {
            const option = obj(value), code = num(option.code)
            if (code === null) continue
            choices.push({ id: groupId + ':' + index, name: localized(option.name), priceDelta: money(num(option.amount) ?? 0), raw: { groupId, index: Number(index), code } })
          }
        }
        const stopped = r.is_shop_stopped === true || r.is_table_stopped === true || r.is_table_limited === true || (num(r.stock_status) ?? 0) !== 0 || r.max_orderable_quantity === 0 || r.remaining_orderable_quantity === 0
        const image = typeof r.image === 'string' && /^assets\/[\w/.-]+$/.test(r.image) ? 'https://mo.sushiro.jp/' + r.image : undefined
        items.push({ id: brand<MenuItemId>(String(id)), name: localized(r.name), price: money(price), category: localized(s.name) || localized(c.name), tags: [], ...(image ? { imageUrl: image } : {}), ...(choices.length ? { options: choices } : {}), availability: stopped ? 'sold_out' : 'available', source: 'dynamic', extensions: { defaults: obj(r.options), orderLimit: num(r.order_limit), remainingQuantity: num(r.remaining_orderable_quantity) }, raw: { id, options: obj(r.options), discounts: array(r.discounts) } })
      }
    }
  }
  return items
}
