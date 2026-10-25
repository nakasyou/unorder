import type { Shop } from '@unorder/core'

/** Region segment used by the Sushiro CRM API. Japan is the default. */
export type SushiroRegion = 'ja' | 'sg' | 'tw' | 'hk' | 'th' | 'id' | 'my'

export type SushiroTableType = 'T' | 'C' | 'P'

export interface SushiroProviderConfig {
  /** CRM region segment. Defaults to `ja`. */
  region?: SushiroRegion
  /**
   * Store used by `menu.list` / `menu.get` when no session is open. Accepts the
   * CRM store id (the same id returned by `x-sushiro.shop.list`).
   */
  storeId?: string
  /** Device/session GUID used for tickets. Generated on first use when omitted. */
  guid?: string
  /** Default party size for ticket methods. */
  peopleCount?: number
  /** Default seat type for ticket methods. */
  tableType?: SushiroTableType
  /** CRM API base URL. Defaults to the Japanese production endpoint. */
  crmBaseUrl?: string
  /** Menu detail base URL. Defaults to the Japanese production menu endpoint. */
  menuBaseUrl?: string
  /** Takeout (net order) base URL. Defaults to the Japanese production endpoint. */
  takeoutBaseUrl?: string
  /**
   * Bearer token used by the takeout wait-time API. The default is the token
   * shipped in the public Android app environment file.
   */
  takeoutToken?: string
  /** Optional User-Agent override. */
  userAgent?: string
}

export interface SushiroState {
  region: SushiroRegion
  guid: string
  storeId?: string
  storeName?: string
  tableId?: string
  peopleCount?: number
  tableType: SushiroTableType
  openedAt: string
  lastTicket?: unknown
}

export interface SushiroRawStore {
  id: number | string
  name?: string
  nameKana?: string
  nameEn?: string
  address?: string
  area?: string
  latitude?: number
  longitude?: number
  distance?: string | number
  storeStatus?: string
  wait?: number
  waitTimeCap?: number
  waitingGroup?: number
  netTicketStatus?: string
  remoteTicketingManualStatus?: string
  reservationStatus?: string
  checkinStatus?: string
  requireNetTicketLogin?: boolean
  counterReservationsAllowed?: boolean
  [key: string]: unknown
}

export interface SushiroShop extends Shop {
  readonly brand: 'sushiro'
  readonly status?: string
  readonly address?: string
  readonly area?: string
  readonly latitude?: number
  readonly longitude?: number
  readonly distanceKm?: number
  readonly waitMinutes?: number
  readonly waitTimeCapMinutes?: number
  readonly waitingGroups?: number
  readonly netTicketStatus?: string
  readonly reservationStatus?: string
  readonly checkinStatus?: string
  readonly requiresTicketLogin?: boolean
  readonly raw: SushiroRawStore
}

export interface SushiroQueue {
  readonly storeId: string
  readonly storeQueue: readonly string[]
  readonly storeCounterQueue: readonly string[]
  readonly storeBoothQueue: readonly string[]
  readonly reservationQueue: readonly string[]
  readonly reservationCounterQueue: readonly string[]
  readonly reservationBoothQueue: readonly string[]
  readonly mixedQueue: readonly string[]
  readonly mixedCounterQueue: readonly string[]
  readonly mixedBoothQueue: readonly string[]
  readonly separateQueue: number
  readonly raw: unknown
}

export interface SushiroWaitingConfig {
  readonly storeId: string
  readonly top: boolean
  readonly stores: boolean
  readonly ticketing: boolean
  readonly ticket: boolean
  readonly raw: unknown
}

export interface SushiroTicket {
  readonly ticketId?: string | number
  readonly storeId?: string
  readonly queueDate?: string
  readonly queueTime?: string
  readonly number?: string
  readonly adults?: number
  readonly children?: number
  readonly tableType?: string
  readonly waitMinutes?: number
  readonly status?: string
  readonly checkedIn?: boolean
  readonly raw: unknown
}

export interface SushiroTicketStatus {
  readonly tickets: readonly SushiroTicket[]
  readonly localTickets: readonly SushiroTicket[]
  readonly reservations: readonly SushiroTicket[]
  readonly raw: unknown
}

