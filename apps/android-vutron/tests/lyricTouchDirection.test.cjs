const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), vue = require('vue')
const { parse, compileScript } = require('@vue/compiler-sfc')
function fixture() {
  const frames=new Map(),timers=new Map(),scrolls=[],emits=[],cleanup=[];let nextId=0
  function load(file,dependencies={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:name=>dependencies[name]});return module.exports}
  const helpers=load(path.join(__dirname,'../src/utils/lyricPlayback.ts'))
  const filename=path.join(__dirname,'../src/components/OriginalLyricsView.vue'),descriptor=parse(fs.readFileSync(filename,'utf8'),{filename}).descriptor
  const script=compileScript(descriptor,{id:'lyric-touch-fixture'}),module={exports:{}}
  vm.runInNewContext(ts.transpileModule(script.content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    module,exports:module.exports,require(name){if(name==='vue')return{...vue,inject:(_,fallback)=>fallback,onMounted(){},onUnmounted:fn=>cleanup.push(fn)};if(name==='../composables/navigationPreview')return{navigationPreviewKey:Symbol('navigation-preview')};if(name==='../utils/lyricPlayback')return helpers;if(name==='../platform/lyricDisplay')return{lyricDisplayStyle:()=>({})};if(name==='../platform/motion')return{isMotionReduced:()=>true};throw new Error('Unexpected lyric-touch dependency '+name)},
    document:{visibilityState:'visible',removeEventListener(){}},window:{scrollY:0,scrollBy:options=>scrolls.push(options.top),removeEventListener(){}},performance:{now:()=>1000},
    requestAnimationFrame:fn=>{frames.set(++nextId,fn);return nextId},cancelAnimationFrame:id=>frames.delete(id),setTimeout:fn=>{timers.set(++nextId,fn);return nextId},clearTimeout:id=>timers.delete(id),console
  })
  const line={start:1000,text:'Line one',words:[]},props=vue.reactive({family:{original:[line],translation:[],pairedTranslations:[]},position:0,playing:false,offsetMs:0,duration:180000,rate:1})
  const scope=vue.effectScope(),state=scope.run(()=>module.exports.default.setup(props,{expose(){},emit:(...args)=>emits.push(args)}))
  state.container.value={scrollTop:200,clientHeight:400,scrollHeight:1200}
  const touch=(x,y)=>({touches:[{clientX:x,clientY:y}]})
  const flushFrames=()=>{for(let round=0;round<3&&frames.size;round++)for(const [id,fn]of[...frames]){frames.delete(id);fn()}}
  return{state,props,line,touch,frames,scrolls,emits,flushFrames,destroy(){cleanup.forEach(fn=>fn());scope.stop()}}
}

test('lyric touch jitter and horizontal intent keep automatic following active',()=>{
  const f=fixture();f.state.touchStart(f.touch(200,100));f.state.touchMove(f.touch(202,102));f.state.touchMove(f.touch(204,103));assert.equal(f.state.manualScroll.value,false)
  f.state.touchMove(f.touch(240,104));f.state.touchMove(f.touch(280,111));assert.equal(f.state.manualScroll.value,false);assert.equal(f.frames.size,0)
  f.state.seekLine(f.line,{detail:1},0);assert.equal(f.state.pendingLine.value,undefined,'A horizontal drag cannot create a trailing lyric-seek confirmation');assert.deepEqual(f.emits,[]);f.destroy()
})

test('only a clear vertical lyric drag enters manual follow mode and retains boundary page handoff',()=>{
  const f=fixture();f.state.touchStart(f.touch(200,100));f.state.touchMove(f.touch(203,123));assert.equal(f.state.manualScroll.value,true);assert.equal(f.frames.size,0)
  f.state.container.value.scrollTop=0;f.state.touchStart(f.touch(200,100));f.state.touchMove(f.touch(202,125));assert.equal(f.state.manualScroll.value,true);f.flushFrames();assert.deepEqual(f.scrolls,[-25]);f.destroy()
})

test('a fresh tap after horizontal dragging preserves the original double-confirm seek contract and offset',()=>{
  const f=fixture();f.props.offsetMs=250;f.state.touchStart(f.touch(200,100));f.state.touchMove(f.touch(240,102));f.state.seekLine(f.line,{detail:1},0);assert.deepEqual(f.emits,[])
  f.state.touchStart(f.touch(200,100));f.state.seekLine(f.line,{detail:1},0);assert.equal(f.state.pendingLine.value,0);assert.deepEqual(f.emits,[])
  f.state.seekLine(f.line,{detail:1},0);assert.equal(f.state.pendingLine.value,undefined);assert.deepEqual(f.emits,[['seek',1250]]);f.destroy()
})
