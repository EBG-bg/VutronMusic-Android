'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const runtime=path.resolve(__dirname,'../src/main/assets/sources-runtime');
const policy=require(path.join(runtime,'source-policy.json'));

test('the shared audio fallback catalogue keeps the established real provider set',()=>{
  assert.equal(policy.format,1);
  assert.deepEqual(policy.fallbackSources,['bodian','kuwo','kugou','qq','bilibili','pyncmd','migu']);
  assert.equal(new Set(policy.fallbackSources).size,policy.fallbackSources.length);
  for(const id of policy.fallbackSources) assert.ok(fs.existsSync(path.join(runtime,'node_modules/@unblockneteasemusic/server/src/provider',id+'.js')),id+' has a real bundled matcher');
});
