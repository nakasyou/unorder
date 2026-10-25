import {
  AuthRequiredError,
  ConflictError,
  InvalidInputError,
  NetworkError,
  NotFoundError,
  ProviderError,
} from '@unorder/core'
import { createBaseFields, createOrderSubmitBody, createSearchParams, nowOrderTime } from './forms'
import { createCookieFetch, createQueueLocker, fetchOrThrow, readJSON } from './http'
import { PageParser } from './page-parser'
import type {
  AccountSummary,
  AddItemOptions,
  CallOptions,
  LookupItemResult,
  PageKind,
  ReceiptSummary,
  SaizeriyaCartLine,
  SaizeriyaState,
} from './types'

const CODE_PATTERN = /^\d{4}$/

const lockers = new WeakMap<SaizeriyaState, ReturnType<typeof createQueueLocker>>()

const lockerFor = (state: SaizeriyaState): ReturnType<typeof createQueueLocker> => {
  const existing = lockers.get(state)
  if (existing) {
    return existing
  }
  const locker = createQueueLocker()
  lockers.set(state, locker)
  return locker
}

export interface ProcessedQR {
  baseURL: string
  id: string
  shopId: number
  tableNo: number
  peopleCount?: number
  pageKind: PageKind
}

export const processQR = async (
  qrURL: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<ProcessedQR> => {
  let qrResponse: Response
  try {
    qrResponse = await fetchImpl(qrURL, { redirect: 'manual' })
  } catch (error) {
    throw new NetworkError('QR resolution failed', { cause: error })
  }

  if (qrResponse.status >= 400) {
    throw new ProviderError(`QR resolution failed with HTTP ${qrResponse.status}`, {
      details: { status: qrResponse.status },
    })
  }

  const firstLocation = qrResponse.headers.get('location')
  const nextLocation = firstLocation ? new URL(firstLocation, qrURL) : new URL(qrURL)
  const response = await fetchOrThrow(fetchImpl, nextLocation, undefined, 'QR landing page')
  const parser = new PageParser(await response.text())
  const peopleCount = parser.getPeopleCount()

  return {
    baseURL: `${nextLocation.origin}${nextLocation.pathname}`,
    id: parser.getNextActionId(),
    shopId: parser.getShopId(),
    tableNo: parser.getTableNo(),
    ...(peopleCount === undefined ? {} : { peopleCount }),
    pageKind: parser.getPageKind(),
  }
}

export interface SaizeriyaClientOptions {
  state: SaizeriyaState
  fetch?: typeof globalThis.fetch
  now?: () => Date
  language?: string
}

export interface SaizeriyaClient {
  readonly state: SaizeriyaState
  getState(): SaizeriyaState
  setPeopleCount(count: number): Promise<SaizeriyaState>
  lookupItem(code: string): Promise<LookupItemResult>
  addItem(code: string, options?: AddItemOptions): Promise<SaizeriyaCartLine>
  removeCartItem(index: number): SaizeriyaState
  clearCart(): SaizeriyaState
  submitOrder(): Promise<SaizeriyaState>
  goToMenu(): Promise<SaizeriyaState>
  goToCart(): Promise<SaizeriyaState>
  goToHistory(): Promise<SaizeriyaState>
  getAccount(): Promise<{ state: SaizeriyaState; account: AccountSummary }>
  getReceipt(): Promise<{
    state: SaizeriyaState
    account: AccountSummary
    receipt: ReceiptSummary
  }>
  reorder(code: string): Promise<SaizeriyaState>
  call(options?: CallOptions): Promise<{ result: string }>
  callStaff(): Promise<{ result: string }>
  callDessert(): Promise<{ result: string }>
  checkOrderStarted(): Promise<{ result: string }>
  checkLastOrder(): Promise<{ result: string; lastorder?: boolean }>
  checkMidnight(): Promise<{ result: string }>
  confirmAlcohol(): Promise<{ result: string }>
}

export const openSaizeriyaState = async (options: {
  qrUrl: string
  peopleCount?: number
  fetch?: typeof globalThis.fetch
  now?: () => Date
}): Promise<SaizeriyaState> => {
  const cookies: Record<string, string> = {}
  const now = options.now ?? (() => new Date())
  const cookieFetch = createCookieFetch(cookies, options.fetch ?? globalThis.fetch)
  const processed = await processQR(options.qrUrl, cookieFetch)
  const state: SaizeriyaState = {
    baseUrl: processed.baseURL,
    nextId: processed.id,
    shopId: processed.shopId,
    tableNo: processed.tableNo,
    peopleCount: options.peopleCount ?? processed.peopleCount ?? 0,
    page: processed.pageKind,
    cart: [],
    orders: [],
    cookies,
    openedAt: now().toISOString(),
  }

  if (options.peopleCount !== undefined) {
    const client = createSaizeriyaClient({
      state,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.now ? { now: options.now } : {}),
    })
    await client.setPeopleCount(options.peopleCount)
  }

  return state
}

