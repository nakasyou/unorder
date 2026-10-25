import { InvalidInputError, NotFoundError } from '@unorder/core'
import {
  buildMenuUrl,
  buildUrl,
  formBody,
  requestJson,
  requestText,
  type SushiroEndpoints,
} from './http'
import {
  isRecord,
  toQueue,
  toShop,
  toSlot,
  toTakeoutWaitTime,
  toTicketResult,
  toTicketStatus,
  toWaitingConfig,
  type SushiroQueue,
  type SushiroShop,
  type SushiroSlot,
  type SushiroTakeoutWaitTime,
  type SushiroTicketResult,
  type SushiroTicketStatus,
  type SushiroWaitingConfig,
} from './types'

export interface ApiContext {
  readonly fetch: typeof globalThis.fetch
  readonly endpoints: SushiroEndpoints
}

const json = (context: ApiContext, url: string, label: string, init?: RequestInit) =>
  requestJson<unknown>({
    fetch: context.fetch,
    url,
    label,
    ...(init ? { init } : {}),
    userAgent: context.endpoints.userAgent,
  })

const text = (context: ApiContext, url: string, label: string, init?: RequestInit) =>
  requestText({
    fetch: context.fetch,
    url,
    label,
    ...(init ? { init } : {}),
    userAgent: context.endpoints.userAgent,
    expected: 'text',
  })

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

export interface StoreSearchInput {
  readonly latitude?: number
  readonly longitude?: number
  readonly numResults?: number
  readonly storeIds?: readonly string[]
  readonly guid?: string
  readonly query?: string
  readonly limit?: number
  readonly offset?: number
}

export const searchStores = async (
  context: ApiContext,
  input: StoreSearchInput,
): Promise<{ items: SushiroShop[]; total: number }> => {
  const region = context.endpoints.region
  let raw: unknown

  if (input.storeIds && input.storeIds.length > 0) {
    raw = await json(
      context,
      buildUrl(context.endpoints.crmBaseUrl, '/info/multiplestoredetails', {
        storeids: input.storeIds.join(','),
        region,
      }),
      'Sushiro store lookup',
    )
  } else if (input.latitude !== undefined && input.longitude !== undefined) {
    if (input.latitude < -90 || input.latitude > 90) {
      throw new InvalidInputError('latitude must be between -90 and 90')
    }
    if (input.longitude < -180 || input.longitude > 180) {
      throw new InvalidInputError('longitude must be between -180 and 180')
    }
    raw = await json(
      context,
      buildUrl(context.endpoints.crmBaseUrl, '/info/storelist', {
        latitude: input.latitude,
        longitude: input.longitude,
        numresults: input.numResults ?? 20,
        region,
      }),
      'Sushiro store search',
    )
  } else {
    raw = await json(
      context,
      buildUrl(context.endpoints.crmBaseUrl, '/info/storelist', {
        guid: input.guid ?? '',
        region,
      }),
      'Sushiro store list',
    )
  }

  const shops = asArray(raw).map(toShop)
  const query = input.query?.trim().toLocaleLowerCase('ja')
  const filtered = query
    ? shops.filter((shop) =>
        [
          shop.name,
          shop.address,
          shop.area,
          String(shop.id),
          String(shop.raw.nameKana),
          String(shop.raw.nameEn),
        ]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase('ja').includes(query)),
      )
    : shops

  const offset = Math.max(0, Math.trunc(input.offset ?? 0))
  const limit = Math.min(1000, Math.max(1, Math.trunc(input.limit ?? 50)))
  return { items: filtered.slice(offset, offset + limit), total: filtered.length }
}

export const getStore = async (context: ApiContext, storeId: string): Promise<SushiroShop> => {
  const raw = await json(
    context,
    buildUrl(context.endpoints.crmBaseUrl, '/info/store', {
      storeid: storeId,
      region: context.endpoints.region,
    }),
    `Sushiro store ${storeId}`,
  )
  const shop = toShop(raw)
  if (String(shop.id) !== String(storeId)) {
    throw new NotFoundError(`Sushiro store ${storeId} was not found`)
  }
  return shop
}

export const getStoreQueue = async (context: ApiContext, storeId: string): Promise<SushiroQueue> =>
  toQueue(
    storeId,
    await json(
      context,
      buildUrl(context.endpoints.crmBaseUrl, '/remote/groupqueues', {
        storeid: storeId,
        region: context.endpoints.region,
      }),
      `Sushiro store queue ${storeId}`,
    ),
  )

export const getWaitingConfig = async (
  context: ApiContext,
  storeIds: readonly string[],
): Promise<SushiroWaitingConfig[]> => {
  const raw = await json(
    context,
    buildUrl(context.endpoints.crmBaseUrl, '/info/storewaitingtimeconfig', {
      stores: storeIds.join(','),
      region: context.endpoints.region,
    }),
    'Sushiro waiting configuration',
  )
  const configs = isRecord(raw) ? raw.configs : undefined
  return asArray(configs).flatMap((value) => {
    const config = toWaitingConfig(value)
    return config ? [config] : []
  })
}

