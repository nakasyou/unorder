import {
  brand,
  createProviderInstance,
  defineProvider,
  defineStandardMethod,
  InvalidInputError,
  listMenuItems,
  NotFoundError,
  s,
} from '@unorder/core'
import type {
  MenuItem,
  MenuItemId,
  MethodMap,
  Page,
  ProviderCreateOptions,
  ProviderInstance,
  ProviderRuntime,
  Reservation,
  ReservationSlot,
  Session,
  SessionId,
  ShopId,
  TableId,
  WaitEstimate,
  WaitlistStatus,
  WaitlistTicket,
} from '@unorder/core'
import {
  cancelTicket,
  enterTicket,
  getMenuHtml,
  getSlots,
  getStore,
  getStoreQueue,
  getTakeoutWaitTimes,
  getTicketStatus,
  issueTicket,
  searchStores,
  type ApiContext,
  type StoreSearchInput,
} from './api'
import { resolveEndpoints } from './http'
import { parseSushiroMenu } from './menu'
import type {
  SushiroProviderConfig,
  SushiroShop,
  SushiroSlot,
  SushiroState,
  SushiroTableType,
  SushiroTicket,
  SushiroTakeoutWaitTime,
} from './types'
import { isRecord } from './types'

const DEFAULT_TABLE_TYPE: SushiroTableType = 'T'

const newGuid = (): string => {
  const crypto = globalThis.crypto
  if (crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Math.floor(Math.random() * 256)
  }
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
}

const parseStoreId = (value: string): string | undefined => {
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) {
    return trimmed
  }
  try {
    const url = new URL(trimmed)
    const query = [
      url.searchParams.get('storeId'),
      url.searchParams.get('storeid'),
      url.searchParams.get('id'),
    ]
    for (const candidate of query) {
      if (candidate && /^\d+$/.test(candidate)) {
        return candidate
      }
    }
    if (/^\d+$/.test(url.hostname)) {
      return url.hostname
    }
    const segments = url.pathname.split('/').filter(Boolean)
    const last = segments.at(-1)
    if (last && /^\d+$/.test(last) && (url.hostname === 'store' || segments[0] === 'store')) {
      return last
    }
  } catch {
    // Fall through to a plain key=value search.
  }
  return /(?:storeId|storeid|id)=(\d+)/.exec(trimmed)?.[1]
}

const asTableType = (value: unknown): SushiroTableType | undefined =>
  value === 'T' || value === 'C' || value === 'P' ? value : undefined

const apiContext = (context: {
  fetch: typeof globalThis.fetch
  config: SushiroProviderConfig
}): ApiContext => ({
  fetch: context.fetch,
  endpoints: resolveEndpoints(context.config),
})

const toSession = (state: SushiroState, now: Date): Session => ({
  provider: 'sushiro',
  ...(state.storeId ? { sessionId: brand<SessionId>(state.guid) } : {}),
  ...(state.storeId
    ? {
        shop: {
          id: brand<ShopId>(state.storeId),
          ...(state.storeName ? { name: state.storeName } : {}),
          brand: 'sushiro',
        },
      }
    : {}),
  ...(state.tableId ? { table: { id: brand<TableId>(state.tableId) } } : {}),
  ...(state.peopleCount === undefined ? {} : { peopleCount: state.peopleCount }),
  page: state.storeId ? 'store' : 'unselected',
  openedAt: state.openedAt,
  updatedAt: now.toISOString(),
  raw: { region: state.region, tableType: state.tableType },
})

const resolveStoreId = (
  context: {
    state: SushiroState | null
    config: SushiroProviderConfig
  },
  inputStoreId?: string,
): string => {
  const storeId = inputStoreId ?? context.state?.storeId ?? context.config.storeId
  if (!storeId) {
    throw new InvalidInputError(
      'Sushiro needs a store id: call session.open with a store link or set the storeId config option',
    )
  }
  if (!/^\d+$/.test(storeId)) {
    throw new InvalidInputError('Sushiro store id must be numeric')
  }
  return storeId
}

