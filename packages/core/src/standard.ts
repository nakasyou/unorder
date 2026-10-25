import type {
  Bill,
  Cart,
  MenuItem,
  Order,
  OrderValidation,
  Page,
  Queue,
  Receipt,
  Reservation,
  ReservationSlot,
  Session,
  Shop,
  Source,
  WaitEstimate,
  WaitlistTicket,
} from './domain'
import type {
  MethodAnnotations,
  MethodDefinition,
  MethodHandler,
  SessionRequirement,
} from './provider'
import type { Schema } from './schema'
import { s } from './schema'
import type { MenuGetInput, MenuListInput, MenuListResult } from './menu'

export interface SessionOpenInput {
  readonly qrUrl: string
  readonly peopleCount?: number
}

export interface SessionUpdateInput {
  readonly peopleCount?: number
  readonly tableId?: string
}

export interface SessionCloseOutput {
  readonly closed: boolean
}

export interface ShopListNear {
  readonly latitude: number
  readonly longitude: number
  readonly radiusMeters?: number
}

export interface ShopListInput {
  readonly near?: ShopListNear
  readonly ids?: readonly string[]
  readonly query?: string
  readonly limit?: number
  readonly offset?: number
}

export type ShopListResult = Page<Shop>

export interface ShopGetInput {
  readonly shopId: string
}

export interface QueueGetInput {
  readonly shopId?: string
}

export interface WaitlistJoinInput {
  readonly shopId?: string
  readonly partySize?: number
  readonly children?: number
  readonly service?: 'dine_in' | 'takeout'
  readonly lane?: string
  readonly seating?: 'table' | 'counter' | 'pair' | 'any'
  /** Register an existing store-issued number instead of issuing a new ticket. */
  readonly number?: string
}

export type WaitlistJoinResult = WaitlistTicket

export interface WaitlistCancelInput {
  readonly shopId?: string
  readonly ticketId?: string
}

export interface WaitlistCancelResult {
  readonly cancelled: boolean
  readonly ticket?: WaitlistTicket
  readonly raw?: unknown
}

export interface WaitlistStatusInput {
  readonly shopId?: string
  readonly ticketId?: string
}

export interface WaitlistStatusResult {
  readonly shopId?: string
  readonly tickets: readonly WaitlistTicket[]
  readonly waits?: readonly WaitEstimate[]
  readonly raw?: unknown
}

export interface ReservationSlotsInput {
  readonly shopId?: string
  readonly partySize?: number
  readonly date?: string
  readonly availableOnly?: boolean
  readonly limit?: number
  readonly offset?: number
}

export type ReservationSlotsResult = Page<ReservationSlot>

export interface ReservationListInput {
  readonly shopId?: string
}

export interface ReservationListResult {
  readonly reservations: readonly Reservation[]
  readonly raw?: unknown
}

export interface OrderReorderInput {
  readonly itemId: string
  readonly quantity?: number
  readonly optionId?: string
  readonly optionQuantity?: number
}

export interface OrderValidateInput {
  readonly itemIds?: readonly string[]
}

export type OrderValidateResult = OrderValidation

export interface CartAddInput {
  readonly itemId: string
  readonly quantity?: number
  readonly optionId?: string
  readonly optionQuantity?: number
  readonly reorder?: boolean
}

export interface CartRemoveInput {
  readonly index?: number
  readonly lineId?: string
}

export interface CartClearInput {
  readonly [key: string]: never
}

export interface OrderSendInput {
  readonly note?: string
}

export interface OrderListInput {
  readonly limit?: number
}

export interface OrderListResult {
  readonly orders: readonly Order[]
}

export interface StaffCallInput {
  readonly after?: boolean
}

export interface StaffCallResult {
  readonly ok: boolean
  readonly target: 'staff' | 'after'
}

export type BillGetInput = CartClearInput
export type ReceiptGetInput = CartClearInput
export type CartListInput = CartClearInput

