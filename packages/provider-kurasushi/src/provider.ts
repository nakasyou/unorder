import {
  brand,
  calculateCart,
  ConflictError,
  createProviderInstance,
  defineMethod,
  defineProvider,
  defineStandardMethod,
  InvalidInputError,
  listMenuItems,
  money,
  NotFoundError,
  ProviderError,
  s,
  standardMethodSpecs,
  UnsupportedError,
  validateSchema,
} from '@unorder/core'
import type {
  CartLine,
  CartLineId,
  MenuItem,
  MethodContext,
  MethodDefinition,
  Order,
  OrderId,
  ProviderInstance,
  ProviderCreateOptions,
  ShopId,
  TableId,
} from '@unorder/core'
import { integer, japanTime, processKurasushiQR, record, request, text } from './api'
import { parseKurasushiMenu, parseToppings } from './menu'
import type { KurasushiItem } from './menu'

export interface KurasushiCartLine extends CartLine {
  readonly categoryId: number
  readonly toppings: readonly number[]
}
export interface KurasushiState {
  readonly token: string
  readonly shopId: number
  readonly seatNo: number
  readonly shopName: string
  readonly checkedInAt: string
  readonly openedAt: string
  cart: KurasushiCartLine[]
  orders: Order[]
}
type Config = Record<string, never>
type Context = MethodContext<KurasushiState, Config>
const nonnegative = s.integer({ minimum: 0 })
const stateSchema = s.object({
  token: s.string({ minLength: 1 }),
  shopId: nonnegative,
  seatNo: nonnegative,
  shopName: s.string(),
  checkedInAt: s.string({ minLength: 1 }),
  openedAt: s.string({ minLength: 1 }),
  cart: s.array(
    s.object({
      id: s.string(),
      itemId: s.string({ pattern: '^\\d+$' }),
      name: s.string(),
      unitPrice: s.object({ amount: nonnegative, currency: s.string({ enum: ['JPY'] }) }),
      quantity: s.integer({ minimum: 1, maximum: 4 }),
      categoryId: nonnegative,
      toppings: s.array(nonnegative),
      options: s.optional(s.array(s.unknown())),
    }),
  ),
  orders: s.array(standardMethodSpecs['order.send'].output),
})
export const validateKurasushiState = (raw: unknown): KurasushiState => {
  if (validateSchema(stateSchema, raw).length)
    throw new InvalidInputError('Invalid Kurasushi session state')
  return structuredClone(raw) as KurasushiState
}

const api = (ctx: Context, path: string, body?: unknown) =>
  request(ctx.fetch, path, ctx.requireState().token, body)
const menu = async (ctx: Context): Promise<KurasushiItem[]> => {
  const state = ctx.requireState()
  return parseKurasushiMenu(await api(ctx, `menus/v1/${state.shopId}/${state.seatNo}`))
}
const findItem = async (ctx: Context, id: string): Promise<KurasushiItem> => {
  const item = (await menu(ctx)).find((item) => item.id === id)
  if (!item) throw new NotFoundError(`Kurasushi item ${id} not found`)
  return item
}
const detail = async (ctx: Context, item: KurasushiItem) => {
  const state = ctx.requireState()
  const raw = record(await api(ctx, `items/v1/${state.shopId}/${state.seatNo}/${item.id}`))
  // Detail is authoritative for price and current options; itemCode is absent on some responses.
  const toppings = parseToppings(raw.toppings)
  return {
    raw,
    toppings,
    item: { ...item, name: text(raw.name), price: money(integer(raw.price)), raw },
  }
}
const checkSeat = async (ctx: Context) => {
  const state = ctx.requireState()
  const seat = record(await api(ctx, 'seat/status/v1/'))
  if (
    seat.shopId !== state.shopId ||
    seat.seatNo !== state.seatNo ||
    seat.checkedInAt !== state.checkedInAt
  ) {
    throw new ConflictError('Kurasushi table session changed; scan the current QR code')
  }
  if (seat.orderRestriction === 3)
    throw new ConflictError('Kurasushi has restricted ordering for this table')
}

const requireSession = <Input, Output>(
  method: MethodDefinition<KurasushiState, Config, Input, Output>,
): MethodDefinition<KurasushiState, Config, Input, Output> => ({ ...method, session: 'required' })

