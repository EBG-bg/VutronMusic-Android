const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
test('lyric interpolation follows speed, seek, pause and the end of a CUE segment',()=>{
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/utils/lyricPlayback.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {module,exports:module.exports,Math});
 const position=module.exports.interpolatedPosition;
 assert.equal(position({position:1000,monotonicTime:2000,playing:true,rate:2},2500,10000),2000);
 assert.equal(position({position:2000,monotonicTime:2500,playing:true,rate:.5},3000,10000),2250);
 assert.equal(position({position:5000,monotonicTime:3000,playing:false,rate:.5},9000,10000),5000);
 assert.equal(position({position:9500,monotonicTime:3000,playing:true,rate:2},5000,10000),10000);
});
test('short A/B lyric clocks wrap between samples without changing pause, speed or relative CUE time',()=>{
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/utils/lyricPlayback.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,Math});
 const position=module.exports.interpolatedPosition;
 const anchor={position:1200,monotonicTime:1000,playing:true,rate:1,loop:{enabled:true,startMs:1000,endMs:1500}};
 assert.equal(position(anchor,1299,5000),1499);
 assert.equal(position(anchor,1300,5000),1000);
 assert.equal(position(anchor,3100,5000),1300,'Several short loops still remain inside the current segment');
 assert.equal(position({...anchor,rate:2},1150,5000),1000);
 assert.equal(position({...anchor,playing:false},9000,5000),1200);
 assert.equal(position({...anchor,loop:{...anchor.loop,enabled:false}},1300,5000),1500);
 assert.equal(position({...anchor,loop:{enabled:true,startMs:1000,endMs:1200}},1300,5000),1500,'Invalid undersized ranges never wrap');
 assert.equal(position({...anchor,position:0},2300,5000),1300,'A pre-loop seek/buffering sample is not reinterpreted as a loop');
});
test('confirmed lyric seeks use the same A/B bounds as native playback before painting a new anchor',()=>{
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/utils/lyricPlayback.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,Math});
 const seek=module.exports.lyricSeekPosition,loop={enabled:true,startMs:1000,endMs:1500};
 assert.equal(seek({start:200},0,5000,loop),1000);
 assert.equal(seek({start:9000},0,5000,loop),1499);
 assert.equal(seek({start:1200},50,5000,loop),1250);
 assert.equal(seek({start:1200},-500,5000,loop),1000,'The user offset is applied before the loop bound');
 assert.equal(seek({start:9000},0,5000,{...loop,enabled:false}),5000);
 assert.equal(seek({start:200},0,5000,{...loop,endMs:1200}),200);
 assert.equal(seek({start:9000},0,5000),5000);
});
