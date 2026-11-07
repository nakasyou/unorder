import {
  AuthRequiredError,
  InvalidInputError,
  NetworkError,
  ProviderError,
  RateLimitedError,
} from '@unorder/core'

export const API_BASE_URL = 'https://api-app.smart-order.epark.jp'

export const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderError('Invalid Kurasushi response object')
  }
  return value as Record<string, unknown>
}
export const text = (value: unknown): string => {
  if (typeof value !== 'string' || !value) throw new ProviderError('Missing Kurasushi text field')
  return value
}
export const integer = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ProviderError('Invalid Kurasushi numeric field')
  }
  return value
}

/** The web app reads the opaque QR value from the `id` query parameter. */
export const processKurasushiQR = (input: string): string => {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new InvalidInputError('Invalid Kurasushi QR URL')
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'kurasushi-so.epark.jp' ||
    url.port ||
    url.username ||
    url.password
  ) {
    throw new InvalidInputError('Expected an HTTPS kurasushi-so.epark.jp QR URL')
  }
  const id = url.searchParams.get('id')
  if (!id || url.searchParams.getAll('id').length !== 1)
    throw new InvalidInputError('QR URL must contain one nonempty id')
  return id
}

/** The Japanese app sends local Japan time, without a timezone suffix. */
export const japanTime = (date: Date): string =>
  new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')

export const request = async (
  fetchImpl: typeof globalThis.fetch,
  path: string,
  token = '',
  body?: unknown,
): Promise<unknown> => {
  let response: Response
  try {
    response = await fetchImpl(`${API_BASE_URL}/app_order/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Language-Id': 'ja',
        soAuthToken: token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    // Never include a request, QR value, or access token in public errors.
    throw new NetworkError('Kurasushi request failed; mutating requests are never retried')
  }
  if (response.status === 401 || response.status === 403)
    throw new AuthRequiredError('Kurasushi authentication expired or was rejected')
  if (response.status === 429) throw new RateLimitedError('Kurasushi rate limit reached')
  if (!response.ok) throw new ProviderError(`Kurasushi HTTP ${response.status}`)
  try {
    return await response.json()
  } catch {
    throw new ProviderError('Invalid Kurasushi JSON response')
  }
}
