import {
  AuthRequiredError,
  brand,
  calculateCart,
  createProviderInstance,
  defineProvider,
  defineStandardMethod,
  InvalidInputError,
  listMenuItems,
  money,
  NotFoundError,
  s,
  UnsupportedError,
} from '@unorder/core'
import type {
  Bill,
  Cart,
  CartLine,
  CartLineId,
  MenuItem,
  MenuItemId,
  Order,
  OrderId,
  OrderLine,
  OrderValidation,
  ProviderCreateOptions,
  ProviderInstance,
  Receipt,
  Session,
  SessionId,
  ShopId,
  TableId,
  MethodContext,
  MethodMap,
  StandardInput,
} from '@unorder/core'
import { createInternalSaizeriyaClient, openSaizeriyaState } from './client'
import { findMenuItem, loadSaizeriyaMenu } from './menu'
import type {
  AccountSummary,
  ItemData,
  PageKind,
  SaizeriyaCartLine,
  SaizeriyaProviderConfig,
  SaizeriyaState,
} from './types'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const pageKinds = new Set<PageKind>([
  'entry',
  'top',
  'number',
  'menu',
  'main',
  'history',
  'call',
  'account',
  'receipt',
  'unknown',
])

const asPageKind = (value: unknown): PageKind =>
  typeof value === 'string' && pageKinds.has(value as PageKind) ? (value as PageKind) : 'unknown'

const sanitizeCartLine = (value: unknown, index: number): SaizeriyaCartLine => {
  if (!isRecord(value)) {
    throw new InvalidInputError(`Invalid cart line at index ${index}`)
  }
  const id = value.id
  const count = value.count
  if (
    typeof id !== 'string' ||
    typeof count !== 'number' ||
    !Number.isInteger(count) ||
    count < 1
  ) {
    throw new InvalidInputError(`Invalid cart line at index ${index}`)
  }
  return {
    id,
    count,
    reorder: value.reorder === 1 ? 1 : 0,
    modId: typeof value.modId === 'string' ? value.modId : '',
    modCount:
      typeof value.modCount === 'number' && Number.isInteger(value.modCount) ? value.modCount : '',
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(typeof value.price === 'number' ? { price: value.price } : {}),
  }
}

/** Validates and normalizes a persisted state envelope. */
export const validateSaizeriyaState = (raw: unknown): SaizeriyaState => {
  if (!isRecord(raw)) {
    throw new InvalidInputError('Saizeriya session state must be an object')
  }
  const { baseUrl, nextId, shopId, tableNo, peopleCount, openedAt } = raw
  if (
    typeof baseUrl !== 'string' ||
    typeof nextId !== 'string' ||
    typeof shopId !== 'number' ||
    typeof tableNo !== 'number' ||
    typeof peopleCount !== 'number' ||
    typeof openedAt !== 'string'
  ) {
    throw new InvalidInputError('Saizeriya session state is missing required fields')
  }
  if (!Array.isArray(raw.cart) || !Array.isArray(raw.orders)) {
    throw new InvalidInputError('Saizeriya session state has invalid cart or order lists')
  }
  const cookies: Record<string, string> = {}
  if (isRecord(raw.cookies)) {
    for (const [key, value] of Object.entries(raw.cookies)) {
      if (typeof value === 'string') {
        cookies[key] = value
      }
    }
  }

  return {
    baseUrl,
    nextId,
    shopId,
    tableNo,
    peopleCount,
    page: asPageKind(raw.page),
    cart: raw.cart.map(sanitizeCartLine),
    orders: raw.orders.map((batch, batchIndex) => {
      if (!Array.isArray(batch)) {
        throw new InvalidInputError(`Invalid order batch at index ${batchIndex}`)
      }
      return batch.map(sanitizeCartLine)
    }),
    cookies,
    openedAt,
    ...(typeof raw.token === 'string' ? { token: raw.token } : {}),
    ...(typeof raw.sessionId === 'string' ? { sessionId: raw.sessionId } : {}),
  }
}

const cartLineId = (line: SaizeriyaCartLine, index: number): CartLineId =>
  brand<CartLineId>(`${line.id}:${line.modId}:${index}`)

const toCartLine = (line: SaizeriyaCartLine, index: number): CartLine => ({
  id: cartLineId(line, index),
  itemId: brand<MenuItemId>(line.id),
  name: line.name ?? `Item ${line.id}`,
  unitPrice: money(line.price ?? 0),
  quantity: line.count,
  ...(line.modId
    ? {
        options: [
          {
            optionId: line.modId,
            quantity: typeof line.modCount === 'number' ? line.modCount : 0,
          },
        ],
      }
    : {}),
  reorder: line.reorder === 1,
  raw: line,
})