const resolveGuid = (
  context: {
    state: SushiroState | null
    config: SushiroProviderConfig
  },
  inputGuid?: string,
): string => inputGuid ?? context.state?.guid ?? context.config.guid ?? newGuid()

const resolvePeopleCount = (
  context: {
    state: SushiroState | null
    config: SushiroProviderConfig
  },
  inputPeople?: number,
): number => inputPeople ?? context.state?.peopleCount ?? context.config.peopleCount ?? 2

const resolveTableType = (
  context: {
    state: SushiroState | null
    config: SushiroProviderConfig
  },
  inputTableType?: string,
): SushiroTableType =>
  asTableType(inputTableType) ??
  asTableType(context.state?.tableType) ??
  context.config.tableType ??
  DEFAULT_TABLE_TYPE

const seatingTableType = (seating: string | undefined): SushiroTableType | undefined => {
  switch (seating) {
    case 'table':
      return 'T'
    case 'counter':
      return 'C'
    case 'pair':
      return 'P'
    default:
      return undefined
  }
}

const laneForTableType = (tableType: string | undefined): string | undefined => {
  switch (tableType) {
    case 'T':
      return 'table'
    case 'C':
      return 'counter'
    case 'P':
      return 'pair'
    default:
      return undefined
  }
}

const waitlistStatus = (value: string | undefined): WaitlistStatus => {
  switch (value?.toUpperCase()) {
    case 'WAITING':
    case 'WAIT':
      return 'waiting'
    case 'CALLED':
      return 'called'
    case 'SEATED':
    case 'CHECKED_IN':
      return 'seated'
    case 'CANCELLED':
    case 'CANCELED':
      return 'cancelled'
    case 'MISSED':
    case 'EXPIRED':
      return 'expired'
    default:
      return 'unknown'
  }
}

const toWaitlistTicket = (ticket: SushiroTicket, fallbackShopId?: string): WaitlistTicket => {
  const shopId = ticket.storeId ?? fallbackShopId ?? ''
  const partySize =
    ticket.adults === undefined && ticket.children === undefined
      ? undefined
      : (ticket.adults ?? 0) + (ticket.children ?? 0)
  return {
    ...(ticket.ticketId === undefined ? {} : { id: String(ticket.ticketId) }),
    ...(ticket.number ? { number: ticket.number } : {}),
    shopId: brand<ShopId>(shopId),
    status: waitlistStatus(ticket.status),
    ...(ticket.status ? { statusRaw: ticket.status } : {}),
    ...(partySize === undefined ? {} : { partySize }),
    service: 'dine_in',
    ...(laneForTableType(ticket.tableType) ? { lane: laneForTableType(ticket.tableType) } : {}),
    ...(ticket.waitMinutes === undefined ? {} : { estimatedWaitMinutes: ticket.waitMinutes }),
    raw: ticket.raw,
  }
}

const reservationStatus = (value: string | undefined): Reservation['status'] => {
  switch (value?.toUpperCase()) {
    case 'CONFIRMED':
    case 'RESERVED':
      return 'confirmed'
    case 'WAITING':
    case 'PENDING':
      return 'pending'
    case 'CANCELLED':
    case 'CANCELED':
      return 'cancelled'
    case 'MISSED':
    case 'EXPIRED':
      return 'expired'
    default:
      return 'unknown'
  }
}

const formatDateTime = (date: string, time: string): string => {
  const dateMatch = /^(\d{4})(\d{2})(\d{2})$/.exec(date)
  const timeMatch = /^(\d{2})(\d{2})(\d{2})$/.exec(time)
  if (!dateMatch || !timeMatch) {
    return `${date}T${time}`
  }
  return `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3]}`
}

const toReservation = (ticket: SushiroTicket): Reservation => {
  const start =
    ticket.queueDate && ticket.queueTime
      ? formatDateTime(ticket.queueDate, ticket.queueTime)
      : undefined
  const partySize =
    ticket.adults === undefined && ticket.children === undefined
      ? undefined
      : (ticket.adults ?? 0) + (ticket.children ?? 0)
  return {
    ...(ticket.ticketId === undefined ? {} : { id: String(ticket.ticketId) }),
    shopId: brand<ShopId>(ticket.storeId ?? ''),
    status: reservationStatus(ticket.status),
    ...(ticket.status ? { statusRaw: ticket.status } : {}),
    ...(partySize === undefined ? {} : { partySize }),
    ...(start ? { start } : {}),
    raw: ticket.raw,
  }
}

