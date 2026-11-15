const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')

module.exports = async ({ page, evaluate, wait, delay, root }) => {
  const click = selector => evaluate('document.querySelector(' + JSON.stringify(selector) + ').click()')
  const ids = () => evaluate('Array.from(document.querySelectorAll(".local-track-section .track-row"),row=>row.dataset.localTrackKey)')
  const choose = async value => {
    await click('.local-order-select .app-select-trigger'); await wait('document.querySelector(".app-select-panel")')
    await click('.app-select-options [data-value="' + value + '"]'); await delay(240)
  }
  const leaveAndSave = async () => {
    await click('.bottom-nav > button:first-of-type'); await wait('document.querySelector(".action-dialog")')
    assert.equal(await evaluate('document.querySelectorAll(".action-dialog button").length'), 3)
    await click('.action-dialog [data-default-action]'); await wait('!document.querySelector(".action-dialog")')
  }
  await evaluate(`(async()=>{
    const {vutronPlugin:n}=await import('/src/platform/vutronPlugin.ts'),s=window.featureHarness.store;
    window.sortWrites=[];window.sortReadCount=0;window.sortFail=false;
    window.sortPlaylist={id:42,name:'Sort fixture',creatorUserId:7,trackCount:3};
    window.sortServer=[{id:1,name:'Zulu',artists:['Beta']},{id:2,name:'Alpha',artists:['Zulu']},{id:3,name:'Beta',artists:['Alpha']}].map(row=>({...row,playlistVolumeKey:'netease:42'}));
    const snapshot=()=>({userId:7,playlists:[structuredClone(window.sortPlaylist)],likedIds:[],playlist:structuredClone(window.sortPlaylist),tracks:structuredClone(window.sortServer)});
    n.getOnlineLibrary=async()=>{window.sortReadCount++;return snapshot()};
    n.getPlaylistTracks=async()=>({playlist:structuredClone(window.sortPlaylist),tracks:structuredClone(window.sortServer)});
    n.manageNeteaseLibrary=async request=>{window.sortWrites.push(structuredClone(request));await new Promise(resolve=>setTimeout(resolve,120));
      if(window.sortFail){window.sortFail=false;throw new Error('Fixture order sync failed')}
      const byId=new Map(window.sortServer.map(row=>[row.id,row]));window.sortServer=request.trackIds.map(id=>byId.get(id));return{...snapshot(),committed:true}};
    window.openSortPlaylist=()=>{s.profile={userId:7,nickname:'Sorting fixture'};s.localOnly=false;s.navigateTo('library');s.selectedPlaylist=structuredClone(window.sortPlaylist);s.tracks=structuredClone(window.sortServer)};
    window.openSortPlaylist();
  })()`)
  await wait('document.querySelectorAll(".local-track-section .track-row").length===3'); await delay(450)
  await choose('custom'); await click('.bottom-nav > button:first-of-type')
  await wait('window.featureHarness.store.activeTab==="home"'); assert.equal(await evaluate('window.sortWrites.length'), 0, 'Unchanged custom order does not write or ask')
  assert.equal(await evaluate('Boolean(document.querySelector(".action-dialog"))'), false)

  await evaluate('window.openSortPlaylist()'); await wait('document.querySelectorAll(".local-track-section .track-row").length===3'); await delay(450)
  await choose('custom')
  await evaluate('document.querySelector(".local-track-section .sort-handle").focus()')
  for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key:'ArrowDown', code:'ArrowDown', windowsVirtualKeyCode:40 })
  assert.deepEqual(await ids(), ['netease:2', 'netease:1', 'netease:3'])
  await choose('title'); assert.deepEqual(await ids(), ['netease:2', 'netease:3', 'netease:1'])
  await choose('custom'); assert.deepEqual(await ids(), ['netease:2', 'netease:1', 'netease:3'])
  assert.equal(await evaluate('window.sortWrites.length'), 0, 'Sort changes remain local while viewing')
  await leaveAndSave(); await wait('window.featureHarness.store.activeTab==="home"')
  assert.deepEqual(await evaluate('window.sortWrites.map(row=>row.trackIds)'), [[2,1,3]])
  assert.equal(await evaluate('Boolean(document.querySelector(".action-dialog"))'), false, 'Successful explicit save closes the departure question')

  await evaluate('window.openSortPlaylist()'); await wait('document.querySelectorAll(".local-track-section .track-row").length===3'); await delay(450)
  assert.deepEqual(await ids(), ['netease:2', 'netease:1', 'netease:3'])
  await choose('artist'); assert.deepEqual(await ids(), ['netease:3', 'netease:1', 'netease:2'])
  await evaluate('window.sortFail=true'); await leaveAndSave()
  assert.equal(await evaluate('window.featureHarness.store.activeTab'), 'library')
  assert.equal(await evaluate('window.sortWrites.length'), 2, 'A failed explicit save was attempted once')
  await click('.bottom-nav > button:first-of-type')
  await wait('document.querySelector(".action-dialog")'); assert.equal(await evaluate('window.featureHarness.store.activeTab'), 'library')
  assert.equal(await evaluate('document.querySelectorAll(".action-dialog button").length'), 3)
  await click('.action-dialog button:first-child'); await wait('!document.querySelector(".action-dialog")')
  assert.deepEqual(await ids(), ['netease:3', 'netease:1', 'netease:2'], 'Failed sync retains the selected local view')
  await leaveAndSave(); await wait('window.featureHarness.store.activeTab==="home"')
  assert.deepEqual(await evaluate('window.sortWrites.at(-1).trackIds'), [3,1,2]); assert.ok(await evaluate('window.sortReadCount') >= 2, 'Retry reconciles the uncertain server write first')

  await evaluate('window.openSortPlaylist()'); await wait('document.querySelectorAll(".local-track-section .track-row").length===3'); await delay(450)
  const scope = 'netease:7:playlist:42'
  const savedHistory = () => evaluate(`JSON.parse(localStorage.getItem('vutron:collection-order-history:v2:'+encodeURIComponent(${JSON.stringify(scope)})))`)
  const openHistory = async () => { await click('.local-history-button'); await wait('document.querySelector(".history-overview")'); await delay(450) }
  const previewRecent = async () => { await click('.history-recent'); await wait('document.querySelector(".history-preview")'); await delay(600) }
  const expandHistoryCard = async selector => {
    if (await evaluate(`document.querySelector(${JSON.stringify(selector + ' > summary')}).getAttribute('aria-expanded')!=="true"`)) await click(selector + ' > summary')
    await delay(400)
  }
  const backToHistory = async () => { await click('.history-preview-back'); await wait('document.querySelector(".history-overview")'); await delay(600) }
  const closeHistory = async () => { await click('.collection-history-sheet > header .icon-button'); await wait('!document.querySelector(".collection-history-sheet")'); await delay(120) }
  const writeCount = await evaluate('window.sortWrites.length')
  assert.ok((await savedHistory()).entries.some(entry => JSON.stringify(entry.keys) === JSON.stringify(['netease:1','netease:2','netease:3'])), 'Sync preserves the server order from before the first change')
  await openHistory(); assert.equal(await evaluate('document.querySelector("#app").inert'), true)
  await previewRecent()
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".history-preview-list li b"),row=>row.textContent)'), ['Alpha','Zulu','Beta'], 'Latest custom order remains separate from a more recent artist sort')
  assert.deepEqual(await ids(), ['netease:3','netease:1','netease:2'], 'Preview does not apply its order')
  assert.equal(await evaluate('window.sortWrites.length'), writeCount)
  assert.equal(await evaluate('document.activeElement.classList.contains("history-preview-back")'), true, 'Full enter transition focuses the preview after it is mounted')
  for (const type of ['keyDown','keyUp']) await page.send('Input.dispatchKeyEvent', { type, key:'Escape',code:'Escape',windowsVirtualKeyCode:27 })
  await wait('document.querySelector(".history-overview")'); await delay(600)
  assert.equal(await evaluate('Boolean(document.activeElement.dataset.historyId)'), true, 'Escape returns focus to the selected saved order after the transition')
  for (const type of ['keyDown','keyUp']) await page.send('Input.dispatchKeyEvent', { type, key:'Escape',code:'Escape',windowsVirtualKeyCode:27 })
  await wait('!document.querySelector(".collection-history-sheet")'); await delay(150)
  assert.equal(await evaluate('document.querySelector("#app").inert'), false)
  assert.equal(await evaluate('document.activeElement.classList.contains("local-history-button")'), true)
  assert.equal(await evaluate('window.sortWrites.length'), writeCount)

  await openHistory(); await previewRecent(); await expandHistoryCard('.history-manage')
  await evaluate(`(()=>{const input=document.querySelector('.history-name-form input');input.value='Morning custom order';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await click('.history-name-form button'); await wait('document.querySelector(".history-preview-heading h3").textContent==="Morning custom order"')
  await click('.history-pin-toggle'); await wait('document.querySelector(".history-pin-toggle").getAttribute("aria-checked")==="true"')
  await backToHistory(); await expandHistoryCard('.history-retention')
  await evaluate('document.querySelector(".history-limit-form input").focus()')
  for (const type of ['keyDown','keyUp']) await page.send('Input.dispatchKeyEvent', { type, key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40 })
  assert.equal(await evaluate('document.querySelector(".history-limit-form input").value'), '9', 'The themed numeric control keeps keyboard stepping')
  assert.equal((await savedHistory()).limit, 10, 'Editing the limit does not remove versions before Apply')
  await evaluate(`(()=>{const input=document.querySelector('.history-limit-form input');input.value='0';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  assert.equal(await evaluate('document.querySelector(".history-limit-form button").disabled'), true)
  await evaluate(`(()=>{const input=document.querySelector('.history-limit-form input');input.value='1';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await click('.history-limit-form button'); await delay(100)
  const retained = await savedHistory(), permanent = retained.entries.find(entry => entry.name === 'Morning custom order')
  assert.equal(retained.limit, 1); assert.equal(permanent.pinned, true)
  assert.ok(retained.entries.filter(entry => !entry.pinned).length <= 1)
  assert.equal(await evaluate('window.sortWrites.length'), writeCount, 'Name, permanent retention and limits never synchronize track order')
  await previewRecent(); await click('.history-load-actions .primary-button')
  await wait('!document.querySelector(".collection-history-sheet")'); await delay(150)
  assert.deepEqual(await ids(), ['netease:2','netease:1','netease:3'])
  assert.equal(await evaluate('window.sortWrites.length'), writeCount, 'Applying a version remains a draft until explicit save')
  await leaveAndSave(); await wait('window.featureHarness.store.activeTab==="home"')
  assert.deepEqual(await evaluate('window.sortWrites.at(-1).trackIds'), [2,1,3])

  const openScoped = async (user, playlist) => {
    await evaluate(`(()=>{const s=window.featureHarness.store;s.profile={userId:${user},nickname:'Scoped fixture'};s.navigateTo('library');s.selectedPlaylist={id:${playlist},name:'Scoped playlist',creatorUserId:${user},trackCount:3};s.tracks=structuredClone(window.sortServer)})()`)
    await wait('document.querySelectorAll(".local-track-section .track-row").length===3'); await delay(450)
  }
  await openScoped(8,42); await openHistory()
  assert.equal(await evaluate('Boolean(document.querySelector(".history-empty"))'), true, 'Another account has no access to the saved versions')
  await expandHistoryCard('.history-retention')
  assert.equal(await evaluate('document.querySelector(".history-limit-form input").value'), '10')
  await closeHistory(); await openScoped(7,43); await openHistory()
  assert.equal(await evaluate('Boolean(document.querySelector(".history-empty"))'), true, 'Another playlist has its own history')
  await expandHistoryCard('.history-retention')
  assert.equal(await evaluate('document.querySelector(".history-limit-form input").value'), '10')
  await closeHistory(); await openScoped(7,42); await openHistory()
  await expandHistoryCard('.history-retention')
  assert.equal(await evaluate('document.querySelector(".history-limit-form input").value'), '1')
  assert.ok(await evaluate('document.querySelector(".history-entries").textContent.includes("Morning custom order")'))
  await previewRecent(); await expandHistoryCard('.history-manage')
  const beforeDelete = (await savedHistory()).entries.length, beforeMetadataWrites = await evaluate('window.sortWrites.length')
  await click('.history-delete'); await wait('document.querySelector(".history-overview")'); await delay(500)
  assert.equal(await evaluate('Boolean(document.querySelector(".action-dialog"))'), false, 'Recoverable deletion uses the countdown undo notification')
  await wait('document.querySelector(".undo-action")'); await click('.undo-action'); await delay(220)
  assert.equal((await savedHistory()).entries.length, beforeDelete, 'Undo restores the exact permanent version')
  await previewRecent(); await expandHistoryCard('.history-manage'); await click('.history-delete')
  await wait('document.querySelector(".history-overview")'); await delay(500)
  assert.equal((await savedHistory()).entries.some(entry => entry.id === permanent.id), false)
  assert.equal(await evaluate('window.sortWrites.length'), beforeMetadataWrites)
  assert.deepEqual(await ids(), ['netease:2','netease:1','netease:3'], 'Deleting history never changes the current sort')
  await closeHistory()

  // Keep one named permanent version for the visual checks, then reconcile a removed/new track in preview.
  await evaluate(`(async()=>{const {recordCollectionOrder}=await import('/src/composables/collectionOrderHistory.ts');recordCollectionOrder(${JSON.stringify(scope)},['netease:2','netease:1','netease:3'],'custom')})()`)
  await openHistory(); await previewRecent(); await expandHistoryCard('.history-manage')
  await evaluate(`(()=>{const input=document.querySelector('.history-name-form input');input.value='Saved evening order';input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await click('.history-name-form button'); await click('.history-pin-toggle'); await backToHistory(); await closeHistory()
  await evaluate(`(()=>{const current=window.sortServer;window.sortServer=[{id:4,name:'Delta',artists:['New artist'],playlistVolumeKey:'netease:42'},current.find(row=>row.id===2),current.find(row=>row.id===3)];window.featureHarness.store.tracks=structuredClone(window.sortServer)})()`); await delay(120)
  await openHistory(); await previewRecent()
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".history-preview-list li b"),row=>row.textContent)'), ['Alpha','Beta','Delta'])
  assert.equal(await evaluate('document.querySelectorAll(".history-added").length'), 1)
  const previewWrites = await evaluate('window.sortWrites.length')
  await backToHistory(); await closeHistory(); assert.equal(await evaluate('window.sortWrites.length'), previewWrites)

  await evaluate(`(async()=>{const rows=Array.from({length:101},(_,index)=>({id:1000+index,name:'Preview track '+index,artists:['Artist'],playlistVolumeKey:'netease:99'}));const keys=rows.map(row=>'netease:'+row.id);const {restoreCollectionOrderHistories}=await import('/src/composables/collectionOrderHistory.ts');restoreCollectionOrderHistories({'netease:7:playlist:99':{limit:1,legacyMigrated:true,entries:Array.from({length:100},(_,index)=>({id:'long-'+index,createdAt:1800000000000+index,customAt:1800000000000+index,mode:'custom',pinned:true,name:'Permanent order '+index,keys:[...keys.slice(index),...keys.slice(0,index)]}))}});window.dispatchEvent(new Event('vutron-backup-restored'));const s=window.featureHarness.store;s.selectedPlaylist={id:99,name:'Long history',creatorUserId:7,trackCount:rows.length};s.tracks=rows})()`)
  await wait('window.featureHarness.store.tracks.length===101&&document.querySelectorAll(".local-track-section .track-row").length>0'); await delay(300)
  assert.ok(await evaluate('document.querySelectorAll(".local-track-section .track-row").length') < 101, 'The song list renders a bounded window while preserving the full collection')
  await openHistory(); assert.equal(await evaluate('document.querySelectorAll(".history-entry").length'), 80, 'Permanent history also uses progressive rendering')
  await click('.history-overview .track-list-pager'); await delay(180)
  assert.equal(await evaluate('document.querySelectorAll(".history-entry").length'), 100)
  await evaluate('document.querySelectorAll(".history-entry")[90].scrollIntoView({block:"center",behavior:"instant"})'); await delay(80)
  const listPosition = await evaluate('document.querySelector(".collection-history-sheet").scrollTop')
  const selectedLongId = await evaluate('document.querySelectorAll(".history-entry")[90].dataset.historyId')
  await evaluate('document.querySelectorAll(".history-entry")[90].click()'); await wait('document.querySelector(".history-preview")'); await delay(600)
  assert.equal(await evaluate('document.querySelectorAll(".history-preview-list li").length'), 80)
  await click('.history-preview .track-list-pager'); await delay(180)
  assert.equal(await evaluate('document.querySelectorAll(".history-preview-list li").length'), 101)
  await backToHistory()
  assert.equal(await evaluate('document.activeElement.dataset.historyId'), selectedLongId)
  assert.ok(Math.abs(await evaluate('document.querySelector(".collection-history-sheet").scrollTop') - listPosition) <= 2, 'Preview back restores deep list position through the full transition')
  assert.equal(await evaluate('window.sortWrites.length'), previewWrites)
  await closeHistory(); await evaluate('window.openSortPlaylist()'); await wait('document.querySelectorAll(".local-track-section .track-row").length===3'); await delay(450)

  const shots = path.join(root, 'playlist-sort-2026-11-15'); fs.mkdirSync(shots, { recursive:true })
  await page.send('Emulation.setDeviceMetricsOverride', { width:320,height:720,deviceScaleFactor:1,mobile:true })
  await evaluate(`import('/src/platform/interfacePreferences.ts').then(m=>m.fontScale.value=150)`)
  for (const language of ['zh','zht','en']) {
    await evaluate(`import('/src/platform/i18n.ts').then(m=>m.setAppLocale(${JSON.stringify(language)}))`)
    await openHistory(); assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true)
    const overview = await page.send('Page.captureScreenshot', { format:'png',captureBeyondViewport:false }); fs.writeFileSync(path.join(shots, 'order-history-'+language+'.png'), Buffer.from(overview.data,'base64'))
    await previewRecent(); assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true)
    assert.ok(await evaluate('document.querySelector(".history-preview-list li").getBoundingClientRect().top<innerHeight-30'), 'The first actual preview track stays visible above the fold')
    const preview = await page.send('Page.captureScreenshot', { format:'png',captureBeyondViewport:false }); fs.writeFileSync(path.join(shots, 'order-preview-'+language+'.png'), Buffer.from(preview.data,'base64'))
    await backToHistory(); await closeHistory()
  }
  await evaluate('window.openSortPlaylist()'); await wait('document.querySelectorAll(".local-track-section .track-row").length===3'); await delay(450)
  await evaluate(`(async()=>{(await import('/src/platform/interfacePreferences.ts')).fontScale.value=150;(await import('/src/platform/i18n.ts')).setAppLocale('en')})()`)
  await page.send('Emulation.setDeviceMetricsOverride', { width:320, height:720, deviceScaleFactor:1, mobile:true }); await delay(250)
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true)
  await evaluate('window.featureHarness.store.error="";window.featureHarness.store.queueNotice="";document.querySelectorAll(".app-error-notice header button").forEach(button=>button.click())'); await delay(300)
  await evaluate('scrollTo({top:document.querySelector(".local-track-section").getBoundingClientRect().top+scrollY-115,behavior:"instant"})'); await delay(100)
  const shot = await page.send('Page.captureScreenshot', { format:'png', captureBeyondViewport:false })
  fs.writeFileSync(path.join(root, 'playlist-sort-2026-11-15/native-sorting-narrow.png'), Buffer.from(shot.data, 'base64'))
  const beforeHistoryFailure = await evaluate('window.sortWrites.length')
  await choose('artist')
  await evaluate(`(()=>{window.historyStorageOriginal=Storage.prototype.setItem;window.historyQuotaAttempts=0;Storage.prototype.setItem=function(key,value){if(key.startsWith('vutron:collection-order-history:v2:')){window.historyQuotaAttempts++;throw new DOMException('Fixture history quota failure','QuotaExceededError')}return window.historyStorageOriginal.call(this,key,value)}})()`)
  try {
    await click('.bottom-nav > button:first-of-type'); await wait('document.querySelector(".action-dialog")')
    await click('.action-dialog [data-default-action]'); await wait('!document.querySelector(".action-dialog")')
    assert.ok(await evaluate('window.historyQuotaAttempts') > 0)
    assert.equal(await evaluate('window.sortWrites.length'), beforeHistoryFailure, 'A failed history save blocks the external reorder')
    assert.equal(await evaluate('window.featureHarness.store.activeTab'), 'library')
    await click('.bottom-nav > button:first-of-type'); await wait('document.querySelector(".action-dialog")'); await click('.action-dialog button:first-child'); await wait('!document.querySelector(".action-dialog")')
  } finally { await evaluate('Storage.prototype.setItem=window.historyStorageOriginal;delete window.historyStorageOriginal') }
  await leaveAndSave(); await wait('window.featureHarness.store.activeTab==="home"')
  assert.deepEqual(await evaluate('window.sortWrites.at(-1).trackIds'), [3,4,2], 'Retry saves the playlist shard before committing the chosen order')
  console.log('PASS: native sorting drafts and explicit save; sharded history, preview/cancel/confirm, name/permanent/retention/deletion/undo, account/playlist isolation, reconciliation, transition focus and three-language narrow 150% layout')
}
