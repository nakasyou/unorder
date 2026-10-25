export const mockMenuHtml = `<!DOCTYPE html>
<html lang="ja">
<body>
<div class="category-tab">
  <div class="swiper-wrapper">
    <div data-target="0" class="swiper-slide category-tab__item active">フェア商品</div>
    <div data-target="1" class="swiper-slide category-tab__item">にぎり</div>
  </div>
</div>
<div class="swiper-container">
  <div class="swiper-wrapper">
    <div class="swiper-slide">
      <div class="menu-items">
        <div data-target="5271" class="menu-item">
          <img class="menu-item__img" src="https://example.test/1.png" alt="本鮪中とろ" />
          <div class="menu-item__name">本鮪中とろ</div>
          <div class="menu-item__price">
            110円(税込)
          </div>
          <div class="menu-item__setdetail"></div>
          <div class="menu-item__calorie">69kcal</div>
          <div class="menu-item__annotation">[10/14(水)～10/25(日)<br />但し完売次第終了。</div>
        </div>
        <div data-target="5280" class="menu-item">
          <img class="menu-item__img" src="https://example.test/2.png" alt="プリンアラモード" />
          <div class="menu-item__name">プリン&amp;アラモード</div>
          <div class="menu-item__price">
            380円(税込)
          </div>
          <div class="menu-item__setdetail"></div>
          <div class="menu-item__calorie">120kcal</div>
          <div class="menu-item__annotation"></div>
        </div>
      </div>
    </div>
    <div class="swiper-slide">
      <div class="menu-items">
        <div data-target="343" class="menu-item">
          <img class="menu-item__img" src="https://example.test/3.png" alt="サーモン" />
          <div class="menu-item__name">サーモン</div>
          <div class="menu-item__price">
            120円(税込)
          </div>
          <div class="menu-item__setdetail"></div>
          <div class="menu-item__calorie">80kcal</div>
          <div class="menu-item__annotation"></div>
        </div>
        <div data-target="9999" class="menu-item">
          <img class="menu-item__img" src="https://example.test/4.png" alt="販売終了" />
          <div class="menu-item__name">販売終了品</div>
          <div class="menu-item__price">
          </div>
          <div class="menu-item__setdetail"></div>
          <div class="menu-item__calorie"></div>
          <div class="menu-item__annotation">完売しました</div>
        </div>
      </div>
    </div>
  </div>
</div>
</body>
</html>`

export const rawStore = {
  id: 874,
  storeStatus: 'OPEN',
  name: 'ヤエチカ店',
  nameKana: 'やえちかてん',
  nameEn: 'Yaesu Shopping Mall',
  address: '東京都中央区八重洲2-1',
  area: '東京都',
  latitude: 35.67943188021078,
  longitude: 139.7678689678233,
  distance: '0.2',
  wait: 120,
  waitTimeCap: 180,
  waitingGroup: 79,
  netTicketStatus: 'ONLINE',
  reservationStatus: 'ON',
  checkinStatus: 'ON',
  requireNetTicketLogin: true,
  region: '関東',
}

export const rawStore2 = {
  id: 858,
  name: '有楽町店',
  storeStatus: 'OPEN',
  address: '東京都千代田区有楽町',
  latitude: 35.675413,
  longitude: 139.76285,
  distance: '0.8',
  wait: 145,
  waitingGroup: 67,
  region: '関東',
}

export const rawQueue = {
  boothQueue: ['544', '551'],
  counterQueue: ['547'],
  mixedQueue: ['544', '547'],
  reservationQueue: ['7300'],
  reservationCounterQueue: [],
  reservationBoothQueue: [],
  storeQueue: ['544', '547'],
  storeCounterQueue: [],
  storeBoothQueue: ['544'],
  separateQueue: 0,
}

export const rawTicketStatus = {
  TICKETS: [
    {
      TICKET_DETAIL: {
        ticketId: 418677667,
        storeId: '874',
        queueDate: '20261025',
        queueTime: '183000',
        number: '053',
        numAdult: 2,
        numChild: 0,
        tableType: 'T',
        wait: 30,
        status: 'WAITING',
        checkedIn: false,
      },
      STORE_INFO: rawStore,
    },
  ],
  LOCALTICKETS: [],
  RESERVATIONS: [],
}

