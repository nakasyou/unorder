import type { SaizeriyaMenuEntry } from '../src/types'

export type MockPage =
  | 'entry'
  | 'top'
  | 'number'
  | 'menu'
  | 'main'
  | 'history'
  | 'call'
  | 'account'
  | 'receipt'

export interface MockCartLine {
  id: string
  count: number
  modId: string
  modCount: number
}

export interface MockTable {
  id: string
  shopId: number
  tableId: number
  peopleCount: number
  peopleCountRegistered: boolean
  page: MockPage
  token: string
  sessionId: string
  cart: MockCartLine[]
  submittedOrders: MockCartLine[][]
  orderStarted: boolean
  lastOrderClosed: boolean
  midnightCharge: boolean
  staffCalls: number
  dessertCalls: number
  receiptShown: boolean
}

const escapeHtml = (value: unknown) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json; charset=UTF-8' },
  })

const readBody = async (request: Request): Promise<URLSearchParams> =>
  new URLSearchParams(await request.text())

const receiptCode = (table: MockTable): string => {
  const digits = table.sessionId
    .split('')
    .map((char) => char.charCodeAt(0) % 10)
    .join('')
  const sessionPart = digits.slice(0, 6).padEnd(6, '0')
  return `${table.shopId.toString().padStart(3, '0')}${table.tableId
    .toString()
    .padStart(3, '0')}${sessionPart}`.slice(0, 12)
}

export class MockSaizeriyaServer {
  readonly tables = new Map<string, MockTable>()
  readonly menu = new Map<string, SaizeriyaMenuEntry>()
  readonly #urlIds = new Map<string, MockTable>()
  #sequence = 0

  constructor(menu: readonly SaizeriyaMenuEntry[]) {
    for (const item of menu) {
      this.menu.set(item.code, item)
    }
  }

  createTable(shopId = 525, tableId = 51): MockTable {
    const table: MockTable = {
      id: `table-${++this.#sequence}`,
      shopId,
      tableId,
      peopleCount: 0,
      peopleCountRegistered: false,
      page: 'entry',
      token: `token-${++this.#sequence}`,
      sessionId: `session-${this.#sequence}-abcdef`,
      cart: [],
      submittedOrders: [],
      orderStarted: false,
      lastOrderClosed: false,
      midnightCharge: false,
      staffCalls: 0,
      dessertCalls: 0,
      receiptShown: false,
    }
    this.tables.set(table.id, table)
    return table
  }

  qrUrl(table: MockTable): string {
    return `http://example.com/saizeriya3/qr?table=${table.id}`
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    const method = request.method.toUpperCase()

    if (url.pathname === '/saizeriya3/qr' && method === 'GET') {
      const tableId = url.searchParams.get('table')
      const table = (tableId ? this.tables.get(tableId) : undefined) ?? this.createTable()
      const urlId = this.#createUrlId(table, table.peopleCountRegistered ? 'top' : 'entry')
      return new Response(null, {
        status: 302,
        headers: { location: `./?${urlId}`, 'set-cookie': 'session=cookie; Path=/' },
      })
    }

    if (url.pathname === '/saizeriya3/' && method === 'GET') {
      const id = url.search.slice(1)
      const table = this.#urlIds.get(id)
      if (!table) {
        return new Response('Not found', { status: 404 })
      }
      return this.#render(table)
    }

    if (url.pathname === '/saizeriya3/' && method === 'POST') {
      const id = url.search.slice(1)
      const table = this.#urlIds.get(id)
      if (!table) {
        return new Response('Not found', { status: 404 })
      }
      const body = await readBody(request)
      this.#applyPage(table, body)
      return this.#render(table)
    }

    const command = url.pathname.replace('/saizeriya3/src/cmd/', '')
    if (method === 'POST' && url.pathname.startsWith('/saizeriya3/src/cmd/')) {
      return this.#handleCommand(command, await readBody(request))
    }

    return new Response('Not found', { status: 404 })
  }

