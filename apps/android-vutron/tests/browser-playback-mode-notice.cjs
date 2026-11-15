const assert = require('node:assert/strict')
const { chromium } = require('@playwright/test')
async function main() {
  const browser = await chromium.launch({ headless: true }), errors = []
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.on('pageerror', error => errors.push(error.message))
    await page.goto(new URL('tests/fixtures/features.html', process.env.VUTRON_FIXTURE_URL || 'http://127.0.0.1:5173/').href)
    await page.waitForFunction(() => window.featureReady)
    assert.equal(await page.locator('.queue-notice').count(), 0, 'Startup does not announce a playback mode')
    await page.evaluate(async () => {
      const { vutronPlugin } = await import('/src/platform/vutronPlugin.ts'), { setAppLocale } = await import('/src/platform/i18n.ts')
      const state = { mode: 0, calls: 0, fail: false, unchanged: false, defer: false, resolve: undefined,
        deferPoll: false, pollResolve: undefined, pollMode: undefined, position: 2000 }
      const playback = vutronPlugin.getPlaybackState.bind(vutronPlugin), queue = vutronPlugin.getPlaybackQueue.bind(vutronPlugin)
      vutronPlugin.getPlaybackState = async () => {
        const sample = { ...await playback(), mode: state.pollMode ?? state.mode, position: state.position }
        if (state.deferPoll) { state.deferPoll = false; await new Promise(resolve => { state.pollResolve = resolve }) }
        return sample
      }
      vutronPlugin.getPlaybackQueue = async () => ({ ...await queue(), mode: state.mode })
      vutronPlugin.setPlaybackMode = async ({ mode }) => {
        state.calls++
        if (state.defer) { state.defer = false; await new Promise(resolve => { state.resolve = resolve }) }
        if (state.fail) { state.fail = false; throw new Error('Fixture mode save failed') }
        if (!state.unchanged) state.mode = mode
        state.unchanged = false; return { mode: state.mode }
      }
      window.modeNoticeHarness = { state, setAppLocale }
      window.featureHarness.store.stopPlaybackPolling()
      await window.featureHarness.store.refreshPlaybackState()
      window.featureHarness.store.navigateTo('player')
    })
    const control = page.locator('.player-page .playback-mode-control'), notice = page.locator('.queue-notice')
    await control.waitFor(); assert.equal(await notice.count(), 0, 'Native restore/poll does not announce mode')
    await control.click(); await page.waitForFunction(() => window.featureHarness.store.queueNotice === '单曲循环')
    assert.equal(await notice.innerText(), '单曲循环'); assert.equal(await page.evaluate(() => window.featureHarness.store.playbackQueue.mode), 1)
    await page.waitForTimeout(1550); await control.click(); await page.waitForFunction(() => window.featureHarness.store.queueNotice === '随机播放')
    await page.waitForTimeout(850); assert.equal(await notice.innerText(), '随机播放', 'A new successful mode restarts the shared 2200ms notice timer')
    await notice.waitFor({ state: 'detached', timeout: 2500 })
    const beforeSame = await page.evaluate(() => window.modeNoticeHarness.state.calls)
    await page.evaluate(() => window.featureHarness.store.setPlaybackMode(window.featureHarness.store.playback.mode))
    assert.equal(await page.evaluate(() => window.modeNoticeHarness.state.calls), beforeSame); assert.equal(await notice.count(), 0)

    await page.evaluate(() => { window.modeNoticeHarness.state.fail = true })
    const previous = await page.evaluate(() => window.featureHarness.store.playback.mode)
    await control.click(); await page.waitForFunction(() => window.featureHarness.store.error.includes('Fixture mode save failed'))
    assert.equal(await page.evaluate(() => window.featureHarness.store.playback.mode), previous); assert.equal(await notice.count(), 0, 'Failure cannot announce a new mode')
    await page.evaluate(() => { window.featureHarness.store.error = ''; window.modeNoticeHarness.state.unchanged = true })
    await control.click(); await page.waitForFunction(() => !window.featureHarness.store.playbackModeBusy)
    assert.equal(await notice.count(), 0, 'An unchanged native response cannot announce success')

    await page.evaluate(() => { window.modeNoticeHarness.state.defer = true })
    await control.click(); await page.waitForFunction(() => Boolean(window.modeNoticeHarness.state.resolve))
    assert.equal(await notice.count(), 0, 'A pending native write has no optimistic success notice')
    assert.equal(await control.isDisabled(), true)
    const pendingCalls = await page.evaluate(() => window.modeNoticeHarness.state.calls)
    await page.evaluate(() => window.featureHarness.store.cyclePlaybackMode())
    assert.equal(await page.evaluate(() => window.modeNoticeHarness.state.calls), pendingCalls)
    await page.evaluate(() => window.modeNoticeHarness.state.resolve()); await page.waitForFunction(() => window.featureHarness.store.queueNotice === '列表循环')
    await notice.waitFor({ state: 'detached', timeout: 3000 })

    for (const [locale, expected] of [['zht', '單曲循環'], ['en', 'Shuffle']]) {
      await page.evaluate(locale => window.modeNoticeHarness.setAppLocale(locale), locale)
      await control.click(); await page.waitForFunction(expected => window.featureHarness.store.queueNotice === expected, expected)
      assert.equal(await notice.innerText(), expected)
    }
    await page.waitForTimeout(1200)
    for (const expected of ['Repeat playlist', 'Repeat track', 'Shuffle']) { await control.click(); await page.waitForFunction(expected => window.featureHarness.store.queueNotice === expected, expected) }
    await page.waitForTimeout(1100); assert.equal(await notice.innerText(), 'Shuffle', 'Cycling back to a recent label still refreshes its expiry')
    await notice.waitFor({ state: 'detached', timeout: 2200 })

    // A poll issued before the explicit write must keep the newly confirmed mode,
    // while continuing to publish its legitimate position update.
    await page.evaluate(() => {
      const { state } = window.modeNoticeHarness; state.deferPoll = true; state.pollResolve = undefined; state.position = 4000
      window.modePollTask = window.featureHarness.store.refreshPlaybackState()
    })
    await page.waitForFunction(() => Boolean(window.modeNoticeHarness.state.pollResolve))
    await page.evaluate(() => window.featureHarness.store.setPlaybackMode(0))
    await page.evaluate(async () => { window.modeNoticeHarness.state.pollResolve(); await window.modePollTask })
    assert.equal(await page.evaluate(() => window.featureHarness.store.playback.mode), 0)
    assert.equal(await page.evaluate(() => window.featureHarness.store.playback.position), 4000)

    // A poll can also start while set is awaiting native confirmation. Even a
    // prospective mode in that sample cannot optimistically change the icon.
    await page.evaluate(() => {
      const { state } = window.modeNoticeHarness; window.featureHarness.store.queueNotice = ''; state.defer = true; state.resolve = undefined
      window.modeSetTask = window.featureHarness.store.setPlaybackMode(1)
    })
    await page.waitForFunction(() => Boolean(window.modeNoticeHarness.state.resolve))
    await page.evaluate(async () => { const { state } = window.modeNoticeHarness; state.pollMode = 1; state.position = 5000; await window.featureHarness.store.refreshPlaybackState(); state.pollMode = undefined })
    assert.equal(await page.evaluate(() => window.featureHarness.store.playback.mode), 0)
    assert.equal(await page.evaluate(() => window.featureHarness.store.playback.position), 5000)
    assert.equal(await page.evaluate(() => window.featureHarness.store.queueNotice), '')
    await page.evaluate(() => {
      const { state } = window.modeNoticeHarness; state.deferPoll = true; state.pollResolve = undefined; state.position = 5100
      window.modePollTask = window.featureHarness.store.refreshPlaybackState()
    })
    await page.waitForFunction(() => Boolean(window.modeNoticeHarness.state.pollResolve))
    await page.evaluate(async () => { window.modeNoticeHarness.state.resolve(); await window.modeSetTask })
    await page.evaluate(async () => { window.modeNoticeHarness.state.pollResolve(); await window.modePollTask })
    assert.equal(await page.evaluate(() => window.featureHarness.store.playback.mode), 1)
    assert.equal(await page.evaluate(() => window.featureHarness.store.playback.position), 5100)

    // Failed writes settle their generation as well. Late samples started in
    // that write cannot manufacture a successful mode change after the error.
    await page.evaluate(() => {
      const { state } = window.modeNoticeHarness; window.featureHarness.store.queueNotice = ''; state.defer = true; state.fail = true; state.resolve = undefined
      window.modeSetTask = window.featureHarness.store.setPlaybackMode(2)
    })
    await page.waitForFunction(() => Boolean(window.modeNoticeHarness.state.resolve))
    await page.evaluate(() => {
      const { state } = window.modeNoticeHarness; state.deferPoll = true; state.pollResolve = undefined; state.pollMode = 2; state.position = 6000
      window.modePollTask = window.featureHarness.store.refreshPlaybackState()
    })
    await page.waitForFunction(() => Boolean(window.modeNoticeHarness.state.pollResolve))
    await page.evaluate(async () => { window.modeNoticeHarness.state.resolve(); await window.modeSetTask })
    await page.evaluate(async () => { window.modeNoticeHarness.state.pollResolve(); await window.modePollTask })
    assert.equal(await page.evaluate(() => window.featureHarness.store.playback.mode), 1)
    assert.equal(await page.evaluate(() => window.featureHarness.store.playback.position), 6000)
    assert.equal(await page.evaluate(() => window.featureHarness.store.queueNotice), '')
    assert.deepEqual(errors, [])
    console.log('PASS: real App playback-mode success notice, 2200ms expiry/reset, three locales, same-mode no-op, late polls before/during/after failed writes preserve confirmed mode and publish new positions')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