export interface StandardMethodSignature<Input, Output> {
  readonly input: Input
  readonly output: Output
}

/** The provider-neutral method surface. Providers may omit methods they cannot support. */
export interface StandardMethods {
  'session.open': StandardMethodSignature<SessionOpenInput, Session>
  'session.update': StandardMethodSignature<SessionUpdateInput, Session>
  'session.close': StandardMethodSignature<CartClearInput, SessionCloseOutput>
  'menu.list': StandardMethodSignature<MenuListInput, MenuListResult>
  'menu.get': StandardMethodSignature<MenuGetInput, MenuItem>
  'shop.list': StandardMethodSignature<ShopListInput, ShopListResult>
  'shop.get': StandardMethodSignature<ShopGetInput, Shop>
  'queue.get': StandardMethodSignature<QueueGetInput, Queue>
  'waitlist.join': StandardMethodSignature<WaitlistJoinInput, WaitlistJoinResult>
  'waitlist.cancel': StandardMethodSignature<WaitlistCancelInput, WaitlistCancelResult>
  'waitlist.status': StandardMethodSignature<WaitlistStatusInput, WaitlistStatusResult>
  'reservation.slots': StandardMethodSignature<ReservationSlotsInput, ReservationSlotsResult>
  'reservation.list': StandardMethodSignature<ReservationListInput, ReservationListResult>
  'cart.list': StandardMethodSignature<CartListInput, Cart>
  'cart.add': StandardMethodSignature<CartAddInput, Cart>
  'cart.remove': StandardMethodSignature<CartRemoveInput, Cart>
  'cart.clear': StandardMethodSignature<CartClearInput, Cart>
  'cart.validate': StandardMethodSignature<OrderValidateInput, OrderValidateResult>
  'order.reorder': StandardMethodSignature<OrderReorderInput, Cart>
  'order.send': StandardMethodSignature<OrderSendInput, Order>
  'order.list': StandardMethodSignature<OrderListInput, OrderListResult>
  'order.validate': StandardMethodSignature<OrderValidateInput, OrderValidateResult>
  'bill.get': StandardMethodSignature<BillGetInput, Bill>
  'staff.call': StandardMethodSignature<StaffCallInput, StaffCallResult>
  'receipt.get': StandardMethodSignature<ReceiptGetInput, Receipt>
}

export type StandardMethodName = keyof StandardMethods
export type StandardInput<Name extends StandardMethodName> = StandardMethods[Name]['input']
export type StandardOutput<Name extends StandardMethodName> = StandardMethods[Name]['output']

export interface StandardMethodSpec {
  readonly summary: string
  readonly description: string
  readonly input: Schema
  readonly output: Schema
  readonly session: SessionRequirement
  readonly annotations: MethodAnnotations
}

const moneySchema = s.object({
  amount: s.number({ description: 'Amount in the currency minor unit (yen for JPY)' }),
  currency: s.string({ description: 'ISO 4217 currency code', minLength: 3, maxLength: 3 }),
})

const optionSchema = s.object({
  id: s.string(),
  name: s.string(),
  priceDelta: s.optional(moneySchema),
  required: s.optional(s.boolean()),
  minimum: s.optional(s.integer({ minimum: 0 })),
  maximum: s.optional(s.integer({ minimum: 0 })),
})

const menuItemSchema = s.object({
  id: s.string(),
  name: s.string(),
  kana: s.optional(s.string()),
  price: moneySchema,
  category: s.optional(s.string()),
  tags: s.array(s.string()),
  imageUrl: s.optional(s.string()),
  description: s.optional(s.string()),
  options: s.optional(s.array(optionSchema)),
  availability: s.string({ enum: ['available', 'sold_out', 'unknown'] }),
  source: s.string({ enum: ['static', 'dynamic'] }),
  raw: s.optional(s.unknown()),
})

