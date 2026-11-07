'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const { transform } = require(path.join(root,'scripts/runtime-regex-compat.cjs'));
function evaluate(code) { const context={module:{exports:{}}};vm.runInNewContext(code,context);return context.module.exports; }

test('Unicode letter and number expansion preserves all code points in the locked complete data set',()=>{
  const source='module.exports=/^[\\p{L}\\p{N}]$/u;';
  const result=transform(source,'letters.cjs');assert.equal(result.changes.length,1);
  const regex=evaluate(result.code),sets=path.join(root,'packages/plugin-api/node_modules/regenerate-unicode-properties/General_Category');
  const letters=require(path.join(sets,'Letter.js')).characters,numbers=require(path.join(sets,'Number.js')).characters;
  for(let code=0;code<=0x10ffff;code++) assert.equal(regex.test(String.fromCodePoint(code)),letters.contains(code)||numbers.contains(code),'U+'+code.toString(16));
  for(const value of ['A','中','é','Ω','Ж','ش','अ','한','𓀀','𐐀','𝟙','١'])assert.equal(regex.test(value),true,value);
});
test('AST conversion handles static constructor templates while preserving comments, strings and lexical shadowing',()=>{
  const source='// /\\p{L}/u stays a comment\nconst description="\\\\p{L}";const p=`^\\\\p{Script=Greek}+$`;module.exports=new RegExp(p,"u");';
  const output=transform(source,'constructor.cjs');assert.equal(output.changes.length,1);
  assert.ok(output.code.includes('const description="\\\\p{L}"'));
  const regex=evaluate(output.code);assert.equal(regex.test('αΩ'),true);assert.equal(regex.test('Latin'),false);
  const shadowed='const p="\\\\p{L}";function f(p){return new RegExp(p,"u")}function g(RegExp){return new RegExp("\\\\p{L}","u")}';
  assert.equal(transform(shadowed,'shadow.cjs').changes.length,0);
});
test('real unicode-set and emoji string properties are lowered to Node 18 compatible Unicode regexes',()=>{
  const value=transform('module.exports=/^[\\p{Script=Greek}&&\\p{Letter}]+$/v;','sets.cjs');
  assert.equal(value.changes[0].outputFlags,'u');assert.equal(evaluate(value.code).test('αΩ'),true);assert.equal(evaluate(value.code).test('Latin'),false);
  const emoji=evaluate(transform('module.exports=/^\\p{RGI_Emoji}$/v;','emoji.cjs').code);
  for(const text of ['😀','👨‍👩‍👧‍👦','🇨🇳','1️⃣'])assert.equal(emoji.test(text),true,text);
  assert.equal(emoji.test('text'),false);
});
test('generated Zod emoji and path identifier regexes execute without property escapes',()=>{
  const regexes=require('../src/main/assets/sources-runtime/node_modules/zod/v4/core/regexes.cjs');
  assert.equal(regexes.emoji().test('😀'),true);assert.equal(regexes.emoji().source.includes('\\p{'),false);
  const routes=require('../src/main/assets/sources-runtime/node_modules/@neteasecloudmusicapienhanced/api/node_modules/path-to-regexp/dist/index.js');
  assert.equal(routes.match('/song/:名称')('/song/test').params['名称'],'test');
});
