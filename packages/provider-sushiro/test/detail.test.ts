import { describe, expect, it, vi } from 'vitest'
import { createSushiro, parseSushiroOrderDetail } from '../src/index'

const TOKEN = '00000000-1111-2222-3333-444444444444'
const session = {
  session: {
    token: TOKEN, enable_order: true, is_checked_out: false,
    is_payment_confirmed: false, is_last_order_passed: false,
    enable_table_order: true, enable_device_order: true,
    device_number: 1, total_devices: 2, max_devices: 4,
  },
  shop: { id: 841, name: 'Mock Shop' },
  table: { id: 44 },
}
const detail = {
  table_id: 44,
  total_amount: 420,
  order_items: [
    { plu_id: 128, qty: 2, unit_price: 210, current_price: 210,
      served_flag: 1, item_discounts: { item_discounts_id: 0 } },
  ],
}

describe('read-only Sushiro table detail', () => {
  it('parses served flags, quantities and authoritative total', () => {
    const parsed = parseSushiroOrderDetail(detail)
    expect(parsed.itemCount).toBe(2)
    expect(parsed.lines[0]?.served).toBe(true)
    expect(parsed.total.amount).toBe(420)
  })
  it('rejects malformed upstream data', () => {
    expect(() => parseSushiroOrderDetail({ order_items: {}, table_id: 44, total_amount: 0 })).toThrow()
    expect(() => parseSushiroOrderDetail({ ...detail, order_items: [{ ...detail.order_items[0], served_flag: 4 }] })).toThrow()
  })
  it('reads session status and order history without an order POST', async () => {
    const requests: Array<{ url: string; method: string }> = []
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), method: init?.method ?? 'GET' })
      return new Response(JSON.stringify(String(url).endsWith('/v1/mobile/order/detail') ? detail : session), { status: 200 })
    }) as unknown as typeof globalThis.fetch
    const p = createSushiro({ fetch })
    await p.call('session.open', { qrUrl: 'https://mo.sushiro.jp/?token=' + TOKEN })
    const status = await p.call('session.status', {})
    expect(status.totalDevices).toBe(2)
    expect(status.canOrder).toBe(true)
    const history = await p.call('order.detail', {})
    expect(history.total.amount).toBe(420)
    expect(requests).toHaveLength(3)
    expect(requests.every((r) => r.method === 'GET')).toBe(true)
  })
  it('rejects detail for another table', async () => {
    const fetch = vi.fn(async (url: string | URL | Request) =>
      new Response(JSON.stringify(String(url).endsWith('/v1/mobile/order/detail') ? { ...detail, table_id: 999 } : session), { status: 200 }),
    ) as unknown as typeof globalThis.fetch
    const p = createSushiro({ fetch })
    await p.call('session.open', { qrUrl: 'https://mo.sushiro.jp/?token=' + TOKEN })
    await expect(p.call('order.detail', {})).rejects.toThrow('different table')
  })
})
