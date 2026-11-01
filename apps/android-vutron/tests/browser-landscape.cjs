const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ page, evaluate, wait, delay, root }) => {
  const navigate = async tab => {
    await evaluate('window.featureHarness.store.navigateTo(' + JSON.stringify(tab) + ');window.scrollTo(0,0)');
    await wait('document.querySelector(' + JSON.stringify('.' + tab + '-page') + ')');
    await delay(600);
  };
  const resize = async (width, height) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    await delay(300);
  };
  const escape = async () => {
    for (const type of ['keyDown', 'keyUp']) {
      await page.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    }
    await delay(400);
  };
  const screenshot = async name => {
    const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(root, name), Buffer.from(shot.data, 'base64'));
  };
  const rect = selector => evaluate('(() => {const e=document.querySelector(' + JSON.stringify(selector) + ');if(!e)throw new Error("Missing element");const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,display:getComputedStyle(e).display}})()');
  const noOverflow = async label => {
    const size = await evaluate('({viewport:innerWidth,content:document.documentElement.scrollWidth})');
    assert.ok(size.content <= size.viewport, label + ': horizontal overflow ' + JSON.stringify(size));
  };
  const reachable = async (selector, container) => {
    assert.equal(await evaluate('Boolean(document.querySelector(' + JSON.stringify(selector) + '))'), true, selector + ': missing; ' + await evaluate("document.querySelector('.library-sidebar')?.outerHTML || ''"));
    await evaluate('document.querySelector(' + JSON.stringify(selector) + ').scrollIntoView({block:"center",inline:"nearest"})');
    await delay(200);
    const r = await rect(selector);
    assert.ok(r.y >= 0 && r.bottom <= await evaluate('innerHeight') + 1, selector + ': not vertically reachable ' + JSON.stringify(r));
    assert.ok(r.x >= 0 && r.right <= await evaluate('innerWidth') + 1, selector + ': not horizontally reachable');
    if (container) {
      const visible = await evaluate('(() => {const e=document.querySelector(' + JSON.stringify(selector) + '),r=e.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return e.contains(hit)||hit===e})()');
      assert.equal(visible, true, selector + ': obscured in ' + container);
    }
  };

  await page.send('Page.bringToFront');
  const original = await evaluate('({track:window.featureHarness.store.playback.trackId,position:window.featureHarness.store.playback.position})');
  await navigate('player');
  const switchableVisual = await evaluate("Boolean(document.querySelector('.player-visual'))");
  if (switchableVisual) { await resize(1138,640);await screenshot('android15-landscape-cover.png'); }
  if (switchableVisual) { await evaluate("document.querySelector('.player-view-tabs button:last-child').click()");await delay(500); }
  await wait("document.querySelector('.original-lyrics-scroll')");
  if (switchableVisual) {
    const selector = '.landscape-lyric-offset .offset-slider';
    const geometry = () => evaluate('(() => {const e=document.querySelector(' + JSON.stringify(selector) + ');e.scrollIntoView({block:"center"});const r=e.querySelector(".offset-rail").getBoundingClientRect(),t=e.querySelector(".offset-thumb").getBoundingClientRect();return {x:t.x+t.width/2,y:t.y+t.height/2,railTop:r.top,railBottom:r.bottom,value:Number(e.getAttribute("aria-valuenow"))}})()');
    const mouse = (type,x,y) => page.send('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1,pointerType:'mouse'});
    assert.equal(await evaluate("document.querySelector('.landscape-lyric-offset .offset-slider').getAttribute('aria-orientation')"),'vertical');
    assert.equal(await evaluate("document.querySelectorAll('.landscape-lyric-offset button,.landscape-lyric-offset input').length"),0,'Only slider adjusts the landscape offset');
    await page.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    for (const kind of ['mouse','touch']) {
      await evaluate('window.featureHarness.store.updateCurrentLyricOffset(0).then(()=>window.featureHarness.store.flushLiveSettings())');await delay(250);
      let g=await geometry();await delay(200);g=await geometry();
      await mouse('mousePressed',g.x,g.railTop+3);await mouse('mouseMoved',g.x,g.railTop+20);await mouse('mouseReleased',g.x,g.railTop+20);
      assert.equal(await evaluate('window.featureHarness.store.overlaySettings.currentLyricOffsetMs'),0,'Blank vertical track cannot start a drag');
      if(kind==='mouse') {await mouse('mousePressed',g.x,g.y);await mouse('mouseMoved',g.x,g.y-10);}
      else {await page.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:g.x,y:g.y}]});await page.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:g.x,y:g.y-10}]});}
      await delay(80);
      const live=await evaluate('window.featureHarness.store.overlaySettings.currentLyricOffsetMs');
      assert.ok(live<0 && live>=-500,kind+': 10px up makes a small earlier adjustment, not seconds');
      assert.ok(live%10===0,'Offset retains 10ms granularity');
      if(kind==='mouse') await mouse('mouseReleased',g.x,g.y-10);
      else await page.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await wait('JSON.parse(localStorage.getItem("vutron-slider-ui")||"{}").offset==='+live);
      assert.equal(await evaluate('window.featureHarness.store.overlaySettings.currentLyricOffsetMs'),live,'Release retains the live value');
    }
  }
  await evaluate("window.landscapeLyricNode=document.querySelector('.original-lyrics-scroll')");
  for (const [width, height] of [[1138,640],[1280,800],[844,390],[896,414],[740,420],[390,844],[320,740],[1440,900]]) {
    await resize(width, height);
    await evaluate('window.scrollTo(0,0)');
    const wide = width >= 840 && width > height;
    const nav = await rect('.bottom-nav');
    assert.equal(nav.display, wide ? 'flex' : 'grid', width + 'x' + height + ': navigation mode');
    if (wide) {
      assert.ok(nav.width < 120 && nav.height <= height, 'Navigation rail stays in its own column');
      const lyrics = await rect('.lyrics-panel'), artwork = await rect(switchableVisual ? '.player-title-row' : '.player-artwork');
      assert.ok(lyrics.x > artwork.right && lyrics.y < artwork.bottom, width + 'x' + height + ': lyrics beside artwork');
      assert.ok(lyrics.right <= width, 'Lyrics column fits available width');
      const scroll = await rect('.original-lyrics-scroll');
      assert.ok(scroll.height < height, width + 'x' + height + ': lyric scroll area fits landscape height ' + JSON.stringify(scroll));
    } else {
      assert.ok(nav.width === width && nav.height < 100, 'Phone layout retains bottom navigation');
    }
    await noOverflow(width + 'x' + height + ' player');
    if (switchableVisual) {
      const landscape=width>height;
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.landscape-lyric-offset')).display==='flex'"),landscape,'Offset toolbar only appears in landscape');
      if (landscape) assert.ok((await rect('.landscape-lyric-offset')).x >= (await rect('.original-lyrics-view')).right,'Offset sits on the right of the lyric column');
    }
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.original-lyrics-scroll')).backgroundColor"), 'rgba(0, 0, 0, 0)', 'In-app lyrics inherit the app surface, even with a dark overlay background');
    assert.equal(await evaluate('window.featureHarness.store.overlaySettings.backgroundColor'),0xff181920,'Theme surface must not rewrite overlay settings');
    assert.equal(await evaluate("document.querySelector('.original-lyrics-scroll')===window.landscapeLyricNode"), true, 'Rotation retains lyric component');
    await reachable('.transport-controls .main-play-button');
    await reachable('.playback-queue-button');
  }
  assert.deepEqual(await evaluate('({track:window.featureHarness.store.playback.trackId,position:window.featureHarness.store.playback.position})'), original, 'Rotation retains track/progress');
  await evaluate('(async()=>{const p=await import("/src/platform/interfacePreferences.ts");p.fontScale.value=150})()');
  for (const [width,height] of [[844,390],[1138,640]]) {
    await resize(width,height);await noOverflow('150% text '+width+'x'+height);
    await reachable('.transport-controls .main-play-button');
    await reachable('.playback-mode-control');
  }
  await evaluate('(async()=>{const p=await import("/src/platform/interfacePreferences.ts");p.fontScale.value=100})()');
  if (process.env.VUTRON_LANDSCAPE_QUICK === '1') {
    await resize(1138,640);await navigate('player');
    assert.equal(await evaluate("document.querySelector('.player-view-tabs button:last-child').textContent.trim()"),'歌词','Lyric tab uses a translated label');
    await screenshot('android15-landscape-player.png');
    console.log('PASS: final lyric surface, right-side vertical thumb-only mouse/touch drag with 10ms live updates, 8 rotating windows and translated label');return;
  }

  for (const [width, height] of [[1138,640],[844,390],[740,420],[390,844]]) {
    await resize(width, height);
    const wide = width >= 840 && width > height;
    for (const tab of ['home','library','search','settings','player']) {
      await navigate(tab);
      await noOverflow(width + 'x' + height + ' ' + tab);
      if (tab === 'settings') assert.equal(await evaluate("Boolean(document.querySelector('.mini-player'))"),false);
      else if (tab !== 'player') {
        const mini = await rect('.mini-player'), nav = await rect('.bottom-nav');
        assert.ok(wide ? mini.x >= nav.right : mini.bottom <= nav.y, 'Mini player does not overlap navigation');
        const shell = await rect('.app-shell');
        if (wide) assert.ok(shell.width > width * .7, 'Landscape uses available width');
      }
    }
    if (width === 1138) await screenshot('android15-landscape-player.png');
    await evaluate("document.querySelector('.playback-tuning-button').click()");
    await wait("document.querySelector('.tuning-sheet')");await delay(400);
    await reachable('.tuning-sheet header button', '.tuning-sheet');
    await reachable('#tuning-pitch ~ .thumb-range-path .thumb-range-thumb', '.tuning-sheet');
    await noOverflow('tuning');await escape();
    await wait("!document.querySelector('.tuning-sheet')");
    await evaluate("document.querySelector('.playback-queue-button').click()");
    await wait("document.querySelector('.queue-panel')");await delay(400);
    await reachable('.queue-panel > header button', '.queue-panel');
    await noOverflow('queue');await escape();
    await wait("!document.querySelector('.queue-panel')");
    await evaluate("document.querySelector('.player-title-row [data-track-menu-button]').click()");
    await wait("document.querySelector('.track-action-menu')");await delay(400);
    await reachable('.track-action-options > button:last-of-type', '.track-action-menu');
    await noOverflow('track menu');await escape();
    await wait("!document.querySelector('.track-action-menu')");
    await evaluate("Array.from(document.querySelectorAll('.player-page > button')).find(e=>e.textContent.includes('歌曲评论')).click()");
    await wait("document.querySelector('.comments-sheet')");await delay(400);
    await reachable('.comment-composer textarea', '.comments-sheet');
    await noOverflow('comments');await escape();
    await wait("!document.querySelector('.comments-sheet')");
    await evaluate("document.querySelector('.sidebar-toggle').click()");await wait("document.querySelector('.library-sidebar')");await delay(400);
    if (width === 1138) await screenshot('android15-landscape-sidebar.png');
    await reachable('.sidebar-heading button', '.library-sidebar');
    await reachable('.library-sidebar > button:last-of-type', '.library-sidebar');
    await noOverflow('sidebar');
    await evaluate("document.querySelector('.sidebar-heading button').click()");
    await wait("!document.querySelector('.library-sidebar')");
    console.log('PASS: landscape interactions ' + width + 'x' + height);
  }
  await resize(1138,640);await navigate('library');await screenshot('android15-landscape-library.png');
  await resize(844,390);
  await evaluate('window.featureHarness.store.openCreateOnlinePlaylist()');
  await wait("document.querySelector('.online-playlist-dialog')");await delay(200);
  await reachable('.online-playlist-dialog header button', '.online-playlist-dialog');
  await reachable('.online-playlist-dialog footer button:last-child', '.online-playlist-dialog');
  await noOverflow('playlist dialog');await escape();
  await evaluate("import('/src/platform/actionDialog.ts').then(m=>{void m.askAction({title:'Landscape',message:'Long content\\n'.repeat(70),confirmLabel:'Confirm',cancelLabel:'Cancel'})})");
  await wait("document.querySelector('.action-dialog')");
  await reachable('.action-dialog-buttons [data-default-action]', '.action-dialog');
  await noOverflow('long action dialog');await escape();
  // Browser safe areas complement native API-35 compilation; they are not a device test.
  let safeAreaSupported = true;
  try { await page.send('Emulation.setSafeAreaInsets', { insets: { top: 24, left: 48, right: 32, bottom: 24 } }); }
  catch (error) {
    if (!error.message.includes("'Emulation.setSafeAreaInsets' wasn't found")) throw error;
    safeAreaSupported = false;
    console.log('SKIP: this Edge version does not support safe-area emulation; real Android 15 cutout/system-bar validation remains pending');
  }
  if (safeAreaSupported) {
  await resize(1138,640);await navigate('player');
  const safeNav = await rect('.bottom-nav'), safeShell = await rect('.app-shell');
  assert.equal(safeNav.width, 136, 'Rail includes the landscape cutout');
  assert.ok(safeShell.x >= 136, 'Page clears the cutout and navigation rail');
  assert.ok((await rect('.app-header')).y >= 24, 'Header clears status bar');
  assert.ok((await rect('.lyrics-panel')).right <= 1106, 'Lyrics clear right cutout');
  await evaluate("document.querySelector('.playback-tuning-button').click()");await wait("document.querySelector('.tuning-sheet')");await delay(400);
  await reachable('.tuning-sheet header button', '.tuning-sheet');
  const safeSheet = await rect('.tuning-sheet');
  assert.ok(safeSheet.x >= 48 && safeSheet.right <= 1106 && safeSheet.y >= 24, 'Sheet fits safe rectangle');
  await escape();
  await page.send('Emulation.setSafeAreaInsets', { insets: { top: 0, left: 0, right: 0, bottom: 0 } });
  }
  if (switchableVisual) {
    const saved=await evaluate('window.featureHarness.store.overlaySettings.currentLyricOffsetMs');
    await evaluate('window.featureReady=false');await page.send('Page.reload');await wait('window.featureReady===true');
    await navigate('player');await wait("document.querySelector('.landscape-lyric-offset .offset-slider')");
    assert.equal(await evaluate('window.featureHarness.store.overlaySettings.currentLyricOffsetMs'),saved,'Reload restores the saved offset');
  }
  await evaluate('window.featureHarness.store.requestLogin()');
  await wait("document.querySelector('.login-view')");
  for (const [width,height] of [[1138,640],[844,390],[740,420],[390,844]]) {
    await resize(width,height);await evaluate('window.scrollTo(0,0)');
    await noOverflow('login '+width+'x'+height);
    assert.equal(await evaluate("Boolean(document.querySelector('.bottom-nav'))"),false,'Login has no navigation rail');
    await reachable('.login-view > .full-button','.login-view');
  }
  console.log('PASS: 8 rotating viewports retain playback/lyrics; home, library, search, settings and player; tuning, queue, track menu, comments and sidebar remain reachable; phone/split-screen fallbacks');
};
