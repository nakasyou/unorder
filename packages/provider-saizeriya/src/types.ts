export type PageKind =
  | 'entry'
  | 'top'
  | 'number'
  | 'menu'
  | 'main'
  | 'history'
  | 'call'
  | 'account'
  | 'receipt'
  | 'unknown'

export interface SaizeriyaCartLine {
  id: string
  name?: string
  price?: number
  count: number
  reorder: 0 | 1
  modId: string
  modCount: number | ''
}

export interface SaizeriyaState {
  baseUrl: string
  nextId: string
  shopId: number
  tableNo: number
  peopleCount: number
  token?: string
  sessionId?: string
  page: PageKind
  cart: SaizeriyaCartLine[]
  orders: SaizeriyaCartLine[][]
  cookies: Record<string, string>
  openedAt: string
}

export interface SaizeriyaMenuEntry {
  code: string
  name: string
  kana?: string
  price: number
  category?: string
  tags?: string[]
  imageUrl?: string | null
}

export interface SaizeriyaProviderConfig {
  /**
   * Static menu snapshot URL. Defaults to the pinned raw GitHub copy in the
   * unorder repository. Set to null to require menuFile or menuItems.
   */
  menuUrl?: string | null
  /** Local menu JSON path, useful offline and in tests. */
  menuFile?: string
  /** Injected menu entries. Highest-precedence menu source. */
  menuItems?: readonly SaizeriyaMenuEntry[]
  /** Language id posted to the official endpoint. */
  language?: string
  /** Overrides the User-Agent when one is needed. */
  userAgent?: string
}

export interface ItemData {
  id: string
  name: string
  price: number
  messages: string[]
  mod_id: string
  mod_name: string
  mod_price: number
  mod_ini_cnt: number
  mod_guid: string
  drk_id: string
  drk_name: string
  drk_price: number
  drk_guid: string
  popup: string
  notice: string
  arc_type: number
  drk_type: number
  main_type: number
  state: number
}

export interface LookupItemResult {
  result: string
  item_data?: ItemData
  alcohol_check?: number
}

export interface AccountLine {
  name: string
  count: number
  price: number
}

export interface AccountSummary {
  lines: AccountLine[]
  count: number
  total: number
  controlNo?: string
  dummyNo?: string
}

export interface ReceiptSummary {
  barcodeValue?: string
  barcodeImageSrc?: string
}

export interface AddItemOptions {
  count?: number
  modId?: string
  modCount?: number
  reorder?: boolean
}

export interface CallOptions {
  after?: boolean
}

export type PageSubmitFields = Record<string, string | number | boolean | undefined>