const sourceSchema = s.object(
  {
    kind: s.string({ enum: ['static', 'dynamic', 'injected'] }),
    url: s.optional(s.string()),
    file: s.optional(s.string()),
    providerId: s.optional(s.string()),
    label: s.optional(s.string()),
    fetchedAt: s.optional(s.string()),
  },
  { additionalProperties: true },
)

const selectedOptionSchema = s.object({
  optionId: s.string(),
  name: s.optional(s.string()),
  quantity: s.integer({ minimum: 0 }),
  priceDelta: s.optional(moneySchema),
})

const cartLineSchema = s.object({
  id: s.string(),
  itemId: s.string(),
  name: s.string(),
  unitPrice: moneySchema,
  quantity: s.integer({ minimum: 1 }),
  options: s.optional(s.array(selectedOptionSchema)),
  reorder: s.optional(s.boolean()),
  raw: s.optional(s.unknown()),
})

const cartSchema = s.object({
  lines: s.array(cartLineSchema),
  itemCount: s.integer({ minimum: 0 }),
  subtotal: moneySchema,
  updatedAt: s.optional(s.string()),
})

const orderLineSchema = s.object({
  itemId: s.string(),
  name: s.string(),
  quantity: s.integer({ minimum: 1 }),
  unitPrice: moneySchema,
  total: moneySchema,
  options: s.optional(s.array(selectedOptionSchema)),
  reorder: s.optional(s.boolean()),
  raw: s.optional(s.unknown()),
})

const orderSchema = s.object({
  id: s.string(),
  status: s.string({
    enum: ['draft', 'submitted', 'preparing', 'served', 'cancelled', 'completed', 'unknown'],
  }),
  lines: s.array(orderLineSchema),
  itemCount: s.integer({ minimum: 0 }),
  total: moneySchema,
  submittedAt: s.optional(s.string()),
  raw: s.optional(s.unknown()),
})

const sessionSchema = s.object({
  provider: s.string(),
  sessionId: s.optional(s.string()),
  shop: s.optional(s.unknown()),
  table: s.optional(s.unknown()),
  peopleCount: s.optional(s.integer({ minimum: 0 })),
  page: s.optional(s.string()),
  openedAt: s.string(),
  updatedAt: s.string(),
  raw: s.optional(s.unknown()),
})

const geoPointSchema = s.object({
  latitude: s.number({ minimum: -90, maximum: 90 }),
  longitude: s.number({ minimum: -180, maximum: 180 }),
})

const waitEstimateSchema = s.object(
  {
    service: s.optional(s.string({ enum: ['dine_in', 'takeout', 'queue', 'reservation'] })),
    lane: s.optional(s.string()),
    minutes: s.optional(s.number({ minimum: 0 })),
    parties: s.optional(s.number({ minimum: 0 })),
    updatedAt: s.optional(s.string()),
    raw: s.optional(s.unknown()),
  },
  { additionalProperties: true },
)

const openingHoursSchema = s.object(
  {
    day: s.optional(s.string()),
    opens: s.optional(s.string()),
    closes: s.optional(s.string()),
    raw: s.optional(s.unknown()),
  },
  { additionalProperties: true },
)

const shopSchema = s.object(
  {
    id: s.string(),
    name: s.optional(s.string()),
    brand: s.optional(s.string()),
    address: s.optional(s.string()),
    area: s.optional(s.string()),
    location: s.optional(geoPointSchema),
    distanceMeters: s.optional(s.number({ minimum: 0 })),
    status: s.optional(s.string({ enum: ['open', 'closed', 'temporarily_closed', 'unknown'] })),
    statusRaw: s.optional(s.string()),
    services: s.optional(
      s.array(s.string({ enum: ['dine_in', 'takeout', 'queue', 'reservation'] })),
    ),
    waitEstimates: s.optional(s.array(waitEstimateSchema)),
    openingHours: s.optional(s.array(openingHoursSchema)),
    raw: s.optional(s.unknown()),
  },
  { additionalProperties: true },
)

