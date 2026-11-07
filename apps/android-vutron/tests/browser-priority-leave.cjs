const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
module.exports=async({page,evaluate,wait,delay,root})=>{
 const click=selector=>evaluate('document.querySelector('+JSON.stringify(selector)+').click()')
 const counts=()=>evaluate('window.priorityWrites||0')
 const idle=()=>wait('(async()=>!(await import("/src/composables/navigationGuard.ts")).appNavigation.pending.value)()')
 const choose=async selector=>{await click(selector);await idle();await wait('!document.querySelector(".action-dialog")')}
 const settings=async()=>{await evaluate('window.featureHarness.store.navigateTo("settings")');await wait('document.querySelector(".settings-page")');await delay(350)}
 const openPriorities=async()=>{
  await wait('document.querySelector("[data-settings-section=plugin-source-priorities] > summary")')
  if(!await evaluate('document.querySelector("[data-settings-section=plugin-source-priorities] > summary").getAttribute("aria-expanded")==="true"'))await click('[data-settings-section=plugin-source-priorities] > summary')
  await wait('document.querySelectorAll(".plugin-priority-group:first-child .plugin-priority-row").length===8');await delay(350)
 }
 const edit=async()=>{await openPriorities();await click('.plugin-priority-group:first-child .plugin-priority-buttons button:last-child');await wait('!document.querySelector(".plugin-priority-actions button").disabled')}
 const manage='[data-settings-section=plugin-source-priorities] .wide-outline-button'
 const libraryTab='.bottom-nav > button:nth-of-type(2)'
 await evaluate(`(async()=>{const {musicPluginBridge:b}=await import('/src/plugins/bridge.ts');await b.manageMusicPlugin({action:'enable',id:'fixture'});
  const original=b.manageMusicPlugin.bind(b);window.priorityWrites=0;window.prioritySaveMode='normal';
  b.manageMusicPlugin=async p=>{if(p.action==='setSourcePriorities'){window.priorityWrites++;
   if(window.prioritySaveMode==='fail'){window.prioritySaveMode='normal';throw new Error('Fixture priorities save failed')}
   if(window.prioritySaveMode==='hold')await new Promise(resolve=>window.finishPrioritySave=()=>{window.prioritySaveMode='normal';resolve()})}
   return original(p)};
 })()`)
 await settings();await click(libraryTab);await wait('window.featureHarness.store.activeTab==="library"')
 assert.equal(await evaluate('Boolean(document.querySelector(".action-dialog"))'),false,'Clean settings leave without asking')
 await settings();await edit();await click(manage);await wait('document.querySelector(".action-dialog")')
 assert.equal(await evaluate('window.featureHarness.store.activeTab'),'settings')
 assert.equal(await evaluate('document.querySelectorAll(".action-dialog button").length'),3)
 assert.equal(await evaluate('document.querySelector(".app-shell").inert'),true)
 assert.equal(await evaluate('document.querySelector(".action-dialog").contains(document.activeElement)'),true)
 await choose('.action-dialog button:first-child')
 assert.equal(await counts(),0);assert.equal(await evaluate('document.querySelector(".plugin-priority-actions button").disabled'),false)
 assert.equal(await evaluate('document.activeElement.classList.contains("plugin-priority-handle")'),true)

 await evaluate('window.prioritySaveMode="fail"');await click(manage);await wait('document.querySelector(".action-dialog")')
 await choose('.action-dialog [data-default-action]')
 assert.equal(await evaluate('window.featureHarness.store.activeTab'),'settings','Failed save does not navigate')
 assert.equal(await evaluate('document.querySelector(".plugin-priority-actions button").disabled'),false,'Failed save retains the draft')
 assert.equal(await evaluate('document.querySelector(".inline-error").textContent.includes("Fixture priorities save failed")'),true)
 assert.equal(await evaluate('document.activeElement.classList.contains("inline-error")'),true)

 const beforeSave=await counts();await evaluate('window.prioritySaveMode="hold"')
 await click('.plugin-priority-actions button:first-child')
 await wait('Boolean(window.finishPrioritySave)')
 await click(libraryTab);await wait('document.querySelector(".action-dialog")');await click('.action-dialog [data-default-action]')
 await evaluate('document.querySelector(".header-back").click();document.querySelector(".header-back").click();document.querySelector(".header-back").click()')
 assert.equal(await evaluate('window.featureHarness.store.activeTab'),'settings')
 assert.equal(await counts(),beforeSave+1,'Repeated returns cannot submit concurrent saves')
 assert.equal(await evaluate('(async()=>Boolean((await import("/src/platform/actionDialog.ts")).actionDialog.value))()'),false)
 await wait('!document.querySelector(".action-dialog")')
 await evaluate('window.finishPrioritySave()');await idle();await wait('window.featureHarness.store.activeTab==="library"')
 await settings();await edit();await click(manage);await wait('document.querySelector(".action-dialog")')
 const beforeDiscard=await counts();await choose('.action-dialog button:nth-child(2)')
 await wait('window.featureHarness.store.activeTab==="plugins"')
 assert.equal(await counts(),beforeDiscard,'Discard does not write source priorities')

 await settings();await edit()
 await evaluate('document.querySelector(".plugin-priority-row").scrollIntoView({block:"center"})');await delay(200)
 const point=await evaluate('(()=>{const r=document.querySelector(".plugin-priority-handle").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()')
 await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1})
 await wait('document.querySelector(".plugin-priority-preview")')
 await evaluate('document.querySelector(".header-back").click()')
 await wait('!document.querySelector(".plugin-priority-preview")')
 assert.equal(await evaluate('document.querySelector("[data-settings-section=plugin-source-priorities] > summary").getAttribute("aria-expanded")'),'true','Back cancels a drag before closing its card')
 assert.equal(await evaluate('Boolean(document.querySelector(".action-dialog"))'),false)
 assert.equal(await evaluate('document.querySelector(".plugin-priority-actions button").disabled'),false,'Canceling a drag retains earlier unsaved edits')
 await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1})
 await click('[data-settings-section=plugin-source-priorities] > summary');await delay(350)
 await click('.header-back');await wait('document.querySelector(".action-dialog")');await choose('.action-dialog button:first-child')
 await openPriorities()

 // Keep successful import side effects even when the subsequent navigation is cancelled.
 await evaluate(`(async()=>{const {vutronPlugin:n}=await import('/src/platform/vutronPlugin.ts');
  const oldLibrary=n.getLocalLibrary.bind(n);window.priorityImports=0;
  n.getLocalLibrary=async()=>{const l=await oldLibrary();return{...l,playlists:window.priorityImports?[...l.playlists,{id:'bundle:leave-test',name:'Imported before leaving',trackCount:1,isLocalBundle:true}]:l.playlists}};
  n.importLocalPlaylist=async()=>{window.priorityImports++;return{playlist:{id:'bundle:leave-test',name:'Imported before leaving',trackCount:1,isLocalBundle:true}}}
 })()`)
 await click('.sidebar-toggle');await wait('document.querySelector(".library-sidebar")')
 await evaluate('Array.from(document.querySelectorAll(".library-sidebar > button")).find(e=>e.textContent.includes("导入")).click()')
 await wait('window.priorityImports===1&&document.querySelector(".action-dialog")')
 assert.equal(await evaluate('window.featureHarness.store.localLibrary.playlists.some(p=>p.id==="bundle:leave-test")'),true)
 assert.equal(await evaluate('window.featureHarness.store.libraryLoading'),false,'Import completes before the actual leave question')
 await choose('.action-dialog button:first-child')
 assert.equal(await evaluate('window.featureHarness.store.activeTab'),'settings')
 assert.equal(await evaluate('window.featureHarness.store.localLibrary.playlists.some(p=>p.id==="bundle:leave-test")'),true,'Keeping the editor does not roll back the imported playlist')

 await evaluate('(async()=>{(await import("/src/platform/interfacePreferences.ts")).fontScale.value=150;(await import("/src/platform/i18n.ts")).setAppLocale("en")})()')
 await click('[data-settings-section=app-update] > summary');await wait('document.querySelector(".about-entry")')
 await click('.about-entry');await wait('document.querySelector(".action-dialog")')
 await page.send('Emulation.setDeviceMetricsOverride',{width:320,height:720,deviceScaleFactor:1,mobile:true});await delay(250)
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Three leave choices fit 320px at English 150%')
 assert.equal(await evaluate('document.querySelector(".action-dialog").textContent.includes("mobile.plugins.")'),false)
 assert.equal(await evaluate('document.querySelector(".action-dialog").textContent.includes("Discard and leave")'),true)
 const shot=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(root,'priority-leave-narrow.png'),Buffer.from(shot.data,'base64'))
 await choose('.action-dialog button:nth-child(2)');await wait('window.featureHarness.store.activeTab==="about"')
 console.log('PASS: clean navigation; manage/tab/back/about save-discard-continue; failed and single-flight saves; drag-back priority; completed import retained after cancelled leave; themed focused/inert English 150% dialog')
}
