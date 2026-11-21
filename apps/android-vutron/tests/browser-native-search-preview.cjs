const assert = require('node:assert/strict')
const { chromium } = require('@playwright/test')

const form = ['.section-heading h2', '.remote-search-box input', '.remote-search-box button', '.search-categories button.selected', '.search-result-heading']
const geometry = {
  tracks: ['.select-tracks-button', '.track-row .track-copy', '.track-row .track-menu-button'],
  playlists: ['.library-layout-controls', '.search-playlist-grid img', '.playlist-copy'],
  entities: ['.search-entity-row img', '.entity-copy', '.entity-type']
}
const geometryAt = (page, selectors) => page.evaluate(selectors => {
  const origin = document.querySelector('.page.search-page, .swipe-peek').getBoundingClientRect()
  return selectors.map(selector => {
    const element = document.querySelector(selector)
    if (!element) throw new Error('Missing geometry target: ' + selector)
    const { x, y, width, height } = element.getBoundingClientRect()
    return [element.value ?? element.textContent.trim(), x - origin.x, y - origin.y, width, height]
  })
}, selectors)

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
  const base = process.argv[2] || 'http://127.0.0.1:5173'
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 800 } }), errors = [], network = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('https://preview-cover.invalid/**', route => { network.push(route.request().url()); return route.abort() })
    await page.goto(new URL('/tests/fixtures/native-search-preview.html', base).href)
    await page.waitForFunction(() => window.nativeSearchPreview)
    for (const [width, height, scale, language] of [[360, 800, 1, 'zh'], [320, 720, 1.5, 'en']]) {
      await page.setViewportSize({ width, height })
      await page.evaluate(async ({ scale, language }) => {
        document.documentElement.style.setProperty('--ui-font-scale', String(scale))
        const { setAppLocale } = await import('/src/platform/i18n.ts'); setAppLocale(language)
      }, { scale, language })
      for (const category of ['tracks', 'albums', 'artists', 'playlists', 'mvs']) {
        const row = geometry[category] || geometry.entities
        const show = async (preview, nested = false) => {
          await page.evaluate(({ category, preview, nested }) => window.nativeSearchPreview.show(category, preview, nested), { category, preview, nested })
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        }
        await show(true)
        const whole = await geometryAt(page, [...form, ...row])
        let nested
        if (category === 'tracks') {
          assert.equal(await page.locator('.track-row').count(), 24, 'Preview work is bounded for long search lists')
          assert.equal(await page.locator('.track-current').count(), 1, 'Current recording stays highlighted in the peek')
        } else {
          await show(true, true)
          nested = await geometryAt(page, row)
          assert.equal(await page.locator('.search-result-heading').count(), 0, 'A category peek has no duplicate page header')
        }
        await show(false)
        assert.deepEqual(await geometryAt(page, [...form, ...row]), whole, `Whole ${category} peek matches live geometry at ${width}px`)
        if (category !== 'tracks') {
          const liveOrigin = await page.locator('.search-page .swipe-deck').evaluate(el => el.getBoundingClientRect().y - el.closest('.search-page').getBoundingClientRect().y)
          const live = await geometryAt(page, row)
          assert.deepEqual(live.map(([label, x, y, w, h]) => [label, x, y - liveOrigin, w, h]), nested, `Adjacent ${category} peek matches live results at ${width}px`)
        }
      }
    }
    await page.evaluate(() => {
      const { show, store } = window.nativeSearchPreview
      show('playlists', true, true)
      store.adjacentSearch = { category: 'playlists', items: [{ id: 44, name: 'Remote only', coverImgUrl: 'https://preview-cover.invalid/cover.png' }] }
    })
    const card = page.locator('.swipe-peek .playlist-card')
    await card.waitFor({ state: 'attached' })
    assert.equal(await card.evaluate(element => { element.focus(); element.click(); return document.activeElement === element }), false)
    assert.equal(await page.locator('.swipe-peek img[data-artwork-state]').getAttribute('data-artwork-state'), 'missing')
    assert.deepEqual(network, [], 'Preview does not fetch unavailable remote artwork')
    assert.deepEqual(await page.evaluate(() => window.nativeSearchPreview.events), [], 'Preview cannot dispatch playlist actions')
    await page.evaluate(() => { window.nativeSearchPreview.store.adjacentSearch = undefined })
    const pending = await page.locator('.swipe-peek .empty-state').textContent()
    await page.evaluate(() => { window.nativeSearchPreview.store.adjacentSearch = { category: 'playlists', items: [] } })
    assert.notEqual(await page.locator('.swipe-peek .empty-state').textContent(), pending, 'Pending and empty prepared results have distinct states')
    await page.evaluate(() => { window.nativeSearchPreview.store.searchKeywords = 'Unsubmitted draft' })
    assert.equal(await page.locator('.swipe-peek .empty-state').count(), 0, 'Typing a new draft does not create a fake search or loading state in the peek')
    assert.deepEqual(errors, [])
    console.log(`PASS: search preview geometry for 5 categories at standard and large font sizes; read-only previews, bounded rows and pending/empty states (${browser.version()})`)
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