export const getTicketStatus = async (
  context: ApiContext,
  guid: string,
): Promise<SushiroTicketStatus> =>
  toTicketStatus(
    await json(
      context,
      buildUrl(context.endpoints.crmBaseUrl, '/remote/opentickets', {
        guid,
        region: context.endpoints.region,
      }),
      'Sushiro ticket status',
    ),
  )

export interface SlotQuery {
  readonly storeId: string
  readonly peopleCount: number
  readonly tableType: string
  readonly guid: string
}

export const getSlots = async (context: ApiContext, query: SlotQuery): Promise<SushiroSlot[]> => {
  const raw = await json(
    context,
    buildUrl(context.endpoints.crmBaseUrl, '/info/reservationtimeslots', {
      storeid: query.storeId,
      numpersons: query.peopleCount,
      guid: query.guid,
      tabletype: query.tableType,
      region: context.endpoints.region,
    }),
    'Sushiro reservation slots',
  )
  return asArray(raw).flatMap((value) => {
    const slot = toSlot(value)
    return slot ? [slot] : []
  })
}

export const getCheckInCount = async (
  context: ApiContext,
  storeId: string,
  ticketNumber: string,
): Promise<unknown> =>
  await json(
    context,
    buildUrl(context.endpoints.crmBaseUrl, '/remote/storequeuecount', {
      storeid: storeId,
      ticketNo: ticketNumber,
      region: context.endpoints.region,
    }),
    'Sushiro ticket wait count',
  )

export interface IssueTicketInput {
  readonly storeId: string
  readonly adults: number
  readonly children: number
  readonly tableType: string
  readonly guid: string
  readonly googleRegistrationId?: string
  readonly customerId?: string
}

export const issueTicket = async (
  context: ApiContext,
  input: IssueTicketInput,
): Promise<SushiroTicketResult> => {
  const body = formBody({
    guid: input.guid,
    storeid: input.storeId,
    adult: input.adults,
    child: input.children,
    tabletype: input.tableType,
    region: context.endpoints.region,
    googleregistrationid: input.googleRegistrationId,
    activecustomerid: input.customerId,
  })
  const raw = await json(
    context,
    buildUrl(context.endpoints.crmBaseUrl, '/remote/newticket'),
    'Sushiro ticket issue',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body,
    },
  )
  return toTicketResult(raw)
}

export const cancelTicket = async (
  context: ApiContext,
  guid: string,
): Promise<SushiroTicketResult> => {
  const body = formBody({ guid, region: context.endpoints.region })
  const raw = await json(
    context,
    buildUrl(context.endpoints.crmBaseUrl, '/remote/cancel'),
    'Sushiro ticket cancel',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body,
    },
  )
  return toTicketResult(raw)
}

export interface EnterTicketInput {
  readonly storeId: string
  readonly ticketNumber: string
  readonly guid: string
  readonly googleRegistrationId?: string
}

export const enterTicket = async (
  context: ApiContext,
  input: EnterTicketInput,
): Promise<SushiroTicketResult> => {
  const body = formBody({
    guid: input.guid,
    region: context.endpoints.region,
    googleregistrationid: input.googleRegistrationId,
    storeid: input.storeId,
    ticketnum: input.ticketNumber,
  })
  const raw = await json(
    context,
    buildUrl(context.endpoints.crmBaseUrl, '/remote/watchticket'),
    'Sushiro ticket entry',
    {
      method: 'PUT',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body,
    },
  )
  return toTicketResult(raw)
}

export const getTakeoutWaitTimes = async (
  context: ApiContext,
  storeIds: readonly string[],
): Promise<SushiroTakeoutWaitTime[]> => {
  if (storeIds.length === 0) {
    throw new InvalidInputError('At least one store id is required')
  }
  const authorization = { authorization: `Bearer ${context.endpoints.takeoutToken}` }
  if (storeIds.length === 1) {
    const raw = await json(
      context,
      buildUrl(context.endpoints.takeoutBaseUrl, '/sushipass/api/estimatedReceivingTime', {
        store_id: storeIds[0],
      }),
      'Sushiro takeout wait time',
      { headers: authorization },
    )
    const waitTime = toTakeoutWaitTime(raw)
    return waitTime ? [waitTime] : []
  }
  const raw = await json(
    context,
    buildUrl(context.endpoints.takeoutBaseUrl, '/sushipass/api/estimatedReceivingTimeList', {
      store_id: storeIds.join(','),
    }),
    'Sushiro takeout wait times',
    { headers: authorization },
  )
  const data = isRecord(raw) && Array.isArray(raw.data) ? raw.data : []
  return data.flatMap((value) => {
    const waitTime = toTakeoutWaitTime({ data: value })
    return waitTime ? [waitTime] : []
  })
}

export const getMenuHtml = async (context: ApiContext, storeId: string): Promise<string> => {
  if (!/^\d+$/.test(storeId)) {
    throw new InvalidInputError('Sushiro store id must be numeric')
  }
  return await text(context, buildMenuUrl(context.endpoints.menuBaseUrl, storeId), 'Sushiro menu')
}

export const getAppConfig = async (context: ApiContext): Promise<unknown> =>
  await json(
    context,
    buildUrl(context.endpoints.crmBaseUrl, '/info/config', {
      region: context.endpoints.region,
    }),
    'Sushiro app configuration',
  )
