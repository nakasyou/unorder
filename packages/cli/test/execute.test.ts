import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'
import { MemorySessionStore } from '@unorder/core'
import { executeMethod } from '../src/execute'
import { parseArguments } from '../src/options'
import { FileSessionStore } from '../src/state-store'
import { mockMenu, MockSaizeriyaServer } from '../../provider-saizeriya/test/mock-server'

const menuFile = fileURLToPath(new URL('../../provider-saizeriya/data/menu.json', import.meta.url))

describe('CLI execution', () => {
  it('runs a static menu method without opening a session', async () => {
    const result = await executeMethod({
      providerId: 'saizeriya',
      method: 'menu.list',
      input: { limit: 2, query: 'ランチ' },
      store: new MemorySessionStore(),
      overrides: { menuFile },
    })
    expect(result.session).toBe('unchanged')
    expect(result.output).toMatchObject({ limit: 2, source: { kind: 'static' } })
    expect((result.output as { items: unknown[] }).items).toHaveLength(2)
  })

  it('writes and clears an explicit state file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'unorder-cli-'))
    const store = new FileSessionStore(join(directory, 'sessions.json'))
    expect(await store.load('saizeriya')).toBeNull()
    await store.save({
      format: 'unorder.session',
      version: 1,
      provider: 'saizeriya',
      stateVersion: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      state: { marker: true },
    })
    expect(await store.load('saizeriya')).toMatchObject({ state: { marker: true } })
    await store.clear('saizeriya')
    expect(await store.load('saizeriya')).toBeNull()
  })

  it('parses flags in any position', () => {
    expect(
      parseArguments([
        'run',
        'saizeriya',
        'menu.list',
        '--state',
        '/tmp/state.json',
        '--menu-file=./menu.json',
        '{}',
      ]),
    ).toMatchObject({
      command: 'run',
      positionals: ['saizeriya', 'menu.list', '{}'],
      options: { state: '/tmp/state.json', menuFile: './menu.json' },
    })
  })

  it('exports a stored session and rejects export without one', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'unorder-export-'))
    const statePath = join(directory, 'sessions.json')
    const store = new FileSessionStore(statePath)
    await expect(
      executeMethod({
        providerId: 'saizeriya',
        method: 'session.export',
        input: {},
        store,
        overrides: { menuFile },
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' })

    const server = new MockSaizeriyaServer(mockMenu)
    const table = server.createTable()
    const common = {
      providerId: 'saizeriya',
      store,
      overrides: { menuFile },
      fetch: server.fetch,
    } as const
    await executeMethod({
      ...common,
      method: 'session.open',
      input: { qrUrl: server.qrUrl(table), peopleCount: 2 },
    })
    const exported = await executeMethod({ ...common, method: 'session.export', input: {} })
    expect(exported.output).toMatchObject({
      format: 'unorder.session',
      version: 1,
      provider: 'saizeriya',
      stateVersion: 1,
      state: { shopId: 525, tableNo: 51, peopleCount: 2 },
    })
    expect(exported.session).toBe('saved')
  })

  it('rejects unknown providers', async () => {
    await expect(
      executeMethod({
        providerId: 'nope',
        method: 'menu.list',
        input: {},
        store: new MemorySessionStore(),
      }),
    ).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('keeps a Saizeriya session across separate runs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'unorder-session-'))
    const statePath = join(directory, 'sessions.json')
    const menuPath = join(directory, 'menu.json')
    await writeFile(menuPath, JSON.stringify(mockMenu))

    const server = new MockSaizeriyaServer(mockMenu)
    const table = server.createTable()
    const store = new FileSessionStore(statePath)
    const common = {
      providerId: 'saizeriya',
      store,
      overrides: { menuFile: menuPath },
      fetch: server.fetch,
    } as const

    await executeMethod({
      ...common,
      method: 'session.open',
      input: { qrUrl: server.qrUrl(table), peopleCount: 2 },
    })
    await executeMethod({
      ...common,
      method: 'cart.add',
      input: { itemId: '1202', quantity: 2 },
    })
    const cart = await executeMethod({ ...common, method: 'cart.list', input: {} })
    expect(cart.output).toMatchObject({ itemCount: 2, subtotal: { amount: 700 } })

    const order = await executeMethod({ ...common, method: 'order.send', input: {} })
    expect(order.output).toMatchObject({ status: 'submitted', itemCount: 2 })

    const history = await executeMethod({ ...common, method: 'order.list', input: {} })
    expect((history.output as { orders: unknown[] }).orders).toHaveLength(1)

    await executeMethod({ ...common, method: 'session.close', input: {} })
    expect(await store.load('saizeriya')).toBeNull()
  })
})
