import type { Bill, Cart, MenuItem, Order, Receipt, Session, Source } from './domain'
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

export interface SessionCloseOutput {
  readonly closed: boolean
}

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
  'session.close': StandardMethodSignature<CartClearInput, SessionCloseOutput>
  'menu.list': StandardMethodSignature<MenuListInput, MenuListResult>
  'menu.get': StandardMethodSignature<MenuGetInput, MenuItem>
  'cart.list': StandardMethodSignature<CartListInput, Cart>
  'cart.add': StandardMethodSignature<CartAddInput, Cart>
  'cart.remove': StandardMethodSignature<CartRemoveInput, Cart>
  'cart.clear': StandardMethodSignature<CartClearInput, Cart>
  'order.send': StandardMethodSignature<OrderSendInput, Order>
  'order.list': StandardMethodSignature<OrderListInput, OrderListResult>
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
  extensions: s.optional(s.unknown()),
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
  extensions: s.optional(s.unknown()),
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
    description: 'Looks up an item from the configured menu source without adding it to the cart.',
    input: s.object({ id: s.string() }),
    output: menuItemSchema,
    session: 'none',
    annotations: { readOnlyHint: true, destructiveHint: false },
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
