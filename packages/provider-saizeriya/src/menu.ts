import { readFile } from 'node:fs/promises'
import {
  brand,
  menuCategories,
  money,
  NotFoundError,
  ProviderError,
  sourceFromMenuSource,
} from '@unorder/core'
import type { MenuItem, MenuItemId, MenuSource, Source } from '@unorder/core'
import { fetchOrThrow, readJSON } from './http'
import type { SaizeriyaMenuEntry, SaizeriyaProviderConfig } from './types'

export const DEFAULT_SAIZERIYA_MENU_URL =
  'https://raw.githubusercontent.com/nakasyou/unorder/main/packages/provider-saizeriya/data/menu.json'

interface LoadedMenu {
  readonly items: readonly MenuItem[]
  readonly categories: readonly string[]
  readonly source: Source
  readonly fetchedAt: string
}

const cache = new Map<string, Omit<LoadedMenu, 'fetchedAt'>>()

const asEntry = (value: unknown): SaizeriyaMenuEntry | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const record = value as Record<string, unknown>
  const itemData =
    typeof record.item_data === 'object' && record.item_data !== null
      ? (record.item_data as Record<string, unknown>)
      : record
  const code = itemData.code ?? itemData.id
  const name = itemData.name
  const price = itemData.price
  if (typeof code !== 'string' || typeof name !== 'string' || typeof price !== 'number') {
    return undefined
  }
  return {
    code,
    name,
    price,
    ...(typeof itemData.kana === 'string' ? { kana: itemData.kana } : {}),
    ...(typeof itemData.category === 'string' ? { category: itemData.category } : {}),
    ...(Array.isArray(itemData.tags)
      ? { tags: itemData.tags.filter((tag): tag is string => typeof tag === 'string') }
      : {}),
    ...(typeof itemData.imageUrl === 'string' ? { imageUrl: itemData.imageUrl } : {}),
  }
}

const parseEntries = (raw: unknown): SaizeriyaMenuEntry[] => {
  if (!Array.isArray(raw)) {
    throw new ProviderError('Saizeriya menu data must be a JSON array')
  }
  return raw.flatMap((value) => {
    const entry = asEntry(value)
    return entry ? [entry] : []
  })
}

export const toMenuItem = (entry: SaizeriyaMenuEntry): MenuItem => ({
  id: brand<MenuItemId>(entry.code),
  name: entry.name,
  ...(entry.kana ? { kana: entry.kana } : {}),
  price: money(entry.price),
  ...(entry.category ? { category: entry.category } : {}),
  tags: entry.tags ?? [],
  ...(entry.imageUrl ? { imageUrl: entry.imageUrl } : {}),
  availability: 'unknown',
  source: 'static',
  raw: entry,
})

/** Loads the configured static menu. Injected entries win over file and URL. */
export const loadSaizeriyaMenu = async (options: {
  config: SaizeriyaProviderConfig
  fetch: typeof globalThis.fetch
  now: () => Date
  refresh?: boolean
}): Promise<LoadedMenu> => {
  const { config } = options

  if (config.menuItems) {
    const items = config.menuItems.map(toMenuItem)
    return {
      items,
      categories: menuCategories(items),
      source: { kind: 'injected', label: 'provider config' },
      fetchedAt: options.now().toISOString(),
    }
  }

  const menuUrl = config.menuUrl === undefined ? DEFAULT_SAIZERIYA_MENU_URL : config.menuUrl
  const source: MenuSource = config.menuFile
    ? { kind: 'static', location: { kind: 'file', path: config.menuFile } }
    : menuUrl
      ? { kind: 'static', location: { kind: 'url', url: menuUrl } }
      : (() => {
          throw new ProviderError(
            'No Saizeriya menu source configured: set menuItems, menuFile, or menuUrl',
          )
        })()

  const cacheKey = config.menuFile ? `file:${config.menuFile}` : `url:${menuUrl}`
  const cached = options.refresh ? undefined : cache.get(cacheKey)
  if (cached) {
    return {
      ...cached,
      source: sourceFromMenuSource(source),
      fetchedAt: options.now().toISOString(),
    }
  }

  let entries: SaizeriyaMenuEntry[]
  if (config.menuFile) {
    let text: string
    try {
      text = await readFile(config.menuFile, 'utf8')
    } catch (error) {
      throw new ProviderError(`Failed to read Saizeriya menu file: ${config.menuFile}`, {
        cause: error,
        details: { path: config.menuFile },
      })
    }
    try {
      entries = parseEntries(JSON.parse(text))
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error
      }
      throw new ProviderError(`Saizeriya menu file is not valid JSON: ${config.menuFile}`, {
        cause: error,
      })
    }
  } else {
    const response = await fetchOrThrow(
      options.fetch,
      menuUrl as string,
      { headers: { accept: 'application/json' } },
      'Saizeriya menu download',
    )
    entries = parseEntries(await readJSON(response, 'Saizeriya menu download'))
  }

  const items = entries.map(toMenuItem)
  const loaded = {
    items,
    categories: menuCategories(items),
    source: sourceFromMenuSource(source),
  }
  cache.set(cacheKey, loaded)
  return { ...loaded, fetchedAt: options.now().toISOString() }
}

export const findMenuItem = async (
  options: Parameters<typeof loadSaizeriyaMenu>[0] & { id: string },
): Promise<MenuItem> => {
  const menu = await loadSaizeriyaMenu(options)
  const item = menu.items.find((candidate) => candidate.id === options.id)
  if (!item) {
    throw new NotFoundError(`Menu item "${options.id}" was not found`)
  }
  return item
}

export const clearMenuCache = () => {
  cache.clear()
}
