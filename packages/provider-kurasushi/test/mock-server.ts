import { expect } from 'vite-plus/test'

// Minimal menu fields observed in the HAR; credentials and table identifiers are synthetic.
export const item = {
  itemCode: 33800075,
  name: '特製茶碗蒸し',
  price: 290,
  itemImage: 'https://app-smart-order.epark.jp/assets/image/item/33800075.jpg',
  wideView: 0,
  unit: 2,
  isPriceChange: 0,
  calorie: null,
}
export const menu = [
  { categoryId: 22, name: 'すべて', itemList: [item] },
  { categoryId: 7, name: 'サイドメニュー', itemList: [item] },
]
export class MockKurasushiServer {
  readonly requests: { path: string; body: Record<string, unknown> | undefined }[] = []
  results: (number | 'network' | 'malformed' | 'http500')[] = []
  restriction = 1
  seatNo = 2
  toppings = [
    { toppingCode: 1, toppingGroup: 1, name: '通常', defaultSelect: 0 },
    { toppingCode: 2, toppingGroup: 1, name: '変更', defaultSelect: 1 },
  ]
  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input)
    expect(url.origin).toBe('https://api-app.smart-order.epark.jp')
    expect(new Headers(init?.headers).get('Language-Id')).toBe('ja')
    expect(init?.redirect).toBe('error')
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined
    this.requests.push({ path: url.pathname + url.search, body })
    const path = url.pathname.replace('/app_order/', '')
    if (path === 'auth/web/v1/') {
      expect(body?.qrCode).toBe('test-qr')
      expect(body?.requestedAt).toBe('2026-11-07 19:30:00')
      return Response.json({ accessToken: 'test-token' })
    }
    expect(new Headers(init?.headers).get('soAuthToken')).toBe('test-token')
    if (path === 'seat/status/v1/')
      return Response.json({
        shopId: 1,
        seatNo: this.seatNo,
        checkedInAt: '2026-11-07 19:00:00',
        orderRestriction: this.restriction,
      })
    if (path === 'shops/v1/1') return Response.json({ id: 1, name: 'テスト店' })
    if (path === 'menus/v1/1/2') return Response.json(menu)
    if (path === 'items/v1/1/2/33800075')
      return Response.json({ ...item, toppings: this.toppings, cautionaryNote: '熱いので注意' })
    if (path === 'add/v1/1/2') {
      const result = this.results.shift() ?? 1
      if (result === 'network') throw new TypeError('lost response')
      if (result === 'malformed') return new Response('invalid json')
      if (result === 'http500') return new Response('', { status: 500 })
      return Response.json({ result })
    }
    if (path === 'histories/v1/') {
      expect(url.searchParams.get('checkedInAt')).toBe('20261107190000')
      return Response.json({ list: [{ id: 'example-history', itemName: item.name, quantity: 1 }] })
    }
    throw new Error(`Unexpected mock endpoint ${path}`)
  }
}