  #createUrlId(table: MockTable, page: MockPage): string {
    table.page = page
    const id = `url-${++this.#sequence}`
    this.#urlIds.set(id, table)
    return id
  }

  #findTable(shopId: string | null, tableId: string | null): MockTable | undefined {
    return [...this.tables.values()].find(
      (table) =>
        table.shopId === Number.parseInt(shopId ?? '', 10) &&
        table.tableId === Number.parseInt(tableId ?? '', 10),
    )
  }

  #applyPage(table: MockTable, body: URLSearchParams) {
    const proc = body.get('proc') ?? ''
    const nextPage: MockPage =
      proc === 'order' ? 'call' : proc === 'top' || proc === 'entry' ? 'top' : (proc as MockPage)
    table.token = `token-${++this.#sequence}`

    if (proc === 'menu' && body.get('ctrl') === 'number') {
      table.peopleCount = Number.parseInt(body.get('number') ?? '0', 10)
      table.peopleCountRegistered = true
    }

    if (proc === 'main' && body.get('ctrl') === 'add' && body.get('code')) {
      table.orderStarted = true
      table.cart.push({
        id: body.get('code') ?? '',
        count: Number.parseInt(body.get('amount') ?? '1', 10),
        modId: body.get('mod_code') ?? '',
        modCount: Number.parseInt(body.get('mod_amount') ?? '0', 10),
      })
    }

    if (proc === 'order') {
      const ids = body.getAll('item[id][]')
      const counts = body.getAll('item[count][]')
      const modIds = body.getAll('item[mod_id][]')
      const modCounts = body.getAll('item[mod_count][]')
      const submitted = ids.map((id, index) => ({
        id,
        count: Number.parseInt(counts[index] ?? '1', 10),
        modId: modIds[index] ?? '',
        modCount: Number.parseInt(modCounts[index] ?? '0', 10),
      }))
      if (submitted.length > 0) {
        table.submittedOrders.push(submitted)
      }
      table.cart = []
      table.orderStarted = true
      table.page = 'call'
      return
    }

    if (proc === 'receipt') {
      table.receiptShown = true
    }

    table.page = nextPage
  }

  #handleCommand(command: string, body: URLSearchParams): Response {
    if (command === 'get_item.php') {
      const item = this.menu.get(body.get('id') ?? '')
      if (!item) {
        return json({ result: 'NG' })
      }
      return json({
        result: 'OK',
        alcohol_check: 0,
        item_data: {
          id: item.code,
          name: item.name,
          price: item.price,
          messages: ['0', '2'],
          mod_id: '',
          mod_name: '',
          mod_price: 0,
          mod_ini_cnt: 0,
          mod_guid: '',
          drk_id: '',
          drk_name: '',
          drk_price: 0,
          drk_guid: '',
          popup: '',
          notice: '',
          arc_type: 0,
          drk_type: 0,
          main_type: 0,
          state: Object.hasOwn(item, 'state') ? (item as unknown as { state: number }).state : 2,
        },
      })
    }

    const table = this.#findTable(body.get('sid'), body.get('tno') ?? body.get('tbl'))
    switch (command) {
      case 'check_order.php':
        return json({ result: table?.orderStarted ? 'OK' : 'NG' })
      case 'check_lastorder.php':
        return json({
          result: table?.lastOrderClosed ? 'OK' : 'NG',
          lastorder: table?.lastOrderClosed ?? false,
        })
      case 'check_midnight.php':
        return json({ result: table?.midnightCharge ? 'OK' : 'NG' })
      case 'put_alcohol.php':
        return json({ result: 'OK' })
      case 'tbl_call.php':
        if (table) {
          if (body.get('aft') === 'true') {
            table.dessertCalls++
          } else {
            table.staffCalls++
          }
        }
        return json({ result: 'OK' })
      default:
        return new Response('Not found', { status: 404 })
    }
  }

  #render(table: MockTable): Response {
    const urlId = this.#createUrlId(table, table.page)
    const rows = table.submittedOrders
      .flat()
      .map((line) => {
        const item = this.menu.get(line.id)
        const price = (item?.price ?? 0) * line.count
        return `<tr><td>${escapeHtml(item?.name ?? line.id)}</td><td>${line.count}</td><td>${price}</td></tr>`
      })
      .join('')
    const itemCount = table.submittedOrders.flat().reduce((sum, line) => sum + line.count, 0)
    const total = table.submittedOrders
      .flat()
      .reduce((sum, line) => sum + (this.menu.get(line.id)?.price ?? 0) * line.count, 0)

    const body = (() => {
      switch (table.page) {
        case 'number':
          return `<div class="number"><input id="number" name="number" value="${table.peopleCount}"></div>`
        case 'menu':
          return `<div class="menu"><input id="session-id" value="${table.sessionId}"></div>`
        case 'main':
          return `<div id="body-section"><div class="list"><table><tbody>${table.cart
            .map(
              (line) => `<tr><td>${escapeHtml(line.id)}</td><td>${line.count}</td><td>0</td></tr>`,
            )
            .join(
              '',
            )}</tbody></table></div><div class="amount"><p class="count"><span>${table.cart.reduce((sum, line) => sum + line.count, 0)}</span></p><p class="amount"><span>0</span></p></div></div>`
        case 'history':
        case 'account':
          return `<div id="body-section"><div class="list-base"><table><tbody>${rows}</tbody></table></div><div class="amount"><p class="count"><span>${itemCount}</span></p><p class="amount"><span>${total}</span></p></div><p>[control_no] => C${table.tableId}</p></div>`
        case 'receipt':
          return `<div class="receipt-page"><p class="table">${table.tableId}</p><div class="barcode"><img src="data:image/png;base64,AAAA"><p>${receiptCode(table)}</p></div></div>`
        case 'call':
          return `<div class="call"><ul data-shop="${table.shopId}" data-tbl="${table.tableId}"></ul></div>`
        case 'entry':
        case 'top':
          return `<div id="number" class="btn text">${table.peopleCount}名</div>`
        default:
          return ''
      }
    })()

    const html = `<!doctype html><html><body><form id="frm_ctrl" class="${table.page}-page" method="post" action="./?${urlId}">
      <input id="shop-id" value="${table.shopId}">
      <input id="table-no" value="${table.tableId}">
      <input id="session-id" value="${table.sessionId}">
      <input name="token" value="${table.token}">
      ${body}
    </form></body></html>`

    return new Response(html, {
      headers: {
        'content-type': 'text/html; charset=UTF-8',
        'set-cookie': 'session=cookie; Path=/',
      },
    })
  }
}

export const mockMenu: SaizeriyaMenuEntry[] = [
  {
    code: '1202',
    name: '小ｴﾋﾞのｻﾗﾀﾞ',
    kana: 'こえびのさらだ',
    price: 350,
    category: 'サラダ',
    tags: [],
  },
  {
    code: '3201',
    name: 'ﾃｨﾗﾐｽｸﾗｼｺ',
    kana: 'てぃらみすくらしこ',
    price: 300,
    category: 'デザート',
    tags: [],
  },
  { code: '3215', name: 'ｺｰﾋｰｾﾞﾘｰ&ﾐﾙｸｼﾞｪﾗｰﾄ', price: 250, category: 'デザート', tags: [] },
]
