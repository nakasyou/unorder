declare const brandSymbol: unique symbol

/**
 * Nominal wrapper for identifiers that must not be mixed up with plain strings.
 * Brands exist only at the type level and have no runtime cost.
 */
export type Brand<T, B extends string> = T & { readonly [brandSymbol]: B }

/** Attaches a compile-time brand to a runtime string. */
export const brand = <B extends Brand<string, string>>(value: string): B => value as B

export type ShopId = Brand<string, 'ShopId'>
export type TableId = Brand<string, 'TableId'>
export type MenuItemId = Brand<string, 'MenuItemId'>
export type CartLineId = Brand<string, 'CartLineId'>
export type OrderId = Brand<string, 'OrderId'>
export type SessionId = Brand<string, 'SessionId'>