const toReservationSlot = (slot: SushiroSlot): ReservationSlot => ({
  shopId: brand<ShopId>(slot.storeId),
  service: 'reservation',
  start: formatDateTime(slot.date, slot.start),
  end: formatDateTime(slot.date, slot.end),
  available: slot.available,
  status: slot.availability,
  raw: slot.raw,
})

const pageOf = <Item>(
  items: readonly Item[],
  total: number,
  offset: number,
  limit: number,
): Page<Item> => ({
  items,
  total,
  offset,
  limit,
  hasMore: offset + items.length < total,
})

const takeoutWaits = async (
  api: ApiContext,
  storeIds: readonly string[],
): Promise<Map<string, WaitEstimate>> => {
  if (storeIds.length === 0) {
    return new Map()
  }
  try {
    const items = await getTakeoutWaitTimes(api, storeIds)
    return new Map(
      items.flatMap((item: SushiroTakeoutWaitTime) =>
        item.minutes === null
          ? []
          : [
              [
                item.storeId,
                { service: 'takeout' as const, minutes: item.minutes, raw: item.raw },
              ] as const,
            ],
      ),
    )
  } catch {
    return new Map()
  }
}

const withTakeoutWaits = (
  shops: readonly SushiroShop[],
  waits: ReadonlyMap<string, WaitEstimate>,
): SushiroShop[] =>
  shops.map((shop) => {
    const wait = waits.get(String(shop.id))
    return wait ? { ...shop, waitEstimates: [...(shop.waitEstimates ?? []), wait] } : shop
  })

const storeWaits = async (
  api: ApiContext,
  storeId: string,
): Promise<readonly WaitEstimate[] | undefined> => {
  try {
    const shop = await getStore(api, storeId)
    return shop.waitEstimates
  } catch {
    return undefined
  }
}

export const validateSushiroState = (raw: unknown): SushiroState => {
  if (!isRecord(raw)) {
    throw new InvalidInputError('Sushiro session state must be an object')
  }
  const region = raw.region
  const guid = raw.guid
  const openedAt = raw.openedAt
  if (typeof region !== 'string' || typeof guid !== 'string' || typeof openedAt !== 'string') {
    throw new InvalidInputError('Sushiro session state is missing required fields')
  }
  const storeId = raw.storeId
  const storeName = raw.storeName
  const tableId = raw.tableId
  const peopleCount = raw.peopleCount
  const tableType = asTableType(raw.tableType) ?? DEFAULT_TABLE_TYPE
  if (storeId !== undefined && typeof storeId !== 'string') {
    throw new InvalidInputError('Sushiro session storeId must be a string')
  }
  if (storeName !== undefined && typeof storeName !== 'string') {
    throw new InvalidInputError('Sushiro session storeName must be a string')
  }
  if (tableId !== undefined && typeof tableId !== 'string') {
    throw new InvalidInputError('Sushiro session tableId must be a string')
  }
  if (peopleCount !== undefined && (typeof peopleCount !== 'number' || peopleCount < 1)) {
    throw new InvalidInputError('Sushiro session peopleCount must be a positive number')
  }
  return {
    region: region as SushiroState['region'],
    guid,
    ...(storeId ? { storeId } : {}),
    ...(storeName ? { storeName } : {}),
    ...(tableId ? { tableId } : {}),
    ...(peopleCount === undefined ? {} : { peopleCount }),
    tableType,
    openedAt,
    ...(raw.lastTicket === undefined ? {} : { lastTicket: raw.lastTicket }),
  }
}

