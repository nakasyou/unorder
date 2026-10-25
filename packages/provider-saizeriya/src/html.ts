/**
 * A deliberately small HTML parser. The Saizeriya client only needs hidden
 * input values, a handful of classes, and table rows, so this avoids a runtime
 * dependency on a full parser.
 */

export interface HtmlElement {
  readonly kind: 'element'
  readonly tag: string
  readonly attributes: Record<string, string>
  readonly children: HtmlNode[]
}

export interface HtmlText {
  readonly kind: 'text'
  readonly text: string
}

export type HtmlNode = HtmlElement | HtmlText

const voidTags = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

const rawTextTags = new Set(['script', 'style'])

const entities: Record<string, string> = {
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
    return entities[entity.toLowerCase()] ?? whole
  })

const createElement = (tag: string, attributes: Record<string, string>): HtmlElement => ({
  kind: 'element',
  tag: tag.toLowerCase(),
  attributes,
  children: [],
})

const parseAttributes = (source: string): Record<string, string> => {
  const attributes: Record<string, string> = {}
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  for (const match of source.matchAll(pattern)) {
    const name = match[1]?.toLowerCase()
    if (!name) {
      continue
    }
    const raw = match[2] ?? match[3] ?? match[4] ?? ''
    attributes[name] = decodeEntities(raw)
  }
  return attributes
}

const findTagEnd = (html: string, start: number): number => {
  let quote: '"' | "'" | undefined
  for (let index = start; index < html.length; index++) {
    const char = html[index]
    if (quote) {
      if (char === quote) {
        quote = undefined
      }
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '>') {
      return index
    }
  }
  return html.length - 1
}

const parse = (html: string): HtmlElement => {
  const root = createElement('#document', {})
  const stack: HtmlElement[] = [root]
  let index = 0

  const current = () => stack[stack.length - 1] ?? root

  while (index < html.length) {
    const next = html.indexOf('<', index)
    if (next === -1) {
      current().children.push({ kind: 'text', text: decodeEntities(html.slice(index)) })
      break
    }
    if (next > index) {
      current().children.push({ kind: 'text', text: decodeEntities(html.slice(index, next)) })
    }

    if (html.startsWith('<!--', next)) {
      const end = html.indexOf('-->', next + 4)
      index = end === -1 ? html.length : end + 3
      continue
    }

    if (html.startsWith('<!', next) || html.startsWith('<?', next)) {
      const end = html.indexOf('>', next + 2)
      index = end === -1 ? html.length : end + 1
      continue
    }

    if (html.startsWith('</', next)) {
      const end = html.indexOf('>', next + 2)
      const tag = html
        .slice(next + 2, end === -1 ? html.length : end)
        .trim()
        .split(/\s+/)[0]
        ?.toLowerCase()
      if (tag) {
        const match = stack.findLastIndex((element) => element.tag === tag)
        if (match > 0) {
          stack.length = match
        }
      }
      index = end === -1 ? html.length : end + 1
      continue
    }

    const end = findTagEnd(html, next + 1)
    const rawTag = html.slice(next + 1, end)
    const selfClosing = rawTag.trimEnd().endsWith('/')
    const body = selfClosing ? rawTag.trimEnd().slice(0, -1) : rawTag
    const nameMatch = /^([a-zA-Z][\w:-]*)/.exec(body)
    if (!nameMatch?.[1]) {
      current().children.push({ kind: 'text', text: '<' })
      index = next + 1
      continue
    }

    const tag = nameMatch[1].toLowerCase()
    const element = createElement(tag, parseAttributes(body.slice(nameMatch[0].length)))
    current().children.push(element)
    index = end + 1

    if (rawTextTags.has(tag) && !selfClosing) {
      const close = html.toLowerCase().indexOf(`</${tag}`, index)
      const textEnd = close === -1 ? html.length : close
      if (textEnd > index) {
        element.children.push({ kind: 'text', text: html.slice(index, textEnd) })
      }
      const closeEnd = close === -1 ? html.length : html.indexOf('>', close)
      index = closeEnd === -1 ? html.length : closeEnd + 1
      continue
    }

    if (!selfClosing && !voidTags.has(tag)) {
      stack.push(element)
    }
  }

  return root
}

interface Compound {
  readonly tag?: string
  readonly id?: string
  readonly classes: readonly string[]
  readonly attributes: readonly {
    readonly name: string
    readonly operator: '=' | 'exists' | '!='
    readonly value?: string
  }[]
}

interface SelectorPart {
  readonly compound: Compound
  readonly combinator: ' ' | '>'
}