export const createSaizeriyaClient = ({
  state,
  fetch: baseFetch = globalThis.fetch,
  now = () => new Date(),
  language = '1',
}: SaizeriyaClientOptions): SaizeriyaClient => {
  const fetchImpl = createCookieFetch(state.cookies, baseFetch)
  const locker = lockerFor(state)

  const commandURL = (path: string) => new URL(path, state.baseUrl)
  const pageURL = () => `${state.baseUrl}?${state.nextId}`

  const updateFromPage = (parser: PageParser) => {
    state.nextId = parser.getNextActionId()
    state.token = parser.getToken() ?? state.token
    state.sessionId = parser.getSessionId() ?? state.sessionId
    state.page = parser.getPageKind()
    state.peopleCount = parser.getPeopleCount() ?? state.peopleCount
  }

  const submitPage = async (
    fields: Record<string, string | number | boolean | undefined>,
  ): Promise<PageParser> => {
    const response = await fetchOrThrow(
      fetchImpl,
      pageURL(),
      { method: 'POST', body: createSearchParams(fields) },
      'Saizeriya page submission',
    )
    const parser = new PageParser(await response.text())
    updateFromPage(parser)
    return parser
  }

  const postJSONCommand = async <Value>(
    path: string,
    fields: Record<string, string | number | boolean>,
  ): Promise<Value> => {
    const response = await fetchOrThrow(
      fetchImpl,
      commandURL(path),
      { method: 'POST', body: createSearchParams(fields) },
      `Saizeriya command ${path}`,
    )
    return readJSON<Value>(response, `Saizeriya command ${path}`)
  }

  const requireToken = (): string => {
    if (!state.token) {
      throw new AuthRequiredError('Saizeriya token not found; move to a token-bearing page first')
    }
    return state.token
  }

  const moveToNumberPage = async (forced = true) =>
    submitPage({
      ...createBaseFields('number'),
      ctrl: forced ? 'forced' : '',
    })

  const setPeopleCount = async (count: number) =>
    locker(async () => {
      if (!Number.isInteger(count) || count < 1 || count > 99) {
        throw new InvalidInputError('People count must be an integer between 1 and 99')
      }

      if (state.page !== 'number') {
        await moveToNumberPage(true)
      }

      await submitPage({
        ...createBaseFields('menu', requireToken()),
        ctrl: 'number',
        number: count,
      })
      state.peopleCount = count
      return state
    })

  const lookupItem = async (code: string) =>
    locker(async () => {
      if (!CODE_PATTERN.test(code)) {
        throw new InvalidInputError('Item code must be 4 digits')
      }

      const result = await postJSONCommand<LookupItemResult>('./src/cmd/get_item.php', {
        sid: state.shopId,
        tno: state.tableNo,
        lng: language,
        id: code,
        num: state.peopleCount,
        ssid: state.sessionId ?? '',
      })
      return result
    })

  const addItem = async (code: string, options: AddItemOptions = {}) =>
    locker(async () => {
      if (!CODE_PATTERN.test(code)) {
        throw new InvalidInputError('Item code must be 4 digits')
      }

      const count = options.count ?? 1
      const modId = options.modId ?? ''
      const modCount = options.modCount ?? 0
      if (!Number.isInteger(count) || count < 1 || count > 99) {
        throw new InvalidInputError('Item count must be an integer between 1 and 99')
      }
      if (!Number.isInteger(modCount) || modCount < 0 || modCount > 99) {
        throw new InvalidInputError('Modifier count must be an integer between 0 and 99')
      }

      const item = await postJSONCommand<LookupItemResult>('./src/cmd/get_item.php', {
        sid: state.shopId,
        tno: state.tableNo,
        lng: language,
        id: code,
        num: state.peopleCount,
        ssid: state.sessionId ?? '',
      })

      if (item.result !== 'OK' || !item.item_data) {
        throw new NotFoundError(`Item ${code} was not found`)
      }
      if (item.item_data.state !== 2) {
        throw new ConflictError(`Item ${code} is not available`, {
          details: { state: item.item_data.state },
        })
      }

      await submitPage({
        ...createBaseFields('main', requireToken()),
        ctrl: 'add',
        'ord-drkbar-cnt': '0',
        is_reorder: options.reorder ? '1' : '0',
        'order-time': nowOrderTime(now()),
        code,
        amount: count,
        mod_code: modId,
        mod_amount: modCount,
      })

      const line: SaizeriyaCartLine = {
        id: code,
        name: item.item_data.name,
        price: item.item_data.price,
        count,
        reorder: options.reorder ? 1 : 0,
        modId,
        modCount,
      }
      state.cart.push(line)
      return line
    })

  const goToMenu = async () =>
    locker(async () => {
      await submitPage(createBaseFields('menu'))
      return state
    })

  const goToCart = async () =>
    locker(async () => {
      await submitPage(createBaseFields('main', state.token))
      return state
    })

  const goToHistory = async () =>
    locker(async () => {
      await submitPage({
        ...createBaseFields('history', state.token),
        ctrl: 'remember',
        code: '',
        'drinkbar-cnt': '0',
        'alcohol-cnt': '0',
        'ord-drkbar-cnt': '0',
      })
      return state
    })

  const getAccount = async () =>
    locker(async () => {
      const parser = await submitPage(createBaseFields('account', state.token))
      return {
        state,
        account: parser.getAccountSummary(),
      }
    })

  const getReceipt = async () =>
    locker(async () => {
      const parser = await submitPage(createBaseFields('receipt'))
      return {
        state,
        account: parser.getAccountSummary(),
        receipt: parser.getReceiptSummary(),
      }
    })

  const reorder = async (code: string) =>
    locker(async () => {
      if (!CODE_PATTERN.test(code)) {
        throw new InvalidInputError('Item code must be 4 digits')
      }
      await submitPage({
        ...createBaseFields('menu'),
        ctrl: 'reorder',
        code,
      })
      return state
    })

  const removeCartItem = (index: number) => {
    if (!Number.isInteger(index) || index < 0 || index >= state.cart.length) {
      throw new NotFoundError('Cart item was not found', { details: { index } })
    }
    state.cart.splice(index, 1)
    return state
  }

  const clearCart = () => {
    state.cart = []
    return state
  }

  const submitOrder = async () =>
    locker(async () => {
      if (state.cart.length === 0) {
        throw new ConflictError('Cannot submit an empty cart')
      }

      const response = await fetchOrThrow(
        fetchImpl,
        pageURL(),
        {
          method: 'POST',
          body: createOrderSubmitBody(requireToken(), state.cart),
        },
        'Saizeriya order submission',
      )
      const parser = new PageParser(await response.text())
      updateFromPage(parser)
      state.orders.push(state.cart.map((item) => ({ ...item })))
      state.cart = []
      return state
    })

  const call = async (options: CallOptions = {}) =>
    locker(async () => {
      return await postJSONCommand<{ result: string }>('./src/cmd/tbl_call.php', {
        sid: state.shopId,
        tbl: state.tableNo,
        aft: options.after ?? false,
      })
    })

  const checkOrderStarted = async () =>
    locker(async () => {
      return await postJSONCommand<{ result: string }>('./src/cmd/check_order.php', {
        sid: state.shopId,
        tno: state.tableNo,
      })
    })

  const checkLastOrder = async () =>
    locker(async () => {
      return await postJSONCommand<{ result: string; lastorder?: boolean }>(
        './src/cmd/check_lastorder.php',
        { sid: state.shopId },
      )
    })

  const checkMidnight = async () =>
    locker(async () => {
      return await postJSONCommand<{ result: string }>('./src/cmd/check_midnight.php', {
        sid: state.shopId,
      })
    })

  const confirmAlcohol = async () =>
    locker(async () => {
      return await postJSONCommand<{ result: string }>('./src/cmd/put_alcohol.php', {
        sid: state.shopId,
        tno: state.tableNo,
        ssid: state.sessionId ?? '',
      })
    })

  return {
    state,
    getState: () => state,
    setPeopleCount,
    lookupItem,
    addItem,
    removeCartItem,
    clearCart,
    submitOrder,
    goToMenu,
    goToCart,
    goToHistory,
    getAccount,
    getReceipt,
    reorder,
    call,
    callStaff: () => call({ after: false }),
    callDessert: () => call({ after: true }),
    checkOrderStarted,
    checkLastOrder,
    checkMidnight,
    confirmAlcohol,
  }
}
