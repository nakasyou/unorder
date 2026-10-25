import {
  brand,
  defineMethod,
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
  Session,
  SessionId,
  ShopId,
  TableId,
} from '@unorder/core'
import {
  cancelTicket,
  enterTicket,
  getAppConfig,
  getCheckInCount,
  getMenuHtml,
  getSlots,
  getStore,
  getStoreQueue,
  getTakeoutWaitTimes,
  getTicketStatus,
  getWaitingConfig,
  issueTicket,
  searchStores,
  type ApiContext,
  type StoreSearchInput,
} from './api'
import { resolveEndpoints } from './http'
import { parseSushiroMenu } from './menu'
import type {
  SushiroProviderConfig,
  SushiroQueue,
  SushiroShop,
  SushiroSlot,
  SushiroState,
  SushiroTableType,
  SushiroTakeoutWaitTime,
  SushiroTicketResult,
  SushiroTicketStatus,
  SushiroWaitingConfig,
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
  extensions: {
    guid: state.guid,
    region: state.region,
    tableType: state.tableType,
  },
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

const emptyInput = s.object({})
const guidInput = s.object({
  guid: s.optional(s.string()),
})
const ticketInput = s.object({
  storeId: s.optional(s.string()),
  adults: s.optional(s.integer({ minimum: 1, maximum: 99 })),
  children: s.optional(s.integer({ minimum: 0, maximum: 99 })),
  peopleCount: s.optional(s.integer({ minimum: 1, maximum: 99 })),
  tableType: s.optional(s.string({ enum: ['T', 'C', 'P'] })),
  guid: s.optional(s.string()),
  googleRegistrationId: s.optional(s.string()),
})

const shopListInput = s.object({
  latitude: s.optional(s.number({ minimum: -90, maximum: 90 })),
  longitude: s.optional(s.number({ minimum: -180, maximum: 180 })),
  numResults: s.optional(s.integer({ minimum: 1, maximum: 100 })),
  storeIds: s.optional(s.array(s.string())),
  query: s.optional(s.string()),
  limit: s.optional(s.integer({ minimum: 1, maximum: 1000 })),
  offset: s.optional(s.integer({ minimum: 0 })),
})

const slotInput = s.object({
  storeId: s.optional(s.string()),
  peopleCount: s.optional(s.integer({ minimum: 1, maximum: 99 })),
  tableType: s.optional(s.string({ enum: ['T', 'C', 'P'] })),
  guid: s.optional(s.string()),
  date: s.optional(s.string({ pattern: '^\\d{4}-?\\d{2}-?\\d{2}$' })),
  availableOnly: s.optional(s.boolean()),
  limit: s.optional(s.integer({ minimum: 1, maximum: 1000 })),
  offset: s.optional(s.integer({ minimum: 0 })),
})

const ticketResultSchema = s.object(
  {
    ok: s.boolean(),
    status: s.optional(s.string()),
    ticket: s.optional(s.unknown()),
    raw: s.unknown(),
  },
  { additionalProperties: true },
)

const shopSchema = s.object(
  {
    id: s.string(),
    name: s.optional(s.string()),
    brand: s.string({ enum: ['sushiro'] }),
    status: s.optional(s.string()),
    address: s.optional(s.string()),
    area: s.optional(s.string()),
    latitude: s.optional(s.number()),
    longitude: s.optional(s.number()),
    distanceKm: s.optional(s.number()),
    waitMinutes: s.optional(s.number()),
    waitTimeCapMinutes: s.optional(s.number()),
    waitingGroups: s.optional(s.number()),
    netTicketStatus: s.optional(s.string()),
    reservationStatus: s.optional(s.string()),
    checkinStatus: s.optional(s.string()),
    requiresTicketLogin: s.optional(s.boolean()),
    raw: s.unknown(),
  },
  { additionalProperties: true },
)

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
  'session.close': defineStandardMethod<'session.close', SushiroState, SushiroProviderConfig>(
    'session.close',
    (ctx) => {
      ctx.setState(null)
      return { closed: true }
    },
  ),
  'session.export': defineStandardMethod<'session.export', SushiroState, SushiroProviderConfig>(
    'session.export',
    (ctx) => ctx.exportSession(),
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
  'x-sushiro.shop.list': defineMethod<
    SushiroState,
    SushiroProviderConfig,
    StoreSearchInput,
    { items: readonly SushiroShop[]; total: number }
  >({
    name: 'x-sushiro.shop.list',
    summary: 'Search Sushiro stores by location, id, or the full store list.',
    description:
      'Read-only CRM store search. Pass latitude/longitude for nearby stores, storeIds for an exact lookup, or neither for the full store list. Results are normalized to the shared Shop shape with provider fields and the original payload in raw.',
    input: shopListInput,
    output: s.object({ items: s.array(shopSchema), total: s.integer({ minimum: 0 }) }),
    session: 'none',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (ctx, input) => {
      const api = apiContext(ctx)
      return await searchStores(api, { ...input, guid: resolveGuid(ctx, undefined) })
    },
  }),
  'x-sushiro.shop.get': defineMethod<
    SushiroState,
    SushiroProviderConfig,
    { storeId: string },
    SushiroShop
  >({
    name: 'x-sushiro.shop.get',
    summary: 'Read one Sushiro store, including wait and ticketing status.',
    description:
      'Read-only lookup of the CRM store endpoint. The normalized Shop fields include current wait minutes, waiting groups, and ticket/reservation availability.',
    input: s.object({ storeId: s.string() }),
    output: shopSchema,
    session: 'none',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (ctx, input) => await getStore(apiContext(ctx), input.storeId),
  }),
  'x-sushiro.shop.queue': defineMethod<
    SushiroState,
    SushiroProviderConfig,
    { storeId: string },
    SushiroQueue
  >({
    name: 'x-sushiro.shop.queue',
    summary: 'Read the live queue groups for a Sushiro store.',
    description:
      'Read-only call to the group queue endpoint. Returns the queue numbers for store, counter, booth, reservation, and mixed lanes.',
    input: s.object({ storeId: s.string() }),
    output: s.unknown(),
    session: 'none',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (ctx, input) => await getStoreQueue(apiContext(ctx), input.storeId),
  }),
  'x-sushiro.shop.waiting': defineMethod<
    SushiroState,
    SushiroProviderConfig,
    { storeIds: readonly string[] },
    { configs: readonly SushiroWaitingConfig[] }
  >({
    name: 'x-sushiro.shop.waiting',
    summary: 'Read wait-time display settings for stores.',
    description:
      'Read-only call that reports whether each store shows wait times on the top page, store list, ticketing page, and ticket page.',
    input: s.object({ storeIds: s.array(s.string(), { minItems: 1, maxItems: 50 }) }),
    output: s.object({ configs: s.array(s.unknown()) }),
    session: 'none',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (ctx, input) => ({
      configs: await getWaitingConfig(apiContext(ctx), input.storeIds),
    }),
  }),
  'x-sushiro.ticket.status': defineMethod<
    SushiroState,
    SushiroProviderConfig,
    { guid?: string },
    SushiroTicketStatus
  >({
    name: 'x-sushiro.ticket.status',
    summary: 'Read the tickets and reservations associated with a GUID.',
    description:
      'Read-only call to the anonymous opentickets endpoint. It returns tickets, local tickets, and reservations for the given GUID. Use the GUID exported by session.export.',
    input: guidInput,
    output: s.unknown(),
    session: 'optional',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (ctx, input) =>
      await getTicketStatus(apiContext(ctx), resolveGuid(ctx, input.guid)),
  }),
  'x-sushiro.ticket.slots': defineMethod<
    SushiroState,
    SushiroProviderConfig,
    {
      storeId?: string
      peopleCount?: number
      tableType?: 'T' | 'C' | 'P'
      guid?: string
      date?: string
      availableOnly?: boolean
      limit?: number
      offset?: number
    },
    {
      storeId: string
      peopleCount: number
      tableType: string
      items: readonly SushiroSlot[]
      total: number
    }
  >({
    name: 'x-sushiro.ticket.slots',
    summary: 'List reservation time slots for a store and party size.',
    description:
      'Read-only call to the reservation-timeslots endpoint. Slots are returned with their raw availability flag; use availableOnly to keep only AVAILABLE slots.',
    input: slotInput,
    output: s.object(
      {
        storeId: s.string(),
        peopleCount: s.integer({ minimum: 1 }),
        tableType: s.string({ enum: ['T', 'C', 'P'] }),
        items: s.array(s.unknown()),
        total: s.integer({ minimum: 0 }),
      },
      { additionalProperties: true },
    ),
    session: 'optional',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (ctx, input) => {
      const storeId = resolveStoreId(ctx, input.storeId)
      const peopleCount = resolvePeopleCount(ctx, input.peopleCount)
      const tableType = resolveTableType(ctx, input.tableType)
      const guid = resolveGuid(ctx, input.guid)
      const slots = await getSlots(apiContext(ctx), {
        storeId,
        peopleCount,
        tableType,
        guid,
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
      return {
        storeId,
        peopleCount,
        tableType,
        items: filtered.slice(offset, offset + limit),
        total: filtered.length,
      }
    },
  }),
  'x-sushiro.ticket.check-in-count': defineMethod<
    SushiroState,
    SushiroProviderConfig,
    { storeId: string; ticketNumber: string },
    number
  >({
    name: 'x-sushiro.ticket.check-in-count',
    summary: 'Read the current wait count for one ticket number.',
    description:
      'Read-only call to the store queue count endpoint. The provider returns the upstream value unchanged because it is a scalar.',
    input: s.object({ storeId: s.string(), ticketNumber: s.string() }),
    output: s.unknown(),
    session: 'none',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (ctx, input) =>
      (await getCheckInCount(apiContext(ctx), input.storeId, input.ticketNumber)) as number,
  }),
  'x-sushiro.ticket.issue': defineMethod<
    SushiroState,
    SushiroProviderConfig,
    {
      storeId?: string
      adults?: number
      children?: number
      peopleCount?: number
      tableType?: 'T' | 'C' | 'P'
      guid?: string
      googleRegistrationId?: string
    },
    SushiroTicketResult
  >({
    name: 'x-sushiro.ticket.issue',
    summary: 'Issue a real "going now" queue ticket at a Sushiro store.',
    description:
      'WARNING: this is a real-world, destructive action. It creates a live queue ticket at the selected store and may affect seating and staff workload. Do not call it without explicit human approval. The provider does not send this request in tests.',
    input: ticketInput,
    output: ticketResultSchema,
    session: 'optional',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    handler: async (ctx, input) => {
      const storeId = resolveStoreId(ctx, input.storeId)
      const adults = input.adults ?? input.peopleCount ?? resolvePeopleCount(ctx)
      const children = input.children ?? 0
      const result = await issueTicket(apiContext(ctx), {
        storeId,
        adults,
        children,
        tableType: resolveTableType(ctx, input.tableType),
        guid: resolveGuid(ctx, input.guid),
        ...(input.googleRegistrationId ? { googleRegistrationId: input.googleRegistrationId } : {}),
      })
      const state = ctx.state
      if (state) {
        ctx.setState({ ...state, ...(result.ticket ? { lastTicket: result.ticket } : {}) })
      }
      return result
    },
  }),
  'x-sushiro.ticket.cancel': defineMethod<
    SushiroState,
    SushiroProviderConfig,
    { guid?: string },
    SushiroTicketResult
  >({
    name: 'x-sushiro.ticket.cancel',
    summary: 'Cancel a real "going now" queue ticket.',
    description:
      'WARNING: this is a real-world, destructive action. It cancels the current anonymous queue ticket for the GUID and may lose the place in line. Do not call it without explicit human approval. The provider does not send this request in tests.',
    input: guidInput,
    output: ticketResultSchema,
    session: 'optional',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    handler: async (ctx, input) =>
      await cancelTicket(apiContext(ctx), resolveGuid(ctx, input.guid)),
  }),
  'x-sushiro.ticket.enter': defineMethod<
    SushiroState,
    SushiroProviderConfig,
    {
      storeId?: string
      ticketNumber: string
      guid?: string
      googleRegistrationId?: string
    },
    SushiroTicketResult
  >({
    name: 'x-sushiro.ticket.enter',
    summary: 'Register a store-issued paper ticket number.',
    description:
      'WARNING: this is a real-world action. It registers a ticket number issued at the store and can affect the local queue. Do not call it without explicit human approval. The provider does not send this request in tests.',
    input: s.object({
      storeId: s.optional(s.string()),
      ticketNumber: s.string({ minLength: 1 }),
      guid: s.optional(s.string()),
      googleRegistrationId: s.optional(s.string()),
    }),
    output: ticketResultSchema,
    session: 'optional',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    handler: async (ctx, input) => {
      const storeId = resolveStoreId(ctx, input.storeId)
      return await enterTicket(apiContext(ctx), {
        storeId,
        ticketNumber: input.ticketNumber,
        guid: resolveGuid(ctx, input.guid),
        ...(input.googleRegistrationId ? { googleRegistrationId: input.googleRegistrationId } : {}),
      })
    },
  }),
  'x-sushiro.takeout.wait-time': defineMethod<
    SushiroState,
    SushiroProviderConfig,
    { storeId?: string; storeIds?: readonly string[] },
    { items: readonly SushiroTakeoutWaitTime[] }
  >({
    name: 'x-sushiro.takeout.wait-time',
    summary: 'Read takeout pickup wait time for one or more stores.',
    description:
      'Read-only call to the takeout API with the app bearer token. It reports the estimated pickup wait in minutes and does not create or submit an order.',
    input: s.object({
      storeId: s.optional(s.string()),
      storeIds: s.optional(s.array(s.string(), { minItems: 1, maxItems: 50 })),
    }),
    output: s.object({ items: s.array(s.unknown()) }),
    session: 'none',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (ctx, input) => {
      const ids =
        input.storeIds && input.storeIds.length > 0
          ? input.storeIds
          : [resolveStoreId(ctx, input.storeId)]
      return { items: await getTakeoutWaitTimes(apiContext(ctx), ids) }
    },
  }),
  'x-sushiro.app.config': defineMethod<
    SushiroState,
    SushiroProviderConfig,
    Record<string, never>,
    unknown
  >({
    name: 'x-sushiro.app.config',
    summary: 'Read the public app configuration and feature flags.',
    description:
      'Read-only call to the CRM config endpoint. It exposes the app version policy and feature flags the app reads at startup.',
    input: emptyInput,
    output: s.unknown(),
    session: 'none',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (ctx) => await getAppConfig(apiContext(ctx)),
  }),
  'x-sushiro.table.set': defineMethod<
    SushiroState,
    SushiroProviderConfig,
    { tableId: string },
    Session
  >({
    name: 'x-sushiro.table.set',
    summary: 'Record a table id in the local session (Sushiro-specific).',
    description:
      'Stores a table label locally for scripts that keep a table id alongside a store. This app has no table QR ordering flow, so nothing is sent upstream.',
    input: s.object({ tableId: s.string() }),
    output: s.unknown(),
    session: 'required',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    handler: (ctx, input) => {
      const state = ctx.requireState()
      const next = { ...state, tableId: input.tableId }
      ctx.setState(next)
      return {
        ...toSession(next, ctx.now()),
        table: { id: brand<TableId>(input.tableId) },
      }
    },
  }),
} satisfies MethodMap<SushiroState, SushiroProviderConfig>

export const sushiro = defineProvider<
  'sushiro',
  SushiroState,
  SushiroProviderConfig,
  typeof methods
>({
  id: 'sushiro',
  displayName: 'Sushiro',
  description:
    'Unofficial Sushiro provider for store search, live queues, queue tickets, reservations, dynamic menus, and takeout wait times. It does not implement in-store table ordering.',
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
  methods,
})

export type SushiroProvider = typeof sushiro
export type SushiroRuntime = ReturnType<typeof sushiro.createRuntime>
export type SushiroMenuItem = MenuItem

/**
 * Creates a call-only Sushiro instance. This matches the forward-looking
 * `createProvider(config?)` shape while the current core still exposes
 * `provider.createRuntime()`.
 */
export const createSushiro = (
  config: SushiroProviderConfig = {},
  options: {
    fetch?: typeof globalThis.fetch
    now?: () => Date
    session?: Parameters<typeof sushiro.createRuntime>[0] extends infer Options
      ? Options extends { session?: infer Session }
        ? Session
        : never
      : never
  } = {},
) => {
  const runtime = sushiro.createRuntime({
    config,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.session ? { session: options.session } : {}),
  })
  const call: typeof runtime.call = (name, input) => runtime.call(name, input)
  return { call }
}

export type SushiroMethodName = keyof typeof methods
export type SushiroMenuItemId = MenuItemId