const pageSchema = (items: Schema) =>
  s.object({
    items: s.array(items),
    total: s.integer({ minimum: 0 }),
    offset: s.integer({ minimum: 0 }),
    limit: s.integer({ minimum: 1 }),
    hasMore: s.boolean(),
  })

const queueLaneSchema = s.object(
  {
    id: s.optional(s.string()),
    name: s.optional(s.string()),
    service: s.optional(s.string({ enum: ['dine_in', 'takeout', 'queue', 'reservation'] })),
    waiting: s.optional(s.number({ minimum: 0 })),
    numbers: s.optional(s.array(s.string())),
    wait: s.optional(waitEstimateSchema),
    raw: s.optional(s.unknown()),
  },
  { additionalProperties: true },
)

const queueSchema = s.object(
  {
    shopId: s.string(),
    lanes: s.array(queueLaneSchema),
    updatedAt: s.optional(s.string()),
    raw: s.optional(s.unknown()),
  },
  { additionalProperties: true },
)

const waitlistTicketSchema = s.object(
  {
    id: s.optional(s.string()),
    number: s.optional(s.string()),
    shopId: s.string(),
    status: s.string({
      enum: ['waiting', 'called', 'seated', 'cancelled', 'expired', 'unknown'],
    }),
    statusRaw: s.optional(s.string()),
    partySize: s.optional(s.integer({ minimum: 1 })),
    service: s.optional(s.string({ enum: ['dine_in', 'takeout', 'queue', 'reservation'] })),
    lane: s.optional(s.string()),
    estimatedWaitMinutes: s.optional(s.number({ minimum: 0 })),
    position: s.optional(s.integer({ minimum: 0 })),
    issuedAt: s.optional(s.string()),
    raw: s.optional(s.unknown()),
  },
  { additionalProperties: true },
)

const reservationSlotSchema = s.object(
  {
    shopId: s.string(),
    service: s.optional(s.string({ enum: ['dine_in', 'takeout', 'queue', 'reservation'] })),
    start: s.string(),
    end: s.string(),
    available: s.boolean(),
    status: s.optional(s.string()),
    raw: s.optional(s.unknown()),
  },
  { additionalProperties: true },
)

const reservationSchema = s.object(
  {
    id: s.optional(s.string()),
    shopId: s.string(),
    status: s.string({
      enum: ['confirmed', 'pending', 'cancelled', 'expired', 'unknown'],
    }),
    statusRaw: s.optional(s.string()),
    partySize: s.optional(s.integer({ minimum: 1 })),
    start: s.optional(s.string()),
    end: s.optional(s.string()),
    raw: s.optional(s.unknown()),
  },
  { additionalProperties: true },
)

const orderValidationSchema = s.object({
  ok: s.boolean(),
  issues: s.array(s.string()),
  checks: s.optional(s.unknown()),
  raw: s.optional(s.unknown()),
})

const emptyInput = s.object({})