export interface SushiroSlot {
  readonly storeId: string
  readonly date: string
  readonly start: string
  readonly end: string
  readonly availability: string
  readonly available: boolean
  readonly raw: unknown
}

export interface SushiroTicketResult {
  readonly ok: boolean
  readonly status?: string
  readonly ticket?: SushiroTicket
  readonly raw: unknown
}

export interface SushiroTakeoutWaitTime {
  readonly storeId: string
  readonly minutes: number | null
  readonly raw: unknown
}

type RecordValue = Record<string, unknown>

export const isRecord = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stringValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

const numberValue = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

const arrayOfStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

const asRawStore = (value: unknown): SushiroRawStore | undefined => {
  if (!isRecord(value)) {
    return undefined
  }
  const id = value.id
  if (typeof id !== 'number' && typeof id !== 'string') {
    return undefined
  }
  return value as SushiroRawStore
}

export const toShop = (value: unknown): SushiroShop => {
  const raw = asRawStore(value)
  if (!raw) {
    throw new TypeError('Sushiro store payload is missing an id')
  }
  const distance = numberValue(raw.distance)
  return {
    id: String(raw.id) as SushiroShop['id'],
    brand: 'sushiro',
    ...(stringValue(raw.name) ? { name: stringValue(raw.name) } : {}),
    ...(stringValue(raw.storeStatus) ? { status: stringValue(raw.storeStatus) } : {}),
    ...(stringValue(raw.address) ? { address: stringValue(raw.address) } : {}),
    ...(stringValue(raw.area) ? { area: stringValue(raw.area) } : {}),
    ...(numberValue(raw.latitude) === undefined ? {} : { latitude: numberValue(raw.latitude) }),
    ...(numberValue(raw.longitude) === undefined ? {} : { longitude: numberValue(raw.longitude) }),
    ...(distance === undefined || distance < 0 ? {} : { distanceKm: distance }),
    ...(numberValue(raw.wait) === undefined ? {} : { waitMinutes: numberValue(raw.wait) }),
    ...(numberValue(raw.waitTimeCap) === undefined
      ? {}
      : { waitTimeCapMinutes: numberValue(raw.waitTimeCap) }),
    ...(numberValue(raw.waitingGroup) === undefined
      ? {}
      : { waitingGroups: numberValue(raw.waitingGroup) }),
    ...(stringValue(raw.netTicketStatus)
      ? { netTicketStatus: stringValue(raw.netTicketStatus) }
      : {}),
    ...(stringValue(raw.reservationStatus)
      ? { reservationStatus: stringValue(raw.reservationStatus) }
      : {}),
    ...(stringValue(raw.checkinStatus) ? { checkinStatus: stringValue(raw.checkinStatus) } : {}),
    ...(typeof raw.requireNetTicketLogin === 'boolean'
      ? { requiresTicketLogin: raw.requireNetTicketLogin }
      : {}),
    raw,
  }
}

export const toQueue = (storeId: string, value: unknown): SushiroQueue => {
  const raw = isRecord(value) ? value : {}
  return {
    storeId,
    storeQueue: arrayOfStrings(raw.storeQueue),
    storeCounterQueue: arrayOfStrings(raw.storeCounterQueue),
    storeBoothQueue: arrayOfStrings(raw.storeBoothQueue),
    reservationQueue: arrayOfStrings(raw.reservationQueue),
    reservationCounterQueue: arrayOfStrings(raw.reservationCounterQueue),
    reservationBoothQueue: arrayOfStrings(raw.reservationBoothQueue),
    mixedQueue: arrayOfStrings(raw.mixedQueue),
    mixedCounterQueue: arrayOfStrings(raw.mixedCounterQueue),
    mixedBoothQueue: arrayOfStrings(raw.mixedBoothQueue),
    separateQueue: numberValue(raw.separateQueue) ?? 0,
    raw: value,
  }
}

export const toWaitingConfig = (value: unknown): SushiroWaitingConfig | undefined => {
  if (!isRecord(value)) {
    return undefined
  }
  const storeId = value.storeId
  if (typeof storeId !== 'string' && typeof storeId !== 'number') {
    return undefined
  }
  return {
    storeId: String(storeId),
    top: value.top === true,
    stores: value.stores === true,
    ticketing: value.ticketing === true,
    ticket: value.ticket === true,
    raw: value,
  }
}

