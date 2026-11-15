const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {chromium}=require('playwright')
async function main(){
 const app=path.resolve(__dirname,'..'),output=path.resolve(app,'../../_analysis/frontend-audit-2026-11-15/app/sweep');fs.mkdirSync(output,{recursive:true})
 const {createServer}=await import('vite')
 const server=await createServer({root:app,logLevel:'error',server:{host:'127.0.0.1',port:0},plugins:[{name:'frontend-sweep',enforce:'pre',transform(code,id){const file=id.replaceAll('\\','/');if(file.endsWith('/src/platform/vutronPlugin.ts'))return "export {vutronPlugin} from '/tests/visual/native.mock.js'";if(file.endsWith('/src/plugins/bridge.ts'))return "export {musicPluginBridge} from '/tests/visual/plugin-bridge.mock.js'"}}]})
 let browser;const errors=[],warnings=[],results=[]
 async function settle(page){await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(420);await page.evaluate(()=>document.fonts.ready);await page.waitForFunction(()=>!document.querySelector('.page-stage')?.getAnimations().some(a=>a.playState==='running'))}
 async function capture(page,scene,state){await settle(page);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,scene+' '+state);await page.screenshot({path:path.join(output,scene+'-'+state+'.png')});results.push({scene,state,overflow})}
 try{
  await server.listen();browser=await chromium.launch({headless:true,args:['--force-color-profile=srgb','--font-render-hinting=none']})
  for(const [scene,width,height,locale,scale,theme] of [['phone',360,800,'zh',100,'light'],['narrow-en',320,720,'en',150,'light'],['dark-zht',360,800,'zht',150,'dark'],['wide',1024,768,'en',150,'light']]){
   const page=await browser.newPage({viewport:{width,height},isMobile:true,hasTouch:true});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='warning'&&m.text().includes('Failed to resolve component'))warnings.push(m.text())})
   await page.addInitScript(({locale,scale,theme})=>{localStorage.setItem('vutron:language',locale);localStorage.setItem('vutron:font-scale',String(scale));localStorage.setItem('vutron:appearance',theme);localStorage.setItem('vutron:motion-preference','full')},{locale,scale,theme})
   await page.route(/^https?:\/\//,route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort('blockedbyclient'))
   await page.goto(server.resolvedUrls.local[0]+'tests/visual/app.html');await page.waitForFunction(()=>window.visualReady)
   await page.evaluate(()=>{const s=window.visualHarness.store;s.navigateTo('search');s.searchCategory='playlists';s.searchKeywords='Evening';s.submittedSearch={keywords:'Evening',category:'playlists'};s.searchResults=s.playlists;s.searchCount=s.playlists.length;s.searchLoading=false})
   await page.locator('.library-layout-controls').waitFor();assert.equal(await page.locator('librarylayoutcontrols').count(),0);await capture(page,scene,'search-playlists')
   await page.evaluate(()=>{const s=window.visualHarness.store;s.searchCategory='tracks';s.searchResults=[];s.searchCount=0;s.searchLoading=true});await capture(page,scene,'search-loading')
   await page.evaluate(()=>window.visualHarness.store.searchLoading=false);await capture(page,scene,'search-empty')
   await page.evaluate(()=>{const s=window.visualHarness.store;s.error='NETWORK_ERROR: connection unavailable';s.navigateTo('search')});await capture(page,scene,'search-error')
   await page.evaluate(()=>{const s=window.visualHarness.store;s.error='';s.navigateTo('library');s.localTracks=[{id:81,name:'Local recording — long title',artists:['Artist'],localUri:'content://fixture/81',duration:180000}];s.localLibrary={folders:[{id:'folder:fixture',name:'Music recordings',trackCount:1,permissionGranted:false}],playlists:[]}})
   await settle(page);await page.locator('.segmented-control button').nth(1).click();await capture(page,scene,'device-library')
   await page.locator('.segmented-control button').nth(2).click();await capture(page,scene,'offline-library')
   await page.evaluate(()=>{const s=window.visualHarness.store;s.activeTab='entity';s.selectedEntity={id:91,category:'artists',name:'Long artist name — 演奏者'};s.tracks=[{id:92,name:'A quiet recording',artists:['Soloist']}];s.loading=false});await capture(page,scene,'artist-detail')
   await page.evaluate(()=>{const s=window.visualHarness.store;s.activeTab='localCollection';s.selectedLocalCollection={id:'bundle:fixture',name:'Imported recordings',trackCount:1};s.tracks=s.localTracks});await capture(page,scene,'imported-detail')
   await page.evaluate(()=>window.visualHarness.store.navigateTo('about'));await page.locator('.about-page').waitFor();await capture(page,scene,'about')
   await page.locator('[data-settings-section="about-privacy"] > summary').click();await page.locator('.about-document').waitFor();assert.ok((await page.locator('.about-document').innerText()).includes('privacy'));await capture(page,scene,'about-privacy')
   await page.close()
  }
  assert.deepEqual(errors,[]);assert.deepEqual(warnings,[])
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,browser:browser.version(),results,pageErrors:errors,unresolvedComponents:warnings,scope:'Synthetic real-App browser sweep, not Android or live network behavior'},null,2))
  console.log('PASS: 40 real-App search/loading/empty/error/local/offline/detail/about states, four viewports, no unresolved components')
 }finally{await browser?.close();await server.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