const toCart = (state: SaizeriyaState): Cart =>
  calculateCart(state.cart.map((line, index) => toCartLine(line, index)))

const toOrder = (
  state: SaizeriyaState,
  batch: readonly SaizeriyaCartLine[],
  index: number,
): Order => {
  const lines: OrderLine[] = batch.map((line, lineIndex) => ({
    itemId: brand<MenuItemId>(line.id),
    name: line.name ?? `Item ${line.id}`,
    quantity: line.count,
    unitPrice: money(line.price ?? 0),
    total: money((line.price ?? 0) * line.count),
    ...(line.modId
      ? {
          options: [
            {
              optionId: line.modId,
              quantity: typeof line.modCount === 'number' ? line.modCount : 0,
            },
          ],
        }
      : {}),
    reorder: line.reorder === 1,
    raw: { ...line, index: lineIndex },
  }))
  return {
    id: brand<OrderId>(`${state.openedAt}:${index + 1}`),
    status: 'submitted',
    lines,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    total: lines.reduce(
      (sum, line) => money(sum.amount + line.total.amount, sum.currency),
      money(0),
    ),
    raw: { batch: index },
  }
}

const toBill = (account: AccountSummary): Bill => ({
  lines: account.lines.map((line) => ({
    name: line.name,
    quantity: line.count,
    total: money(line.price),
    raw: line,
  })),
  itemCount: account.count,
  total: money(account.total),
  ...(account.controlNo ? { controlNo: account.controlNo } : {}),
  ...(account.dummyNo ? { dummyNo: account.dummyNo } : {}),
  raw: account,
})

const toReceipt = (
  state: SaizeriyaState,
  receipt: { barcodeValue?: string; barcodeImageSrc?: string },
  account: AccountSummary,
): Receipt => ({
  ...(receipt.barcodeValue ? { barcodeValue: receipt.barcodeValue } : {}),
  ...(receipt.barcodeImageSrc ? { barcodeImageUrl: receipt.barcodeImageSrc } : {}),
  tableId: brand<TableId>(String(state.tableNo)),
  total: money(account.total),
  raw: receipt,
})

const toSession = (state: SaizeriyaState, now: Date): Session => ({
  provider: 'saizeriya',
  ...(state.sessionId ? { sessionId: brand<SessionId>(state.sessionId) } : {}),
  shop: { id: brand<ShopId>(String(state.shopId)), brand: 'saizeriya' },
  table: { id: brand<TableId>(String(state.tableNo)) },
  peopleCount: state.peopleCount,
  page: state.page,
  openedAt: state.openedAt,
  updatedAt: now.toISOString(),
  raw: { baseUrl: state.baseUrl },
})

const clientFor = (context: {
  state: SaizeriyaState | null
  config: SaizeriyaProviderConfig
  fetch: typeof globalThis.fetch
  now: () => Date
}) => {
  if (!context.state) {
    throw new InvalidInputError('Saizeriya session is not open')
  }
  return createInternalSaizeriyaClient({
    state: context.state,
    fetch: context.fetch,
    now: context.now,
    language: context.config.language ?? '1',
  })
}

const itemFromData = (data: ItemData): MenuItem => ({
  id: brand<MenuItemId>(data.id),
  name: data.name,
  price: money(data.price),
  tags: [],
  availability: data.state === 2 ? 'available' : data.state === 0 ? 'sold_out' : 'unknown',
  source: 'dynamic',
  raw: data,
})

const validateOrder = async (
  ctx: MethodContext<SaizeriyaState, SaizeriyaProviderConfig>,
  input: StandardInput<'order.validate'>,
): Promise<OrderValidation> => {
  const client = clientFor(ctx)
  const [orderStarted, lastOrder, midnight] = await Promise.all([
    client.checkOrderStarted(),
    client.checkLastOrder(),
    client.checkMidnight(),
  ])
  const checks = {
    orderingStarted: orderStarted.result === 'OK',
    lastOrderClosed: lastOrder.result === 'OK' || lastOrder.lastorder === true,
    midnightCharge: midnight.result === 'OK',
  }
  const issues = [
    ...(checks.orderingStarted ? [] : ['ordering_not_started']),
    ...(checks.lastOrderClosed ? ['last_order_closed'] : []),
    ...(checks.midnightCharge ? ['midnight_charge'] : []),
  ]
  return {
    ok: issues.length === 0,
    issues,
    checks,
    raw: { orderStarted, lastOrder, midnight, itemIds: input.itemIds ?? [] },
  }
}