const methods = {
  'session.open': defineStandardMethod<'session.open', SushiroState, SushiroProviderConfig>(
    'session.open',
    async (ctx, input) => {
      const storeId = parseStoreId(input.qrUrl)
      if (!storeId) {
        throw new InvalidInputError(
          'qrUrl must contain a Sushiro store id (for example sushiroapp://store/874)',
        )
      }
      const api = apiContext(ctx)
      const shop = await getStore(api, storeId)
      const state: SushiroState = {
        region: api.endpoints.region,
        guid: ctx.config.guid ?? newGuid(),
        storeId,
        ...(shop.name ? { storeName: shop.name } : {}),
        ...(input.peopleCount === undefined ? {} : { peopleCount: input.peopleCount }),
        tableType: ctx.config.tableType ?? DEFAULT_TABLE_TYPE,
        openedAt: ctx.now().toISOString(),
      }
      ctx.setState(state)
      return toSession(state, ctx.now())
    },
  ),
  'session.update': defineStandardMethod<'session.update', SushiroState, SushiroProviderConfig>(
    'session.update',
    (ctx, input) => {
      if (input.peopleCount === undefined && input.tableId === undefined) {
        throw new InvalidInputError('session.update requires peopleCount or tableId')
      }
      const state = ctx.requireState()
      const next = {
        ...state,
        ...(input.peopleCount === undefined ? {} : { peopleCount: input.peopleCount }),
        ...(input.tableId === undefined ? {} : { tableId: input.tableId }),
      }
      ctx.setState(next)
      return toSession(next, ctx.now())
    },
  ),
  'session.close': defineStandardMethod<'session.close', SushiroState, SushiroProviderConfig>(
    'session.close',
    (ctx) => {
      ctx.setState(null)
      return { closed: true }
    },
  ),
  'menu.list': defineStandardMethod<'menu.list', SushiroState, SushiroProviderConfig>(
    'menu.list',
    async (ctx, input) => {
      const storeId = resolveStoreId(ctx)
      const api = apiContext(ctx)
      const html = await getMenuHtml(api, storeId)
      const snapshot = parseSushiroMenu(html)
      return listMenuItems(
        snapshot.items,
        input,
        { kind: 'dynamic', providerId: 'sushiro' },
        ctx.now().toISOString(),
      )
    },
  ),
  'menu.get': defineStandardMethod<'menu.get', SushiroState, SushiroProviderConfig>(
    'menu.get',
    async (ctx, input) => {
      const storeId = resolveStoreId(ctx)
      const api = apiContext(ctx)
      const html = await getMenuHtml(api, storeId)
      const item = parseSushiroMenu(html).items.find((candidate) => candidate.id === input.id)
      if (!item) {
        throw new NotFoundError(
          `Sushiro menu item "${input.id}" was not found for store ${storeId}`,
        )
      }
      return item
    },
  ),
  'shop.list': defineStandardMethod<'shop.list', SushiroState, SushiroProviderConfig>(
    'shop.list',
    async (ctx, input) => {
      if (input.ids && input.near) {
        throw new InvalidInputError('shop.list accepts either ids or near, not both')
      }
      const api = apiContext(ctx)
      const radius = input.near?.radiusMeters
      const searchInput: StoreSearchInput = {
        ...(input.near
          ? {
              latitude: input.near.latitude,
              longitude: input.near.longitude,
              numResults: input.limit ?? 20,
            }
          : {}),
        ...(input.ids ? { storeIds: input.ids } : {}),
        ...(input.query ? { query: input.query } : {}),
        ...(radius === undefined ? {} : { limit: 1000, offset: 0 }),
        ...(radius !== undefined ? {} : input.limit === undefined ? {} : { limit: input.limit }),
        ...(radius !== undefined ? {} : input.offset === undefined ? {} : { offset: input.offset }),
        guid: resolveGuid(ctx),
      }
      const result = await searchStores(api, searchInput)
      let shops = result.items
      let total = result.total
      const offset = input.offset ?? 0
      const limit = input.limit ?? 50
      if (radius !== undefined) {
        shops = shops.filter(
          (shop) => shop.distanceMeters === undefined || shop.distanceMeters <= radius,
        )
        total = shops.length
        shops = shops.slice(offset, offset + limit)
      }
      const waits = await takeoutWaits(
        api,
        shops.map((shop) => String(shop.id)),
      )
      return pageOf(withTakeoutWaits(shops, waits), total, offset, limit)
    },
  ),
  'shop.get': defineStandardMethod<'shop.get', SushiroState, SushiroProviderConfig>(
    'shop.get',
    async (ctx, input) => {
      const api = apiContext(ctx)
      const shop = await getStore(api, input.shopId)
      const waits = await takeoutWaits(api, [String(shop.id)])
      return withTakeoutWaits([shop], waits)[0] ?? shop
    },
  ),
  'queue.get': defineStandardMethod<'queue.get', SushiroState, SushiroProviderConfig>(
    'queue.get',
    async (ctx, input) => {
      const storeId = resolveStoreId(ctx, input.shopId)
      const queue = await getStoreQueue(apiContext(ctx), storeId)
      return { ...queue, updatedAt: ctx.now().toISOString() }
    },
  ),
  'waitlist.join': defineStandardMethod<'waitlist.join', SushiroState, SushiroProviderConfig>(
    'waitlist.join',
    async (ctx, input) => {
      const storeId = resolveStoreId(ctx, input.shopId)
      const api = apiContext(ctx)
      const guid = resolveGuid(ctx)
      if (input.number) {
        const result = await enterTicket(api, {
          storeId,
          ticketNumber: input.number,
          guid,
        })
        return {
          number: input.number,
          shopId: brand<ShopId>(storeId),
          status: result.ok ? ('waiting' as const) : ('unknown' as const),
          ...(result.status ? { statusRaw: result.status } : {}),
          service: 'dine_in' as const,
          raw: result.raw,
        }
      }
      const adults = input.partySize ?? resolvePeopleCount(ctx)
      const children = input.children ?? 0
      const tableType = seatingTableType(input.seating) ?? resolveTableType(ctx)
      const result = await issueTicket(api, {
        storeId,
        adults,
        children,
        tableType,
        guid,
      })
      const state = ctx.state
      if (state) {
        ctx.setState({ ...state, ...(result.ticket ? { lastTicket: result.ticket } : {}) })
      }
      if (!result.ticket) {
        return {
          shopId: brand<ShopId>(storeId),
          status: result.ok ? ('waiting' as const) : ('unknown' as const),
          ...(result.status ? { statusRaw: result.status } : {}),
          service: 'dine_in' as const,
          raw: result.raw,
        }
      }
      return toWaitlistTicket(result.ticket, storeId)
    },
  ),
  'waitlist.cancel': defineStandardMethod<'waitlist.cancel', SushiroState, SushiroProviderConfig>(
    'waitlist.cancel',
    async (ctx) => {
      const result = await cancelTicket(apiContext(ctx), resolveGuid(ctx))
      const ticket = result.ticket ? toWaitlistTicket(result.ticket) : undefined
      return {
        cancelled: result.ok,
        ...(ticket ? { ticket } : {}),
        raw: result.raw,
      }
    },
  ),
  'waitlist.status': defineStandardMethod<'waitlist.status', SushiroState, SushiroProviderConfig>(
    'waitlist.status',
    async (ctx, input) => {
      const api = apiContext(ctx)
      const result = await getTicketStatus(api, resolveGuid(ctx))
      const shopId = input.shopId ?? ctx.state?.storeId
      const tickets = [...result.tickets, ...result.localTickets].map((ticket) =>
        toWaitlistTicket(ticket, shopId),
      )
      const filtered =
        input.ticketId === undefined
          ? tickets
          : tickets.filter((ticket) => ticket.id === input.ticketId)
      const waits = shopId ? await storeWaits(api, shopId) : undefined
      return {
        ...(shopId ? { shopId } : {}),
        tickets: filtered,
        ...(waits ? { waits } : {}),
        raw: result.raw,
      }
    },
  ),
  'reservation.slots': defineStandardMethod<
    'reservation.slots',
    SushiroState,
    SushiroProviderConfig
  >('reservation.slots', async (ctx, input) => {
    const storeId = resolveStoreId(ctx, input.shopId)
    const partySize = resolvePeopleCount(ctx, input.partySize)
    const tableType = resolveTableType(ctx)
    const slots = await getSlots(apiContext(ctx), {
      storeId,
      peopleCount: partySize,
      tableType,
      guid: resolveGuid(ctx),
    })
    const normalizedDate = input.date?.replaceAll('-', '')
    const filtered = slots.filter((slot) => {
      if (normalizedDate && slot.date !== normalizedDate) {
        return false
      }
      if (input.availableOnly && !slot.available) {
        return false
      }
      return true
    })
    const offset = Math.max(0, Math.trunc(input.offset ?? 0))
    const limit = Math.min(1000, Math.max(1, Math.trunc(input.limit ?? 200)))
    const page = filtered.slice(offset, offset + limit).map(toReservationSlot)
    return pageOf(page, filtered.length, offset, limit)
  }),
  'reservation.list': defineStandardMethod<'reservation.list', SushiroState, SushiroProviderConfig>(
    'reservation.list',
    async (ctx, input) => {
      const result = await getTicketStatus(apiContext(ctx), resolveGuid(ctx))
      const shopId = input.shopId ?? ctx.state?.storeId
      const reservations = result.reservations
        .map(toReservation)
        .filter((reservation) => shopId === undefined || reservation.shopId === shopId)
      return { reservations, raw: result.raw }
    },
  ),
} satisfies MethodMap<SushiroState, SushiroProviderConfig>

