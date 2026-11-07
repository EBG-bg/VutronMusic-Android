'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../../..');
const ts = require(path.join(root, 'apps/android-vutron/node_modules/typescript'));
const packageRequire = createRequire(path.join(root, 'packages/plugin-api/package.json'));
const modules = new Map();
// Exercise the unmodified shared TypeScript source. The generated Android CJS
// files have separate runtime tests and are not imported by this suite.
function sourceModule(relative) {
  const file = path.resolve(root, relative);
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} }; modules.set(file, module);
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file
  }).outputText;
  const resolve = request => request.startsWith('.')
    ? sourceModule(path.relative(root, path.resolve(path.dirname(file), request + (path.extname(request) ? '' : '.ts'))))
    : packageRequire(request);
  new vm.Script('(function(module,exports,require){' + output + '\n})', { filename: file }).runInThisContext()(module,module.exports,resolve);
  return module.exports;
}
const schemas = sourceModule('packages/plugin-api/src/schemas.ts');
const { defaultMap } = sourceModule('packages/plugin-api/src/plugin.ts');
const { parseLyric } = sourceModule('packages/plugin-api/src/lyricAdapter.ts');

test('shared TypeScript defaults retain the full original method contract', () => {
  assert.ok(Object.keys(defaultMap).length >= 60);
  for (const [method,value] of Object.entries(defaultMap)) {
    assert.ok(schemas.PluginResultSchema[method],method);
    assert.equal(schemas.PluginResultSchema[method].safeParse(value).success,true,method);
  }
});
test('shared result validation preserves opaque contexts and rejects malformed success bodies', () => {
  const context={cursor:'opaque',nested:{providerKey:'unchanged'},id:'song:arbitrary'};
  const input={code:200,data:[],count:0,sourceContext:context};
  assert.deepEqual(schemas.PluginResultSchema.search.parse(input).sourceContext,context);
  assert.equal(schemas.PluginResultSchema.search.safeParse({...input,data:'bad'}).success,false);
  assert.equal(schemas.PluginResultSchema.getPlaylistTracks.safeParse({code:200,data:[],sourceContext:context}).success,true);
});
test('shared lyric source preserves real word milliseconds, line seconds and paired translations', () => {
  const yrc=parseLyric({yrc:{lyric:'[1000,2000](1000,1000,0)One(2000,1000,0)Two'},ytlrc:{lyric:'[00:01.00]译文'}});
  assert.equal(yrc[0].start,1);assert.equal(yrc[0].end,3);
  assert.deepEqual(yrc[0].lyric.info.map(word=>[word.start,word.end]),[[1000,2000],[2000,3000]]);
  assert.equal(yrc[0].tlyric.text,'译文');
  const lrc=parseLyric('[offset:100]\n[00:01.00]<00:01.00>One<00:02.00>Two\n[00:03.00]End');
  assert.equal(lrc[0].start,0.9);assert.equal(lrc[0].lyric.info[1].start,1900);
  assert.equal(schemas.PluginResultSchema.getLyric.safeParse({code:200,data:lrc}).success,true);
});
