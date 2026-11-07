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
  console.log('PASS: playlist resume position/order; collapse returns without stopping; two-step lyric seeking; phone/tablet layouts; floor collapse/reopen without refetch');
};