const methods = {
  'session.open': defineStandardMethod<'session.open', KurasushiState, Config>(
    'session.open',
    async (ctx, input) => {
      if (input.peopleCount !== undefined)
        throw new UnsupportedError('Kurasushi does not support setting party size')
      if (ctx.state)
        throw new ConflictError('Close the existing Kurasushi session before opening another')
      const qrCode = processKurasushiQR(input.qrUrl)
      const now = ctx.now()
      const stamp = japanTime(now)
      const auth = record(
        await request(ctx.fetch, 'auth/web/v1/', '', {
          qrCode,
          checkedInAt: stamp,
          requestedAt: stamp,
          reserve: [],
        }),
      )
      const token = text(auth.accessToken)
      const seat = record(await request(ctx.fetch, 'seat/status/v1/', token))
      const shopId = integer(seat.shopId)
      const seatNo = integer(seat.seatNo)
      if (!shopId || !seatNo)
        throw new UnsupportedError('Only seated Kurasushi sessions are supported')
      const shop = record(await request(ctx.fetch, `shops/v1/${shopId}`, token))
      const openedAt = now.toISOString()
      const shopName = text(shop.name)
      ctx.setState({
        token,
        shopId,
        seatNo,
        shopName,
        checkedInAt: text(seat.checkedInAt),
        openedAt,
        cart: [],
        orders: [],
      })
      return {
        provider: 'kurasushi',
        shop: { id: brand<ShopId>(String(shopId)), name: shopName, brand: 'くら寿司' },
        table: { id: brand<TableId>(String(seatNo)) },
        openedAt,
        updatedAt: openedAt,
      }
    },
  ),
  'session.close': defineStandardMethod<'session.close', KurasushiState, Config>(
    'session.close',
    (ctx) => {
      ctx.setState(null)
      return { closed: true }
    },
  ),
  'menu.list': requireSession(
    defineStandardMethod<'menu.list', KurasushiState, Config>('menu.list', async (ctx, input) =>
      listMenuItems(
        await menu(ctx),
        input,
        { kind: 'dynamic', providerId: 'kurasushi' },
        ctx.now().toISOString(),
      ),
    ),
  ),
  'menu.get': requireSession(
    defineStandardMethod<'menu.get', KurasushiState, Config>(
      'menu.get',
      async (ctx, input): Promise<MenuItem> => {
        const result = await detail(ctx, await findItem(ctx, input.id))
        return {
          ...result.item,
          options: result.toppings.map((t) => ({
            id: String(t.code),
            name: t.name,
            raw: { group: t.group, isDefault: t.isDefault },
          })),
        }
      },
    ),
  ),
  'cart.list': defineStandardMethod<'cart.list', KurasushiState, Config>('cart.list', (ctx) =>
    calculateCart(ctx.requireState().cart),
  ),
  'cart.add': defineStandardMethod<'cart.add', KurasushiState, Config>(
    'cart.add',
    async (ctx, input) => {
      if (input.reorder || input.optionQuantity !== undefined)
        throw new UnsupportedError('Kurasushi reorder and option quantities are unsupported')
      const quantity = input.quantity ?? 1
      if (quantity > 4)
        throw new InvalidInputError('Kurasushi permits at most 4 units per item request')
      const state = ctx.requireState()
      const result = await detail(ctx, await findItem(ctx, input.itemId))
      const picked = new Map(result.toppings.filter((t) => t.isDefault).map((t) => [t.group, t]))
      if (input.optionId !== undefined) {
        const chosen = result.toppings.find((t) => String(t.code) === input.optionId)
        if (!chosen) throw new InvalidInputError('Unknown Kurasushi topping option')
        picked.set(chosen.group, chosen)
      }
      if (new Set(result.toppings.map((t) => t.group)).size !== picked.size)
        throw new InvalidInputError('Select the required Kurasushi topping option')
      const line: KurasushiCartLine = {
        id: brand<CartLineId>(crypto.randomUUID()),
        itemId: result.item.id,
        name: result.item.name,
        unitPrice: result.item.price,
        quantity,
        categoryId: result.item.extensions.categoryId,
        toppings: [...picked.values()].map((t) => t.code),
        options: [...picked.values()].map((t) => ({
          optionId: String(t.code),
          name: t.name,
          quantity: 1,
        })),
      }
      ctx.setState({ ...state, cart: [...state.cart, line] })
      return calculateCart(ctx.requireState().cart)
    },
  ),
  'cart.remove': defineStandardMethod<'cart.remove', KurasushiState, Config>(
    'cart.remove',
    (ctx, input) => {
      const state = ctx.requireState()
      const index =
        input.lineId === undefined
          ? input.index
          : state.cart.findIndex((line) => line.id === input.lineId)
      if (index === undefined || index < 0 || index >= state.cart.length)
        throw new NotFoundError('Kurasushi cart line not found')
      ctx.setState({ ...state, cart: state.cart.filter((_, i) => i !== index) })
      return calculateCart(ctx.requireState().cart)
    },
  ),
  'cart.clear': defineStandardMethod<'cart.clear', KurasushiState, Config>('cart.clear', (ctx) => {
    ctx.setState({ ...ctx.requireState(), cart: [] })
    return calculateCart([])
  }),
  'order.send': defineStandardMethod<'order.send', KurasushiState, Config>(
    'order.send',
    async (ctx, input) => {
      if (input.note !== undefined)
        throw new UnsupportedError('Kurasushi does not accept order notes')
      const initial = ctx.requireState()
      if (!initial.cart.length) throw new InvalidInputError('Kurasushi cart is empty')
      if (initial.orders.some((order) => order.status === 'unknown'))
        throw new ConflictError(
          'An earlier order has an unknown result; inspect table history before starting a new session',
        )
      await checkSeat(ctx)
      const submitted: Order[] = []
      for (const line of initial.cart) {
        const state = ctx.requireState()
        if (!state.cart.some((current) => current.id === line.id))
          throw new ConflictError('Kurasushi cart changed during submission')
        const stamp = japanTime(ctx.now())
        const pending: Order = {
          id: brand<OrderId>(crypto.randomUUID()),
          status: 'unknown',
          lines: [
            {
              itemId: line.itemId,
              name: line.name,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              total: money(line.unitPrice.amount * line.quantity),
              options: line.options,
            },
          ],
          itemCount: line.quantity,
          total: money(line.unitPrice.amount * line.quantity),
          submittedAt: ctx.now().toISOString(),
        }
        // Claim the line before yielding to fetch. An uncertain response must not resend it.
        ctx.setState({
          ...state,
          cart: state.cart.filter((current) => current.id !== line.id),
          orders: [...state.orders, pending],
        })
        const response = record(
          await api(ctx, `add/v1/${state.shopId}/${state.seatNo}`, {
            itemCode: line.itemId,
            toppings: line.toppings,
            quantity: line.quantity,
            influxType: 0,
            influxSource: line.categoryId,
            orderedAt: stamp,
            requestedAt: stamp,
            reserve: [],
          }),
        )
        if (response.result !== 1) {
          // Only documented rejection codes establish that the request did not order food.
          if ([2, 3, 4].includes(response.result as number)) {
            const current = ctx.requireState()
            ctx.setState({
              ...current,
              cart: [line, ...current.cart],
              orders: current.orders.filter((order) => order.id !== pending.id),
            })
          }
          throw new ProviderError('Kurasushi did not confirm the order', {
            details: {
              result: typeof response.result === 'number' ? response.result : null,
              submittedOrderIds: submitted.map((order) => order.id),
            },
          })
        }
        const confirmed: Order = { ...pending, status: 'submitted' }
        const current = ctx.requireState()
        ctx.setState({
          ...current,
          orders: current.orders.map((order) => (order.id === pending.id ? confirmed : order)),
        })
        submitted.push(confirmed)
      }
      return {
        id: brand<OrderId>(submitted.map((order) => order.id).join(',')),
        status: 'submitted',
        lines: submitted.flatMap((order) => order.lines),
        itemCount: submitted.reduce((n, order) => n + order.itemCount, 0),
        total: money(submitted.reduce((n, order) => n + order.total.amount, 0)),
        submittedAt: ctx.now().toISOString(),
      }
    },
  ),
  'order.list': defineStandardMethod<'order.list', KurasushiState, Config>(
    'order.list',
    (ctx, input) => ({
      orders: ctx
        .requireState()
        .orders.slice()
        .reverse()
        .slice(0, input.limit ?? 100),
    }),
  ),
  'history.get': defineMethod<
    KurasushiState,
    Config,
    Record<string, never>,
    { list: readonly unknown[] }
  >({
    name: 'history.get',
    summary: 'Read the whole table order history.',
    description:
      'Reads upstream table history, including orders from other terminals. Does not initiate checkout.',
    input: s.object({}),
    output: s.object({ list: s.array(s.unknown()) }),
    session: 'required',
    annotations: { readOnlyHint: true },
    async handler(ctx) {
      const state = ctx.requireState()
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(state.checkedInAt))
        throw new ProviderError('Invalid Kurasushi check-in time')
      const query = new URLSearchParams({
        shopId: String(state.shopId),
        seatNo: String(state.seatNo),
        checkedInAt: state.checkedInAt.replace(/[- :]/g, ''),
      })
      const response = record(await api(ctx, `histories/v1/?${query}`))
      if (!Array.isArray(response.list)) throw new ProviderError('Invalid Kurasushi history')
      return { list: response.list }
    },
  }),
}
const definition = defineProvider<'kurasushi', KurasushiState, Config, typeof methods>({
  id: 'kurasushi',
  displayName: 'くら寿司',
  description: 'Unofficial Kurasushi EPARK smart ordering.',
  stateVersion: 1,
  menus: 'dynamic',
  methods,
  validateState: validateKurasushiState,
})
export type KurasushiCreateOptions = ProviderCreateOptions<Config>
export const createKurasushi = (
  options: KurasushiCreateOptions = {},
): ProviderInstance<typeof methods> => {
  let queue: Promise<unknown> = Promise.resolve()
  const serialize = <Input, Output>(
    method: MethodDefinition<KurasushiState, Config, Input, Output>,
  ) => ({
    ...method,
    handler(ctx: Context, input: Input): Promise<Output> {
      const result = queue.then(() => method.handler(ctx, input))
      queue = result.catch(() => undefined)
      return result
    },
  })
  const locked = Object.fromEntries(
    Object.entries(methods).map(([name, method]) => [
      name,
      serialize(method as unknown as MethodDefinition<KurasushiState, Config, never, unknown>),
    ]),
  ) as typeof methods
  return createProviderInstance({ ...definition, methods: locked }, options)
}
