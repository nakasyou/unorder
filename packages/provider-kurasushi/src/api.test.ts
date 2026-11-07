import { describe, expect, it } from 'vite-plus/test'
import { AuthRequiredError, serializeError } from '@unorder/core'
import { KurasushiAuthError } from './index'
import { request } from './api'

describe('Kurasushi HTTP diagnostics', () => {
  it('preserves the actual status, endpoint, and rejection code without exposing credentials', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls++
      return Response.json(
        {
          message: 'お席が見つかりませんでした。(403-1) secret-token secret-qr',
          accessToken: 'secret-token',
        },
        { status: 403 },
      )
    }
    try {
      await request(fetchImpl, 'auth/web/v1/', 'secret-token', { qrCode: 'secret-qr' })
      expect.fail('Expected authentication rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(AuthRequiredError)
      expect(error).toBeInstanceOf(KurasushiAuthError)
      expect(serializeError(error)).toMatchObject({
        code: 'auth_required',
        details: {
          status: 403,
          endpoint: '/app_order/auth/web/v1/',
          serverCode: '403-1',
          reason: 'お席が見つかりませんでした。',
        },
      })
      expect(JSON.stringify(serializeError(error))).not.toContain('secret')
      expect(calls).toBe(1)
    }
  })
  it.each([401, 403])('reports HTTP %s even when the body is not JSON', async (status) => {
    const fetchImpl: typeof fetch = async () => new Response('not JSON: private-token', { status })
    await expect(request(fetchImpl, 'seat/status/v1/', 'private-token')).rejects.toMatchObject({
      details: { status, endpoint: '/app_order/seat/status/v1/' },
    })
  })
  it('does not silently replace a rejected stored session with QR authentication', async () => {
    const { MemorySessionStore } = await import('@unorder/core')
    const { openKurasushi } = await import('./index')
    const { MockKurasushiServer } = await import('../test/mock-server')
    const server = new MockKurasushiServer()
    const store = new MemorySessionStore()
    await openKurasushi({
      store,
      fetch: server.fetch,
      now: () => new Date('2026-11-07T10:30:00Z'),
      qrUrl: 'https://kurasushi-so.epark.jp/?id=test-qr',
    })
    const calls: string[] = []
    const fetchImpl: typeof fetch = async (url) => {
      calls.push(url instanceof Request ? url.url : url instanceof URL ? url.href : url)
      return Response.json({ message: 'Rejected' }, { status: 401 })
    }
    const restored = await openKurasushi({
      store,
      fetch: fetchImpl,
      qrUrl: 'https://kurasushi-so.epark.jp/?id=expired',
    })
    await expect(restored.call('menu.list', {})).rejects.toMatchObject({ details: { status: 401 } })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('/menus/')
  })
  it('reports pending authentication as such instead of accepting it as a session', async () => {
    const fetchImpl: typeof fetch = async () => Response.json({}, { status: 202 })
    await expect(request(fetchImpl, 'auth/web/v1/', '', {})).rejects.toMatchObject({
      code: 'provider_error',
      details: { status: 202 },
    })
  })
})
