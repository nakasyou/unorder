import {
  AuthRequiredError, brand, calculateCart, ConflictError, createProviderInstance,
  defineProvider, defineMethod, defineStandardMethod, InvalidInputError, listMenuItems,
  money, NotFoundError, ProviderError, s, standardMethodSpecs,
  UnsupportedError, validateSchema,
} from '@unorder/core'
import type {
  CartLine, CartLineId, MenuItem, Order, OrderId, ProviderCreateOptions,
  ShopId, TableId, MethodDefinition,
} from '@unorder/core'
import { parseSushiroEntryURL, parseSushiroSessionURL, sushiroConfig, sushiroStart, sushiroRequest } from './api'
import { parseSushiroMenu } from './menu'
import { parseSushiroOrderDetail } from './detail'

interface SushiroLine extends CartLine {
  readonly additionalInfo: readonly { additional_info_index: number; additional_info_id: number }[]
}

export interface SushiroState {
  readonly token: string
  readonly shopId: number
  readonly tableId: number
  readonly shopName: string
  readonly openedAt: string
  readonly cart: readonly SushiroLine[]
  readonly orders: readonly Order[]
}
type Config = Record<string, never>
const nonnegative = s.integer({ minimum: 0 })
const stateSchema = s.object({
  token: s.string({ minLength: 8 }),
  shopId: nonnegative,
  tableId: nonnegative,
  shopName: s.string(),
  openedAt: s.string(),
  cart: s.array(s.object({
    id: s.string(), itemId: s.string(), name: s.string(),
    unitPrice: s.object({ amount: nonnegative, currency: s.string({ enum: ['JPY'] }) }),
    quantity: s.integer({ minimum: 1 }),
    additionalInfo: s.array(s.object({
      additional_info_index: nonnegative,
      additional_info_id: nonnegative,
    })),
    options: s.optional(s.array(s.unknown())),
  })),
  orders: s.array(standardMethodSpecs['order.send'].output),
})
export const validateSushiroState = (raw: unknown): SushiroState => {
  if (validateSchema(stateSchema, raw).length)
    throw new InvalidInputError('Invalid Sushiro session state')
  return structuredClone(raw) as SushiroState
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ProviderError('Invalid Sushiro API response')
  return value as Record<string, unknown>
}
const integer = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new ProviderError('Invalid Sushiro integer field')
  return value
}
const name = (value: unknown): string => {
  if (typeof value !== 'string') throw new ProviderError('Invalid Sushiro shop name')
  return value
}

const requireSession = <Input, Output>(method: MethodDefinition<SushiroState, Config, Input, Output>): MethodDefinition<SushiroState, Config, Input, Output> => ({ ...method, session: 'required' })

