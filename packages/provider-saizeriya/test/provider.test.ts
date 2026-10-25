import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import {
  ConflictError,
  createClient,
  createProviderRuntime,
  exportSession,
  NotFoundError,
} from '@unorder/core'
import { createSaizeriya } from '../src/index'
import type { SaizeriyaMenuEntry, SaizeriyaProviderConfig } from '../src/types'
import { mockMenu, MockSaizeriyaServer } from './mock-server'

const createRuntime = (
  server: MockSaizeriyaServer,
  config: SaizeriyaProviderConfig = { menuItems: mockMenu },
) => createProviderRuntime(createSaizeriya(), { fetch: server.fetch, config })

const openSession = async (
  server: MockSaizeriyaServer,
  peopleCount = 2,
  config?: SaizeriyaProviderConfig,
) => {
  const table = server.createTable()
  const runtime = createRuntime(server, config)
  const session = await runtime.call('session.open', {
    qrUrl: server.qrUrl(table),
    peopleCount,
  })
  return { table, runtime, session }
}

describe('saizeriya provider', () => {
  it('opens a session from a QR URL and exposes the normalized session', async () => {
    const server = new MockSaizeriyaServer(mockMenu)
    const { runtime, session } = await openSession(server, 4)
    expect(session).toMatchObject({
      provider: 'saizeriya',
      shop: { id: '525' },
      table: { id: '51' },
      peopleCount: 4,
      page: 'menu',
    })
    await expect(runtime.call('staff.call', { after: false })).resolves.toEqual({
      ok: true,
      target: 'staff',
    })
  })

  it('starts on entry until a party size is registered', async () => {
    const server = new MockSaizeriyaServer(mockMenu)
    const table = server.createTable()
    const runtime = createRuntime(server)
    const session = await runtime.call('session.open', { qrUrl: server.qrUrl(table) })
    expect(session.page).toBe('entry')
    expect(session.peopleCount).toBe(0)

    const updated = await runtime.call('session.update', { peopleCount: 5 })
    expect(updated.page).toBe('menu')
    expect(updated.peopleCount).toBe(5)
    expect(table.peopleCountRegistered).toBe(true)
  })

  it('adds and removes cart lines with normalized totals', async () => {
    const server = new MockSaizeriyaServer(mockMenu)
    const { runtime } = await openSession(server, 3)

    await Promise.all([
      runtime.call('cart.add', { itemId: '1202', quantity: 2 }),
      runtime.call('cart.add', { itemId: '3201' }),
    ])

    const cart = await runtime.call('cart.list', {})
    expect(cart.itemCount).toBe(3)
    expect(cart.subtotal).toEqual({ amount: 1000, currency: 'JPY' })
    expect(cart.lines).toMatchObject([
      { itemId: '1202', quantity: 2, name: '小ｴﾋﾞのｻﾗﾀﾞ' },
      { itemId: '3201', quantity: 1, name: 'ﾃｨﾗﾐｽｸﾗｼｺ' },
    ])

    const lineId = cart.lines[0]?.id
    expect(lineId).toBeDefined()
    const removed = await runtime.call('cart.remove', {
      lineId: lineId as string,
    })
    expect(removed.lines).toMatchObject([{ itemId: '3201' }])
  })

  it('validates, reorders, and looks up live item availability', async () => {
    const server = new MockSaizeriyaServer(mockMenu)
    const { runtime } = await openSession(server, 2)
    await runtime.call('cart.add', { itemId: '1202' })

    const validation = await runtime.call('order.validate', {})
    expect(validation).toMatchObject({
      ok: true,
      issues: [],
      checks: { orderingStarted: true, lastOrderClosed: false, midnightCharge: false },
    })
    await expect(runtime.call('cart.validate', {})).resolves.toMatchObject({ ok: true })

    const reordered = await runtime.call('order.reorder', { itemId: '3201' })
    expect(reordered.lines).toMatchObject([{ itemId: '1202' }, { itemId: '3201', quantity: 1 }])

    const live = await runtime.call('menu.get', { id: '1202', live: true })
    expect(live).toMatchObject({ id: '1202', name: '小ｴﾋﾞのｻﾗﾀﾞ', availability: 'available' })
    await expect(runtime.call('menu.get', { id: '9999', live: true })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('submits an order, lists history, and reads the bill and receipt', async () => {
    const server = new MockSaizeriyaServer(mockMenu)
    const { runtime } = await openSession(server, 2)
    await runtime.call('cart.add', { itemId: '1202', quantity: 2 })
    await runtime.call('cart.add', { itemId: '3201' })

    const order = await runtime.call('order.send', {})
    expect(order.status).toBe('submitted')
    expect(order.itemCount).toBe(3)
    expect(order.total).toEqual({ amount: 1000, currency: 'JPY' })

    const history = await runtime.call('order.list', {})
    expect(history.orders).toHaveLength(1)

    const bill = await runtime.call('bill.get', {})
    expect(bill.itemCount).toBe(3)
    expect(bill.total).toEqual({ amount: 1000, currency: 'JPY' })
    expect(bill.lines[0]).toMatchObject({ name: '小ｴﾋﾞのｻﾗﾀﾞ', quantity: 2, total: { amount: 700 } })

    const receipt = await runtime.call('receipt.get', {})
    expect(receipt.barcodeValue).toMatch(/^\d{12}$/)
    expect(receipt.barcodeImageUrl).toMatch(/^data:image\/png;base64,/)
  })

  it('persists and restores session state across runtimes', async () => {
    const server = new MockSaizeriyaServer(mockMenu)
    const { runtime } = await openSession(server, 2)
    await runtime.call('cart.add', { itemId: '1202', quantity: 2 })
    const exported = exportSession(createSaizeriya(), runtime.getState())

    const created = createSaizeriya()
    const restored = createProviderRuntime(created, {
      fetch: server.fetch,
      config: { menuItems: mockMenu },
      session: exported,
    })
    await expect(restored.call('cart.list', {})).resolves.toMatchObject({ itemCount: 2 })
    await restored.call('cart.add', { itemId: '3201' })
    expect(exportSession(created, restored.getState()).state).toMatchObject({
      shopId: 525,
      tableNo: 51,
      peopleCount: 2,
    })
  })

  it('lists the static menu without a session', async () => {
    const server = new MockSaizeriyaServer(mockMenu)
    const runtime = createRuntime(server)

    const all = await runtime.call('menu.list', {})
    expect(all.total).toBe(3)
    expect(all.source).toEqual({ kind: 'injected', label: 'provider config' })

    const desserts = await runtime.call('menu.list', { category: 'デザート' })
    expect(desserts.total).toBe(2)

    const queried = await runtime.call('menu.list', { query: 'てぃらみす' })
    expect(queried.items[0]?.id).toBe('3201')

    const paged = await runtime.call('menu.list', { limit: 2, offset: 2 })
    expect(paged.items).toHaveLength(1)
    expect(paged.hasMore).toBe(false)

    await expect(runtime.call('menu.get', { id: '1202' })).resolves.toMatchObject({
      name: '小ｴﾋﾞのｻﾗﾀﾞ',
      price: { amount: 350 },
    })
    await expect(runtime.call('menu.get', { id: '9999' })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('loads a menu snapshot from a local file and a URL', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'unorder-menu-'))
    const file = join(directory, 'menu.json')
    await writeFile(file, JSON.stringify(mockMenu))

    const server = new MockSaizeriyaServer(mockMenu)
    const fileRuntime = createProviderRuntime(createSaizeriya(), {
      fetch: server.fetch,
      config: { menuFile: file },
    })
    const fileMenu = await fileRuntime.call('menu.list', {})
    expect(fileMenu.total).toBe(3)
    expect(fileMenu.source).toMatchObject({ kind: 'static', file })

    const remoteRuntime = createProviderRuntime(createSaizeriya(), {
      fetch: async () => new Response(JSON.stringify(mockMenu)),
      config: { menuUrl: 'https://example.com/menu.json' },
    })
    const remoteMenu = await remoteRuntime.call('menu.list', {})
    expect(remoteMenu.total).toBe(3)
    expect(remoteMenu.source).toMatchObject({
      kind: 'static',
      url: 'https://example.com/menu.json',
    })
  })

  it('reports unavailable items without mutating the cart', async () => {
    const soldOut = {
      code: '9999',
      name: 'Sold out',
      price: 100,
      category: 'テスト',
      tags: [],
      state: 0,
    } as SaizeriyaMenuEntry & { state: number }
    const server = new MockSaizeriyaServer([...mockMenu, soldOut])
    const { runtime } = await openSession(server, 2, {
      menuItems: [...mockMenu, soldOut],
    })
    await expect(runtime.call('cart.add', { itemId: '9999' })).rejects.toBeInstanceOf(ConflictError)
    await expect(runtime.call('menu.get', { id: '9999' })).resolves.toMatchObject({
      name: 'Sold out',
    })
    await expect(runtime.call('cart.list', {})).resolves.toMatchObject({ itemCount: 0 })
  })

  it('exposes a call-only provider object with a typed proxy client', async () => {
    const server = new MockSaizeriyaServer(mockMenu)
    const provider = createSaizeriya({ menuItems: mockMenu }, { fetch: server.fetch })
    expect(Object.keys(provider)).toEqual(['call'])
    expect('state' in provider).toBe(false)
    expect('methods' in provider).toBe(false)

    const table = server.createTable()
    const client = createClient(provider)
    await client.session.open({ qrUrl: server.qrUrl(table), peopleCount: 2 })
    await client.cart.add({ itemId: '1202', quantity: 2 })
    const cart = await client.cart.list({})
    expect(cart.itemCount).toBe(2)
  })

  it('rejects invalid input and reports unsupported methods', async () => {
    const server = new MockSaizeriyaServer(mockMenu)
    const { runtime } = await openSession(server)
    await expect(runtime.call('cart.add', { itemId: '12' })).rejects.toThrow()
    const before = exportSession(createSaizeriya(), runtime.getState())
    const closed = createProviderRuntime(createSaizeriya(), { fetch: server.fetch })
    closed.importSession({ ...before, state: null })
    await expect(closed.call('order.send', {})).rejects.toThrow(/session/)
  })
})
