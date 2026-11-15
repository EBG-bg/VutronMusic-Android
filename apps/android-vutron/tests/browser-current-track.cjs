const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { chromium } = require('@playwright/test')
async function main() {
  const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
  const url = process.argv[2] || 'http://127.0.0.1:5173', output = path.resolve(__dirname, '../../../_analysis/personal-0.4.17')
  fs.mkdirSync(output, { recursive: true })
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 800 } }), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(url + '/tests/fixtures/features.html'); await page.waitForFunction(() => window.featureReady === true)
    await page.evaluate(async () => {
      const { vutronPlugin: native } = await import('/src/platform/vutronPlugin.ts'), store = window.featureHarness.store
      const local = [
        { id:1,name:'Another recording',artists:['Local artist'],localUri:'content://music/other',localKey:'other',localFolderId:'folder:test' },
        { id:2,name:'Album · CUE 01',artists:['Album artist'],localUri:'content://music/album.flac',localKey:'cue-1',localFolderId:'folder:test',cueTrackNo:1,cueOffsetMs:0,cueDurationMs:120000 },
        { id:3,name:'Album · CUE 02',artists:['Album artist'],localUri:'content://music/album.flac',localKey:'cue-2',localFolderId:'folder:test',cueTrackNo:2,cueOffsetMs:120000,cueDurationMs:120000 },
        { id:3,name:'Same id · different file',artists:['Other artist'],localUri:'content://music/different',localKey:'different',localFolderId:'folder:test' }
      ]
      const online=[{id:61,name:'Online current recording',artists:['Online artist']},{id:62,name:'Next recording',artists:['Online artist']}]
      const playback = {...store.playback,track:{...local[2],localKey:'another-context',localFolderId:'folder:another',playlistVolumeKey:'local:another'},trackId:3,title:local[2].name,playing:false}
      window.currentFixture={native,local,online,playback}
      native.getPlaybackState=async()=>structuredClone(window.currentFixture.playback)
      native.getLocalMusicIndex=async()=>({tracks:structuredClone(local),indexed:true,updatedAt:Date.now()})
      native.getLocalLibrary=async()=>({folders:[{id:'folder:test',name:'Phone music',trackCount:local.length}],playlists:[]})
      native.search=async()=>({items:structuredClone(online),count:2,page:1})
      native.getHomeData=async()=>({banners:[],playlists:[],artists:[],albums:[],charts:[],dailyTracks:structuredClone(online)})
      store.localTracks=structuredClone(local);store.localLibrary={folders:[{id:'folder:test',name:'Phone music',trackCount:local.length}],playlists:[]};store.playback=structuredClone(playback);store.navigateTo('library');store.error=''
    })
    await page.waitForSelector('.library-page');await page.locator('.local-shortcut').click();await page.waitForSelector('.local-track-section .track-row.track-current');await page.waitForTimeout(300)
    assert.equal(await page.locator('.local-track-section .track-current').count(),1)
    assert.match(await page.locator('.local-track-section .track-current').textContent(),/CUE 02/)
    const stroke = async locator => locator.evaluate(row=>{const sample=document.createElement('i');sample.style.color='var(--accent)';row.append(sample);const accent=getComputedStyle(sample).color;sample.remove();const style=getComputedStyle(row);return {accent,border:style.borderTopColor,outline:style.outlineColor,shadow:style.boxShadow,background:style.backgroundColor}})
    let currentStyle=await stroke(page.locator('.local-track-section .track-current'))
    assert.equal(currentStyle.border,currentStyle.accent);assert.ok(currentStyle.shadow.includes(currentStyle.accent))
    await page.locator('.local-order-tools > .text-button').filter({hasText:'选择歌曲'}).click()
    await page.locator('.local-track-section .track-row').first().click()
    const otherSelected=await stroke(page.locator('.local-track-section .track-selected'))
    assert.notEqual(currentStyle.shadow,otherSelected.shadow,'Current recording has an inset accent rail distinct from batch selection')
    for(const [name,width,language,scale,theme] of [['current-track-zh-360',360,'zh',100,'light'],['current-track-en-320-150',320,'en',150,'light'],['current-track-zht-dark-150',360,'zht',150,'dark']]){
      await page.setViewportSize({width,height:800})
      await page.evaluate(async({language,scale,theme})=>{const {fontScale}=await import('/src/platform/interfacePreferences.ts'),{appearance}=await import('/src/platform/appearance.ts');document.querySelector('#app').__vue_app__.config.globalProperties.$i18n.locale=language;fontScale.value=scale;appearance.value=theme;window.featureHarness.store.error=''},{language,scale,theme})
      await page.locator('.track-selection-bar').scrollIntoViewIfNeeded();await page.locator('.track-selection-bar').evaluate(bar=>window.scrollTo({top:scrollY+bar.getBoundingClientRect().top-12,behavior:'instant'}));await page.waitForTimeout(200)
      await page.locator('.bottom-nav-indicator').evaluate(indicator=>Promise.all(indicator.getAnimations().map(animation=>animation.finished.catch(()=>{}))))
      currentStyle=await stroke(page.locator('.local-track-section .track-current'));assert.equal(currentStyle.border,currentStyle.accent)
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
      await page.screenshot({path:path.join(output,name+'.png')})
    }
    await page.locator('.local-track-section .track-current').click()
    assert.equal(await page.locator('.local-track-section .track-current.track-selected').count(),1)
    assert.ok((await stroke(page.locator('.local-track-section .track-current'))).shadow.includes(currentStyle.accent),'Batch selection preserves the current-recording rail')
    await page.locator('.selection-heading .icon-button').click()
    await page.evaluate(async()=>{const {fontScale}=await import('/src/platform/interfacePreferences.ts'),{appearance}=await import('/src/platform/appearance.ts');fontScale.value=100;appearance.value='light';document.querySelector('#app').__vue_app__.config.globalProperties.$i18n.locale='zh';window.currentFixture.playback.playing=true;await window.featureHarness.store.refreshPlaybackState()})
    assert.equal(await page.locator('.local-track-section .track-current').count(),1)
    await page.evaluate(async()=>{window.currentFixture.playback.playing=false;await window.featureHarness.store.refreshPlaybackState()})
    assert.equal(await page.locator('.local-track-section .track-current').count(),1,'Pause keeps the current recording highlighted')
    await page.evaluate(async()=>{const f=window.currentFixture,s=window.featureHarness.store;f.playback={...s.playback,track:{...f.online[0],playlistOrderScope:'netease:7'},trackId:61,title:f.online[0].name,playing:false};s.playback=structuredClone(f.playback);s.cachedTracks=f.online.map(track=>({...track,cached:true,localUri:'file:///cache/'+track.id+'.audio'}))})
    await page.locator('.segmented-control button').last().click();await page.waitForSelector('.offline-content .track-current')
    assert.equal(await page.locator('.offline-content .track-current').count(),1);assert.equal((await stroke(page.locator('.offline-content .track-current'))).border,(await stroke(page.locator('.offline-content .track-current'))).accent)
    await page.evaluate(async()=>{const s=window.featureHarness.store;s.navigateTo('search');await s.runSearch('tracks','fixture',true)})
    await page.waitForSelector('.search-track-list .track-current');assert.equal(await page.locator('.search-track-list .track-current').count(),1)
    await page.evaluate(()=>{window.featureHarness.store.profile={userId:8,nickname:'Other account'}});await page.waitForTimeout(80)
    assert.equal(await page.locator('.search-track-list .track-current').count(),0,'A known native account owner does not leak to a different account view')
    await page.evaluate(()=>{const s=window.featureHarness.store;s.profile={userId:7,nickname:'Fixture account'};s.selectedEntity={category:'artists',id:1,name:'Fixture artist'};s.tracks=structuredClone(window.currentFixture.online);s.navigateTo('entity')})
    await page.waitForSelector('.playlist-tracks .track-current');assert.equal(await page.locator('.playlist-tracks .track-current').count(),1)
    await page.evaluate(async()=>{const s=window.featureHarness.store;s.navigateTo('home');await s.loadHomeData()});await page.waitForSelector('.home-track-card.track-current')
    assert.equal(await page.locator('.home-track-card.track-current').count(),1)
    await page.evaluate(()=>{const f=window.currentFixture,s=window.featureHarness.store,track=f.online[0];f.playback={...f.playback,queueToken:'duplicate-queue',queueIndex:1,queueCount:2,upNextCount:0,mode:0};const q={tracks:[structuredClone(track),structuredClone(track)],index:1,upNext:[],mode:0};f.native.getPlaybackQueue=async()=>structuredClone(q);s.playback=structuredClone(f.playback);s.playbackQueue=q;s.queueOpen=true})
    await page.waitForSelector('.queue-row.current');await page.waitForTimeout(350)
    assert.equal(await page.locator('.queue-row.current').count(),1);assert.equal(await page.locator('.queue-row.current .queue-number').textContent(),'2')
    const queueStyle=await stroke(page.locator('.queue-row.current'));assert.equal(queueStyle.outline,queueStyle.accent)
    assert.deepEqual(errors,[])

    const pluginPage=await browser.newPage({viewport:{width:320,height:800}}),pluginErrors=[]
    pluginPage.on('pageerror',error=>pluginErrors.push(error.message))
    await pluginPage.route('**/src/plugins/bridge.ts*',route=>route.fulfill({contentType:'text/javascript',body:"export { musicPluginBridge } from '/tests/fixtures/music-plugin-native.mock.js'"}))
    await pluginPage.goto(url+'/tests/fixtures/plugin-lazy-actions.html?count=4');await pluginPage.waitForFunction(()=>window.lazyReady===true)
    await pluginPage.evaluate(()=>{window.lazyHarness.visible.value=true});await pluginPage.waitForSelector('.plugin-track')
    await pluginPage.evaluate(()=>{const s=window.lazyHarness.app.config.globalProperties.$pinia._s.get('androidShell');s.playback={...s.playback,trackId:900,title:'Fixture song 2',playing:false,track:{id:900,name:'Fixture song 2',pluginId:'fixture',pluginTrackId:'track-2',pluginAccountScope:'fixture-account-a'}}})
    await pluginPage.waitForSelector('.plugin-track.track-current');assert.equal(await pluginPage.locator('.plugin-track.track-current').count(),1)
    await pluginPage.locator('.plugin-track.track-current').evaluate(row=>Promise.all(row.getAnimations().map(animation=>animation.finished.catch(()=>{}))))
    const pluginStyle=await stroke(pluginPage.locator('.plugin-track.track-current'));assert.equal(pluginStyle.border,pluginStyle.accent,'Lazy plugin scoped CSS keeps the shared accent stroke')
    await pluginPage.evaluate(async()=>{window.lazyHarness.pluginBackend.plugins.find(row=>row.id==='fixture').accountScope='account-b';await window.lazyHarness.refresh()});await pluginPage.waitForTimeout(100)
    assert.equal(await pluginPage.locator('.plugin-track.track-current').count(),0,'Plugin account switches do not reuse the previous account current marker')
    await pluginPage.evaluate(()=>{const s=window.lazyHarness.app.config.globalProperties.$pinia._s.get('androidShell');s.playback.track.pluginAccountScope='account-b'});await pluginPage.waitForSelector('.plugin-track.track-current')
    assert.deepEqual(pluginErrors,[])
    console.log('PASS: current strokes in local/CUE/cache/search/entity/home/plugin/queue; paused state; native/plugin account isolation; batch selection; only actual duplicate queue item; three theme/font screenshots')
  } finally { await browser.close() }
}
main().catch(error=>{console.error(error);process.exitCode=1})
