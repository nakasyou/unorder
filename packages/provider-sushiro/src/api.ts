import { AuthRequiredError, InvalidInputError, NetworkError, ProviderError, RateLimitedError } from '@unorder/core'

const ORIGIN = 'https://mo.sushiro.jp'
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
  if (!/^\/v1\/(?:session|menu|mobile\/order)$/.test(path)) throw new InvalidInputError('Unsupported Sushiro endpoint')
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
