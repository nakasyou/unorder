import { describe, expect, it, vi } from 'vitest'
import { createSushiro, parseSushiroMenu, parseSushiroSessionURL } from '../src/index'

const TOKEN = '00000000-1111-2222-3333-444444444444'
const session = {
  session: { token: TOKEN, enable_order: true, is_checked_out: false },
  shop: { id: 841, name: 'Mock Shop' },
  table: { id: 44 },
}
const menu = {
  categories: [{ name: { ja: '寿司' }, sub_categories: [{
    name: { ja: 'にぎり' },
    items: [
      { id: 128, name: { ja: 'サーモン' }, price: 210, options: { '1': '1' },
        stock_status: 0, is_shop_stopped: false, is_table_stopped: false },
      { id: 184, name: { ja: '売切' }, price: 500, options: {},
        stock_status: 1 },
    ],
  }] }],
  option_groups: { '1': { options: {
    '1': { code: 1, name: { ja: '普通' }, amount: 0 },
    '2': { code: 2, name: { ja: 'ミニしゃり' }, amount: 0 },
  } } },
}
const mockFetch = () => {
  const sent: { url: string; init: RequestInit }[] = []
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url)
    sent.push({ url: path, init: init ?? {} })
    const response = path.endsWith('/v1/session') ? session
      : path.endsWith('/v1/menu') ? menu : { id: 99 }
    return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, sent }
}
describe('Sushiro HAR-backed provider', () => {
  it('rejects foreign hosts, QR q-only URLs, and ambiguous tokens', () => {
    expect(() => parseSushiroSessionURL('https://evil.example/?token=' + TOKEN)).toThrow()
    expect(() => parseSushiroSessionURL('https://mo.sushiro.jp/?q=qr-value')).toThrow()
    expect(() => parseSushiroSessionURL('https://mo.sushiro.jp/?token=x&token=y')).toThrow()
  })
  it('normalizes categories, prices, options and stock flags', () => {
    const items = parseSushiroMenu(menu)
    expect(items).toHaveLength(2)
    expect(items[0]?.price.amount).toBe(210)
    expect(items[0]?.options?.map((o) => o.id)).toEqual(['1:1', '1:2'])
    expect(items[1]?.availability).toBe('sold_out')
  })
  it('opens a session, filters the menu, and sends the observed order payload once', async () => {
    const { fetch, sent } = mockFetch()
    const p = createSushiro({ fetch })
    await p.call('session.open', { qrUrl: 'https://mo.sushiro.jp/?token=' + TOKEN })
    const listing = await p.call('menu.list', { query: 'サーモン' })
    expect(listing.items).toHaveLength(1)
    await p.call('cart.add', { itemId: '128', quantity: 1, optionId: '1:2' })
    const cart = await p.call('cart.list', {})
    expect(cart.subtotal.amount).toBe(210)
    const order = await p.call('order.send', {})
    expect(order.status).toBe('submitted')
    const orderCalls = sent.filter((r) => r.url.endsWith('/v1/mobile/order'))
    expect(orderCalls).toHaveLength(1)
    expect(JSON.parse(String(orderCalls[0]?.init.body))).toEqual({
      order_items: [{ plu_id: 128, current_price: 210, qty: 1,
        additional_info: [{ additional_info_index: 2, additional_info_id: 1 }],
        item_discounts: { item_discounts_id: 0 } }],
    })
    expect(sent.every((r) => r.init.headers && !JSON.stringify(r.init.headers).includes('Bearer '))).toBe(true)
  })
  it('retains an unknown order and blocks resubmission after a network error', async () => {
    const { fetch } = mockFetch()
    const failing: typeof globalThis.fetch = async (url, init) => {
      if (String(url).endsWith('/v1/mobile/order')) throw new Error('network lost')
      return fetch(url, init)
    }
    const p = createSushiro({ fetch: failing })
    await p.call('session.open', { qrUrl: 'https://mo.sushiro.jp/?token=' + TOKEN })
    await p.call('cart.add', { itemId: '128' })
    await expect(p.call('order.send', {})).rejects.toThrow()
    expect((await p.call('order.list', {})).orders[0]?.status).toBe('unknown')
    await expect(p.call('order.send', {})).rejects.toThrow()
  })
})
