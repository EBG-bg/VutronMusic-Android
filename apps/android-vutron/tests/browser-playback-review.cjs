const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({page, evaluate, wait, delay, root}) => {
  await evaluate(`(async()=>{
    const store=window.featureHarness.store;store.stopPlaybackPolling();
    const native=(await import('/src/platform/vutronPlugin.ts')).vutronPlugin;
    window.reviewPlays=[];window.reviewState={...store.playback};window.reviewErrors=[];
    window.addEventListener('unhandledrejection',event=>window.reviewErrors.push(String(event.reason?.stack||event.reason)));
    native.getPlaylistProgress=async ({scope,playlistKey})=>scope==='netease:7'&&playlistKey==='netease:777'?{trackId:62,position:32000,cueTrackNo:0}:{};
    native.getPlaylistTracks=async()=>({tracks:window.featureHarness.store.tracks});
    native.play=async options=>{window.reviewPlays.push(structuredClone(options));window.reviewState={...store.playback,trackId:options.track.id,track:options.track,position:options.position||0,playing:true,duration:180000};};
    native.getPlaybackState=async()=>window.reviewState;
    native.resume=async()=>{window.reviewState.playing=true};
    store.activeTab='library';store.selectedPlaylist={id:777,name:'Continue test',cacheOwnerId:7};
    store.tracks=[{id:61,name:'First',duration:180000},{id:62,name:'Second',duration:180000}];
  })()`);
  await wait("document.querySelector('.playlist-continue-button')");
  assert.match(await evaluate("document.querySelector('.playlist-continue-button').textContent"), /Second.*0:32/s);
  await evaluate("document.querySelector('.playlist-continue-button').click()");
  await wait("window.reviewPlays.length===1&&document.querySelector('.player-page')");
  assert.equal(await evaluate('window.reviewPlays[0].position'),32000);
  assert.equal(await evaluate('window.reviewPlays[0].index'),1);
  assert.equal(await evaluate('window.reviewPlays[0].queue.length'),2);
  assert.equal(await evaluate('window.reviewPlays[0].track.playlistOrderScope'),'netease:7');
  assert.equal(await evaluate("Boolean(document.querySelector('.cache-current'))"),false);
  await evaluate("document.querySelector('.collapse-player').click()");
  await wait("window.featureHarness.store.activeTab==='library'");
  assert.equal(await evaluate('window.featureHarness.store.selectedPlaylist.id'),777);
  assert.equal(await evaluate('window.featureHarness.store.playback.playing'),true,'Collapse keeps playback');
  await wait("document.querySelector('.playlist-continue-button')");
  await evaluate("document.querySelector('.playlist-continue-button').click()");
  await wait("document.querySelector('.player-page')");
  assert.equal(await evaluate('window.reviewPlays.length'),1,'Current playlist resumes without replacing inserts or queue');
  await evaluate(`(async()=>{
    const store=window.featureHarness.store;
    store.lyrics={original:[{start:1000,text:'First line',words:[]},{start:30000,text:'Target line',words:[]},{start:60000,text:'Last line',words:[]}],translation:[],pairedTranslations:[],source:'lrc'};
    store.lyricsLoading=false;
    (await import('/src/platform/interfacePreferences.ts')).playerLyrics.value=true;
    window.reviewSeeks=[];store.seek=async position=>{window.reviewSeeks.push(position)};
  })()`);
  await wait("document.querySelectorAll('.original-lyric-row').length===3");
  await delay(350);
  await evaluate("document.querySelectorAll('.original-lyric-row')[1].click()");
  assert.equal(await evaluate('window.reviewSeeks.length'),0,'Single click only previews');
  assert.equal(await evaluate("document.querySelectorAll('.original-lyric-row')[1].classList.contains('seek-pending')"),true);
  await evaluate("document.querySelectorAll('.original-lyric-row')[1].click()");
  assert.deepEqual(await evaluate('window.reviewSeeks'),[30000]);
  await evaluate("document.querySelectorAll('.original-lyric-row')[2].click()");
  await delay(1900);
  await evaluate("document.querySelectorAll('.original-lyric-row')[2].click()");
  assert.equal(await evaluate('window.reviewSeeks.length'),1,'Expired preview needs confirmation again');
  await evaluate("document.querySelector('.lyric-seek-confirmation button').click()");
  assert.deepEqual(await evaluate('window.reviewSeeks'),[30000,60000]);
  // Keep the lyric pane itself unchanged while moving the outer page around it.
  // Extra fixture space makes both partially exposed positions reachable without
  // overriding production pane sizing or scroll/follow code.
  await evaluate(`(()=>{
    const store=window.featureHarness.store;
    store.stopPlaybackPolling();
    store.playback={...store.playback,position:32500,playing:false,buffering:false,duration:180000};
    window.reviewState={...store.playback};
    store.overlaySettings={...store.overlaySettings,currentLyricOffsetMs:0};
    store.lyrics={original:Array.from({length:24},(_,index)=>({start:1000+index*3000,end:4000+index*3000,text:'Lyric row '+index,words:[]})),translation:[],pairedTranslations:Array.from({length:24},(_,index)=>index===10?'The current translation remains part of the centered row':''),source:'plain'};
    const before=document.createElement('div'),after=document.createElement('div');
    before.dataset.lyricFollowSpacer='';after.dataset.lyricFollowSpacer='';before.style.height='800px';after.style.height='800px';
    document.querySelector('.player-visual').before(before);document.querySelector('.player-page').append(after);
  })()`);
  await wait("document.querySelectorAll('.original-lyric-row').length===24&&document.querySelector('.original-lyric-row.active')?.textContent.includes('Lyric row 10')");
  await delay(600);
  const lyricGeometry=()=>evaluate(`(()=>{
    const list=document.querySelector('.original-lyrics-scroll');
    if(!list)throw new Error('Lyric pane absent: '+JSON.stringify({tab:window.featureHarness.store.activeTab,lyrics:window.featureHarness.store.lyrics.original.length,loading:window.featureHarness.store.lyricsLoading,body:document.body.innerText.slice(-800)}));
    const row=list.querySelector('.original-lyric-row.active');
    if(!row)throw new Error('Active lyric absent: '+JSON.stringify({position:window.featureHarness.store.playback.position,rows:list.querySelectorAll('.original-lyric-row').length}));
    const r=list.getBoundingClientRect(),a=row.getBoundingClientRect();
    const nav=document.querySelector('.bottom-nav').getBoundingClientRect();
    return {outer:scrollY,inner:list.scrollTop,docTop:r.top+scrollY,top:r.top,bottom:r.bottom,height:r.height,visible:Math.max(0,Math.min(r.bottom,nav.top)-Math.max(r.top,0)),usableBottom:nav.top,rowHeight:a.height,centerError:(a.top+a.bottom-r.top-r.bottom)/2,active:row.textContent};
  })()`);
  let pane=await lyricGeometry();
  await evaluate(`scrollTo({top:${pane.docTop}-140,behavior:'instant'})`);await delay(450);
  const fullPane=await lyricGeometry();
  assert.ok(fullPane.visible>=fullPane.height-2,'The initial lyric pane is fully visible: '+JSON.stringify(fullPane));
  assert.ok(Math.abs(fullPane.centerError)<2,'The complete active/translation row is centered in its own pane: '+JSON.stringify(fullPane));
  const partialPanes=[];
  for(const top of [fullPane.docTop-(fullPane.usableBottom-fullPane.height/2),fullPane.docTop+fullPane.height/2]){
    await evaluate(`scrollTo({top:${top},behavior:'instant'})`);await delay(450);
    const partial=await lyricGeometry();partialPanes.push(partial);
    assert.ok(Math.abs(partial.visible/partial.height-.5)<.03,'Only half the pane is exposed: '+JSON.stringify(partial));
    assert.ok(Math.abs(partial.inner-fullPane.inner)<2,'Outer scrolling does not move the lyric list: '+JSON.stringify({fullPane,partial}));
    assert.ok(Math.abs(partial.centerError-fullPane.centerError)<2,'The active row does not chase the visible intersection: '+JSON.stringify({fullPane,partial}));
  }
  await evaluate(`(()=>{const list=document.querySelector('.original-lyrics-scroll');list.dispatchEvent(new WheelEvent('wheel',{deltaY:1,bubbles:true}));list.scrollTop+=100;scrollTo({top:${fullPane.docTop}-( ${fullPane.usableBottom}-24),behavior:'instant'})})()`);
  await wait("document.querySelector('.return-current-lyric')");await delay(100);
  const beforeReturn=await lyricGeometry();
  assert.ok(beforeReturn.visible<beforeReturn.rowHeight+24,'The explicit-return scenario starts with insufficient lyric space');
  await evaluate("document.querySelector('.return-current-lyric').click()");await delay(600);
  const afterReturn=await lyricGeometry();
  assert.ok(Math.abs(afterReturn.outer-beforeReturn.outer)>30,'Return to current explicitly reveals the pane');
  assert.ok(afterReturn.visible>=Math.min(afterReturn.height,afterReturn.rowHeight+24)-2,'The current row has visible space after return');
  assert.ok(Math.abs(afterReturn.centerError)<2,'Return centers the full row in its pane');
  assert.equal(await evaluate('window.reviewSeeks.length'),2,'Following and returning never seek');
  // A real downward touch at the nested list's top chains to the outer page.
  await evaluate(`(()=>{const list=document.querySelector('.original-lyrics-scroll');list.dispatchEvent(new WheelEvent('wheel',{deltaY:-1,bubbles:true}));list.scrollTop=0;scrollTo({top:${fullPane.docTop}-140,behavior:'instant'})})()`);await delay(100);
  const beforeChain=await lyricGeometry();
  const finger=await evaluate("(()=>{const r=document.querySelector('.original-lyrics-scroll').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+30}})()");
  await page.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[finger]});
  for(let step=1;step<=6;step++){await page.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:finger.x,y:finger.y+step*15}]});await delay(18)}
  await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(300);
  const afterChain=await lyricGeometry();
  assert.ok(afterChain.outer<beforeChain.outer-20,'At the lyric top a downward touch scrolls the outer page: '+JSON.stringify({beforeChain,afterChain}));
  assert.equal(afterChain.inner,0,'Scroll chaining leaves the exhausted lyric list at its top');
  assert.equal(await evaluate('window.reviewSeeks.length'),2,'Scroll chaining cannot accidentally seek');
  fs.writeFileSync(path.join(root,'playback-review-lyric-follow.json'),JSON.stringify({fullPane,partialPanes,beforeReturn,afterReturn,beforeChain,afterChain},null,2));
  await evaluate("document.querySelectorAll('[data-lyric-follow-spacer]').forEach(element=>element.remove());scrollTo({top:0,behavior:'instant'})");
  for (const [width,height,wide] of [[1280,800,true],[1024,768,true],[390,844,false],[320,720,false],[740,420,false]]) {
    await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
    await delay(400);
    assert.equal(await evaluate("Boolean(document.querySelector('.player-visual-wide'))"),wide);
    assert.equal(await evaluate("Boolean(document.querySelector('.player-artwork'))"),wide,'Phone retains lyrics choice, tablet shows both');
    if (wide) {
      const box=await evaluate("(()=>{const a=document.querySelector('.player-artwork').getBoundingClientRect(),l=document.querySelector('.player-lyrics-view').getBoundingClientRect();return {ar:a.right,lx:l.x,lr:l.right}})()");
      assert.ok(box.lx>box.ar&&box.lr<=width,JSON.stringify(box));
    }
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  }
  await evaluate("window.featureHarness.store.navigateTo('player')");
  await evaluate("Array.from(document.querySelectorAll('.player-page button')).find(e=>e.textContent.includes('歌曲评论')).click()");
  await wait("document.querySelector('.comment-row')");
  await evaluate("Array.from(document.querySelectorAll('.comment-actions button')).find(e=>e.textContent.includes('楼层回复')).click()");
  await wait("document.querySelector('.comment-floor article')");
  await evaluate("document.querySelector('.comment-actions [aria-expanded=true]').click()");
  await delay(300);
  assert.equal(await evaluate("document.querySelector('.comment-floor-region').getBoundingClientRect().height"),0);
  assert.equal(await evaluate("document.querySelector('.comment-floor-region').inert"),true);
  await evaluate("document.querySelector('.comment-actions [aria-expanded=false]').click()");
  await delay(300);
  assert.equal(await evaluate('window.featureHarness.backend.counts.floor'),1,'Reopen does not advance reply pagination');
  assert.ok(await evaluate("document.querySelector('.comment-floor-region').getBoundingClientRect().height>0"));
  await evaluate("(async()=>{(await import('/src/platform/motion.ts')).motionPreference.value='reduced'})()");
  await delay(50);
  assert.ok(Number(await evaluate("parseFloat(getComputedStyle(document.querySelector('.comment-floor-region')).transitionDuration)"))<=.001,'Reduced motion removes decorative floor transition');
  const shot=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(root,'playback-review-replies.png'),Buffer.from(shot.data,'base64'));
  await evaluate("document.querySelector('.comments-sheet header button').click()");
  await wait("!document.querySelector('.comments-sheet')");
  await evaluate("(async()=>{(await import('/src/platform/interfacePreferences.ts')).fontScale.value=150;(await import('/src/platform/i18n.ts')).setAppLocale('en')})()");
  for(const [width,height] of [[320,720],[1024,768]]) {
    await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await delay(300);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'150% EN layout fits '+width);
    assert.match(await evaluate("document.querySelector('.collapse-player').getAttribute('aria-label')"),/Collapse player/);
  }
  assert.deepEqual(await evaluate('window.reviewErrors'),[],'No uncaught errors in the changed interactions');
  console.log('PASS: playlist resume position/order; collapse returns without stopping; two-step lyric seeking; stable pane-centered lyrics under outer scrolling, explicit reveal and touch scroll chaining; phone/tablet layouts; floor collapse/reopen without refetch');
};