const asTicket = (value: unknown): SushiroTicket | undefined => {
  if (!isRecord(value)) {
    return undefined
  }
  const source = isRecord(value.TICKET_DETAIL) ? value.TICKET_DETAIL : value
  const ticketId = source.ticketId
  const number = source.number
  const storeId = source.storeId
  if (ticketId === undefined && number === undefined && storeId === undefined) {
    return undefined
  }
  return {
    ...(typeof ticketId === 'string' || typeof ticketId === 'number' ? { ticketId } : {}),
    ...(stringValue(storeId) ? { storeId: stringValue(storeId) } : {}),
    ...(stringValue(source.queueDate) ? { queueDate: stringValue(source.queueDate) } : {}),
    ...(stringValue(source.queueTime) ? { queueTime: stringValue(source.queueTime) } : {}),
    ...(stringValue(number) ? { number: stringValue(number) } : {}),
    ...(numberValue(source.numAdult) === undefined ? {} : { adults: numberValue(source.numAdult) }),
    ...(numberValue(source.numChild) === undefined
      ? {}
      : { children: numberValue(source.numChild) }),
    ...(stringValue(source.tableType) ? { tableType: stringValue(source.tableType) } : {}),
    ...(numberValue(source.wait ?? source.waitTime) === undefined
      ? {}
      : { waitMinutes: numberValue(source.wait ?? source.waitTime) }),
    ...(stringValue(source.status) ? { status: stringValue(source.status) } : {}),
    ...(typeof source.checkedIn === 'boolean' ? { checkedIn: source.checkedIn } : {}),
    raw: value,
  }
}

const ticketArray = (value: unknown): SushiroTicket[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const ticket = asTicket(item)
        return ticket ? [ticket] : []
      })
    : []

export const toTicketStatus = (value: unknown): SushiroTicketStatus => {
  const raw = isRecord(value) ? value : {}
  return {
    tickets: ticketArray(raw.TICKETS ?? raw.tickets),
    localTickets: ticketArray(raw.LOCALTICKETS ?? raw.localTickets),
    reservations: ticketArray(raw.RESERVATIONS ?? raw.reservations),
    raw: value,
  }
}

export const toSlot = (value: unknown): SushiroSlot | undefined => {
  if (!isRecord(value)) {
    return undefined
  }
  const storeId = value.storeId
  const date = value.date
  const start = value.start
  const end = value.end
  const availability = value.availability
  if (
    (typeof storeId !== 'string' && typeof storeId !== 'number') ||
    typeof date !== 'string' ||
    typeof start !== 'string' ||
    typeof end !== 'string' ||
    typeof availability !== 'string'
  ) {
    return undefined
  }
  return {
    storeId: String(storeId),
    date,
    start,
    end,
    availability,
    available: availability.toUpperCase() === 'AVAILABLE',
    raw: value,
  }
}

export const toTicketResult = (value: unknown): SushiroTicketResult => {
  const raw = isRecord(value) ? value : {}
  const status = stringValue(raw.status) ?? stringValue(raw.result)
  const ticket =
    asTicket(raw.ticket) ??
    asTicket(raw.TICKET_DETAIL) ??
    asTicket(isRecord(raw.data) ? raw.data.ticket : undefined)
  return {
    ok: status === 'SUCCESS' || status === 'OK' || status === 'succeeded' || raw.success === true,
    ...(status ? { status } : {}),
    ...(ticket ? { ticket } : {}),
    raw: value,
  }
}

export const toTakeoutWaitTime = (value: unknown): SushiroTakeoutWaitTime | undefined => {
  if (!isRecord(value)) {
    return undefined
  }
  const data = isRecord(value.data) ? value.data : value
  const storeId = data.store_id ?? data.storeId
  if (typeof storeId !== 'string' && typeof storeId !== 'number') {
    return undefined
  }
  const minutes = numberValue(data.minutes)
  return {
    storeId: String(storeId),
    minutes: minutes ?? null,
    raw: value,
  }
}