const methods = {
  'session.open': defineStandardMethod<'session.open', SaizeriyaState, SaizeriyaProviderConfig>(
    'session.open',
    async (ctx, input) => {
      let url: URL
      try {
        url = new URL(input.qrUrl)
      } catch {
        throw new InvalidInputError('qrUrl must be an absolute URL')
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new InvalidInputError('qrUrl must use http or https')
      }

      const state = await openSaizeriyaState({
        qrUrl: url.toString(),
        ...(input.peopleCount === undefined ? {} : { peopleCount: input.peopleCount }),
        fetch: ctx.fetch,
        now: ctx.now,
      })
      ctx.setState(state)
      return toSession(state, ctx.now())
    },
  ),
  'session.close': defineStandardMethod<'session.close', SaizeriyaState, SaizeriyaProviderConfig>(
    'session.close',
    (ctx) => {
      ctx.setState(null)
      return { closed: true }
    },
  ),
  'session.update': defineStandardMethod<'session.update', SaizeriyaState, SaizeriyaProviderConfig>(
    'session.update',
    async (ctx, input) => {
      if (input.tableId !== undefined) {
        throw new UnsupportedError(
          'Saizeriya reads the table id from the QR URL; it cannot be changed',
        )
      }
      if (input.peopleCount === undefined) {
        throw new InvalidInputError('session.update requires peopleCount for Saizeriya')
      }
      const state = await clientFor(ctx).setPeopleCount(input.peopleCount)
      return toSession(state, ctx.now())
    },
  ),
  'menu.list': defineStandardMethod<'menu.list', SaizeriyaState, SaizeriyaProviderConfig>(
    'menu.list',
    async (ctx, input) => {
      const menu = await loadSaizeriyaMenu({
        config: ctx.config,
        fetch: ctx.fetch,
        now: ctx.now,
        ...(input.refresh ? { refresh: true } : {}),
      })
      return listMenuItems(menu.items, input, menu.source, menu.fetchedAt)
    },
  ),
  'menu.get': defineStandardMethod<'menu.get', SaizeriyaState, SaizeriyaProviderConfig>(
    'menu.get',
    async (ctx, input) => {
      if (!input.live) {
        return await findMenuItem({
          config: ctx.config,
          fetch: ctx.fetch,
          now: ctx.now,
          id: input.id,
        })
      }
      if (!ctx.state) {
        throw new AuthRequiredError('menu.get with live=true requires an open session')
      }
      const result = await clientFor(ctx).lookupItem(input.id)
      if (result.result !== 'OK' || !result.item_data) {
        throw new NotFoundError(`Item ${input.id} was not found`)
      }
      return itemFromData(result.item_data)
    },
  ),
  'cart.list': defineStandardMethod<'cart.list', SaizeriyaState, SaizeriyaProviderConfig>(
    'cart.list',
    (ctx) => toCart(ctx.requireState()),
  ),
  'cart.add': defineStandardMethod<'cart.add', SaizeriyaState, SaizeriyaProviderConfig>(
    'cart.add',
    async (ctx, input) => {
      const client = clientFor(ctx)
      await client.addItem(input.itemId, {
        ...(input.quantity === undefined ? {} : { count: input.quantity }),
        ...(input.optionId === undefined ? {} : { modId: input.optionId }),
        ...(input.optionQuantity === undefined ? {} : { modCount: input.optionQuantity }),
        ...(input.reorder === undefined ? {} : { reorder: input.reorder }),
      })
      return toCart(ctx.requireState())
    },
  ),
  'cart.remove': defineStandardMethod<'cart.remove', SaizeriyaState, SaizeriyaProviderConfig>(
    'cart.remove',
    (ctx, input) => {
      const state = ctx.requireState()
      let index = input.index
      if (input.lineId !== undefined) {
        index = state.cart.findIndex(
          (line, lineIndex) => cartLineId(line, lineIndex) === input.lineId,
        )
        if (index === -1) {
          throw new NotFoundError(`Cart line "${input.lineId}" was not found`)
        }
      }
      if (index === undefined) {
        throw new InvalidInputError('cart.remove requires index or lineId')
      }
      clientFor(ctx).removeCartItem(index)
      return toCart(ctx.requireState())
    },
  ),
  'cart.clear': defineStandardMethod<'cart.clear', SaizeriyaState, SaizeriyaProviderConfig>(
    'cart.clear',
    (ctx) => {
      clientFor(ctx).clearCart()
      return toCart(ctx.requireState())
    },
  ),
  'order.send': defineStandardMethod<'order.send', SaizeriyaState, SaizeriyaProviderConfig>(
    'order.send',
    async (ctx) => {
      const state = ctx.requireState()
      await clientFor(ctx).submitOrder()
      const batch = state.orders.at(-1)
      if (!batch) {
        throw new InvalidInputError('No submitted order was recorded')
      }
      return toOrder(state, batch, state.orders.length - 1)
    },
  ),
  'order.list': defineStandardMethod<'order.list', SaizeriyaState, SaizeriyaProviderConfig>(
    'order.list',
    (ctx, input) => {
      const state = ctx.requireState()
      const limit = input.limit ?? 20
      const start = Math.max(0, state.orders.length - limit)
      return {
        orders: state.orders
          .slice(start)
          .map((batch, index) => toOrder(state, batch, start + index)),
      }
    },
  ),
  'bill.get': defineStandardMethod<'bill.get', SaizeriyaState, SaizeriyaProviderConfig>(
    'bill.get',
    async (ctx) => {
      const result = await clientFor(ctx).getAccount()
      return toBill(result.account)
    },
  ),
  'staff.call': defineStandardMethod<'staff.call', SaizeriyaState, SaizeriyaProviderConfig>(
    'staff.call',
    async (ctx, input) => {
      const after = input.after ?? false
      const result = await clientFor(ctx).call({ after })
      return { ok: result.result === 'OK', target: after ? ('after' as const) : ('staff' as const) }
    },
  ),
  'receipt.get': defineStandardMethod<'receipt.get', SaizeriyaState, SaizeriyaProviderConfig>(
    'receipt.get',
    async (ctx) => {
      const result = await clientFor(ctx).getReceipt()
      return toReceipt(result.state, result.receipt, result.account)
    },
  ),
  'order.reorder': defineStandardMethod<'order.reorder', SaizeriyaState, SaizeriyaProviderConfig>(
    'order.reorder',
    async (ctx, input) => {
      const client = clientFor(ctx)
      await client.reorder(input.itemId)
      await client.addItem(input.itemId, {
        ...(input.quantity === undefined ? {} : { count: input.quantity }),
        ...(input.optionId === undefined ? {} : { modId: input.optionId }),
        ...(input.optionQuantity === undefined ? {} : { modCount: input.optionQuantity }),
        reorder: true,
      })
      return toCart(ctx.requireState())
    },
  ),
  'cart.validate': defineStandardMethod<'cart.validate', SaizeriyaState, SaizeriyaProviderConfig>(
    'cart.validate',
    (ctx, input) => validateOrder(ctx, input),
  ),
  'order.validate': defineStandardMethod<'order.validate', SaizeriyaState, SaizeriyaProviderConfig>(
    'order.validate',
    (ctx, input) => validateOrder(ctx, input),
  ),
} satisfies MethodMap<SaizeriyaState, SaizeriyaProviderConfig>

