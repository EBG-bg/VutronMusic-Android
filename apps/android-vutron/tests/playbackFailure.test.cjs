const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const moduleScope={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/platform/playbackFailure.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:moduleScope,exports:moduleScope.exports});
const {describePlaybackFailure}=moduleScope.exports;
test('playback recovery actions distinguish sign-in, folder access, offline and retry',()=>{
  for(const [code,action] of [['auth','login'],['local_permission','folders'],['local_missing','folders'],['offline','offline'],['network','retry'],['decode','retry']]){
    const result=describePlaybackFailure({error:'native message',errorCode:code});
    assert.equal(result.action,action);assert.equal(result.legacyMessage,'');
    for(const language of ['en','zh-hans','zh-hant']){
      const messages=JSON.parse(fs.readFileSync(path.join(__dirname,'../src/locales',language+'.json'),'utf8'));
      assert.equal(typeof messages.playbackErrors[code],'string');
    }
  }
});
test('old and unexpected native codes preserve their original message without trusting prototype keys',()=>{
  for(const code of [undefined,'future_code','toString','__proto__']){
    const result=describePlaybackFailure({error:'Old native error',errorCode:code});
    assert.equal(result.code,'playback');assert.equal(result.legacyMessage,'Old native error');
  }
});
