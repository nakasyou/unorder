import { AuthRequiredError, InvalidInputError, NetworkError, ProviderError, RateLimitedError } from '@unorder/core'

const ORIGIN = 'https://mo.sushiro.jp'
/** The official site uses the complete raw query string (not a named parameter). */
export const parseSushiroEntryURL = (input: string): string => {
  let url: URL
  try { url = new URL(input) } catch { throw new InvalidInputError('Invalid Sushiro entry URL') }
  if (url.protocol !== 'https:' || url.hostname !== 'mo.sushiro.jp' || url.port || url.username || url.password || url.hash)
    throw new InvalidInputError('Expected an HTTPS mo.sushiro.jp entry URL')
  // Do not use URLSearchParams: it converts + to space and would corrupt the opaque value.
  const value = url.search.slice(1)
  if (url.pathname !== '/' || !/^[A-Za-z0-9+/%=]{32,512}$/.test(value) || value.includes('&'))
    throw new InvalidInputError('Expected an opaque Sushiro entry query at the site root')
  return value
}

/** A bearer token is obtained from the user's own browser session, not from a shared HAR. */
export const parseSushiroSessionURL = (input: string): string => {
  let url: URL
  try { url = new URL(input) } catch { throw new InvalidInputError('Invalid Sushiro session URL') }
  if (url.protocol !== 'https:' || url.hostname !== 'mo.sushiro.jp' || url.port || url.username || url.password)
    throw new InvalidInputError('Expected an HTTPS mo.sushiro.jp session URL')
  // The captured QR q value is not a bearer token. Do not pretend it is one.
  const tokens = url.searchParams.getAll('token')
  if (tokens.length !== 1 || !/^[a-zA-Z0-9_-]{8,128}$/.test(tokens[0] ?? ''))
    throw new InvalidInputError('Provide a session URL with one token query parameter from your own authenticated session; QR q alone is unsupported')
  return tokens[0]!
}

export const sushiroRequest = async (fetchImpl: typeof fetch, path: string, token: string, body?: unknown): Promise<unknown> => {
  if (!/^\/v1\/(?:session|menu|mobile\/order(?:\/detail)?|mobile\/order\/start|config\?q=[A-Za-z0-9+%._~-]{32,1024})$/.test(path)) throw new InvalidInputError('Unsupported Sushiro endpoint')
  let response: Response
  try {
    response = await fetchImpl(ORIGIN + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: token, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json', origin: ORIGIN }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error', signal: AbortSignal.timeout(30000),
    })
  } catch { throw new NetworkError('Sushiro request failed; an uncertain order must not be retried automatically') }
  if ([401,403].includes(response.status)) throw new AuthRequiredError('Sushiro session is invalid or expired')
  if (response.status === 429) throw new RateLimitedError('Sushiro rate limit reached')
  if (!response.ok) throw new ProviderError('Sushiro API returned HTTP ' + response.status)
  try { return await response.json() } catch { throw new ProviderError('Invalid Sushiro JSON response') }
}

/** Configuration is a read-only way to validate an entry URL before any session-start POST. */
export const sushiroConfig = (fetchImpl: typeof fetch, entry: string): Promise<unknown> =>
  sushiroRequest(fetchImpl, '/v1/config?q=' + encodeURIComponent(entry), '')

/** Matches the upstream frontend's JSON-string body for postStart; may register a device. */
export const sushiroStart = (fetchImpl: typeof fetch, entry: string): Promise<unknown> =>
  sushiroRequest(fetchImpl, '/v1/mobile/order/start', '', entry)