const saizeriyaDefinition = defineProvider<
  'saizeriya',
  SaizeriyaState,
  SaizeriyaProviderConfig,
  typeof methods
>({
  id: 'saizeriya',
  displayName: 'Saizeriya',
  description:
    'Unofficial Saizeriya mobile-ordering provider. Static menu snapshots come from this repository; ordering uses the official form endpoints.',
  version: '0.1.0',
  stateVersion: 1,
  menus: 'static',
  defaultConfig: { language: '1' },
  config: s.object({
    menuUrl: s.optional(s.anyOf([s.string({ format: 'uri' }), s.null()])),
    menuFile: s.optional(s.string()),
    menuItems: s.optional(s.array(s.unknown())),
    language: s.optional(s.string()),
    userAgent: s.optional(s.string()),
  }),
  validateState: validateSaizeriyaState,
  serializeState: (state) => state,
  methods,
})

export type SaizeriyaCreateOptions = ProviderCreateOptions<SaizeriyaProviderConfig>

const isCreateOptions = (
  value: SaizeriyaProviderConfig | SaizeriyaCreateOptions,
): value is SaizeriyaCreateOptions =>
  'config' in value || 'fetch' in value || 'now' in value || 'session' in value

/**
 * Creates a Saizeriya provider instance. The returned object exposes only
 * `call`; use core helpers such as `createClient` for typed nested calls.
 *
 * Accepts either provider config directly (`createSaizeriya({ menuFile })`) or
 * core create options (`createSaizeriya({ config, fetch, session })`). A second
 * argument can supply runtime options alongside a plain config.
 */
export const createSaizeriya = (
  configOrOptions: SaizeriyaProviderConfig | SaizeriyaCreateOptions = {},
  options: SaizeriyaCreateOptions = {},
): ProviderInstance<typeof methods> => {
  const base = isCreateOptions(configOrOptions) ? configOrOptions : { config: configOrOptions }
  return createProviderInstance(saizeriyaDefinition, {
    ...base,
    ...options,
    config: { ...base.config, ...options.config },
  })
}
