import { HtmlDocument, textContent } from './html'
import type { AccountLine, AccountSummary, PageKind, ReceiptSummary } from './types'

const priceFromText = (value: string): number => {
  const normalized = value.replace(/[^\d-]/g, '')
  const parsed = Number.parseInt(normalized, 10)
  return Number.isFinite(parsed) ? parsed : 0
}

export class PageParser {
  readonly document: HtmlDocument
  readonly html: string

  constructor(html: string) {
    this.html = html
    this.document = new HtmlDocument(html)
  }

  getOptionalInputValue(selector: string): string | undefined {
    return this.document.querySelector(selector)?.attributes.value
  }

  getInputValue(selector: string, label: string): string {
    const value = this.getOptionalInputValue(selector)
    if (value === undefined) {
      throw new Error(`${label} value not found`)
    }
    return value
  }

  getShopId(): number {
    return Number.parseInt(this.getInputValue('input[id="shop-id"]', 'Shop ID'), 10)
  }

  getTableNo(): number {
    return Number.parseInt(this.getInputValue('input[id="table-no"]', 'Table number'), 10)
  }

  getToken(): string | undefined {
    return this.getOptionalInputValue('input[name="token"]')
  }

  getSessionId(): string | undefined {
    return this.getOptionalInputValue('input[id="session-id"]')
  }

  getPeopleCount(): number | undefined {
    const value = this.getOptionalInputValue('input[id="number"]')
    if (value !== undefined && value !== '') {
      const parsed = Number.parseInt(value, 10)
      return Number.isFinite(parsed) ? parsed : undefined
    }

    const element = this.document.querySelector('#number')
    const numberText = element ? textContent(element) : ''
    const result = numberText.match(/(\d+)\s*名/)
    return result?.[1] ? Number.parseInt(result[1], 10) : undefined
  }

  getPageKind(): PageKind {
    const pageClass = this.document
      .querySelector('form[id="frm_ctrl"]')
      ?.attributes.class?.split(/\s+/)
      .find((className) => className.endsWith('-page'))

    if (!pageClass) {
      return 'unknown'
    }

    const kind = pageClass.replace(/-page$/, '')
    if (
      kind === 'top' ||
      kind === 'entry' ||
      kind === 'number' ||
      kind === 'menu' ||
      kind === 'main' ||
      kind === 'history' ||
      kind === 'call' ||
      kind === 'account' ||
      kind === 'receipt'
    ) {
      return kind
    }
    return 'unknown'
  }

  getNextActionId(): string {
    const form = this.document.querySelector('form[id="frm_ctrl"]')
    if (!form) {
      throw new Error('Form with id "frm_ctrl" not found')
    }
    const action = form.attributes.action
    if (!action) {
      throw new Error('Form action attribute not found')
    }
    const id = action.split('?')[1]
    if (!id) {
      throw new Error('No action id found in form action')
    }
    return id
  }

  getOrderLines(): AccountLine[] {
    const rowSelectors = [
      '#body-section .list-base table tbody tr',
      '#body-section .list table tbody tr',
      '.list table tbody tr',
    ]
    for (const selector of rowSelectors) {
      const rows = this.document.querySelectorAll(selector)
      if (rows.length === 0) {
        continue
      }
      return rows
        .map((row) => {
          const cells = row.children
            .filter((child) => child.kind === 'element' && child.tag === 'td')
            .map((cell) => (cell.kind === 'element' ? textContent(cell) : ''))
          return {
            name: cells[0] ?? '',
            count: Number.parseInt(cells[1] ?? '0', 10),
            price: priceFromText(cells[2] ?? '0'),
          }
        })
        .filter((line) => Boolean(line.name) && Number.isFinite(line.count))
    }
    return []
  }

  getControlNumbers(): { controlNo?: string; dummyNo?: string } {
    const controlNo = this.html.match(/\[control_no\]\s*=>\s*([^\s<]+)/)?.[1]
    const dummyNo = this.html.match(/\[dummy_no\]\s*=>\s*([^\s<]+)/)?.[1]
    return {
      ...(controlNo ? { controlNo } : {}),
      ...(dummyNo ? { dummyNo } : {}),
    }
  }

  getAccountSummary(): AccountSummary {
    const lines = this.getOrderLines()
    const countElement =
      this.document.querySelector('#body-section .amount .count span') ??
      this.document.querySelector('.amount .count span')
    const totalElement =
      this.document.querySelector('#body-section .amount .amount span') ??
      this.document.querySelector('.amount .amount span')

    const parsedCount = Number.parseInt(countElement ? textContent(countElement) : '0', 10)
    const parsedTotal = priceFromText(totalElement ? textContent(totalElement) : '0')

    return {
      lines,
      count: Number.isFinite(parsedCount)
        ? parsedCount
        : lines.reduce((sum, line) => sum + line.count, 0),
      total:
        Number.isFinite(parsedTotal) && parsedTotal > 0
          ? parsedTotal
          : lines.reduce((sum, line) => sum + line.price, 0),
      ...this.getControlNumbers(),
    }
  }

  getReceiptSummary(): ReceiptSummary {
    const image = this.document.querySelector('.receipt-page .barcode img')
    const value = this.document.querySelector('.receipt-page .barcode p')
    const barcodeValue = value ? textContent(value).replace(/\s/g, '') : undefined
    const barcodeImageSrc = image?.attributes.src
    return {
      ...(barcodeValue ? { barcodeValue } : {}),
      ...(barcodeImageSrc ? { barcodeImageSrc } : {}),
    }
  }
}
