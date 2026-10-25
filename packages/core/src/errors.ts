/** Stable machine-readable error codes shared by every provider. */
export type UnorderErrorCode =
  | 'unsupported'
  | 'invalid_input'
  | 'auth_required'
  | 'rate_limited'
  | 'provider_error'
  | 'network'
  | 'not_found'
  | 'conflict'
  | 'internal'

export interface SerializedUnorderError {
  name: string
  code: UnorderErrorCode
  message: string
  details?: unknown
}

/** Base class for every error intentionally surfaced by the SDK. */
export class UnorderError extends Error {
  readonly code: UnorderErrorCode
  readonly details?: unknown

  constructor(
    code: UnorderErrorCode,
    message: string,
    options: { details?: unknown; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = new.target.name
    this.code = code
    this.details = options.details
  }

  /** Errors are JSON-serializable so CLI and MCP transports can return them verbatim. */
  toJSON(): SerializedUnorderError {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    }
  }
}

export class UnsupportedError extends UnorderError {
  constructor(message: string, options?: { details?: unknown }) {
    super('unsupported', message, options)
  }
}

export class InvalidInputError extends UnorderError {
  constructor(message: string, options?: { details?: unknown; cause?: unknown }) {
    super('invalid_input', message, options)
  }
}

export class AuthRequiredError extends UnorderError {
  constructor(message = 'This operation requires an open session') {
    super('auth_required', message)
  }
}

export class RateLimitedError extends UnorderError {
  constructor(message = 'The provider rate-limited this request', options?: { details?: unknown }) {
    super('rate_limited', message, options)
  }
}

export class ProviderError extends UnorderError {
  constructor(message: string, options?: { details?: unknown; cause?: unknown }) {
    super('provider_error', message, options)
  }
}

export class NetworkError extends UnorderError {
  constructor(message: string, options?: { details?: unknown; cause?: unknown }) {
    super('network', message, options)
  }
}

export class NotFoundError extends UnorderError {
  constructor(message: string, options?: { details?: unknown }) {
    super('not_found', message, options)
  }
}

export class ConflictError extends UnorderError {
  constructor(message: string, options?: { details?: unknown }) {
    super('conflict', message, options)
  }
}

/** Normalizes unknown thrown values into a serializable error payload. */
export const serializeError = (error: unknown): SerializedUnorderError => {
  if (error instanceof UnorderError) {
    return error.toJSON()
  }
  if (error instanceof Error) {
    return { name: error.name, code: 'internal', message: error.message }
  }
  return { name: 'Error', code: 'internal', message: String(error) }
}

/** Wraps a non-Unorder error without losing the original cause. */
export const toUnorderError = (error: unknown, fallbackMessage: string): UnorderError => {
  if (error instanceof UnorderError) {
    return error
  }
  return new UnorderError('internal', fallbackMessage, { cause: error })
}
