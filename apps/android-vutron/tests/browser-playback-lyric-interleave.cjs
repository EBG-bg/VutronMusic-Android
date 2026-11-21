// Real app UI and controllable native bridge; all media and account data are fixtures.
const assert = require('node:assert/strict')
const path = require('node:path')
const { chromium } = require('@playwright/test')

async function main() {
  const app = path.resolve(__dirname, '..')
  const { createServer } = await import('vite')
  const server = await createServer({ root: app,
    optimizeDeps: { entries: ['tests/fixtures/features.html'] },
    plugins: [{ name: 'playback-lyric-fixture', enforce: 'pre', transform(_code, id) {
      if (id.replaceAll(String.fromCharCode(92), '/').endsWith('/src/platform/vutronPlugin.ts')) {
        return "export { vutronPlugin } from '/tests/fixtures/features-native.mock.js'"
      }
    } }],
    server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
  })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(new URL('tests/fixtures/features.html', server.resolvedUrls.local[0]).href)
    await page.waitForFunction(() => window.featureReady)
    await page.evaluate(async () => {
      const { vutronPlugin } = await import('/src/platform/vutronPlugin.ts')
      const { setAppLocale } = await import('/src/platform/i18n.ts')
      setAppLocale('en')
      const store = window.featureHarness.store
      store.stopPlaybackPolling()
      const state = { id: 701, nextId: 702, playing: true, position: 0, requests: [], held: {} }
      vutronPlugin.getPlaybackState = async () => ({
        trackId: state.id, position: state.position, duration: 180000, title: 'Track ' + state.id,
        artist: 'Fixture artist', playing: state.playing, error: '', track: { id: state.id, name: 'Track ' + state.id },
      })
      vutronPlugin.getLyrics = ({ trackId }) => {
        state.requests.push(trackId)
        return new Promise((resolve, reject) => {
          state.held[trackId] = { resolve: () => resolve({ lrc: '[00:02.00]Lyrics for ' + trackId }), reject }
        })
      }
      vutronPlugin.pause = async () => { state.playing = false }
      vutronPlugin.next = async () => { state.id = state.nextId++; state.playing = true; state.position = 0 }
      vutronPlugin.seek = async ({ position }) => { state.position = position }
      window.lyricInterleave = state
      store.navigateTo('player')
      void store.refreshPlaybackState()
    })
    const player = page.locator('.page-stage[data-slide-active] .player-page')
    const title = player.locator('.player-title h2')
    const play = player.locator('.main-play-button')
    await player.locator('.transport-small').last().waitFor()
    await player.locator('.artwork-toggle').click()
    await page.waitForFunction(() => Boolean(window.lyricInterleave.held[701]))
    assert.equal(await title.innerText(), 'Track 701')
    assert.equal(await play.getAttribute('aria-label'), 'Pause')
    await play.click()
    assert.equal(await page.evaluate(() => window.lyricInterleave.playing), false, 'The native bridge has already paused')
    await page.waitForFunction(() => !window.featureHarness.store.playback.playing, undefined, { timeout: 1600 })
    assert.equal(await play.getAttribute('aria-label'), 'Play', 'Pause is visible while the previous lyric request is held')
    await player.locator('.transport-small').last().click()
    await page.waitForFunction(() => window.featureHarness.store.playback.trackId === 702, undefined, { timeout: 1600 })
    assert.equal(await title.innerText(), 'Track 702')
    assert.equal(await play.getAttribute('aria-label'), 'Pause')
    await player.locator('.transport-small').last().click()
    await page.waitForFunction(() => window.featureHarness.store.playback.trackId === 703, undefined, { timeout: 1600 })
    await page.evaluate(async () => {
      const { store } = window.featureHarness
      await store.seek(44000)
      await store.refreshPlaybackState()
      await store.refreshPlaybackState()
    })
    assert.equal(await page.evaluate(() => window.featureHarness.store.playback.position), 44000)
    assert.deepEqual(await page.evaluate(() => window.lyricInterleave.requests), [701], 'Rapid skips and polling do not queue more reads behind an active lyric')
    await page.evaluate(() => window.lyricInterleave.held[701].resolve())
    await page.waitForFunction(() => Boolean(window.lyricInterleave.held[703]))
    assert.equal(await page.evaluate(() => window.featureHarness.store.lyrics.original.length), 0, 'Late lyrics cannot replace the selected track')
    assert.deepEqual(await page.evaluate(() => window.lyricInterleave.requests), [701,703], 'Only the last-selected track is read')
    await page.evaluate(() => window.lyricInterleave.held[703].resolve())
    await player.getByText('Lyrics for 703', { exact: true }).waitFor()

    await player.locator('.transport-small').last().click()
    await page.waitForFunction(() => Boolean(window.lyricInterleave.held[704]))
    await page.evaluate(() => window.lyricInterleave.held[704].reject(new Error('Fixture timeout')))
    await page.waitForFunction(() => !window.featureHarness.store.lyricsLoading)
    await page.evaluate(async () => {
      const { store } = window.featureHarness
      await store.refreshPlaybackState()
      await store.refreshPlaybackState()
    })
    assert.deepEqual(await page.evaluate(() => window.lyricInterleave.requests), [701,703,704], 'A failed lyric does not retry on every poll')
    await page.evaluate(async () => {
      const { store } = window.featureHarness, now = Date.now
      Date.now = () => now() + 9000
      try { await store.refreshPlaybackState() }
      finally { Date.now = now }
    })
    assert.deepEqual(await page.evaluate(() => window.lyricInterleave.requests), [701,703,704,704])
    await page.evaluate(() => window.lyricInterleave.held[704].resolve())
    await player.getByText('Lyrics for 704', { exact: true }).waitFor()
    assert.deepEqual(errors, [])
    console.log('PASS: real player pause, next and seek stay current during slow lyrics; rapid skips ignore old results and fetch only the final track; failed lyrics retry after a delay')
  } finally {
    if (browser) await browser.close()
    await server.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
