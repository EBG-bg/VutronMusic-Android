const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
test('unchanged A/B snapshots share metadata while actual range, disable and removal stay visible',()=>{
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/stores/domains/playbackSnapshot.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports});
 const share=module.exports.sharePlaybackSnapshot;
 const before={trackId:1,position:2000,playing:false,abLoopEnabled:true,abLoop:{trackKey:'track:1',trackId:1,enabled:true,startMs:1000,endMs:3000}};
 assert.equal(share(before,structuredClone(before)),before);
 const advancing=structuredClone(before);advancing.position=2200;assert.equal(share(before,advancing).abLoop,before.abLoop);
 const changed=structuredClone(before);changed.abLoop.endMs=4000;assert.notEqual(share(before,changed),before);assert.equal(before.abLoop.endMs,3000);
 const disabled={...before,abLoopEnabled:false};delete disabled.abLoop;assert.equal(share(before,disabled).abLoop,undefined);
});