export const rawSlots = [
  { storeId: '874', date: '20261025', start: '183000', end: '184500', availability: 'UNAVAILABLE' },
  { storeId: '874', date: '20261025', start: '184500', end: '190000', availability: 'AVAILABLE' },
  { storeId: '874', date: '20261026', start: '180000', end: '181500', availability: 'AVAILABLE' },
]

export interface RecordedRequest {
  readonly method: string
  readonly url: string
  readonly headers: Headers
  readonly body: string
}

export class MockSushiroApi {
  readonly requests: RecordedRequest[] = []
  readonly fetch: typeof globalThis.fetch

  constructor() {
    this.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      const body = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text()
      this.requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        body,
      })

      const json = (value: unknown) =>
        new Response(JSON.stringify(value), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=UTF-8' },
        })

      if (url.pathname === '/api/2.0/info/store') {
        const storeId = url.searchParams.get('storeid')
        if (storeId === String(rawStore.id)) {
          return json(rawStore)
        }
        if (storeId === String(rawStore2.id)) {
          return json(rawStore2)
        }
        return new Response('{}', { status: 404 })
      }
      if (url.pathname === '/api/2.0/info/storelist') {
        return json([rawStore, rawStore2])
      }
      if (url.pathname === '/api/2.0/info/multiplestoredetails') {
        const ids = (url.searchParams.get('storeids') ?? '').split(',')
        return json([rawStore, rawStore2].filter((store) => ids.includes(String(store.id))))
      }
      if (url.pathname === '/api/2.0/remote/groupqueues') {
        return json(rawQueue)
      }
      if (url.pathname === '/api/2.0/info/storewaitingtimeconfig') {
        return json({
          configs: [
            { storeId: 874, top: true, stores: true, ticketing: false, ticket: true },
            { storeId: 858, top: false, stores: true, ticketing: true, ticket: false },
          ],
        })
      }
      if (url.pathname === '/api/2.0/remote/opentickets') {
        return json(rawTicketStatus)
      }
      if (url.pathname === '/api/2.0/info/reservationtimeslots') {
        return json(rawSlots)
      }
      if (url.pathname === '/api/2.0/remote/storequeuecount') {
        return json(3)
      }
      if (url.pathname === '/api/2.0/remote/newticket') {
        return json({
          status: 'SUCCESS',
          TICKET_DETAIL: {
            ticketId: 1,
            storeId: '874',
            number: '054',
            numAdult: 2,
            numChild: 0,
            tableType: 'T',
            status: 'WAITING',
          },
        })
      }
      if (url.pathname === '/api/2.0/remote/cancel') {
        return json({ status: 'SUCCESS' })
      }
      if (url.pathname === '/api/2.0/remote/watchticket') {
        return json({ status: 'SUCCESS' })
      }
      if (url.pathname === '/sushipass/api/estimatedReceivingTime') {
        return json({
          status: 'succeeded',
          message: '',
          data: { minutes: '15', store_id: url.searchParams.get('store_id') },
        })
      }
      if (url.pathname === '/sushipass/api/estimatedReceivingTimeList') {
        return json({
          status: 'succeeded',
          data: (url.searchParams.get('store_id') ?? '').split(',').map((storeId) => ({
            minutes: '15',
            store_id: storeId,
          })),
        })
      }
      if (url.pathname === '/appsv2/menu/menu_detail/') {
        return new Response(mockMenuHtml, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=UTF-8' },
        })
      }
      if (url.pathname === '/api/2.0/info/config') {
        return json({ android_mobile_app_version_force: '60600', netTicketStatus: 'ONLINE' })
      }
      throw new Error(`Unexpected mock request: ${request.method} ${request.url}`)
    }
  }

  requestsTo(path: string): RecordedRequest[] {
    return this.requests.filter((request) => new URL(request.url).pathname === path)
  }
}