const sushiroDefinition = defineProvider<
  'sushiro',
  SushiroState,
  SushiroProviderConfig,
  typeof methods
>({
  id: 'sushiro',
  displayName: 'Sushiro',
  description:
    'Unofficial Sushiro provider for store search, live queues, waitlists, reservations, dynamic menus, and takeout wait times. It does not implement in-store table ordering.',
  version: '0.1.0',
  stateVersion: 1,
  menus: 'dynamic',
  defaultConfig: { region: 'ja', tableType: DEFAULT_TABLE_TYPE },
  config: s.object({
    region: s.optional(s.string()),
    storeId: s.optional(s.string()),
    guid: s.optional(s.string()),
    peopleCount: s.optional(s.integer({ minimum: 1, maximum: 99 })),
    tableType: s.optional(s.string({ enum: ['T', 'C', 'P'] })),
    crmBaseUrl: s.optional(s.string({ format: 'uri' })),
    menuBaseUrl: s.optional(s.string({ format: 'uri' })),
    takeoutBaseUrl: s.optional(s.string({ format: 'uri' })),
    takeoutToken: s.optional(s.string()),
    userAgent: s.optional(s.string()),
  }),
  validateState: validateSushiroState,
  serializeState: (state) => state,
  methods,
})

export const sushiro = sushiroDefinition

