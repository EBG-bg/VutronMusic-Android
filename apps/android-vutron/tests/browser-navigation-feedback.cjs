// Full App.vue and real CDP touch events: old navigation buttons must not retain native hover/press fills.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const { chromium } = require('@playwright/test')

async function main() {
  const browser = await chromium.launch({ headless: true })
  const out = process.env.VUTRON_TEST_ARTIFACTS || path.resolve(__dirname, '../../../_analysis/mobile-1.3.0-feedback')
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage(), errors = [], checks = []
  page.on('pageerror', error => errors.push(error.stack || error.message))
  await context.route('**/src/plugins/bridge.ts*', route => route.fulfill({ contentType: 'application/javascript', body: "export { musicPluginBridge } from '/tests/fixtures/music-plugin-native.mock.js'" }))
  try {
    await page.goto(new URL('tests/fixtures/features.html', process.env.VUTRON_TEST_BASE_URL || 'http://127.0.0.1:5187/').href)
    await page.waitForFunction(() => window.featureReady)
    await page.evaluate(() => window.featureHarness.store.stopPlaybackPolling())
    const cdp = await context.newCDPSession(page)
    const send = (type, position) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: position ? [{ id: 1, ...position, radiusX: 1, radiusY: 1, force: 1 }] : [] })
    async function center(locator, fraction = .5) {
      const b = await locator.boundingBox(); assert.ok(b?.width && b.height)
      return { x: b.x + b.width * fraction, y: b.y + b.height / 2 }
    }
    async function drag(from, to, cancel = false) {
      await send('touchStart', from)
      for (let index = 1; index <= 7; index++) {
        await send('touchMove', { x: from.x + (to.x - from.x) * index / 7, y: from.y + (to.y - from.y) * index / 7 })
        await page.waitForTimeout(18)
      }
      await send(cancel ? 'touchCancel' : 'touchEnd')
    }
    async function go(tab) {
      await page.evaluate(tab => window.featureHarness.store.navigateTo(tab), tab)
      await page.waitForFunction(tab => window.featureHarness.store.activeTab === tab, tab)
      await page.waitForTimeout(650)
    }
    async function clean(label) {
      await page.waitForTimeout(650)
      const state = await page.locator('.bottom-nav > button').evaluateAll(buttons => buttons.map(button => ({
        text: button.textContent.trim(), selected: button.classList.contains('active'), feedback: button.hasAttribute('data-original-feedback'),
        pressed: button.hasAttribute('data-original-pressed'), hover: button.matches(':hover'), focus: button.matches(':focus-visible'),
        background: getComputedStyle(button).backgroundColor, shadow: getComputedStyle(button).boxShadow, transform: getComputedStyle(button).transform,
      })))
      for (const button of state.filter(row => !row.selected && !row.focus)) {
        assert.equal(button.feedback, false, label + ': leftover custom feedback: ' + JSON.stringify(state))
        assert.equal(button.pressed, false, label + ': leftover custom press: ' + JSON.stringify(state))
        assert.equal(button.background, 'rgba(0, 0, 0, 0)', label + ': inactive button has a stale fill: ' + JSON.stringify(state))
        assert.equal(button.shadow, 'none', label + ': inactive button has a shadow')
        assert.equal(button.transform, 'none', label + ': inactive button has a stale transform')
      }
      checks.push(label)
      return state
    }
    await go('search')
    const search = page.locator('.bottom-nav > button').nth(2), settings = page.locator('.bottom-nav > button').nth(4)
    await search.tap(); await page.waitForTimeout(650)
    await drag(await center(search), await center(settings))
    await page.waitForFunction(() => window.featureHarness.store.activeTab === 'settings')
    await clean('touch footer search to settings keeps only the current indicator')
    fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, 'footer-no-stale-search.png') })

    await go('search'); await search.tap(); await page.waitForTimeout(650)
    const heading = await center(page.locator('.section-heading').first(), .7)
    await drag(heading, { x: 15, y: heading.y + 2 })
    await clean('content horizontal swipe clears the previously touched footer button')

    await go('search'); await search.tap(); await page.waitForTimeout(650)
    await drag(await center(search), await center(settings), true)
    assert.equal(await page.evaluate(() => window.featureHarness.store.activeTab), 'search')
    await clean('cancelled footer drag leaves no press on other buttons')

    await go('settings')
    const account = page.locator('.settings-collapse > summary').first()
    if (await account.count()) {
      await account.evaluate(element => element.scrollIntoView({ block: 'center' }))
      const p = await center(account)
      await send('touchStart', p); await page.waitForTimeout(50)
      assert.equal(await account.getAttribute('data-original-pressed'), '')
      await send('touchEnd'); await page.waitForTimeout(650)
      assert.equal(await account.getAttribute('data-original-feedback'), null)
      checks.push('shared touch feedback still appears on press and fades after a tap')
    }

    await page.evaluate(() => { const button = document.querySelector('.bottom-nav > button'); button.blur() })
    await page.keyboard.press('Tab')
    await search.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab')
    assert.equal(await search.evaluate(button => button.matches(':focus-visible')), true, 'keyboard focus is visible')
    await page.keyboard.press('Enter'); await page.waitForTimeout(100)
    assert.equal(await search.evaluate(button => button.matches(':focus-visible')), true, 'keyboard activation preserves its visible focus')
    checks.push('keyboard navigation and activation preserve visible focus')

    const mouseContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    try {
      const mousePage = await mouseContext.newPage()
      await mousePage.goto(new URL('tests/fixtures/features.html', process.env.VUTRON_TEST_BASE_URL || 'http://127.0.0.1:5187/').href)
      await mousePage.waitForFunction(() => window.featureReady)
      const mouseSearch = mousePage.locator('.bottom-nav > button').nth(2)
      await mouseSearch.hover(); await mousePage.waitForTimeout(250)
      assert.notEqual(await mouseSearch.evaluate(button => getComputedStyle(button).backgroundColor), 'rgba(0, 0, 0, 0)', 'a fine pointer keeps hover feedback')
      await mousePage.mouse.move(2, 2); await mousePage.waitForTimeout(350)
      assert.equal(await mouseSearch.evaluate(button => getComputedStyle(button).backgroundColor), 'rgba(0, 0, 0, 0)', 'fine pointer hover fades away after leaving')
      checks.push('real mouse hover remains available and clears after leaving')
    } finally { await mouseContext.close() }
    assert.deepEqual(errors, [])
    fs.mkdirSync(out, { recursive: true })
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ browser: browser.version(), checks, errors }, null, 2) + '\n')
    console.log('PASS: ' + checks.join('; '))
  } finally { await context.close(); await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
