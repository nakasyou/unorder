import {
  brand,
  calculateCart,
  defineMethod,
  defineProvider,
  defineStandardMethod,
  InvalidInputError,
  listMenuItems,
  money,
  NotFoundError,
  s,
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
  Receipt,
  Session,
  SessionId,
  ShopId,
  TableId,
  MethodMap,
} from '@unorder/core'
import { createSaizeriyaClient, openSaizeriyaState } from './client'
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
  extensions: { baseUrl: state.baseUrl },
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
  return createSaizeriyaClient({
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

const peopleInputSchema = s.object({ peopleCount: s.integer({ minimum: 1, maximum: 99 }) })
const itemLookupInputSchema = s.object({ itemId: s.string() })
const checkOutputSchema = s.object({
  result: s.string(),
  active: s.boolean(),
  lastorder: s.optional(s.boolean()),
})

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
  'session.export': defineStandardMethod<'session.export', SaizeriyaState, SaizeriyaProviderConfig>(
    'session.export',
    (ctx) => ctx.exportSession(),
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
    async (ctx, input) =>
      await findMenuItem({
        config: ctx.config,
        fetch: ctx.fetch,
        now: ctx.now,
        id: input.id,
      }),
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
  'x-saizeriya.people.set': defineMethod<
    SaizeriyaState,
    SaizeriyaProviderConfig,
    { peopleCount: number },
    Session
  >({
    name: 'x-saizeriya.people.set',
    summary: 'Set the party size (Saizeriya-specific).',
    description:
      'Changes the party size after a session is open. In a live session this may finalize or lock the table party size, so treat it as approval-required.',
    input: peopleInputSchema,
    output: s.unknown(),
    session: 'required',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: async (ctx, input) => {
      const state = ctx.requireState()
      await clientFor(ctx).setPeopleCount(input.peopleCount)
      return toSession(state, ctx.now())
    },
  }),
  'x-saizeriya.item.lookup': defineMethod<
    SaizeriyaState,
    SaizeriyaProviderConfig,
    { itemId: string },
    { found: boolean; item?: MenuItem }
  >({
    name: 'x-saizeriya.item.lookup',
    summary: 'Look up a live item code (Saizeriya-specific).',
    description:
      'Queries the provider item endpoint for availability without adding the item to the cart.',
    input: itemLookupInputSchema,
    output: s.object({ found: s.boolean(), item: s.optional(s.unknown()) }),
    session: 'required',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (ctx, input) => {
      const result = await clientFor(ctx).lookupItem(input.itemId)
      if (result.result !== 'OK' || !result.item_data) {
        return { found: false }
      }
      return { found: true, item: itemFromData(result.item_data) }
    },
  }),
  'x-saizeriya.history.reorder': defineMethod<
    SaizeriyaState,
    SaizeriyaProviderConfig,
    { itemId: string },
    Session
  >({
    name: 'x-saizeriya.history.reorder',
    summary: 'Open the reorder flow for a historical item (Saizeriya-specific).',
    description:
      'Navigates to the menu page with the reorder action. It does not add an item or submit an order by itself.',
    input: itemLookupInputSchema,
    output: s.unknown(),
    session: 'required',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: async (ctx, input) => {
      const state = ctx.requireState()
      await clientFor(ctx).reorder(input.itemId)
      return toSession(state, ctx.now())
    },
  }),
  'x-saizeriya.check.order': defineMethod<
    SaizeriyaState,
    SaizeriyaProviderConfig,
    Record<string, never>,
    { result: string; active: boolean }
  >({
    name: 'x-saizeriya.check.order',
    summary: 'Check whether ordering has started (Saizeriya-specific).',
    description: 'Calls check_order.php and reports whether the order session is active.',
    input: s.object({}),
    output: checkOutputSchema,
    session: 'required',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (ctx) => {
      const result = await clientFor(ctx).checkOrderStarted()
      return { result: result.result, active: result.result === 'OK' }
    },
  }),
  'x-saizeriya.check.last-order': defineMethod<
    SaizeriyaState,
    SaizeriyaProviderConfig,
    Record<string, never>,
    { result: string; active: boolean; lastorder?: boolean }
  >({
    name: 'x-saizeriya.check.last-order',
    summary: 'Check the last-order state (Saizeriya-specific).',
    description: 'Calls check_lastorder.php and reports whether normal ordering is closed.',
    input: s.object({}),
    output: checkOutputSchema,
    session: 'required',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (ctx) => {
      const result = await clientFor(ctx).checkLastOrder()
      return {
        result: result.result,
        active: result.result === 'OK',
        ...(result.lastorder === undefined ? {} : { lastorder: result.lastorder }),
      }
    },
  }),
  'x-saizeriya.check.midnight': defineMethod<
    SaizeriyaState,
    SaizeriyaProviderConfig,
    Record<string, never>,
    { result: string; active: boolean }
  >({
    name: 'x-saizeriya.check.midnight',
    summary: 'Check the midnight-charge notice (Saizeriya-specific).',
    description: 'Calls check_midnight.php and reports whether the extra-charge notice applies.',
    input: s.object({}),
    output: checkOutputSchema,
    session: 'required',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (ctx) => {
      const result = await clientFor(ctx).checkMidnight()
      return { result: result.result, active: result.result === 'OK' }
    },
  }),
  'x-saizeriya.alcohol.confirm': defineMethod<
    SaizeriyaState,
    SaizeriyaProviderConfig,
    Record<string, never>,
    { ok: boolean }
  >({
    name: 'x-saizeriya.alcohol.confirm',
    summary: 'Acknowledge the restricted-item confirmation (Saizeriya-specific).',
    description: 'Calls put_alcohol.php for age-restricted items.',
    input: s.object({}),
    output: s.object({ ok: s.boolean() }),
    session: 'required',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: async (ctx) => {
      const result = await clientFor(ctx).confirmAlcohol()
      return { ok: result.result === 'OK' }
    },
  }),
} satisfies MethodMap<SaizeriyaState, SaizeriyaProviderConfig>

export const saizeriya = defineProvider<
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
  methods,
})
