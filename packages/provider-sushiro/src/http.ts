import { NetworkError, NotFoundError, ProviderError, RateLimitedError } from '@unorder/core'
import type { SushiroProviderConfig, SushiroRegion } from './types'

export const DEFAULT_CRM_BASE_URL = 'https://sushipass.akindo-sushiro.co.jp/api/2.0'
export const DEFAULT_MENU_BASE_URL = 'https://www.akindo-sushiro.co.jp/appsv2/menu/menu_detail/'
export const DEFAULT_TAKEOUT_BASE_URL = 'https://takeout.akindo-sushiro.co.jp'
export const DEFAULT_TAKEOUT_TOKEN = 'aA1-bB2_cC3~dD4+eE5/fF6='
export const DEFAULT_USER_AGENT = 'unorder-sushiro/0.1 (unofficial interoperability client)'

export interface SushiroEndpoints {
  readonly region: SushiroRegion
  readonly crmBaseUrl: string
  readonly menuBaseUrl: string
  readonly takeoutBaseUrl: string
  readonly takeoutToken: string
  readonly userAgent: string
}

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '')

export const resolveEndpoints = (config: SushiroProviderConfig): SushiroEndpoints => ({
  region: config.region ?? 'ja',
  crmBaseUrl: trimTrailingSlash(config.crmBaseUrl ?? DEFAULT_CRM_BASE_URL),
  menuBaseUrl: config.menuBaseUrl ?? DEFAULT_MENU_BASE_URL,
  takeoutBaseUrl: trimTrailingSlash(config.takeoutBaseUrl ?? DEFAULT_TAKEOUT_BASE_URL),
  takeoutToken: config.takeoutToken ?? DEFAULT_TAKEOUT_TOKEN,
  userAgent: config.userAgent ?? DEFAULT_USER_AGENT,
})

export const buildUrl = (
  base: string,
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>,
): string => {
  const url = new URL(`${trimTrailingSlash(base)}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

export const buildMenuUrl = (base: string, storeId: string): string => {
  const url = new URL(base)
  url.searchParams.set('s_id', storeId)
  return url.toString()
}

const responseLabel = (response: Response, label: string): never => {
  if (response.status === 404) {
    throw new NotFoundError(`${label} was not found`, {
      details: { status: response.status },
    })
  }
  if (response.status === 429) {
    throw new RateLimitedError(`${label} was rate-limited`, {
      details: { status: response.status },
    })
  }
  throw new ProviderError(`${label} failed with HTTP ${response.status}`, {
    details: { status: response.status, statusText: response.statusText },
  })
}

export interface RequestOptions {
  readonly fetch: typeof globalThis.fetch
  readonly url: string
  readonly label: string
  readonly init?: RequestInit
  readonly userAgent?: string
  readonly expected?: 'json' | 'text'
}

export const requestText = async (options: RequestOptions): Promise<string> => {
  const headers = new Headers(options.init?.headers)
  if (!headers.has('accept')) {
    headers.set('accept', options.expected === 'json' ? 'application/json' : 'text/html')
  }
  if (options.userAgent && !headers.has('user-agent')) {
    headers.set('user-agent', options.userAgent)
  }

  let response: Response
  try {
    response = await options.fetch(options.url, { ...options.init, headers })
  } catch (error) {
    throw new NetworkError(`${options.label} failed`, { cause: error })
  }
  if (!response.ok) {
    responseLabel(response, options.label)
  }
  let text: string
  try {
    text = await response.text()
  } catch (error) {
    throw new ProviderError(`${options.label} returned an unreadable body`, { cause: error })
  }
  return text
}

export const requestJson = async <Value>(options: RequestOptions): Promise<Value> => {
  const text = await requestText({ ...options, expected: 'json' })
  if (text.trim() === '') {
    throw new ProviderError(`${options.label} returned an empty body`)
  }
  try {
    return JSON.parse(text) as Value
  } catch (error) {
    throw new ProviderError(`${options.label} returned invalid JSON`, { cause: error })
  }
}

export const formBody = (values: Record<string, string | number | undefined>): string => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      params.set(key, String(value))
    }
  }
  return params.toString()
}
