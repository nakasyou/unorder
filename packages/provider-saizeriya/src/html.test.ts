import { describe, expect, it } from 'vite-plus/test'
import { HtmlDocument, textContent } from './html'

describe('HtmlDocument', () => {
  it('parses attributes and unclosed input tags', () => {
    const document = new HtmlDocument(
      '<form id="frm_ctrl" class="menu-page" action="./?abc"><input id="shop-id" value="525"><input name="token" value="t&amp;1"></form>',
    )
    expect(document.querySelector('form[id="frm_ctrl"]')?.attributes.class).toBe('menu-page')
    expect(document.querySelector('input[id="shop-id"]')?.attributes.value).toBe('525')
    expect(document.querySelector('input[name="token"]')?.attributes.value).toBe('t&1')
  })

  it('supports descendant and child selectors', () => {
    const document = new HtmlDocument(
      '<div id="body-section"><div class="list-base"><table><tbody><tr><td>A</td><td>2</td><td>300</td></tr></tbody></table></div></div>',
    )
    expect(document.querySelectorAll('#body-section .list-base table tbody tr')).toHaveLength(1)
    expect(document.querySelector('div.list-base > table tbody')?.tag).toBe('tbody')
    expect(document.querySelectorAll('table > tr')).toHaveLength(0)
  })

  it('extracts text and decodes entities', () => {
    const document = new HtmlDocument('<div id="number">3名&nbsp;<span>&lt;ok&gt;</span></div>')
    const element = document.querySelector('#number')
    expect(element ? textContent(element) : '').toBe('3名\u00a0<ok>')
  })

  it('ignores script bodies while parsing', () => {
    const document = new HtmlDocument('<script>if (a < b) {}</script><p id="x">ok</p>')
    expect(document.querySelector('#x')?.tag).toBe('p')
  })
})
