import { brand, money } from '@unorder/core'
import type { MenuItem, MenuItemAvailability, MenuItemId } from '@unorder/core'

export interface SushiroMenuSnapshot {
  readonly items: readonly MenuItem[]
  readonly categories: readonly string[]
}

const namedEntities: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: '\u00a0',
  quot: '"',
}

export const decodeEntities = (value: string): string =>
  value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return namedEntities[entity.toLowerCase()] ?? whole
  })

const withLineBreaks = (value: string): string =>
  value.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n')

export const stripTags = (value: string): string =>
  decodeEntities(withLineBreaks(value).replace(/<[^>]*>/g, ' '))
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const attribute = (source: string, name: string): string | undefined => {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')
  const match = pattern.exec(source)
  const value = match?.[1] ?? match?.[2]
  return value === undefined ? undefined : decodeEntities(value)
}

const divContent = (source: string, className: string): string | undefined => {
  const pattern = new RegExp(`<div[^>]*class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)</div>`, 'i')
  return pattern.exec(source)?.[1]
}

const parsePrice = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined
  }
  const normalized = stripTags(value).replaceAll(',', '')
  const match = /(\d+)\s*円/.exec(normalized)
  if (!match?.[1]) {
    return undefined
  }
  const price = Number.parseInt(match[1], 10)
  return Number.isFinite(price) ? price : undefined
}

const availabilityFrom = (
  priceText: string | undefined,
  annotation: string,
): MenuItemAvailability => {
  const text = `${priceText ?? ''} ${annotation}`
  if (/完売しました|販売終了|売り切れ/.test(text)) {
    return 'sold_out'
  }
  if (parsePrice(priceText) !== undefined) {
    return 'available'
  }
  return 'unknown'
}

const parseCategories = (html: string): string[] => {
  const categories: string[] = []
  const pattern = /<div[^>]*class="[^"]*category-tab__item[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
  for (const match of html.matchAll(pattern)) {
    const category = stripTags(match[1] ?? '')
    if (category) {
      categories.push(category)
    }
  }
  return categories
}

const parseItems = (html: string, categories: readonly string[]): MenuItem[] => {
  const containerIndex = html.indexOf('class="swiper-container"')
  if (containerIndex === -1) {
    return []
  }
  const slides = html.slice(containerIndex).split('<div class="swiper-slide">').slice(1)

  const items: MenuItem[] = []
  slides.forEach((slide, slideIndex) => {
    const category = categories[slideIndex]
    const marker = /<div data-target="(\d+)" class="menu-item">/g
    const matches = [...slide.matchAll(marker)]
    matches.forEach((match, itemIndex) => {
      const id = match[1]
      const start = (match.index ?? 0) + match[0].length
      const end = matches[itemIndex + 1]?.index ?? slide.length
      const body = slide.slice(start, end)
      const name = stripTags(divContent(body, 'menu-item__name') ?? '')
      if (!id || !name) {
        return
      }
      const priceText = divContent(body, 'menu-item__price')
      const annotation = stripTags(divContent(body, 'menu-item__annotation') ?? '')
      const setDetail = stripTags(divContent(body, 'menu-item__setdetail') ?? '')
      const calories = stripTags(divContent(body, 'menu-item__calorie') ?? '')
      const imageTag = /<img[^>]*class="[^"]*menu-item__img[^"]*"[^>]*>/i.exec(body)?.[0]
      const imageUrl = imageTag ? attribute(imageTag, 'src') : undefined
      const price = parsePrice(priceText)
      const descriptionParts = [annotation, setDetail].filter(Boolean)
      const availability = availabilityFrom(priceText, annotation)

      items.push({
        id: brand<MenuItemId>(id),
        name,
        price: money(price ?? 0),
        ...(category ? { category } : {}),
        tags: [],
        ...(imageUrl ? { imageUrl } : {}),
        ...(descriptionParts.length > 0 ? { description: descriptionParts.join('\n') } : {}),
        availability,
        source: 'dynamic',
        raw: {
          id,
          name,
          priceText: priceText === undefined ? undefined : stripTags(priceText),
          price,
          category,
          imageUrl,
          calories,
          annotation,
          setDetail,
          availability,
        },
      })
    })
  })
  return items
}

/** Parses the server-rendered Sushiro menu detail page. */
export const parseSushiroMenu = (html: string): SushiroMenuSnapshot => {
  const categories = parseCategories(html)
  return { items: parseItems(html, categories), categories }
}
