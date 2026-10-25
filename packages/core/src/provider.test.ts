import { describe, expect, expectTypeOf, it } from 'vite-plus/test'
import { AuthRequiredError, InvalidInputError, UnsupportedError } from './errors'
import type { MenuListResult } from './menu'
import { listMenuItems } from './menu'
import { money } from './domain'
import {
  createProviderInstance,
  createProviderRuntime,
  defineProvider,
  exportSession,
  instantiate,
} from './provider'
import type { MethodMap } from './provider'
import { s } from './schema'
import { defineStandardMethod } from './standard'

interface TestState {
  token: string
  count: number
}

interface TestConfig {
  label: string
}

const testMethods = {
  'session.open': defineStandardMethod<'session.open', TestState, TestConfig>(
    'session.open',
    (ctx, input) => {
      ctx.setState({ token: 'token', count: input.peopleCount ?? 0 })
      return {
        provider: 'test',
        peopleCount: input.peopleCount,
        openedAt: ctx.now().toISOString(),
        updatedAt: ctx.now().toISOString(),
      }
    },
  ),
  'session.close': defineStandardMethod<'session.close', TestState, TestConfig>(
    'session.close',
    (ctx) => {
      ctx.setState(null)
      return { closed: true }
    },
  ),
  'menu.list': defineStandardMethod<'menu.list', TestState, TestConfig>('menu.list', () =>
    listMenuItems([], {}, { kind: 'dynamic', providerId: 'test' }),
  ),
  'cart.list': defineStandardMethod<'cart.list', TestState, TestConfig>('cart.list', (ctx) => ({
    lines: [],
    itemCount: ctx.requireState().count,
    subtotal: money(0),
  })),
} satisfies MethodMap<TestState, TestConfig>

const makeProvider = (options: { serializeCount?: boolean } = {}) =>
  defineProvider<'test', TestState, TestConfig, typeof testMethods>({
    id: 'test',
    displayName: 'Test Provider',
    description: 'A provider used only by core tests.',
    stateVersion: 1,
    menus: 'dynamic',
    defaultConfig: { label: 'test' },
    config: s.object({ label: s.string() }),
    ...(options.serializeCount
      ? { serializeState: (state: TestState) => ({ token: state.token, count: state.count + 1 }) }
      : {}),
    methods: testMethods,
  })

describe('defineProvider', () => {
  it('is an identity function with no runtime behavior', () => {
    const definition = {
      id: 'test',
      displayName: 'Test Provider',
      description: 'A provider used only by core tests.',
      stateVersion: 1,
      methods: testMethods,
    } as const
    expect(defineProvider<'test', TestState, TestConfig, typeof testMethods>(definition)).toBe(
      definition,
    )
  })

  it('enforces session requirements', async () => {
    const provider = makeProvider()
    const runtime = createProviderRuntime(provider)
    await expect(runtime.call('menu.list', {})).resolves.toMatchObject({ total: 0 })
    await expect(runtime.call('cart.list', {})).rejects.toBeInstanceOf(AuthRequiredError)
  })

  it('opens, exports, and imports a session', async () => {
    const provider = makeProvider()
    const runtime = createProviderRuntime(provider, { config: { label: 'custom' } })
    const session = await runtime.call('session.open', {
      qrUrl: 'https://example.com/qr',
      peopleCount: 3,
    })
    expect(session.peopleCount).toBe(3)
    expect(runtime.getState()).toEqual({ token: 'token', count: 3 })

    const exported = runtime.exportSession()
    expect(exported).toMatchObject({
      format: 'unorder.session',
      version: 1,
      provider: 'test',
      stateVersion: 1,
      state: { token: 'token', count: 3 },
    })

    const automatic = await runtime.call('session.export', {})
    expect(automatic).toEqual(exported)

    const restored = createProviderRuntime(provider, { session: exported })
    expect(restored.getState()).toEqual(runtime.getState())
    await expect(restored.call('cart.list', {})).resolves.toMatchObject({ itemCount: 3 })
  })

  it('closes a session and marks it empty on export', async () => {
    const provider = makeProvider()
    const runtime = createProviderRuntime(provider)
    await runtime.call('session.open', { qrUrl: 'https://example.com/qr' })
    await runtime.call('session.close', {})
    expect(runtime.isOpen()).toBe(false)
    expect(runtime.exportSession().state).toBeNull()
  })

  it('rejects unsupported methods and invalid input', async () => {
    const provider = makeProvider()
    const runtime = createProviderRuntime(provider)
    await expect(runtime.invoke('order.send', {})).rejects.toBeInstanceOf(UnsupportedError)
    await expect(runtime.invoke('menu.list', { limit: 0 })).rejects.toBeInstanceOf(
      InvalidInputError,
    )
    await expect(
      runtime.invoke('menu.list', { limit: 1 }).then(() => runtime.invoke('session.open', {})),
    ).rejects.toBeInstanceOf(InvalidInputError)
  })

  it('exposes typed method calls', async () => {
    const provider = makeProvider()
    const runtime = createProviderRuntime(provider)
    const result = await runtime.call('menu.list', {})
    expectTypeOf(result).toEqualTypeOf<MenuListResult>()
    // @ts-expect-error unknown methods are not part of the method map
    await expect(runtime.call('x-missing', {})).rejects.toBeInstanceOf(UnsupportedError)
    // @ts-expect-error session.open requires qrUrl
    await expect(runtime.call('session.open', {})).rejects.toBeInstanceOf(InvalidInputError)
  })
})