/** Descriptions and JSON schemas shared by all providers. */
export const standardMethodSpecs = {
  'session.open': {
    summary: 'Open a provider session from a QR URL or deep link.',
    description:
      'Resolves the provider-specific entry URL, establishes cookies and tokens, and makes later methods available. Optional party size is applied when the provider supports it.',
    input: s.object({
      qrUrl: s.string({ description: 'QR code URL or provider deep link', format: 'uri' }),
      peopleCount: s.optional(s.integer({ minimum: 1, maximum: 99 })),
    }),
    output: sessionSchema,
    session: 'none',
    annotations: { openWorldHint: true, destructiveHint: false },
  },
  'session.update': {
    summary: 'Update mutable session details such as party size or a local table label.',
    description:
      'Changes party size after a session is open, or records a table label when the provider supports it. In a live session changing the party size may lock or finalize the table, so callers should confirm before running it.',
    input: s.object({
      peopleCount: s.optional(s.integer({ minimum: 1, maximum: 99 })),
      tableId: s.optional(s.string({ minLength: 1 })),
    }),
    output: sessionSchema,
    session: 'required',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  'session.close': {
    summary: 'Close the current session and discard its local state.',
    description:
      'Clears the stored session state. It does not submit an order, call staff, or perform checkout.',
    input: emptyInput,
    output: s.object({ closed: s.boolean() }),
    session: 'optional',
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  'menu.list': {
    summary: 'List menu items with filtering and paging.',
    description:
      'Uses the same normalized input for static and dynamic menu providers. Static providers may refresh a snapshot; dynamic providers query upstream.',
    input: s.object({
      query: s.optional(
        s.string({ description: 'Free-text search over id, name, kana, and tags' }),
      ),
      category: s.optional(s.string()),
      tags: s.optional(s.array(s.string())),
      availability: s.optional(s.string({ enum: ['all', 'available'] })),
      limit: s.optional(s.integer({ minimum: 1, maximum: 1000 })),
      offset: s.optional(s.integer({ minimum: 0 })),
      refresh: s.optional(s.boolean({ description: 'Bypass a provider-side menu cache' })),
    }),
    output: s.object({
      items: s.array(menuItemSchema),
      total: s.integer({ minimum: 0 }),
      offset: s.integer({ minimum: 0 }),
      limit: s.integer({ minimum: 1 }),
      hasMore: s.boolean(),
      source: sourceSchema,
      fetchedAt: s.optional(s.string()),
    }),
    session: 'none',
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  'menu.get': {
    summary: 'Get a single menu item by provider item id.',
    description:
      'Looks up an item from the configured menu source without adding it to the cart. Set live to true to query live availability when the provider supports it.',
    input: s.object({
      id: s.string(),
      live: s.optional(s.boolean({ description: 'Query live availability when supported' })),
    }),
    output: menuItemSchema,
    session: 'none',
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  'shop.list': {
    summary: 'Search shops by location, ids, or a text query.',
    description:
      'Returns normalized shop records with location, status, services, and wait estimates. Providers may use a nearby search, an exact id lookup, or the full list; unsupported inputs are rejected or ignored as documented by the provider.',
    input: s.object({
      near: s.optional(
        s.object({
          latitude: s.number({ minimum: -90, maximum: 90 }),
          longitude: s.number({ minimum: -180, maximum: 180 }),
          radiusMeters: s.optional(s.number({ minimum: 0 })),
        }),
      ),
      ids: s.optional(s.array(s.string(), { minItems: 1, maxItems: 100 })),
      query: s.optional(s.string()),
      limit: s.optional(s.integer({ minimum: 1, maximum: 1000 })),
      offset: s.optional(s.integer({ minimum: 0 })),
    }),
    output: pageSchema(shopSchema),
    session: 'none',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  'shop.get': {
    summary: 'Get a single shop with status, services, and wait estimates.',
    description: 'Read-only lookup of one shop by its provider shop id.',
    input: s.object({ shopId: s.string() }),
    output: shopSchema,
    session: 'none',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  'queue.get': {
    summary: 'Read the current queue state for a shop.',
    description:
      'Returns normalized queue lanes with waiting counts and callable numbers. A lane may represent seating, takeout, or reservations depending on the provider.',
    input: s.object({ shopId: s.optional(s.string()) }),
    output: queueSchema,
    session: 'optional',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  'waitlist.join': {
    summary: 'Join or register a shop waitlist.',
    description:
      'WARNING: this can create a real queue ticket or register a store-issued number. Pass number to register an existing ticket, or omit it to issue a new one when the provider supports issuing. Require explicit human approval before using it against a live shop.',
    input: s.object({
      shopId: s.optional(s.string()),
      partySize: s.optional(s.integer({ minimum: 1, maximum: 99 })),
      children: s.optional(s.integer({ minimum: 0, maximum: 99 })),
      service: s.optional(s.string({ enum: ['dine_in', 'takeout'] })),
      lane: s.optional(s.string()),
      seating: s.optional(s.string({ enum: ['table', 'counter', 'pair', 'any'] })),
      number: s.optional(s.string({ minLength: 1 })),
    }),
    output: waitlistTicketSchema,
    session: 'optional',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  'waitlist.cancel': {
    summary: 'Cancel a waitlist ticket or reservation entry.',
    description:
      'WARNING: this is a real-world cancellation and may lose the place in line. Require explicit human approval before using it against a live shop.',
    input: s.object({
      shopId: s.optional(s.string()),
      ticketId: s.optional(s.string()),
    }),
    output: s.object({
      cancelled: s.boolean(),
      ticket: s.optional(waitlistTicketSchema),
      raw: s.optional(s.unknown()),
    }),
    session: 'optional',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  'waitlist.status': {
    summary: 'Read waitlist tickets and current wait estimates.',
    description:
      'Returns the tickets associated with the current session or anonymous client, plus the shop wait estimates when available.',
    input: s.object({
      shopId: s.optional(s.string()),
      ticketId: s.optional(s.string()),
    }),
    output: s.object({
      shopId: s.optional(s.string()),
      tickets: s.array(waitlistTicketSchema),
      waits: s.optional(s.array(waitEstimateSchema)),
      raw: s.optional(s.unknown()),
    }),
    session: 'optional',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  'reservation.slots': {
    summary: 'List reservation time slots for a shop.',
    description:
      'Read-only availability lookup for a shop, party size, and optional date. Providers that require authentication to create a reservation may still allow browsing slots.',
    input: s.object({
      shopId: s.optional(s.string()),
      partySize: s.optional(s.integer({ minimum: 1, maximum: 99 })),
      date: s.optional(s.string({ pattern: '^\\d{4}-?\\d{2}-?\\d{2}$' })),
      availableOnly: s.optional(s.boolean()),
      limit: s.optional(s.integer({ minimum: 1, maximum: 1000 })),
      offset: s.optional(s.integer({ minimum: 0 })),
    }),
    output: pageSchema(reservationSlotSchema),
    session: 'optional',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  'reservation.list': {
    summary: 'List reservations associated with the current session.',
    description:
      'Read-only list of reservation records. Creating or changing a reservation is provider-specific and intentionally not exposed without an authenticated flow.',
    input: s.object({ shopId: s.optional(s.string()) }),
    output: s.object({
      reservations: s.array(reservationSchema),
      raw: s.optional(s.unknown()),
    }),
    session: 'optional',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  'cart.list': {
    summary: 'Show the current unsubmitted cart.',
    description: 'Returns normalized cart lines and totals for the open session.',
    input: emptyInput,
    output: cartSchema,
    session: 'required',
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  'cart.add': {
    summary: 'Add an item to the cart.',
    description:
      'Looks up the item first, then records an unsubmitted cart line. Adding does not send an order to the kitchen.',
    input: s.object({
      itemId: s.string(),
      quantity: s.optional(s.integer({ minimum: 1, maximum: 99 })),
      optionId: s.optional(s.string()),
      optionQuantity: s.optional(s.integer({ minimum: 0, maximum: 99 })),
      reorder: s.optional(s.boolean()),
    }),
    output: cartSchema,
    session: 'required',
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  'cart.remove': {
    summary: 'Remove an unsubmitted cart line.',
    description:
      'Removes a line by zero-based index or by the line id returned from cart.list. This is reversible until order.send succeeds.',
    input: s.object({
      index: s.optional(s.integer({ minimum: 0 })),
      lineId: s.optional(s.string()),
    }),
    output: cartSchema,
    session: 'required',
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  'cart.clear': {
    summary: 'Clear all unsubmitted cart lines.',
    description: 'Discards the local cart without sending an order.',
    input: emptyInput,
    output: cartSchema,
    session: 'required',
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  'cart.validate': {
    summary: 'Validate the current cart before submission.',
    description:
      'Runs read-only provider checks such as ordering availability and last-order status. It does not send an order.',
    input: s.object({ itemIds: s.optional(s.array(s.string())) }),
    output: orderValidationSchema,
    session: 'required',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  'order.send': {
    summary: 'Submit the current cart to the kitchen.',
    description:
      'Sends the current unsubmitted cart. This is a real-world, destructive action; callers should require explicit human approval before running it against a live restaurant.',
    input: s.object({ note: s.optional(s.string()) }),
    output: orderSchema,
    session: 'required',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  'order.list': {
    summary: 'List orders submitted during this session.',
    description:
      'Returns locally tracked submitted order batches with normalized lines and totals.',
    input: s.object({ limit: s.optional(s.integer({ minimum: 1, maximum: 100 })) }),
    output: s.object({ orders: s.array(orderSchema) }),
    session: 'required',
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  'order.reorder': {
    summary: 'Add a previously ordered item to the cart again.',
    description:
      'Builds a new unsubmitted cart line from an item id and optional options. It does not submit an order.',
    input: s.object({
      itemId: s.string(),
      quantity: s.optional(s.integer({ minimum: 1, maximum: 99 })),
      optionId: s.optional(s.string()),
      optionQuantity: s.optional(s.integer({ minimum: 0, maximum: 99 })),
    }),
    output: cartSchema,
    session: 'required',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  'order.validate': {
    summary: 'Check ordering preconditions without submitting an order.',
    description:
      'Reports whether ordering is active and whether last-order or other restrictions apply. Providers may also report restricted-item confirmation requirements.',
    input: s.object({ itemIds: s.optional(s.array(s.string())) }),
    output: orderValidationSchema,
    session: 'required',
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  'bill.get': {
    summary: 'Get the current bill/account summary.',
    description:
      'Opens the provider accounting view and returns submitted lines and totals. Some providers may treat this as the start of checkout.',
    input: emptyInput,
    output: s.object({
      lines: s.array(s.unknown()),
      itemCount: s.integer({ minimum: 0 }),
      total: moneySchema,
      controlNo: s.optional(s.string()),
      dummyNo: s.optional(s.string()),
      raw: s.optional(s.unknown()),
    }),
    session: 'required',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  'staff.call': {
    summary: 'Call staff or request after-service.',
    description:
      'Calls a human at the table. This has an immediate real-world effect and should require explicit approval.',
    input: s.object({ after: s.optional(s.boolean()) }),
    output: s.object({
      ok: s.boolean(),
      target: s.string({ enum: ['staff', 'after'] }),
    }),
    session: 'required',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  'receipt.get': {
    summary: 'Complete checkout and get receipt details.',
    description:
      'Opens the provider receipt/checkout view. On some providers this finalizes payment intent, so it is treated as destructive.',
    input: emptyInput,
    output: s.object({
      barcodeValue: s.optional(s.string()),
      barcodeImageUrl: s.optional(s.string()),
      tableId: s.optional(s.string()),
      total: s.optional(moneySchema),
      raw: s.optional(s.unknown()),
    }),
    session: 'required',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
} satisfies Record<StandardMethodName, StandardMethodSpec>

/** Defines a standard method while reusing the shared metadata and schemas. */
export const defineStandardMethod = <Name extends StandardMethodName, State, Config>(
  name: Name,
  handler: MethodHandler<State, Config, StandardInput<Name>, StandardOutput<Name>>,
): MethodDefinition<State, Config, StandardInput<Name>, StandardOutput<Name>> => ({
  name,
  ...standardMethodSpecs[name],
  handler,
})

export type StandardMenuSource = Source
