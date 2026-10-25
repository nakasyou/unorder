import type { MenuItem, MenuSource, Source } from './domain'

export interface MenuListInput {
  readonly query?: string
  readonly category?: string
  readonly tags?: readonly string[]
  readonly availability?: 'all' | 'available'
  readonly limit?: number
  readonly offset?: number
  readonly refresh?: boolean
}

export interface MenuListResult {
  readonly items: readonly MenuItem[]
  readonly total: number
  readonly offset: number
  readonly limit: number
  readonly hasMore: boolean
  readonly source: Source
  readonly fetchedAt?: string
}

export interface MenuGetInput {
  readonly id: string
  /** Ask the provider for live availability instead of a cached snapshot when supported. */
  readonly live?: boolean
}

export const DEFAULT_MENU_LIMIT = 200
export const MAX_MENU_LIMIT = 1000

const normalize = (value: string) => value.normalize('NFKC').toLowerCase()

/** Filters menu items using the shared `menu.list` semantics. */
export const filterMenuItems = (
  items: readonly MenuItem[],
  input: MenuListInput = {},
): readonly MenuItem[] => {
  const query = input.query?.trim()
  const normalizedQuery = query ? normalize(query) : undefined
  const category = input.category?.trim()
  const normalizedCategory = category ? normalize(category) : undefined
  const tags = input.tags?.map(normalize) ?? []

  return items.filter((item) => {
    if (input.availability === 'available' && item.availability !== 'available') {
      return false
    }
    if (normalizedCategory && normalize(item.category ?? '') !== normalizedCategory) {
      return false
    }
    if (tags.length > 0) {
      const itemTags = new Set(item.tags.map(normalize))
      if (!tags.every((tag) => itemTags.has(tag))) {
        return false
      }
    }
    if (normalizedQuery) {
      const haystacks = [item.id, item.name, item.kana ?? '', item.category ?? '', ...item.tags]
      if (!haystacks.some((value) => normalize(value).includes(normalizedQuery))) {
        return false
      }
    }
    return true
  })
}

/** Applies filtering and paging and returns the stable `menu.list` shape. */
export const listMenuItems = (
  items: readonly MenuItem[],
  input: MenuListInput = {},
  source: Source,
  fetchedAt?: string,
): MenuListResult => {
  const filtered = filterMenuItems(items, input)
  const offset = Math.max(0, Math.trunc(input.offset ?? 0))
  const limit = Math.min(MAX_MENU_LIMIT, Math.max(1, Math.trunc(input.limit ?? DEFAULT_MENU_LIMIT)))
  const page = filtered.slice(offset, offset + limit)
  return {
    items: page,
    total: filtered.length,
    offset,
    limit,
    hasMore: offset + page.length < filtered.length,
    source,
    ...(fetchedAt ? { fetchedAt } : {}),
  }
}

/** Returns categories in first-seen order, which mirrors the source menu. */
export const menuCategories = (items: readonly MenuItem[]): readonly string[] => {
  const categories = new Set<string>()
  for (const item of items) {
    if (item.category) {
      categories.add(item.category)
    }
  }
  return [...categories]
}

/** Builds a Source record from a MenuSource description. */
export const sourceFromMenuSource = (source: MenuSource): Source => {
  if (source.kind === 'dynamic') {
    return { kind: 'dynamic', providerId: source.providerId }
  }
  if (source.location.kind === 'url') {
    return { kind: 'static', url: source.location.url }
  }
  if (source.location.kind === 'file') {
    return { kind: 'static', file: source.location.path }
  }
  return { kind: 'injected', ...(source.location.label ? { label: source.location.label } : {}) }
}
