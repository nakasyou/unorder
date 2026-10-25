import { describe, expect, expectTypeOf, it } from 'vite-plus/test'
import { brand } from './brand'
import type { OrderId } from './brand'
import { createClient, proxyClient } from './client'
import { money } from './domain'
import type { Order } from './domain'
import { UnsupportedError } from './errors'
import type { MenuListResult } from './menu'
import type { SessionExport } from './session'
import { listMenuItems } from './menu'
import { createProviderInstance, defineMethod, defineProvider } from './provider'
import type { MethodMap } from './provider'
import { s } from './schema'
import { defineStandardMethod } from './standard'
import type { OrderSendInput } from './standard'

interface TestState {
  count: number
}

interface TestConfig {
  label: string
}

const methods = {
  'menu.list': defineStandardMethod<'menu.list', TestState, TestConfig>('menu.list', () =>
    listMenuItems([], {}, { kind: 'dynamic', providerId: 'test' }),
  ),
  'order.send': defineStandardMethod<'order.send', TestState, TestConfig>('order.send', (ctx) => {
    const state = ctx.requireState()
    return {
      id: brand<OrderId>('order-1'),
      status: 'submitted',
      lines: [],
      itemCount: state.count,
      total: money(0),
    } as Order
  }),
  'x-test.thing.set': defineMethod<TestState, TestConfig, { value: number }, { value: number }>({
    name: 'x-test.thing.set',
    summary: 'Set a test value.',
    description: 'Extension method used by the typed client tests.',
    input: s.object({ value: s.number() }),
    output: s.object({ value: s.number() }),
    session: 'none',
    annotations: { readOnlyHint: false },
    handler: (_ctx, input) => ({ value: input.value }),
  }),
} satisfies MethodMap<TestState, TestConfig>

const provider = defineProvider<'test', TestState, TestConfig, typeof methods>({
  id: 'test',
  displayName: 'Test',
  description: 'Typed client test provider.',
  stateVersion: 1,
  methods,
})

const makeClient = () => {
  const instance = createProviderInstance(provider)
  return { instance, client: createClient(instance) }
}

describe('createClient', () => {
  it('returns nested typed callable properties', async () => {
    const { client } = makeClient()

    expectTypeOf(client.menu.list).toBeFunction()
    expectTypeOf(client.menu.list({})).toEqualTypeOf<Promise<MenuListResult>>()
    expectTypeOf(client.order.send).parameter(0).toEqualTypeOf<OrderSendInput>()
    expectTypeOf(client.order.send).returns.toEqualTypeOf<Promise<Order>>()
    expectTypeOf(client['x-test'].thing.set).parameter(0).toEqualTypeOf<{ value: number }>()
    expectTypeOf(client['x-test'].thing.set).returns.toEqualTypeOf<Promise<{ value: number }>>()
    expectTypeOf(client.session.export).returns.toEqualTypeOf<Promise<SessionExport>>()

    await expect(client.menu.list({})).resolves.toMatchObject({ total: 0 })
    await expect(client['x-test'].thing.set({ value: 3 })).resolves.toEqual({ value: 3 })
  })

  it('rejects unsupported methods with UnsupportedError', async () => {
    const { client } = makeClient()
    const untyped = client as unknown as Record<string, Record<string, (input: unknown) => unknown>>
    await expect(untyped.xMissing?.method?.({})).rejects.toBeInstanceOf(UnsupportedError)
  })

  it('accepts a provider definition as well as an instance', async () => {
    const client = createClient(provider)
    expectTypeOf(client.menu.list).returns.toEqualTypeOf<Promise<MenuListResult>>()
    await expect(client.menu.list({})).resolves.toMatchObject({ total: 0 })
  })

  it('exports a proxyClient alias', async () => {
    const { instance } = makeClient()
    const client = proxyClient(instance)
    await expect(client.menu.list({})).resolves.toMatchObject({ total: 0 })
  })
})
