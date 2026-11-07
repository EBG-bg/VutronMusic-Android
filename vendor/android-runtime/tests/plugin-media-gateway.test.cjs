'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createPluginMediaGateway } = require('../src/main/assets/sources-runtime/plugin-media-gateway.cjs');
const listen = server => new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const close = server => new Promise(resolve=>server.close(resolve));
const collect = (url, options={}) => new Promise((resolve,reject)=>{
  const outgoing=http.request(url,options,incoming=>{let text='';incoming.setEncoding('utf8');incoming.on('data',x=>text+=x);incoming.on('end',()=>resolve({status:incoming.statusCode,text,headers:incoming.headers}));});
  outgoing.on('error',reject);outgoing.end();
});
test('configured LAN plugin media preserves auth/ranges/HEAD and cannot cross origin',async()=>{
 const seen=[];const upstream=http.createServer((req,res)=>{seen.push({method:req.method,authorization:req.headers.authorization,range:req.headers.range});res.writeHead(206,{'Content-Type':'audio/mpeg','Content-Range':'bytes 0-2/3','Accept-Ranges':'bytes','Content-Length':'3'});res.end(req.method==='HEAD'?'':'abc');});
 await listen(upstream);const origin='http://127.0.0.1:'+upstream.address().port;
 let allowed=true;const gateway=createPluginMediaGateway({allowed:()=>allowed});
 const app=http.createServer((req,res)=>{if(!gateway.handle(req,res,new URL(req.url,'http://localhost'))){res.writeHead(404);res.end();}});await listen(app);
 try{
  assert.throws(()=>gateway.register('emby',origin,{url:'http://127.0.0.1:1/private'}));
  const media=gateway.register('emby',origin,{url:origin+'/audio',headers:{Authorization:'Bearer plugin-only'}}),url='http://127.0.0.1:'+app.address().port+media;
  const result=await collect(url,{headers:{Range:'bytes=0-2'}});assert.equal(result.status,206);assert.equal(result.text,'abc');
  assert.deepEqual(seen[0],{method:'GET',authorization:'Bearer plugin-only',range:'bytes=0-2'});
  assert.equal((await collect(url,{method:'HEAD'})).text,'');
  allowed=false;assert.equal((await collect(url)).status,404);allowed=true;
  gateway.revoke('emby');assert.equal((await collect(url)).status,404);
 }finally{await close(app);await close(upstream)}
});
test('plugin media is streamed before completion and disconnect stops the upstream',async()=>{
 let responseFinished=false;const upstream=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'audio/mpeg'});res.write('first');const timer=setTimeout(()=>{responseFinished=true;res.end('last')},200);res.once('close',()=>clearTimeout(timer));});
 await listen(upstream);const origin='http://127.0.0.1:'+upstream.address().port,gateway=createPluginMediaGateway();
 const app=http.createServer((req,res)=>gateway.handle(req,res,new URL(req.url,'http://localhost')));await listen(app);
 try{
  const media=gateway.register('navidrome',origin,{url:origin+'/audio'});
  await new Promise((resolve,reject)=>http.get('http://127.0.0.1:'+app.address().port+media,response=>{response.once('data',data=>{assert.equal(data.toString(),'first');assert.equal(responseFinished,false);response.destroy();resolve()});response.on('error',()=>{})}).on('error',reject));
 }finally{gateway.revoke();await close(app);await close(upstream)}
});