const parseCompound = (source: string): Compound => {
  let rest = source.trim()
  let tag: string | undefined
  const tagMatch = /^([a-zA-Z][\w-]*|\*)/.exec(rest)
  if (tagMatch?.[1]) {
    tag = tagMatch[1] === '*' ? undefined : tagMatch[1].toLowerCase()
    rest = rest.slice(tagMatch[0].length)
  }

  let id: string | undefined
  const classes: string[] = []
  const attributes: { name: string; operator: '=' | 'exists' | '!='; value?: string }[] = []

  while (rest.length > 0) {
    if (rest.startsWith('#')) {
      const match = /^#([\w-]+)/.exec(rest)
      if (!match?.[1]) {
        break
      }
      id = match[1]
      rest = rest.slice(match[0].length)
      continue
    }
    if (rest.startsWith('.')) {
      const match = /^\.([\w-]+)/.exec(rest)
      if (!match?.[1]) {
        break
      }
      classes.push(match[1])
      rest = rest.slice(match[0].length)
      continue
    }
    if (rest.startsWith('[')) {
      const match = /^\[([\w-]+)(?:\s*([!~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/.exec(
        rest,
      )
      if (!match?.[1]) {
        break
      }
      const operator = match[2] === '=' ? '=' : match[2] === '!=' ? '!=' : 'exists'
      const value = match[3] ?? match[4] ?? match[5]
      attributes.push({
        name: match[1].toLowerCase(),
        operator,
        ...(value === undefined ? {} : { value: decodeEntities(value) }),
      })
      rest = rest.slice(match[0].length)
      continue
    }
    break
  }

  return { ...(tag ? { tag } : {}), ...(id ? { id } : {}), classes, attributes }
}

const parseSelector = (selector: string): SelectorPart[] | undefined => {
  const parts: SelectorPart[] = []
  let buffer = ''
  let combinator: ' ' | '>' = ' '
  let bracketDepth = 0
  let quote: '"' | "'" | undefined

  const flush = () => {
    const compound = buffer.trim()
    if (compound) {
      parts.push({ compound: parseCompound(compound), combinator })
      combinator = ' '
    }
    buffer = ''
  }

  for (const char of selector.trim()) {
    if (quote) {
      buffer += char
      if (char === quote) {
        quote = undefined
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      buffer += char
      continue
    }
    if (char === '[') {
      bracketDepth++
      buffer += char
      continue
    }
    if (char === ']') {
      bracketDepth--
      buffer += char
      continue
    }
    if (bracketDepth === 0 && char === '>') {
      flush()
      combinator = '>'
      continue
    }
    if (bracketDepth === 0 && /\s/.test(char)) {
      flush()
      continue
    }
    buffer += char
  }
  flush()
  return parts.length > 0 ? parts : undefined
}

const classesOf = (element: HtmlElement): readonly string[] =>
  (element.attributes['class'] ?? '').split(/\s+/).filter(Boolean)

const matches = (element: HtmlElement, compound: Compound): boolean => {
  if (compound.tag && element.tag !== compound.tag) {
    return false
  }
  if (compound.id && element.attributes['id'] !== compound.id) {
    return false
  }
  if (compound.classes.length > 0) {
    const classes = classesOf(element)
    if (!compound.classes.every((name) => classes.includes(name))) {
      return false
    }
  }
  for (const attribute of compound.attributes) {
    const actual = element.attributes[attribute.name]
    if (attribute.operator === 'exists') {
      if (actual === undefined) {
        return false
      }
    } else if (attribute.operator === '=') {
      if (actual !== attribute.value) {
        return false
      }
    } else if (attribute.operator === '!=' && actual === attribute.value) {
      return false
    }
  }
  return true
}

const descendants = (element: HtmlElement, output: HtmlElement[] = []): HtmlElement[] => {
  for (const child of element.children) {
    if (child.kind === 'element') {
      output.push(child)
      descendants(child, output)
    }
  }
  return output
}

const textContentOf = (node: HtmlNode): string => {
  if (node.kind === 'text') {
    return node.text
  }
  return node.children.map(textContentOf).join('')
}

const queryAll = (root: HtmlElement, selector: string): HtmlElement[] => {
  const parts = parseSelector(selector)
  if (!parts) {
    return []
  }
  let current: HtmlElement[] = [root]
  parts.forEach((part, index) => {
    const candidates: HtmlElement[] = []
    for (const element of current) {
      if (index === 0) {
        candidates.push(...descendants(element))
      } else if (part.combinator === '>') {
        candidates.push(
          ...element.children.flatMap((child) => (child.kind === 'element' ? [child] : [])),
        )
      } else {
        candidates.push(...descendants(element))
      }
    }
    current = candidates.filter((element) => matches(element, part.compound))
  })
  return current
}

export class HtmlDocument {
  readonly root: HtmlElement

  constructor(html: string) {
    this.root = parse(html)
  }

  querySelector(selector: string): HtmlElement | undefined {
    return this.querySelectorAll(selector)[0]
  }

  querySelectorAll(selector: string): HtmlElement[] {
    return queryAll(this.root, selector)
  }

  get text(): string {
    return textContentOf(this.root)
  }
}

export const textContent = (element: HtmlElement): string => textContentOf(element).trim()
