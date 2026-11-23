import { describe, expect, it, vi } from 'vitest'
import { createSushiro, parseSushiroEntryURL } from '../src/index'

const QR = 'ABC123+def/XYZ789+ghi/ABC123+def/XYZ789+ghi'
const TOKEN = '00000000-1111-2222-3333-444444444444'
const config = {
  session: { enable_cms_order: true, is_last_order_passed: false },
  shop: { id: 841, name: 'Mock Shop' },
  table: { id: 44 },
}
const active = {
  session: { token: TOKEN, enable_order: true, is_checked_out: false },
  shop: { id: 841, name: 'Mock Shop' },
  table: { id: 44 },
}

describe('official Sushiro opaque entry URLs', () => {
  it('preserves + and / in the raw query instead of form-decoding them', () => {
    expect(parseSushiroEntryURL('https://mo.sushiro.jp/?' + QR)).toBe(QR)
    expect(() => parseSushiroEntryURL('https://mo.sushiro.jp/?q=' + QR)).toThrow()
    expect(() => parseSushiroEntryURL('https://evil.example/?' + QR)).toThrow()
  })
  it('uses config, explicit start, then verifies the returned session without cookies', async () => {
    const requests: { path: string; method: string; body?: BodyInit | null }[] = []
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url)
      requests.push({ path, method: init?.method ?? 'GET', body: init?.body })
      const response = path.includes('/v1/config?q=') ? config
        : path.endsWith('/v1/mobile/order/start') ? { token: TOKEN }
          : active
      return new Response(JSON.stringify(response), { status: 200 })
    }) as unknown as typeof globalThis.fetch
    const p = createSushiro({ fetch })
    const result = await p.call('session.open', { qrUrl: 'https://mo.sushiro.jp/?' + QR })
    expect(result.shop?.id).toBe('841')
    expect(requests.map(({ method }) => method)).toEqual(['GET', 'POST', 'GET'])
    expect(requests[0]?.path).toContain('q=' + encodeURIComponent(QR))
    expect(requests[1]?.body).toBe(JSON.stringify(QR))
    expect(requests[2]?.path).toContain('/v1/session')
    expect(requests.every((request) => !request.path.includes('token='))).toBe(true)
  })
  it('rejects a config whose order session cannot be started without posting', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ...config, session: { enable_cms_order: false } }), { status: 200 })) as unknown as typeof globalThis.fetch
    const p = createSushiro({ fetch })
    await expect(p.call('session.open', { qrUrl: 'https://mo.sushiro.jp/?' + QR })).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('does not accept a token for a different table', async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const path = String(url)
      const response = path.includes('/v1/config?q=') ? config
        : path.endsWith('/v1/mobile/order/start') ? { token: TOKEN }
          : { ...active, table: { id: 999 } }
      return new Response(JSON.stringify(response), { status: 200 })
    }) as unknown as typeof globalThis.fetch
    const p = createSushiro({ fetch })
    await expect(p.call('session.open', { qrUrl: 'https://mo.sushiro.jp/?' + QR })).rejects.toThrow('different tables')
  })
})
