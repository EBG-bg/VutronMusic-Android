const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
module.exports = async ({ page, evaluate, wait, delay, root }) => {
  const key = async (key, code, shiftKey = false) => {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, modifiers: shiftKey ? 8 : 0 })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code })
  }
  const open = async selector => {
    await evaluate('(()=>{const e=document.querySelector(' + JSON.stringify(selector) + ');e.scrollIntoView({block:"center"});e.focus();e.click()})()')
    await wait('Boolean(document.querySelector(".app-select-panel [aria-selected=true]"))')
    await delay(200)
    assert.equal(await evaluate('document.querySelector("#app").inert'), true)
    assert.equal(await evaluate('document.querySelector(".app-select-panel").contains(document.activeElement)'), true)
    assert.equal(await evaluate('(()=>{const r=document.querySelector(".app-select-panel").getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()'), true)
    assert.equal(await evaluate('document.querySelectorAll("select").length'), 0, 'Application options never create native select elements')
  }
  const closed = async selector => {
    await wait('!document.querySelector(".app-select-panel")')
    assert.equal(await evaluate('document.querySelector("#app").inert'), false)
    assert.equal(await evaluate('document.activeElement===document.querySelector(' + JSON.stringify(selector) + ')'), true)
  }
  const sort = '.playlist-sort .app-select-trigger'
  await open(sort)
  assert.equal(await evaluate('document.activeElement.dataset.value'), 'original')
  await key('End', 35)
  assert.equal(await evaluate('document.activeElement.dataset.value'), 'custom')
  for (let i = 0; i < 7; i++) {
    await key('Tab', 9, i % 2 === 0)
    assert.equal(await evaluate('document.querySelector(".app-select-panel").contains(document.activeElement)'), true, 'Tab remains inside the picker')
  }
  await key('Escape', 27); await closed(sort)
  assert.equal(await evaluate('document.querySelector(' + JSON.stringify(sort) + ').dataset.value'), 'original', 'Cancelling leaves the sort unchanged')
  await open(sort)
  await evaluate('document.querySelector(".app-select-layer").click()'); await closed(sort)
  await open(sort)
  assert.equal(await evaluate('(async()=>{const {closeAppSelect}=await import("/src/platform/appSelect.ts");return closeAppSelect()})()'), true)
  await closed(sort)
  assert.equal(await evaluate('window.featureHarness.store.activeTab'), 'library', 'Back closes options without navigating')

  const columns = '.layout-count-control .app-select-trigger'
  const before = await evaluate('document.querySelector(' + JSON.stringify(columns) + ').dataset.value')
  await open(columns)
  await evaluate('document.querySelector(".app-select-options [data-value=\\"4\\"]").click()'); await closed(columns)
  assert.equal(await evaluate('(async()=>(await import("/src/platform/libraryLayout.ts")).playlistColumns.value)()'), 4, 'Numeric settings keep their numeric type')
  await open(columns)
  await evaluate('document.querySelector(' + JSON.stringify('.app-select-options [data-value="' + before + '"]') + ').click()'); await closed(columns)

  await evaluate('window.featureHarness.store.navigateTo("settings")'); await delay(550)
  await evaluate('(()=>{const e=document.querySelector("[data-settings-section=language]");if(!e.open)e.querySelector("summary").click()})()'); await delay(360)
  const language = '#app-language'
  await open(language)
  await evaluate('document.querySelector(".app-select-options [data-value=en]").click()'); await closed(language)
  assert.equal(await evaluate('localStorage.getItem("vutron:language")'), 'en')
  await open(language)
  await evaluate('document.querySelector(".app-select-options [data-value=zh]").click()'); await closed(language)

  await evaluate('window.featureHarness.store.navigateTo("library")'); await delay(550)
  for (const theme of ['light', 'dark']) {
    await evaluate('(async()=>{(await import("/src/platform/appearance.ts")).appearance.value=' + JSON.stringify(theme) + '})()')
    await open(sort)
    const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    fs.writeFileSync(path.join(root, 'app-select-' + theme + '.png'), Buffer.from(shot.data, 'base64'))
    await key('Escape', 27); await closed(sort)
  }
  await evaluate('(async()=>{(await import("/src/platform/appearance.ts")).appearance.value="auto"})()')
  console.log('PASS: custom options, keyboard loop, cancel/back, focus/inert restoration, numeric columns, language persistence, light/dark layout')
}
