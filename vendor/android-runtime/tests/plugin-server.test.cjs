'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function runtimePort() {
  for (let port=49152;port<=49251;port++) {
    const probe=http.createServer();
    const free=await new Promise(resolve=>{probe.once('error',()=>resolve(false));probe.listen(port,'127.0.0.1',()=>resolve(true));});
    if (free) { await new Promise(resolve=>probe.close(resolve)); return port; }
  }
  throw new Error('No test port available in the embedded runtime range');
}
test('the real runtime route revokes successful account/server changes and preserves failed operations', {timeout:15000}, async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vutron-plugin-route-'));
  const upstream=http.createServer((request,response)=>{response.setHeader('connection','close');response.end('audio');});
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const baseUrl='http://127.0.0.1:'+upstream.address().port;
  const port=await runtimePort(), origin='http://127.0.0.1:'+port, token='a'.repeat(64);
  const child=spawn(process.execPath,[path.resolve(__dirname,'../src/main/assets/sources-runtime/server.js'),String(port),token,path.join(directory,'runtime.log')],{stdio:['ignore','ignore','pipe']});
  let diagnostic='';child.stderr.on('data',chunk=>diagnostic=(diagnostic+String(chunk)).slice(-2000));
  const request=async body=>{
    const response=await fetch(origin+'/plugins',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
    return response.json();
  };
  try {
    let ready=false;
    for(let attempt=0;attempt<100;attempt++) {
      try {ready=(await fetch(origin+'/health',{headers:{Authorization:'Bearer '+token}})).ok;}catch{}
      if(ready)break;
      if(child.exitCode!==null)throw new Error('Runtime exited: '+diagnostic);
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    assert.equal(ready,true,diagnostic);
    assert.equal(fs.existsSync(path.join(directory,'music-plugins-v1')),false,'Health does not initialize the plugin host');
    const imported=await request({action:'import',source:"exports.meta={name:'Route fixture',type:'stream'};exports.doLogin=async()=>({code:200});exports.doLogout=async()=>({code:200});"});
    const id=imported.plugin.id;
    assert.equal((await request({action:'configure',id,baseUrl})).code,200);
    const register=async()=>{
      const value=await request({action:'resolveMedia',id,allowNetwork:true,media:{url:baseUrl+'/audio'}});
      assert.equal(value.code,200);return origin+value.path;
    };
    let media=await register();assert.equal((await fetch(media)).status,200);
    assert.notEqual((await request({action:'configure',id,baseUrl:'ftp://invalid'})).code,200);
    assert.equal((await fetch(media)).status,200,'A failed server edit preserves the current authorized stream');
    assert.equal((await request({action:'configure',id,baseUrl})).code,200);
    assert.equal((await fetch(media)).status,404);
    media=await register();
    assert.equal((await request({action:'call',id,method:'doLogin',params:{},allowNetwork:true})).result.code,200);
    assert.equal((await fetch(media)).status,404);
    media=await register();
    assert.equal((await request({action:'call',id,method:'doLogout',params:{},allowNetwork:true})).result.code,200);
    assert.equal((await fetch(media)).status,404);
    const instance=await request({action:'instance',id,name:'Other'});assert.ok(instance.plugin.id);
    media=await register();
    assert.notEqual((await request({action:'remove',id})).code,200);
    assert.equal((await fetch(media)).status,200,'A rejected removal preserves the stream');
    assert.equal((await request({action:'disable',id})).code,200);
    assert.equal((await fetch(media)).status,404);
    const provided='emby';
    assert.equal((await request({action:'enable',id:provided})).code,200);
    assert.equal((await request({action:'configure',id:provided,baseUrl})).code,200);
    const providedMedia=await request({action:'resolveMedia',id:provided,allowNetwork:true,media:{url:baseUrl+'/provided-audio'}});
    assert.equal(providedMedia.code,200);
    const previousUrl=origin+providedMedia.path;
    assert.equal((await fetch(previousUrl)).status,200);
    const reset=await request({action:'reset',id:provided});
    assert.equal(reset.code,200);
    assert.equal(reset.plugins.find(row=>row.id===provided).enabled,false);
    assert.equal((await request({action:'enable',id:provided})).code,200);
    assert.equal((await fetch(previousUrl)).status,404,'Reset revokes the old private stream even after the provided source is enabled again');
    assert.equal(fs.readFileSync(path.join(directory,'runtime.log'),'utf8').includes('matcher-loaded'),false,
      'Plugin libraries and media registration do not initialize the fallback matcher');
  } finally {
    const exited=new Promise(resolve=>child.once('exit',resolve));
    if(child.exitCode===null){child.kill();await exited;}
    await new Promise(resolve=>upstream.close(resolve));
    fs.rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  }
});

test('concurrent first fallback requests initialize the real matcher once while plugin-only startup stays lazy',{timeout:15000},async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vutron-lazy-matcher-'));
  const runtime=path.resolve(__dirname,'../src/main/assets/sources-runtime');
  const entry=require.resolve('@unblockneteasemusic/server',{paths:[runtime]});
  const metadata=path.resolve(path.dirname(entry),'../request.js');
  const trace=path.join(directory,'matcher-loads.txt'),preload=path.join(directory,'preload.cjs');
  // Keep the actual provider graph and wrapper installation, but stop metadata
  // before any external request. This tests runtime lifecycle, not music APIs.
  fs.writeFileSync(preload,`const fs=require('node:fs'),Module=require('node:module');const original=Module._load;
Module._load=function(name,parent,main){const file=Module._resolveFilename(name,parent,main);
if(file===${JSON.stringify(metadata)})return async()=>{throw new Error('Synthetic metadata stop')};
if(file===${JSON.stringify(entry)})fs.appendFileSync(${JSON.stringify(trace)},'loaded\\n');
return original.apply(this,arguments)};`);
  const port=await runtimePort(),origin='http://127.0.0.1:'+port,token='b'.repeat(64);
  const child=spawn(process.execPath,['--require',preload,path.join(runtime,'server.js'),String(port),token,path.join(directory,'runtime.log')],{stdio:['ignore','ignore','pipe']});
  let diagnostic='';child.stderr.on('data',chunk=>diagnostic=(diagnostic+String(chunk)).slice(-3000));
  const get=route=>fetch(origin+route,{headers:{Authorization:'Bearer '+token}});
  try{
    let ready=false;
    for(let attempt=0;attempt<100;attempt++){
      try{ready=(await get('/health')).ok}catch{}
      if(ready)break;
      if(child.exitCode!==null)throw new Error('Runtime exited: '+diagnostic);
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    assert.equal(ready,true,diagnostic);assert.equal(fs.existsSync(trace),false);
    const results=await Promise.all([get('/song?id=1'),get('/song?id=2')]);
    assert.deepEqual(results.map(result=>result.status),[404,404]);
    assert.equal((await get('/song?id=3')).status,404);
    assert.equal(fs.readFileSync(trace,'utf8'),'loaded\n');
    const events=fs.readFileSync(path.join(directory,'runtime.log'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(events.filter(row=>row.event==='matcher-loaded').length,1);
  }finally{
    const exited=new Promise(resolve=>child.once('exit',resolve));
    if(child.exitCode===null){child.kill();await exited}
    fs.rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:50});
  }
});
