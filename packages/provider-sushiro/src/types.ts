import type {
  GeoPoint,
  Queue,
  QueueLane,
  Shop,
  ShopService,
  ShopStatus,
  WaitEstimate,
} from '@unorder/core'

/** Region segment used by the Sushiro CRM API. Japan is the default. */
export type SushiroRegion = 'ja' | 'sg' | 'tw' | 'hk' | 'th' | 'id' | 'my'

export type SushiroTableType = 'T' | 'C' | 'P'

export interface SushiroProviderConfig {
  /** CRM region segment. Defaults to `ja`. */
  region?: SushiroRegion
  /**
   * Store used by `menu.list` / `menu.get` when no session is open. Accepts the
   * CRM store id returned by `shop.list` / `shop.get`.
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
  readonly raw: SushiroRawStore
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

const statusOf = (value: string | undefined): ShopStatus => {
  switch (value?.toUpperCase()) {
    case 'OPEN':
      return 'open'
    case 'CLOSED':
      return 'closed'
    case 'TEMPORARILY_CLOSED':
    case 'TEMP_CLOSED':
    case 'SUSPENDED':
      return 'temporarily_closed'
    default:
      return 'unknown'
  }
}

const servicesOf = (raw: SushiroRawStore): ShopService[] => {
  const services: ShopService[] = ['dine_in', 'takeout']
  if (raw.netTicketStatus || raw.checkinStatus) {
    services.push('queue')
  }
  if (raw.reservationStatus) {
    services.push('reservation')
  }
  return services
}

export const toShop = (value: unknown): SushiroShop => {
  const raw = asRawStore(value)
  if (!raw) {
    throw new TypeError('Sushiro store payload is missing an id')
  }
  const distanceKm = numberValue(raw.distance)
  const latitude = numberValue(raw.latitude)
  const longitude = numberValue(raw.longitude)
  const location: GeoPoint | undefined =
    latitude === undefined || longitude === undefined ? undefined : { latitude, longitude }
  const statusRaw = stringValue(raw.storeStatus)
  const waitMinutes = numberValue(raw.wait)
  const waitingGroups = numberValue(raw.waitingGroup)
  const waitEstimate: WaitEstimate | undefined =
    waitMinutes === undefined && waitingGroups === undefined
      ? undefined
      : {
          service: 'dine_in',
          ...(waitMinutes === undefined ? {} : { minutes: waitMinutes }),
          ...(waitingGroups === undefined ? {} : { parties: waitingGroups }),
          raw: { waitTimeCapMinutes: numberValue(raw.waitTimeCap) },
        }
  return {
    id: String(raw.id) as SushiroShop['id'],
    brand: 'sushiro',
    ...(stringValue(raw.name) ? { name: stringValue(raw.name) } : {}),
    ...(stringValue(raw.address) ? { address: stringValue(raw.address) } : {}),
    ...(stringValue(raw.area) ? { area: stringValue(raw.area) } : {}),
    ...(location ? { location } : {}),
    ...(distanceKm === undefined || distanceKm < 0
      ? {}
      : { distanceMeters: Math.round(distanceKm * 1000) }),
    status: statusOf(statusRaw),
    ...(statusRaw ? { statusRaw } : {}),
    services: servicesOf(raw),
    ...(waitEstimate ? { waitEstimates: [waitEstimate] } : {}),
    raw,
  }
}

const lane = (
  id: string,
  name: string,
  numbers: readonly string[],
  raw: Record<string, unknown>,
): QueueLane | undefined =>
  numbers.length === 0
    ? undefined
    : {
        id,
        name,
        service: id.startsWith('reservation') ? 'reservation' : 'dine_in',
        waiting: numbers.length,
        numbers,
        raw,
      }

export const toQueue = (storeId: string, value: unknown): Queue => {
  const raw = isRecord(value) ? value : {}
  const table = arrayOfStrings(raw.storeQueue)
  const counter = arrayOfStrings(raw.storeCounterQueue ?? raw.counterQueue)
  const booth = arrayOfStrings(raw.storeBoothQueue ?? raw.boothQueue)
  const reservation = arrayOfStrings(raw.reservationQueue)
  const reservationCounter = arrayOfStrings(raw.reservationCounterQueue)
  const reservationBooth = arrayOfStrings(raw.reservationBoothQueue)
  const mixed = arrayOfStrings(raw.mixedQueue)
  const mixedCounter = arrayOfStrings(raw.mixedCounterQueue)
  const mixedBooth = arrayOfStrings(raw.mixedBoothQueue)
  const separate = numberValue(raw.separateQueue) ?? 0
  const lanes = [
    lane('table', 'Table', table, { field: 'storeQueue' }),
    lane('counter', 'Counter', counter, { field: 'storeCounterQueue' }),
    lane('booth', 'Booth', booth, { field: 'storeBoothQueue' }),
    lane('reservation', 'Reservation', reservation, { field: 'reservationQueue' }),
    lane('reservation_counter', 'Reservation counter', reservationCounter, {
      field: 'reservationCounterQueue',
    }),
    lane('reservation_booth', 'Reservation booth', reservationBooth, {
      field: 'reservationBoothQueue',
    }),
    lane('mixed', 'Mixed', mixed, { field: 'mixedQueue' }),
    lane('mixed_counter', 'Mixed counter', mixedCounter, { field: 'mixedCounterQueue' }),
    lane('mixed_booth', 'Mixed booth', mixedBooth, { field: 'mixedBoothQueue' }),
    ...(separate > 0
      ? [
          {
            id: 'separate',
            name: 'Separate',
            service: 'dine_in' as const,
            waiting: separate,
            raw: { field: 'separateQueue' },
          },
        ]
      : []),
  ].filter((entry): entry is QueueLane => entry !== undefined)
  return {
    shopId: String(storeId) as Queue['shopId'],
    lanes,
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
