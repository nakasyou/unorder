import { describe, expect, it } from 'vite-plus/test'
import {
  createProviderRuntime,
  exportSession,
  InvalidInputError,
  NotFoundError,
  UnsupportedError,
} from '@unorder/core'
import { createSushiro, sushiro } from '../src/provider'
import { MockSushiroApi, rawStore } from './mock-api'

const GUID = '11111111-2222-4333-8444-555555555555'

const createRuntime = (api: MockSushiroApi, config = {}) =>
  createProviderRuntime(sushiro, {
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
      raw: { region: 'ja', tableType: 'T' },
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

  it('searches shops by location, ids, and the full list', async () => {
    const api = new MockSushiroApi()
    const runtime = createRuntime(api)

    const nearby = await runtime.call('shop.list', {
      near: { latitude: 35.68, longitude: 139.76 },
      limit: 2,
      query: '有楽町',
    })
    expect(nearby.total).toBe(1)
    expect(nearby.items[0]).toMatchObject({
      id: '858',
      name: '有楽町店',
      brand: 'sushiro',
      status: 'open',
      statusRaw: 'OPEN',
      distanceMeters: 800,
      location: { latitude: 35.675413, longitude: 139.76285 },
    })
    expect(nearby.items[0]?.waitEstimates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ service: 'dine_in', minutes: 145, parties: 67 }),
        expect.objectContaining({ service: 'takeout', minutes: 15 }),
      ]),
    )

    const byId = await runtime.call('shop.list', { ids: ['874', '999'] })
    expect(byId.total).toBe(1)
    expect(byId.items[0]?.id).toBe('874')

    const all = await runtime.call('shop.list', { limit: 1 })
    expect(all.total).toBe(2)
    expect(all.items).toHaveLength(1)
    const listRequest = api.requestsTo('/api/2.0/info/storelist').at(-1)
    expect(listRequest?.url).toContain(`guid=${GUID}`)

    const radius = await runtime.call('shop.list', {
      near: { latitude: 35.68, longitude: 139.76, radiusMeters: 500 },
      limit: 10,
    })
    expect(radius.total).toBe(1)
    expect(radius.items.map((shop) => shop.id)).toEqual(['874'])
  })

  it('reads shops, queue lanes, and wait estimates', async () => {
    const api = new MockSushiroApi()
    const runtime = createRuntime(api)

    const store = await runtime.call('shop.get', { shopId: '874' })
    expect(store).toMatchObject({
      id: '874',
      status: 'open',
      statusRaw: 'OPEN',
      services: expect.arrayContaining(['dine_in', 'queue', 'reservation', 'takeout']),
    })
    expect(store.waitEstimates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ service: 'dine_in', minutes: 120, parties: 79 }),
        expect.objectContaining({ service: 'takeout', minutes: 15 }),
      ]),
    )
    const takeoutRequest = api.requestsTo('/sushipass/api/estimatedReceivingTime')[0]
    expect(takeoutRequest?.headers.get('authorization')).toBeTruthy()

    const queue = await runtime.call('queue.get', { shopId: '874' })
    expect(queue).toMatchObject({
      shopId: '874',
      lanes: expect.arrayContaining([
        expect.objectContaining({
          id: 'table',
          numbers: ['544', '547'],
          waiting: 2,
        }),
        expect.objectContaining({ id: 'booth', numbers: ['544'] }),
        expect.objectContaining({ id: 'reservation', numbers: ['7300'] }),
      ]),
    })
  })

  it('reads waitlist tickets, reservations, and slots', async () => {
    const api = new MockSushiroApi()
    const runtime = createRuntime(api, { storeId: '874' })

    const status = await runtime.call('waitlist.status', {})
    expect(status.tickets).toMatchObject([
      {
        id: '418677667',
        shopId: '874',
        number: '053',
        partySize: 2,
        estimatedWaitMinutes: 30,
        status: 'waiting',
        statusRaw: 'WAITING',
        lane: 'table',
      },
    ])
    expect(status.tickets).toHaveLength(1)
    expect(await runtime.call('waitlist.status', { ticketId: 'nope' })).toMatchObject({
      tickets: [],
    })

    const slots = await runtime.call('reservation.slots', {
      partySize: 2,
      date: '2026-10-25',
      availableOnly: true,
    })
    expect(slots).toMatchObject({ total: 1, offset: 0, limit: 200, hasMore: false })
    expect(slots.items[0]).toMatchObject({
      shopId: '874',
      start: '2026-10-25T18:45:00',
      end: '2026-10-25T19:00:00',
      status: 'AVAILABLE',
      available: true,
    })
    expect(api.requestsTo('/api/2.0/info/reservationtimeslots')[0]?.url).toContain('numpersons=2')

    const reservations = await runtime.call('reservation.list', {})
    expect(reservations.reservations).toEqual([])
  })

  it('creates and cancels real waitlist requests without contacting a real store', async () => {
    const api = new MockSushiroApi()
    const runtime = createRuntime(api, { storeId: '874', peopleCount: 2 })

    const issued = await runtime.call('waitlist.join', {})
    expect(issued).toMatchObject({
      shopId: '874',
      number: '054',
      status: 'waiting',
      partySize: 2,
      lane: 'table',
    })
    const issueRequest = api.requestsTo('/api/2.0/remote/newticket')[0]
    expect(issueRequest?.method).toBe('POST')
    expect(issueRequest?.body).toContain('storeid=874')
    expect(issueRequest?.body).toContain('adult=2')
    expect(issueRequest?.body).toContain('child=0')
    expect(issueRequest?.body).toContain('tabletype=T')
    expect(issueRequest?.body).toContain(`guid=${GUID}`)

    const registered = await runtime.call('waitlist.join', { number: '053' })
    expect(registered).toMatchObject({ shopId: '874', number: '053', status: 'waiting' })
    const enterRequest = api.requestsTo('/api/2.0/remote/watchticket')[0]
    expect(enterRequest?.method).toBe('PUT')
    expect(enterRequest?.body).toContain('ticketnum=053')

    const cancelled = await runtime.call('waitlist.cancel', {})
    expect(cancelled).toMatchObject({ cancelled: true })
    expect(api.requestsTo('/api/2.0/remote/cancel')[0]?.body).toBe(`guid=${GUID}&region=ja`)
  })

  it('updates and restores session state, including a local table label', async () => {
    const api = new MockSushiroApi()
    const runtime = createRuntime(api)
    await runtime.call('session.open', { qrUrl: 'sushiroapp://store/874', peopleCount: 2 })
    const updated = await runtime.call('session.update', {
      peopleCount: 3,
      tableId: 'A-12',
    })
    expect(updated).toMatchObject({
      peopleCount: 3,
      table: { id: 'A-12' },
    })

    const exported = exportSession(sushiro, runtime.getState())
    const restored = createProviderRuntime(sushiro, { fetch: api.fetch, session: exported })
    expect(restored.getState()).toMatchObject({
      storeId: '874',
      tableId: 'A-12',
      peopleCount: 3,
      guid: GUID,
    })
    await expect(restored.call('session.export', {})).resolves.toMatchObject({
      provider: 'sushiro',
      state: { tableId: 'A-12' },
    })
  })

  it('creates a call-only instance and exposes standard capabilities', async () => {
    const api = new MockSushiroApi()
    const client = createSushiro({ guid: GUID, storeId: '874' }, { fetch: api.fetch })
    const shops = await client.call('shop.list', { ids: ['874'] })
    expect(shops.total).toBe(1)
    expect('createRuntime' in client).toBe(false)
    await expect(
      (client.call as (name: string, input?: unknown) => Promise<unknown>)('cart.list', {}),
    ).rejects.toBeInstanceOf(UnsupportedError)
  })

  it('reports the confirmed store shape for normalization', () => {
    expect(rawStore.id).toBe(874)
    expect(rawStore.name).toBe('ヤエチカ店')
  })
})
