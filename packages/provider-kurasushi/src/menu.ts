import { brand, money, ProviderError } from '@unorder/core'
import type { MenuItem, MenuItemId } from '@unorder/core'
import { integer, record, text } from './api'

export interface KurasushiItem extends MenuItem {
  readonly extensions: { readonly categoryId: number }
}
export const toKurasushiItem = (
  raw: unknown,
  categoryId: number,
  category?: string,
): KurasushiItem => {
  const item = record(raw)
  return {
    id: brand<MenuItemId>(String(integer(item.itemCode))),
    name: text(item.name),
    price: money(integer(item.price)),
    ...(category ? { category } : {}),
    tags: [],
    ...(typeof item.itemImage === 'string' ? { imageUrl: item.itemImage } : {}),
    ...(typeof item.cautionaryNote === 'string' ? { description: item.cautionaryNote } : {}),
    availability: 'unknown',
    source: 'dynamic',
    raw,
    extensions: { categoryId },
  }
}

export const parseKurasushiMenu = (raw: unknown): KurasushiItem[] => {
  if (!Array.isArray(raw)) throw new ProviderError('Invalid Kurasushi menu')
  const items = new Map<string, KurasushiItem>()
  for (const entry of raw) {
    const category = record(entry)
    const id = integer(category.categoryId)
    const name = text(category.name)
    if (!Array.isArray(category.itemList)) throw new ProviderError('Invalid Kurasushi category')
    for (const value of category.itemList) {
      const item = toKurasushiItem(value, id, name)
      const previous = items.get(item.id)
      // Prefer the specific category over the duplicated "all" category.
      if (!previous || previous.category === 'すべて') items.set(item.id, item)
    }
  }
  return [...items.values()]
}

export interface Topping {
  readonly code: number
  readonly group: number
  readonly name: string
  readonly isDefault: boolean
}
export const parseToppings = (raw: unknown): Topping[] => {
  if (!Array.isArray(raw)) throw new ProviderError('Invalid Kurasushi toppings')
  return raw.map((value) => {
    const topping = record(value)
    return {
      code: integer(topping.toppingCode),
      group: integer(topping.toppingGroup),
      name: text(topping.name),
      isDefault: topping.defaultSelect === 0,
    }
  })
}