describe('exportSession', () => {
  it('wraps provider state in a versioned envelope', () => {
    const provider = makeProvider()
    const exported = exportSession(
      provider,
      { token: 'abc', count: 2 },
      {
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    )
    expect(exported).toEqual({
      format: 'unorder.session',
      version: 1,
      provider: 'test',
      stateVersion: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      state: { token: 'abc', count: 2 },
    })
  })

  it('uses the provider serializeState hook', () => {
    const provider = makeProvider({ serializeCount: true })
    expect(exportSession(provider, { token: 'abc', count: 2 }).state).toEqual({
      token: 'abc',
      count: 3,
    })
  })

  it('serializes the current state of a call-only instance', async () => {
    const instance = createProviderInstance(makeProvider())
    await instance.call('session.open', { qrUrl: 'https://example.com/qr', peopleCount: 4 })
    expect(exportSession(instance)).toMatchObject({
      provider: 'test',
      state: { token: 'token', count: 4 },
    })
  })
})

describe('createProviderInstance', () => {
  it('exposes only call', () => {
    const instance = createProviderInstance(makeProvider())
    const alias = instantiate(makeProvider())
    expect(Object.keys(instance)).toEqual(['call'])
    expect(Object.keys(alias)).toEqual(['call'])
    expect('state' in instance).toBe(false)
    expect('methods' in instance).toBe(false)
  })

  it('shares state with a runtime created without overrides', async () => {
    const instance = createProviderInstance(makeProvider())
    await instance.call('session.open', { qrUrl: 'https://example.com/qr', peopleCount: 2 })
    const runtime = createProviderRuntime(instance)
    expect(runtime.getState()).toEqual({ token: 'token', count: 2 })
    expect(runtime.exportSession().state).toEqual({ token: 'token', count: 2 })
  })
})

describe('state migration', () => {
  it('migrates older state versions', async () => {
    const migrationMethods = {
      'session.open': defineStandardMethod<'session.open', TestState, TestConfig>(
        'session.open',
        (ctx) => {
          ctx.setState({ token: 'new', count: 0 })
          return {
            provider: 'migrate',
            openedAt: ctx.now().toISOString(),
            updatedAt: ctx.now().toISOString(),
          }
        },
      ),
    } satisfies MethodMap<TestState, TestConfig>
    const provider = defineProvider<'migrate', TestState, TestConfig, typeof migrationMethods>({
      id: 'migrate',
      displayName: 'Migrating Provider',
      description: 'Tests state migration.',
      stateVersion: 2,
      validateState: (raw) => raw as TestState,
      migrateState: (raw) => {
        const old = raw as { token?: string; count?: number }
        return { token: old.token ?? 'migrated', count: (old.count ?? 0) + 1 }
      },
      methods: migrationMethods,
    })
    const runtime = createProviderRuntime(provider, {
      session: {
        format: 'unorder.session',
        version: 1,
        provider: 'migrate',
        stateVersion: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        state: { token: 'old', count: 1 },
      },
    })
    expect(runtime.getState()).toEqual({ token: 'old', count: 2 })
  })
})
