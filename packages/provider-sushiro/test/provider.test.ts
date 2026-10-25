import { describe, expect, it } from 'vite-plus/test'
import { InvalidInputError, NotFoundError } from '@unorder/core'
import { createSushiro, sushiro } from '../src/provider'
import { MockSushiroApi, rawStore } from './mock-api'

const GUID = '11111111-2222-4333-8444-555555555555'

const createRuntime = (api: MockSushiroApi, config = {}) =>
  sushiro.createRuntime({
    fetch: api.fetch,
    config: { guid: GUID, ...config },
  })

describe('sushiro provider', () => {
  it('opens a local store session from a Sushiro deep link', async () => {
    const api = new MockSushiroApi()
    const runtime = createRuntime(api)
    const session = await runtime.call('session.open', {
      qrUrl: 'sushiroapp://store/874',
      peopleCount: 3,
    })
    expect(session).toMatchObject({
      provider: 'sushiro',
      shop: { id: '874', name: 'ヤエチカ店', brand: 'sushiro' },
      peopleCount: 3,
      page: 'store',
      extensions: { guid: GUID, region: 'ja', tableType: 'T' },
    })
    expect(runtime.getState()).toMatchObject({ storeId: '874', guid: GUID, peopleCount: 3 })
    expect(api.requestsTo('/api/2.0/info/store')[0]?.url).toContain('storeid=874')
  })

  it('rejects links without a store id and unknown stores', async () => {
    const api = new MockSushiroApi()
    const runtime = createRuntime(api)
    await expect(
      runtime.call('session.open', { qrUrl: 'sushiroapp://campaign/1' }),
    ).rejects.toBeInstanceOf(InvalidInputError)
    await expect(
      runtime.call('session.open', { qrUrl: 'sushiroapp://store/999' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('parses the dynamic menu and normalizes items', async () => {
    const api = new MockSushiroApi()
    const runtime = createRuntime(api, { storeId: '874' })

    const menu = await runtime.call('menu.list', {})
    expect(menu.total).toBe(4)
    expect(menu.source).toEqual({ kind: 'dynamic', providerId: 'sushiro' })
    expect(menu.items[0]).toMatchObject({
      id: '5271',
      name: '本鮪中とろ',
      category: 'フェア商品',
      price: { amount: 110, currency: 'JPY' },
      availability: 'available',
      imageUrl: 'https://example.test/1.png',
    })
    expect(menu.items[1]?.name).toBe('プリン&アラモード')
    expect(menu.items.find((item) => item.id === '9999')?.availability).toBe('sold_out')

    const nigiri = await runtime.call('menu.list', { category: 'にぎり' })
    expect(nigiri.total).toBe(2)
    expect(nigiri.items.map((item) => item.id)).toEqual(['343', '9999'])

    const available = await runtime.call('menu.list', { availability: 'available', limit: 2 })
    expect(available.items).toHaveLength(2)
    expect(available.hasMore).toBe(true)

    await expect(runtime.call('menu.get', { id: '343' })).resolves.toMatchObject({
      name: 'サーモン',
      price: { amount: 120 },
    })
    await expect(runtime.call('menu.get', { id: 'nope' })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('requires a store for menu methods', async () => {
    const api = new MockSushiroApi()
    const runtime = createRuntime(api)
    await expect(runtime.call('menu.list', {})).rejects.toBeInstanceOf(InvalidInputError)
  })

  it('searches stores by location, ids, and the full list', async () => {
    const api = new MockSushiroApi()
    const runtime = createRuntime(api)

    const nearby = await runtime.call('x-sushiro.shop.list', {
      latitude: 35.68,
      longitude: 139.76,
      numResults: 2,
      query: '有楽町',
    })
    expect(nearby.total).toBe(1)
    expect(nearby.items[0]).toMatchObject({
      id: '858',
      name: '有楽町店',
      waitMinutes: 145,
      waitingGroups: 67,
      distanceKm: 0.8,
      brand: 'sushiro',
    })

    const byId = await runtime.call('x-sushiro.shop.list', { storeIds: ['874', '999'] })
    expect(byId.total).toBe(1)
    expect(byId.items[0]?.id).toBe('874')

    const all = await runtime.call('x-sushiro.shop.list', { limit: 1 })
    expect(all.total).toBe(2)
    expect(all.items).toHaveLength(1)
    const listRequest = api.requestsTo('/api/2.0/info/storelist').at(-1)
    expect(listRequest?.url).toContain(`guid=${GUID}`)
  })

  it('reads store queues and waiting configuration', async () => {
    const api = new MockSushiroApi()
    const runtime = createRuntime(api)

    const store = await runtime.call('x-sushiro.shop.get', { storeId: '874' })
    expect(store).toMatchObject({ id: '874', status: 'OPEN', requiresTicketLogin: true })

    const queue = await runtime.call('x-sushiro.shop.queue', { storeId: '874' })
    expect(queue).toMatchObject({
      storeId: '874',
      storeQueue: ['544', '547'],
      mixedQueue: ['544', '547'],
      separateQueue: 0,
    })

    const waiting = await runtime.call('x-sushiro.shop.waiting', { storeIds: ['874', '858'] })
    expect(waiting.configs).toMatchObject([
      { storeId: '874', top: true, ticket: true },
      { storeId: '858', top: false, ticketing: true },
    ])
  })

  it('reads ticket status, slots, and check-in counts', async () => {
    const api = new MockSushiroApi()
    const runtime = createRuntime(api, { storeId: '874' })

    const status = await runtime.call('x-sushiro.ticket.status', {})
    expect(status.tickets).toMatchObject([
      { storeId: '874', number: '053', adults: 2, waitMinutes: 30, status: 'WAITING' },
    ])
    expect(status.localTickets).toEqual([])

    const slots = await runtime.call('x-sushiro.ticket.slots', {
      peopleCount: 2,
      date: '2026-10-25',
      availableOnly: true,
    })
    expect(slots).toMatchObject({ storeId: '874', peopleCount: 2, tableType: 'T', total: 1 })
    expect(slots.items[0]).toMatchObject({
      date: '20261025',
      start: '184500',
      availability: 'AVAILABLE',
      available: true,
    })
    expect(api.requestsTo('/api/2.0/info/reservationtimeslots')[0]?.url).toContain('numpersons=2')

    await expect(
      runtime.call('x-sushiro.ticket.check-in-count', {
        storeId: '874',
        ticketNumber: '544',
      }),
    ).resolves.toBe(3)
  })

  it('reads takeout wait times with the bearer token', async () => {
    const api = new MockSushiroApi()
    const runtime = createRuntime(api, {
      storeId: '874',
      takeoutToken: 'test-token',
    })

    const single = await runtime.call('x-sushiro.takeout.wait-time', {})
    expect(single.items).toEqual([{ storeId: '874', minutes: 15, raw: expect.anything() }])
    const singleRequest = api.requestsTo('/sushipass/api/estimatedReceivingTime')[0]
    expect(singleRequest?.headers.get('authorization')).toBe('Bearer test-token')

    const multiple = await runtime.call('x-sushiro.takeout.wait-time', {
      storeIds: ['874', '858'],
    })
    expect(multiple.items.map((item) => (item as { storeId: string }).storeId)).toEqual([
      '874',
      '858',
    ])
  })

  it('builds ticket side-effect requests without contacting a real store', async () => {
    const api = new MockSushiroApi()
    const runtime = createRuntime(api, { storeId: '874', peopleCount: 2 })

    const issued = await runtime.call('x-sushiro.ticket.issue', {})
    expect(issued).toMatchObject({ ok: true, status: 'SUCCESS', ticket: { number: '054' } })
    const issueRequest = api.requestsTo('/api/2.0/remote/newticket')[0]
    expect(issueRequest?.method).toBe('POST')
    expect(issueRequest?.body).toContain('storeid=874')
    expect(issueRequest?.body).toContain('adult=2')
    expect(issueRequest?.body).toContain('child=0')
    expect(issueRequest?.body).toContain('tabletype=T')
    expect(issueRequest?.body).toContain(`guid=${GUID}`)

    const cancelled = await runtime.call('x-sushiro.ticket.cancel', {})
    expect(cancelled).toMatchObject({ ok: true, status: 'SUCCESS' })
    expect(api.requestsTo('/api/2.0/remote/cancel')[0]?.body).toBe(`guid=${GUID}&region=ja`)

    const entered = await runtime.call('x-sushiro.ticket.enter', { ticketNumber: '053' })
    expect(entered).toMatchObject({ ok: true, status: 'SUCCESS' })
    const enterRequest = api.requestsTo('/api/2.0/remote/watchticket')[0]
    expect(enterRequest?.method).toBe('PUT')
    expect(enterRequest?.body).toContain('ticketnum=053')
  })

  it('exports and restores state, including a local table label', async () => {
    const api = new MockSushiroApi()
    const runtime = createRuntime(api)
    await runtime.call('session.open', { qrUrl: 'sushiroapp://store/874', peopleCount: 2 })
    const withTable = await runtime.call('x-sushiro.table.set', { tableId: 'A-12' })
    expect(withTable.table).toEqual({ id: 'A-12' })

    const exported = runtime.exportSession()
    const restored = sushiro.createRuntime({ fetch: api.fetch, session: exported })
    expect(restored.getState()).toMatchObject({
      storeId: '874',
      tableId: 'A-12',
      guid: GUID,
    })
    await expect(restored.call('session.export', {})).resolves.toMatchObject({
      provider: 'sushiro',
      state: { tableId: 'A-12' },
    })
  })

  it('creates a call-only instance', async () => {
    const api = new MockSushiroApi()
    const client = createSushiro({ guid: GUID, storeId: '874' }, { fetch: api.fetch })
    const shops = await client.call('x-sushiro.shop.list', { storeIds: ['874'] })
    expect(shops.total).toBe(1)
    expect('createRuntime' in client).toBe(false)
  })

  it('reads the public app configuration', async () => {
    const api = new MockSushiroApi()
    const runtime = createRuntime(api)
    await expect(runtime.call('x-sushiro.app.config', {})).resolves.toMatchObject({
      android_mobile_app_version_force: '60600',
    })
  })

  it('reports the confirmed store shape for normalization', () => {
    expect(rawStore.id).toBe(874)
    expect(rawStore.name).toBe('ヤエチカ店')
  })
})