export type SushiroCreateOptions = ProviderCreateOptions<SushiroProviderConfig>
export type SushiroProvider = typeof sushiroDefinition
export type SushiroRuntime = ProviderRuntime<'sushiro', SushiroState, typeof methods>
export type SushiroMenuItem = MenuItem
export type SushiroMenuItemId = MenuItemId

const isCreateOptions = (
  value: SushiroProviderConfig | SushiroCreateOptions,
): value is SushiroCreateOptions =>
  'config' in value || 'fetch' in value || 'now' in value || 'session' in value

/**
 * Creates a Sushiro provider instance. The returned object exposes only `call`;
 * use core helpers such as `createClient` for typed nested calls and
 * `exportSession` for serialization.
 *
 * Accepts either provider config directly (`createSushiro({ storeId })`) or core
 * create options (`createSushiro({ config, fetch, session })`). A second argument
 * can supply runtime options alongside a plain config.
 */
export const createSushiro = (
  configOrOptions: SushiroProviderConfig | SushiroCreateOptions = {},
  options: SushiroCreateOptions = {},
): ProviderInstance<typeof methods> => {
  const base = isCreateOptions(configOrOptions) ? configOrOptions : { config: configOrOptions }
  return createProviderInstance(sushiroDefinition, {
    ...base,
    ...options,
    config: { ...base.config, ...options.config },
  })
}

export type SushiroMethodName = keyof typeof methods
