const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')

// Real components in the isolated features bridge. No account, filesystem or service writes.
module.exports = async ({ page, evaluate, wait, delay, root }) => {
  await page.send('Page.bringToFront')
  const navigate = async tab => {
    await evaluate('window.featureHarness.store.navigateTo(' + JSON.stringify(tab) + ')')
    await delay(550)
    if (tab === 'settings') await wait('Boolean(document.querySelector(".settings-page"))')
    if (tab === 'player') await wait('Boolean(document.querySelector(".player-page"))')
  }
  const click = selector => evaluate('document.querySelector(' + JSON.stringify(selector) + ').click()')
  const savedOrder = () => evaluate('localStorage.getItem("vutron:playlist-orders:v1")')
  const visibleOrder = () => evaluate('Array.from(document.querySelectorAll(".playlist-item[data-playlist-key]"), e => e.dataset.playlistKey)')
  const seed = () => evaluate(`window.featureHarness.store.playlists = [
    {id:11,name:'Zulu',trackCount:2,creatorUserId:7,createTime:100},
    {id:12,name:'Alpha',trackCount:2,creatorUserId:7,createTime:200},
    {id:13,name:'Beta',trackCount:2,creatorUserId:7,createTime:300}
  ]`)
  const choose = async value => {
    await click('.playlist-sort .app-select-trigger')
    await wait('Boolean(document.querySelector(".app-select-panel"))')
    await click('.app-select-options [data-value="' + value + '"]')
    await wait('!document.querySelector(".app-select-trigger[aria-expanded=true]")')
    await delay(220)
  }
  const key = async (name, code) => {
    for (const type of ['keyDown', 'keyUp'])
      await page.send('Input.dispatchKeyEvent', { type, key:name, code:name, windowsVirtualKeyCode:code })
  }
  const screenshot = async name => {
    const shot = await page.send('Page.captureScreenshot', { format:'png', captureBeyondViewport:false })
    fs.writeFileSync(path.join(root, name), Buffer.from(shot.data, 'base64'))
  }

  await navigate('library'); await seed()
  await wait('document.querySelectorAll(".playlist-item").length===3')
  await click('.library-layout-controls > button:nth-of-type(2)')
  await choose('custom')
  assert.equal(await evaluate('document.querySelectorAll(".playlist-drag-handle").length'), 3)
  assert.ok(await evaluate('Boolean(document.querySelector(".playlist-sort-hint"))'), 'Custom edit shows its optional help')
  await evaluate('document.querySelector(".playlist-drag-handle").focus()')
  await key('ArrowDown', 40)
  await wait('JSON.parse(localStorage.getItem("vutron:playlist-orders:v1"))["netease:7"].keys[0]==="7:12"')
  const committed = await savedOrder(), committedKeys = ['7:12', '7:11', '7:13']
  assert.deepEqual(await visibleOrder(), committedKeys)
  await click('.playlist-finish-order')
  assert.equal(await evaluate('Boolean(document.querySelector(".playlist-drag-handle,.playlist-sort-hint,.playlist-edit-tools"))'), false,
    'Finishing removes drag controls and hints')
  assert.equal(await savedOrder(), committed, 'Finishing retains the saved custom order')
  assert.equal(await evaluate('document.querySelector(".playlist-sort .app-select-trigger").textContent.includes("自定义")'), true)

  await click('.playlist-edit-order')
  await wait('document.querySelectorAll(".playlist-drag-handle").length===3')
  await evaluate('document.querySelector(".playlist-list").scrollIntoView({block:"center"})')
  await delay(250)
  const geometry = await evaluate(`Array.from(document.querySelectorAll('.playlist-item'),e=>{
    const r=e.getBoundingClientRect(),h=e.querySelector('.playlist-drag-handle').getBoundingClientRect()
    return {x:r.left+r.width/2,y:r.top+r.height/2,hx:h.left+h.width/2,hy:h.top+h.height/2}
  })`)
  await page.send('Emulation.setTouchEmulationEnabled', { enabled:true, maxTouchPoints:1 })
  await page.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x:geometry[0].hx,y:geometry[0].hy}] })
  await wait('Boolean(document.querySelector(".playlist-moving,.playlist-drag-preview"))')
  await page.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{x:geometry[2].x,y:geometry[2].y+5}] })
  await wait('Boolean(document.querySelector(".playlist-anchor"))')
  assert.equal(await savedOrder(), committed, 'Dragging previews without committing an intermediate order')
  assert.notDeepEqual(await visibleOrder(), committedKeys, 'The real touch gesture changes the preview order')
  await page.send('Input.dispatchTouchEvent', { type:'touchCancel', touchPoints:[] })
  await wait('!document.querySelector(".playlist-moving,.playlist-anchor,.playlist-drag-preview")')
  assert.equal(await savedOrder(), committed, 'Cancelled gesture preserves the last committed order')
  assert.deepEqual(await visibleOrder(), committedKeys)
  await click('.playlist-sort-hint .icon-button')
  assert.equal(await evaluate('localStorage.getItem("vutron:playlist-sort-hints")'), 'false')
  assert.equal(await evaluate('Boolean(document.querySelector(".playlist-sort-hint"))'), false)
  assert.equal(await evaluate('document.querySelectorAll(".playlist-drag-handle").length'), 3,
    'Dismissing help leaves editing available')
  await click('.playlist-finish-order'); await click('.playlist-edit-order')
  assert.equal(await evaluate('Boolean(document.querySelector(".playlist-sort-hint"))'), false)

  await evaluate('window.featureReady=false'); await page.send('Page.reload')
  await wait('window.featureReady===true'); await navigate('library'); await seed()
  await wait('document.querySelectorAll(".playlist-item").length===3')
  assert.deepEqual(await visibleOrder(), committedKeys, 'Saved custom order survives a full reload')
  assert.equal(await evaluate('Boolean(document.querySelector(".playlist-drag-handle,.playlist-sort-hint"))'), false,
    'Reload retains custom order without reopening the edit mode')
  await click('.playlist-edit-order')
  assert.equal(await evaluate('Boolean(document.querySelector(".playlist-sort-hint"))'), false,
    'Dismissed help stays dismissed after reload')
  await click('.playlist-finish-order')
  await navigate('settings')
  await wait(`Array.from(document.querySelectorAll('.settings-page label')).some(e=>e.textContent.includes('显示歌单排序提示'))`)
  await evaluate(`(()=>{const label=Array.from(document.querySelectorAll('.settings-page label'))
    .find(e=>e.textContent.includes('显示歌单排序提示'));if(!label)throw new Error('Missing sort hint preference');
    label.querySelector('input').click()})()`)
  assert.equal(await evaluate('localStorage.getItem("vutron:playlist-sort-hints")'), 'true')
  await navigate('library'); await click('.playlist-edit-order')
  assert.ok(await evaluate('Boolean(document.querySelector(".playlist-sort-hint"))'), 'Settings restores sort help')

  await page.send('Emulation.setDeviceMetricsOverride', { width:320, height:720, deviceScaleFactor:1, mobile:true })
  await evaluate(`(async()=>{(await import('/src/platform/interfacePreferences.ts')).fontScale.value=150;
    (await import('/src/platform/i18n.ts')).setAppLocale('en')})()`)
  await evaluate('scrollTo(0,0)'); await delay(250)
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true,
    'Custom sorting help and finish controls fit English at 320px / 150%')
  await screenshot('sorting-review-narrow.png')
  await click('.playlist-finish-order')
  await evaluate(`(async()=>{(await import('/src/platform/interfacePreferences.ts')).fontScale.value=100;
    (await import('/src/platform/i18n.ts')).setAppLocale('zh')})()`)
  await page.send('Emulation.setDeviceMetricsOverride', { width:390, height:844, deviceScaleFactor:1, mobile:true })

  await navigate('player')
  await evaluate(`window.sortingCommentTrigger=document.querySelector('.player-title-row [data-track-menu-button]');
    window.sortingCommentTrigger.focus();window.sortingCommentTrigger.click()`)
  await wait('Boolean(document.querySelector(".track-action-menu"))')
  await evaluate(`Array.from(document.querySelectorAll('.track-action-options button'))
    .find(e=>e.textContent.includes('歌曲评论')).click()`)
  await wait('Boolean(document.querySelector(".comments-sheet .comment-row"))')
  await wait('!document.querySelector(".track-action-menu")')
  const topReplyToggle = '.comment-row .comment-actions button[aria-controls]'
  await click(topReplyToggle)
  await wait('Boolean(document.querySelector(".comment-floor-region.expanded .comment-floor-collapse"))')
  await wait('window.featureHarness.backend.counts.floor===1')
  await evaluate('document.querySelector(".comment-floor-collapse").scrollIntoView({block:"center"})')
  await click('.comment-floor-collapse')
  await wait('!document.querySelector(".comment-floor-region.expanded")')
  assert.equal(await evaluate('document.activeElement===document.querySelector(' + JSON.stringify(topReplyToggle) + ')'), true,
    'Bottom collapse restores focus to its top reply toggle')
  assert.equal(await evaluate('document.querySelector(".comment-floor-region").inert'), true)
  assert.equal(await evaluate('document.querySelector(".comment-floor-region").getAttribute("aria-hidden")'), 'true')
  assert.equal(await evaluate('Boolean(document.querySelector(".comment-floor-collapse"))'), false)
  await click(topReplyToggle)
  await wait('Boolean(document.querySelector(".comment-floor-region.expanded .comment-floor-collapse"))')
  assert.equal(await evaluate('window.featureHarness.backend.counts.floor'), 1,
    'Reopening cached floor replies does not refetch')
  await evaluate(`(async()=>{(await import('/src/platform/motion.ts')).motionPreference.value='reduced'})()`)
  assert.ok(await evaluate('getComputedStyle(document.querySelector(".comment-floor-region")).transitionDuration.split(",").every(value=>parseFloat(value)<=0.0001)'),
    'Reduced motion removes perceptible reply-collapse interpolation')
  await click('.comment-floor-collapse')
  await wait('!document.querySelector(".comment-floor-region.expanded")')
  await click('.comments-sheet header button'); await wait('!document.querySelector(".comments-sheet")')
  assert.equal(await evaluate('document.activeElement===window.sortingCommentTrigger'), true)
  assert.equal(await evaluate('document.querySelector(".app-shell").inert'), false)
  console.log('PASS: sorting finish/re-entry, committed keyboard order, real touch preview/cancel, persistent optional hints/settings restore, reload, 320px English 150%, native bottom reply collapse/focus/cache and reduced motion')
}
