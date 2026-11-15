const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
module.exports=async({evaluate,wait,delay,root})=>{
  await evaluate(`(async()=>{
    const {pollingProbe}=await import('/tests/fixtures/playback-poll-native.mock.js');window.pollingProbe=pollingProbe;
    const store=window.featureHarness.store;store.stopPlaybackPolling();
    (await import('/src/platform/interfacePreferences.ts')).playerLyrics.value=false;
    store.navigateTo('player');await store.refreshPlaybackState();
    const {watch}=await import('/tests/fixtures/playback-poll-native.mock.js');window.pollChanges={track:0,snapshot:0};
    window.pollStop=[watch(()=>store.playback.track,()=>window.pollChanges.track++,{flush:'sync'}),watch(()=>store.playback,()=>window.pollChanges.snapshot++,{flush:'sync'})];
  })()`)
  await wait("document.querySelector('.player-artwork .plugin-artwork img[data-artwork-state=loaded]')")
  await delay(250)
  const baseline=process.env.VUTRON_POLLING_BASELINE==='1'
  const before=await evaluate('({artwork:pollingProbe.artworkCalls.length,timer:pollingProbe.timerReads,position:featureHarness.store.playback.position})')
  for(let index=0;index<8;index++){
    await evaluate('(async()=>{pollingProbe.state.position+=2000;await featureHarness.store.refreshPlaybackState()})()')
    await delay(25)
  }
  const after=await evaluate('({artwork:pollingProbe.artworkCalls.length,timer:pollingProbe.timerReads,position:featureHarness.store.playback.position,...pollChanges})')
  const result={baseline,samples:8,before,after,artworkBridgeCalls:after.artwork-before.artwork,timerBridgeCalls:after.timer-before.timer}
  assert.equal(after.position,before.position+16000,'Every native progress sample still reaches the UI')
  assert.equal(after.snapshot,8,'Changed progress updates every sample')
  assert.equal(after.track,baseline?8:0,'Unchanged track metadata preserves its identity')
  assert.equal(result.artworkBridgeCalls,baseline?8:0,'Progress-only polling does not resolve artwork again')
  assert.equal(result.timerBridgeCalls,baseline?8:0,'Non-settings progress polling does not read the sleep timer')
  if(!baseline){
    const stable=await evaluate('({snapshot:pollChanges.snapshot,track:pollChanges.track})')
    for(let index=0;index<3;index++)await evaluate('featureHarness.store.refreshPlaybackState()')
    assert.deepEqual(await evaluate('({snapshot:pollChanges.snapshot,track:pollChanges.track})'),stable,'Identical paused snapshots do not retrigger consumers')
    const count=()=>evaluate('pollingProbe.artworkCalls.length')
    let calls=await count()
    await evaluate("(async()=>{pollingProbe.state.track.name='Updated title';pollingProbe.state.title='Updated title';await featureHarness.store.refreshPlaybackState()})()")
    await delay(50)
    assert.equal(await evaluate('featureHarness.store.playback.track.name'),'Updated title')
    assert.equal(await count(),calls,'An unrelated title change keeps artwork context identity')
    await evaluate("(async()=>{pollingProbe.state.track.pluginSourceContext.nested.tokens[0]='changed-context';await featureHarness.store.refreshPlaybackState()})()")
    await delay(50)
    assert.equal(await count(),++calls,'Real nested source-context changes resolve artwork again')
    await evaluate("(async()=>{pollingProbe.state.track.picUrl='https://artwork.example.invalid/new-cover.jpg';await featureHarness.store.refreshPlaybackState()})()")
    await delay(50)
    assert.equal(await count(),++calls,'An album cover change reaches the existing artwork component')
    await evaluate("(async()=>{pollingProbe.state.track.pluginAccountScope='fixture-b';await featureHarness.store.refreshPlaybackState()})()")
    await delay(50)
    assert.equal(await count(),++calls,'An account change refreshes authenticated artwork even with an otherwise equal context')
    await evaluate("(async()=>{pollingProbe.state.track.pluginId='kugou:other';pollingProbe.state.track.pluginAccountScope='fixture-b';await featureHarness.store.refreshPlaybackState()})()")
    await delay(50)
    assert.equal(await count(),++calls,'Changed provider/account metadata remains observable')
    const timer=await evaluate('pollingProbe.timerReads')
    await evaluate("featureHarness.store.navigateTo('settings')")
    await wait('pollingProbe.timerReads>'+timer)
    assert.equal(await evaluate('pollingProbe.timerReads'),timer+1,'Settings entry calibrates once immediately')
    const remaining=await evaluate('featureHarness.store.sleepTimerRemainingMs')
    assert.ok(remaining>90000&&remaining<=120000,'The native deadline remains authoritative')
    await delay(350)
    assert.ok(await evaluate('featureHarness.store.sleepTimerRemainingMs')<remaining,'The settings display clock advances')
    result.actualMetadataChanges=true;result.timerOnSettingsEntry=1
  }
  await evaluate('pollStop.forEach(stop=>stop())')
  fs.writeFileSync(path.join(root,baseline?'playback-polling-baseline.json':'playback-polling-optimized.json'),JSON.stringify(result,null,2))
  console.log('PASS: playback polling '+(baseline?'baseline':'optimization')+' '+JSON.stringify(result))
}
