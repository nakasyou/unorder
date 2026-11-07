import { describe, expect, it } from 'vite-plus/test'
import { createProviderRuntime, describeProvider, exportSession } from '@unorder/core'
import {
  createKurasushi,
  parseKurasushiMenu,
  processKurasushiQR,
  validateKurasushiState,
} from '../src'
import { MockKurasushiServer, menu } from './mock-server'

const now = () => new Date('2026-11-07T10:30:00Z')
const qrUrl = 'https://kurasushi-so.epark.jp/?id=test-qr'
const setup = async () => {
  const server = new MockKurasushiServer()
  const provider = createKurasushi({ fetch: server.fetch, now })
  await provider.call('session.open', { qrUrl })
  return { server, provider }
}

describe('Kurasushi provider', () => {
  it('accepts only the QR origin and opaque id, without leaking bad inputs', () => {
    expect(processKurasushiQR('https://kurasushi-so.epark.jp/?id=abc%2Bdef')).toBe('abc+def')
    for (const url of [
      'https://example.com/?id=secret',
      'http://kurasushi-so.epark.jp/?id=secret',
      'https://kurasushi-so.epark.jp/',
      'https://kurasushi-so.epark.jp/?id=a&id=b',
    ]) {
      expect(() => processKurasushiQR(url)).toThrow()
    }
  })
  it('deduplicates the all category and validates malformed menu responses', () => {
    expect(parseKurasushiMenu(menu)).toMatchObject([
      { id: '33800075', category: 'サイドメニュー', price: { amount: 290 } },
    ])
    expect(() => parseKurasushiMenu({})).toThrow()
    expect(() =>
      parseKurasushiMenu([{ ...menu[0], itemList: [{ itemCode: 1, price: -1 }] }]),
    ).toThrow()
  })
  it('opens and restores a validated session, keeps credentials out of normal results', async () => {
    const { provider, server } = await setup()
    const state = exportSession(provider)
    expect(state).toMatchObject({
      provider: 'kurasushi',
      stateVersion: 1,
      state: { shopId: 1, seatNo: 2, token: 'test-token' },
    })
    const restored = createKurasushi({ session: state, fetch: server.fetch, now })
    expect(await restored.call('menu.list', { query: '茶碗', limit: 1 })).toMatchObject({
      total: 1,
      source: { kind: 'dynamic' },
    })
    expect(await restored.call('menu.list', { category: '不存在' })).toMatchObject({ total: 0 })
    expect(() =>
      validateKurasushiState({ ...(state.state as object), seatNo: '../other' }),
    ).toThrow()
    expect(await restored.call('session.close', {})).toEqual({ closed: true })
    await expect(restored.call('menu.list', {})).rejects.toMatchObject({ code: 'auth_required' })
  })
  it('requires a session for dynamic menus and advertises only supported methods', async () => {
    const provider = createKurasushi()
    await expect(provider.call('menu.list', {})).rejects.toMatchObject({ code: 'auth_required' })
    const methods = describeProvider(provider).methods
    expect(methods.map((method) => method.name)).not.toContain('bill.get')
  })
  it('only stages cart additions locally, uses defaults and explicit toppings', async () => {
    const { provider, server } = await setup()
    const result = await provider.call('menu.get', { id: '33800075' })
    expect(result.options?.map((option) => option.id)).toEqual(['1', '2'])
    await provider.call('cart.add', { itemId: '33800075', quantity: 2, optionId: '2' })
    expect(server.requests.some((request) => request.path.includes('/add/'))).toBe(false)
    expect(await provider.call('cart.list', {})).toMatchObject({
      itemCount: 2,
      subtotal: { amount: 580 },
      lines: [{ toppings: [2] }],
    })
    await expect(
      provider.call('cart.add', { itemId: '33800075', quantity: 5 }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      provider.call('cart.add', { itemId: '33800075', optionId: '999' }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(provider.call('cart.add', { itemId: 'missing' })).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(await provider.call('cart.remove', { index: 0 })).toMatchObject({ itemCount: 0 })
  })
  it('sends exact per-item bodies and records the confirmed orders', async () => {
    const { provider, server } = await setup()
    await provider.call('cart.add', { itemId: '33800075', quantity: 2 })
    await provider.call('cart.add', { itemId: '33800075' })
    const order = await provider.call('order.send', {})
    expect(order).toMatchObject({ status: 'submitted', itemCount: 3, total: { amount: 870 } })
    expect(
      server.requests
        .filter((request) => request.path.includes('/add/'))
        .map((request) => request.body),
    ).toEqual(
      [2, 1].map((quantity) => ({
        itemCode: '33800075',
        toppings: [1],
        quantity,
        influxType: 0,
        influxSource: 7,
        orderedAt: '2026-11-07 19:30:00',
        requestedAt: '2026-11-07 19:30:00',
        reserve: [],
      })),
    )
    expect(await provider.call('cart.list', {})).toMatchObject({ itemCount: 0 })
    expect((await provider.call('order.list', {})).orders).toHaveLength(2)
  })
  it.each([2, 3, 4])(
    'preserves remaining cart and partial successes for rejection %s',
    async (result) => {
      const { provider, server } = await setup()
      server.results = [1, result]
      for (let i = 0; i < 3; i++) await provider.call('cart.add', { itemId: '33800075' })
      await expect(provider.call('order.send', {})).rejects.toMatchObject({
        code: 'provider_error',
        details: { result },
      })
      expect(await provider.call('cart.list', {})).toMatchObject({ itemCount: 2 })
      expect((await provider.call('order.list', {})).orders).toMatchObject([
        { status: 'submitted' },
      ])
      expect(server.requests.filter((request) => request.path.includes('/add/'))).toHaveLength(2)
    },
  )
  it.each(['network', 'malformed', 'http500', 99] as const)(
    'records uncertainty and blocks duplicate sends after %s',
    async (failure) => {
      const { provider, server } = await setup()
      server.results = [failure]
      await provider.call('cart.add', { itemId: '33800075' })
      await expect(provider.call('order.send', {})).rejects.toThrow()
      expect((await provider.call('order.list', {})).orders).toMatchObject([{ status: 'unknown' }])
      await provider.call('cart.add', { itemId: '33800075' })
      const restored = createKurasushi({
        session: exportSession(provider),
        fetch: server.fetch,
        now,
      })
      await expect(restored.call('order.send', {})).rejects.toMatchObject({ code: 'conflict' })
      expect(server.requests.filter((request) => request.path.includes('/add/'))).toHaveLength(1)
    },
  )
  it('serializes simultaneous sends without duplicate orders', async () => {
    const { provider, server } = await setup()
    await provider.call('cart.add', { itemId: '33800075' })
    const results = await Promise.allSettled([
      provider.call('order.send', {}),
      provider.call('order.send', {}),
    ])
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(server.requests.filter((request) => request.path.includes('/add/'))).toHaveLength(1)
  })
  it('rejects changed or restricted seats before ordering', async () => {
    const { provider, server } = await setup()
    await provider.call('cart.add', { itemId: '33800075' })
    server.restriction = 3
    await expect(provider.call('order.send', {})).rejects.toMatchObject({ code: 'conflict' })
    server.restriction = 1
    server.seatNo = 9
    await expect(provider.call('order.send', {})).rejects.toMatchObject({ code: 'conflict' })
    expect(server.requests.some((request) => request.path.includes('/add/'))).toBe(false)
  })
  it('reads whole-table history without initiating payment', async () => {
    const { provider, server } = await setup()
    const runtime = createProviderRuntime(provider)
    expect(await runtime.invoke('history.get')).toMatchObject({
      list: [{ id: 'example-history' }],
    })
    expect(server.requests.every((request) => !request.path.includes('/pay/'))).toBe(true)
  })
})
