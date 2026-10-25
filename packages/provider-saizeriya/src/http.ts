import { NetworkError, ProviderError } from '@unorder/core'

export type CookieJar = Record<string, string>

export const createQueueLocker = () => {
  let lastPromise: Promise<void> = Promise.resolve()

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    const resultPromise = lastPromise.then(() => fn())
    lastPromise = resultPromise.then(
      () => {},
      () => {},
    )
    return resultPromise
  }
}

const cookieHeader = (cookies: CookieJar): string =>
  Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')

const storeSetCookie = (cookies: CookieJar, response: Response) => {
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] })
    .getSetCookie
  const values =
    typeof getSetCookie === 'function'
      ? getSetCookie.call(response.headers)
      : (response.headers.get('set-cookie')?.split(/,(?=\s*[^;,\s]+=)/) ?? [])

  for (const cookie of values) {
    const [pair] = cookie.split(';')
    const separator = pair?.indexOf('=') ?? -1
    if (pair && separator > 0) {
      cookies[pair.slice(0, separator).trim()] = pair.slice(separator + 1).trim()
    }
  }
}

/**
 * Wraps a fetch implementation with a cookie jar stored in session state so
 * cookies survive separate CLI processes.
 */
export const createCookieFetch = (
  cookies: CookieJar,
  baseFetch: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const headers = new Headers(request.headers)
    const current = cookieHeader(cookies)
    if (current) {
      headers.set('cookie', current)
    }
    const response = await baseFetch(new Request(request, { headers }))
    storeSetCookie(cookies, response)
    return response
  }) as typeof globalThis.fetch

export const fetchOrThrow = async (
  fetchImpl: typeof globalThis.fetch,
  input: string | URL | Request,
  init?: RequestInit,
  label = 'Saizeriya request',
): Promise<Response> => {
  let response: Response
  try {
    response = await fetchImpl(input, init)
  } catch (error) {
    throw new NetworkError(`${label} failed`, { cause: error })
  }
  if (!response.ok) {
    throw new ProviderError(`${label} failed with HTTP ${response.status}`, {
      details: { status: response.status, statusText: response.statusText },
    })
  }
  return response
}

export const readJSON = async <Value>(response: Response, label: string): Promise<Value> => {
  try {
    return (await response.json()) as Value
  } catch (error) {
    throw new ProviderError(`${label} returned invalid JSON`, { cause: error })
  }
}