const methods = {
  'session.open': defineStandardMethod<'session.open', SushiroState, Config>(
    'session.open', async (ctx, input) => {
      if (input.peopleCount !== undefined) throw new UnsupportedError('Sushiro does not support party-size changes')
      if (ctx.state) throw new ConflictError('Close the current Sushiro session first')
      // Two distinct entry forms: the real opaque QR URL and a manually supplied token URL.
      // No cookies or redirects were observed in either captured HAR.
      let token: string
      let expectedShopId: number | undefined
      let expectedTableId: number | undefined
      if (new URL(input.qrUrl).searchParams.has('token')) {
        token = parseSushiroSessionURL(input.qrUrl)
      } else {
        const entry = parseSushiroEntryURL(input.qrUrl)
        const config = record(await sushiroConfig(ctx.fetch, entry))
        const configuration = record(config.session)
        if (configuration.enable_cms_order !== true || configuration.is_last_order_passed === true)
          throw new ConflictError('Sushiro QR session is not available for starting')
        expectedShopId = integer(record(config.shop).id)
        expectedTableId = integer(record(config.table).id)
        // This is not a read-only operation: the upstream website starts a device session.
        // Do not retry after an ambiguous failure; token is only trusted after validation.
        const started = record(await sushiroStart(ctx.fetch, entry))
        if (typeof started.token !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(started.token))
          throw new ProviderError('Sushiro start did not provide a recognized session token')
        token = started.token
      }
      const response = record(await sushiroRequest(ctx.fetch, '/v1/session', token))
      const session = record(response.session)
      if (session.token !== token) throw new AuthRequiredError('Sushiro token mismatch')
      if (session.enable_order !== true || session.is_checked_out === true)
        throw new ConflictError('Sushiro session is not open for ordering')
      const shop = record(response.shop)
      const table = record(response.table)
      const shopId = integer(shop.id), tableId = integer(table.id)
      if ((expectedShopId !== undefined && shopId !== expectedShopId) ||
          (expectedTableId !== undefined && tableId !== expectedTableId))
        throw new ConflictError('Sushiro QR configuration and started session refer to different tables')
      const shopName = name(shop.name)
      const openedAt = ctx.now().toISOString()
      ctx.setState({ token, shopId, tableId, shopName, openedAt, cart: [], orders: [] })
      return {
        provider: 'sushiro',
        shop: { id: brand<ShopId>(String(shopId)), name: shopName, brand: 'スシロー' },
        table: { id: brand<TableId>(String(tableId)) },
        openedAt, updatedAt: openedAt,
      }
    }),
  'session.close': defineStandardMethod<'session.close', SushiroState, Config>(
    'session.close', (ctx) => { ctx.setState(null); return { closed: true } }),
  'menu.list': requireSession(defineStandardMethod<'menu.list', SushiroState, Config>(
    'menu.list', async (ctx, input) => {
      const state = ctx.requireState()
      const items = parseSushiroMenu(await sushiroRequest(ctx.fetch, '/v1/menu', state.token))
      return listMenuItems(items, input, { kind: 'dynamic', providerId: 'sushiro' }, ctx.now().toISOString())
    })),
  'menu.get': requireSession(defineStandardMethod<'menu.get', SushiroState, Config>(
    'menu.get', async (ctx, input): Promise<MenuItem> => {
      const state = ctx.requireState()
      const item = parseSushiroMenu(await sushiroRequest(ctx.fetch, '/v1/menu', state.token)).find((item) => item.id === input.id)
      if (!item) throw new NotFoundError('Sushiro menu item not found')
      return item
    })),
  'cart.list': defineStandardMethod<'cart.list', SushiroState, Config>(
    'cart.list', (ctx) => calculateCart(ctx.requireState().cart)),
  'cart.add': defineStandardMethod<'cart.add', SushiroState, Config>(
    'cart.add', async (ctx, input) => {
      if (input.reorder || input.optionQuantity !== undefined)
        throw new UnsupportedError('Sushiro reorder/option quantity is unsupported')
      const state = ctx.requireState()
      const item = parseSushiroMenu(await sushiroRequest(ctx.fetch, '/v1/menu', state.token)).find((it) => it.id === input.itemId)
      if (!item) throw new NotFoundError('Sushiro menu item not found')
      if (item.availability !== 'available') throw new ConflictError('Sushiro item is not available')
      const quantity = input.quantity ?? 1
      const remaining = item.extensions?.remainingQuantity
      if (typeof remaining === 'number' && quantity > remaining) throw new ConflictError('Sushiro quantity exceeds remaining stock')
      const maxQuantity = item.extensions?.maxQuantity
      if (typeof maxQuantity === 'number' && quantity > maxQuantity) throw new ConflictError('Sushiro maximum orderable quantity exceeded')
      const limit = item.extensions?.orderLimit
      if (typeof limit === 'number' && limit > 0 && quantity > limit) throw new InvalidInputError('Sushiro per-item order limit exceeded')
      const defaults = item.extensions?.defaults as Record<string, unknown> | undefined
      const picks = Object.entries(defaults ?? {}).map(([group, value]) => ({ group, index: String(value) }))
      if (input.optionId !== undefined) {
        const match = item.options?.find((o) => o.id === input.optionId)
        if (!match) throw new InvalidInputError('Unknown Sushiro option')
        const [group, index] = input.optionId.split(':')
        const choice = picks.find((p) => p.group === group)
        if (!choice || index === undefined) throw new InvalidInputError('Unknown Sushiro option group')
        choice.index = index
      }
      const additionalInfo = picks.map(({ group, index }) => {
        const id = Number(group), i = Number(index)
        if (!Number.isSafeInteger(id) || !Number.isSafeInteger(i) || id < 0 || i < 0)
          throw new ProviderError('Invalid Sushiro menu option')
        return { additional_info_index: i, additional_info_id: id }
      })
      const options = picks.map(({ group, index }) => {
        const found = item.options?.find((o) => o.id === group + ':' + index)
        return { optionId: group + ':' + index, name: found?.name, quantity: 1 }
      })
      const line: SushiroLine = {
        id: brand<CartLineId>(crypto.randomUUID()), itemId: item.id, name: item.name,
        unitPrice: item.price, quantity, additionalInfo, options,
      }
      ctx.setState({ ...state, cart: [...state.cart, line] })
      return calculateCart(ctx.requireState().cart)
    }),
  'cart.remove': defineStandardMethod<'cart.remove', SushiroState, Config>(
    'cart.remove', (ctx, input) => {
      const state = ctx.requireState()
      const index = input.lineId === undefined ? input.index : state.cart.findIndex((l) => l.id === input.lineId)
      if (index === undefined || index < 0 || index >= state.cart.length) throw new NotFoundError('Sushiro cart line not found')
      ctx.setState({ ...state, cart: state.cart.filter((_, i) => i !== index) })
      return calculateCart(ctx.requireState().cart)
    }),
  'cart.clear': defineStandardMethod<'cart.clear', SushiroState, Config>(
    'cart.clear', (ctx) => {
      ctx.setState({ ...ctx.requireState(), cart: [] })
      return calculateCart([])
    }),
  'order.send': defineStandardMethod<'order.send', SushiroState, Config>(
    'order.send', async (ctx, input) => {
      if (input.note !== undefined) throw new UnsupportedError('Sushiro notes are unsupported')
      const state = ctx.requireState()
      if (state.cart.length === 0) throw new InvalidInputError('Sushiro cart is empty')
      if (state.orders.some((order) => order.status === 'unknown'))
        throw new ConflictError('Previous Sushiro order result is unknown; check restaurant order history before proceeding')
      // Confirm that the same seated session remains active before sending any order.
      const response = record(await sushiroRequest(ctx.fetch, '/v1/session', state.token))
      const session = record(response.session)
      if (session.token !== state.token || record(response.shop).id !== state.shopId ||
          record(response.table).id !== state.tableId || session.is_checked_out === true ||
          session.enable_order !== true)
        throw new ConflictError('Sushiro table session changed or ordering was disabled')
      // Claim all lines first: ambiguous network failure must not automatically resend food.
      const pending: Order = {
        id: brand<OrderId>(crypto.randomUUID()), status: 'unknown',
        lines: state.cart.map((line) => ({
          itemId: line.itemId, name: line.name, quantity: line.quantity,
          unitPrice: line.unitPrice, total: money(line.unitPrice.amount * line.quantity),
          options: line.options,
        })),
        itemCount: state.cart.reduce((sum, line) => sum + line.quantity, 0),
        total: money(state.cart.reduce((sum, line) => sum + line.unitPrice.amount * line.quantity, 0)),
        submittedAt: ctx.now().toISOString(),
      }
      ctx.setState({ ...state, cart: [], orders: [...state.orders, pending] })
      const result = record(await sushiroRequest(ctx.fetch, '/v1/mobile/order', state.token, {
        order_items: state.cart.map((line) => ({
          plu_id: Number(line.itemId), current_price: line.unitPrice.amount, qty: line.quantity,
          additional_info: line.additionalInfo, item_discounts: { item_discounts_id: 0 },
        })),
      }))
      const remoteId = integer(result.id)
      const confirmed: Order = { ...pending, id: brand<OrderId>(String(remoteId)), status: 'submitted' }
      const current = ctx.requireState()
      ctx.setState({ ...current, orders: current.orders.map((o) => o.id === pending.id ? confirmed : o) })
      return confirmed
    }),
  'session.status': defineMethod<SushiroState, Config, Record<string, never>, {
    shopId: number; tableId: number; shopName: string; canOrder: boolean;
    checkedOut: boolean; paymentConfirmed: boolean; lastOrderPassed: boolean;
    enableTableOrder: boolean; enableDeviceOrder: boolean;
    deviceNumber: number; totalDevices: number; maxDevices: number;
  }>({
    name: 'session.status', summary: 'Read live Sushiro table/session status.',
    description: 'Returns non-secret operational flags from the active Sushiro session without exposing its token.',
    input: s.object({}),
    output: s.object({
      shopId: nonnegative, tableId: nonnegative, shopName: s.string(),
      canOrder: s.boolean(), checkedOut: s.boolean(), paymentConfirmed: s.boolean(),
      lastOrderPassed: s.boolean(), enableTableOrder: s.boolean(), enableDeviceOrder: s.boolean(),
      deviceNumber: nonnegative, totalDevices: nonnegative, maxDevices: nonnegative,
    }),
    session: 'required', annotations: { readOnlyHint: true },
    async handler(ctx) {
      const state = ctx.requireState()
      const response = record(await sushiroRequest(ctx.fetch, '/v1/session', state.token))
      const session = record(response.session)
      if (record(response.shop).id !== state.shopId || record(response.table).id !== state.tableId || session.token !== state.token)
        throw new ConflictError('The Sushiro table session changed')
      const flag = (value: unknown) => value === true
      return {
        shopId: state.shopId, tableId: state.tableId, shopName: state.shopName,
        canOrder: flag(session.enable_order) && !flag(session.is_checked_out),
        checkedOut: flag(session.is_checked_out), paymentConfirmed: flag(session.is_payment_confirmed),
        lastOrderPassed: flag(session.is_last_order_passed),
        enableTableOrder: flag(session.enable_table_order), enableDeviceOrder: flag(session.enable_device_order),
        deviceNumber: integer(session.device_number ?? 0), totalDevices: integer(session.total_devices ?? 0),
        maxDevices: integer(session.max_devices ?? 0),
      }
    },
  }),
  'order.detail': defineMethod<SushiroState, Config, Record<string, never>, ReturnType<typeof parseSushiroOrderDetail>>({
    name: 'order.detail', summary: 'Read current table order items and total.',
    description: 'Reads /v1/mobile/order/detail; includes item quantities, prices, served flags and total without placing an order.',
    input: s.object({}),
    output: s.object({
      tableId: nonnegative, itemCount: nonnegative,
      total: s.object({ amount: nonnegative, currency: s.string({ enum: ['JPY'] }) }),
      lines: s.array(s.object({
        pluId: nonnegative, quantity: nonnegative, unitPrice: nonnegative,
        currentPrice: nonnegative, served: s.boolean(), discountsId: s.optional(s.integer({ minimum: 0 })),
      })),
    }),
    session: 'required', annotations: { readOnlyHint: true },
    async handler(ctx) {
      const state = ctx.requireState()
      const response = parseSushiroOrderDetail(await sushiroRequest(ctx.fetch, '/v1/mobile/order/detail', state.token))
      if (response.tableId !== state.tableId)
        throw new ConflictError('Sushiro order detail belongs to a different table')
      return response
    },
  }),
  'order.list': defineStandardMethod<'order.list', SushiroState, Config>(
    'order.list', (ctx, input) => ({ orders: ctx.requireState().orders.slice().reverse().slice(0, input.limit ?? 100) })),
}
const definition = defineProvider<'sushiro', SushiroState, Config, typeof methods>({
  id: 'sushiro', displayName: 'スシロー', description: 'Unofficial Sushiro mobile ordering API.',
  stateVersion: 1, menus: 'dynamic', methods,
  validateState: validateSushiroState,
})
export const createSushiro = (options: ProviderCreateOptions<Config> = {}) =>
  createProviderInstance(definition, options)
