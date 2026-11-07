'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const runtime = path.resolve(__dirname, '../src/main/assets/sources-runtime');
const tempRoot = os.tmpdir();
const {createPluginHost} = require(path.join(runtime, 'plugin-host.cjs'));
const {validateMeta, validateResult} = require(path.join(runtime, 'plugin-contract.cjs'));

const wav = Buffer.alloc(124);
wav.write('RIFF');wav.writeUInt32LE(116,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);
wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);
wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(80,40);
const ndSong = {id:'song-1',title:'Song',artist:'Artist',artistId:'artist-1',album:'Album',albumId:'album-1',duration:120,trackNumber:1,createdAt:'2026-01-01T00:00:00Z'};
const mbSong = {Id:'song-1',Name:'Song',Album:'Album',AlbumId:'album-1',RunTimeTicks:1200000000,DateCreated:'2026-01-01T00:00:00Z',ArtistItems:[{Id:'artist-1',Name:'Artist'}],AlbumArtists:[{Id:'artist-1',Name:'Artist'}],MediaSources:[{Id:'source-1',Size:124,MediaStreams:[]}],ImageTags:{Primary:'cover-1'},UserData:{PlayCount:2},PlaylistItemId:'entry-1'};

async function fixture(kind) {
  const calls=[];
  const server=http.createServer((request,response)=>{
    const url=new URL(request.url,'http://127.0.0.1');
    calls.push({path:url.pathname,query:Object.fromEntries(url.searchParams),headers:{...request.headers}});
    response.setHeader('connection','close');
    if(url.pathname==='/rest/stream'||url.pathname==='/Audio/song-1/stream') {
      const authorized=kind==='navidrome'?url.searchParams.get('u')==='listener':String(request.headers.authorization||'').includes('fixture-token');
      if(!authorized){response.statusCode=401;response.end('Missing source credentials');return}
      const range=/^bytes=(\d+)-(\d*)$/.exec(request.headers.range||'');
      const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(wav.length-1,Number(range[2])):wav.length-1;
      response.statusCode=range?206:200;response.setHeader('content-type','audio/wav');response.setHeader('accept-ranges','bytes');
      response.setHeader('content-length',end-start+1);if(range)response.setHeader('content-range',`bytes ${start}-${end}/${wav.length}`);
      response.end(wav.subarray(start,end+1));return;
    }
    response.setHeader('content-type','application/json');response.setHeader('x-total-count','1');
    const json=value=>response.end(JSON.stringify(value));
    if(url.pathname==='/auth/login')return json({id:'client-1',token:'fixture-token'});
    if(url.pathname==='/Users/AuthenticateByName')return json({User:{Id:'user-1'},AccessToken:'fixture-token'});
    if(url.pathname==='/rest/ping')return json({'subsonic-response':{status:'ok'}});
    if(url.pathname==='/System/Ping')return json({status:'ok'});
    if(url.pathname==='/api/song')return json([ndSong]);
    if(url.pathname==='/api/album')return json([]);
    if(url.pathname==='/api/playlist')return json([{id:'playlist-1',name:'Playlist',songCount:1}]);
    if(url.pathname==='/api/playlist/playlist-1/tracks')return json([ndSong]);
    if(url.pathname==='/rest/getLyricsBySongId.view')return json({'subsonic-response':{status:'ok',lyricsList:{structuredLyrics:[{line:[{start:1000,value:'Line'}]}]}}});
    if(url.pathname==='/Items'||url.pathname==='/Users/user-1/Items'){
      const type=url.searchParams.get('IncludeItemTypes');
      if(type==='Playlist')return json({Items:[{Id:'playlist-1',Name:'Playlist',ChildCount:1,DateCreated:'2026-01-01T00:00:00Z',UserData:{}}],TotalRecordCount:1});
      if(type==='MusicAlbum')return json({Items:[],TotalRecordCount:0});
      return json({Items:[mbSong],TotalRecordCount:1});
    }
    response.statusCode=404;json({error:'Unexpected fixture endpoint: '+url.pathname});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {server,calls,baseUrl:'http://127.0.0.1:'+server.address().port};
}

for(const kind of ['navidrome','emby','jellyfin'])test(`unchanged ${kind}: worker login → playlist → song → authorized byte-range audio`,async()=>{
  const service=await fixture(kind),root=fs.mkdtempSync(path.join(tempRoot,'vutron-plugin-stream-')),previousTmp=process.env.TMPDIR;
  const host=createPluginHost({root,builtins:path.join(runtime,'plugins'),workerFile:path.join(runtime,'plugin-worker.cjs'),validateMeta,validateResult});
  try{
    await host.manage({action:'enable',id:kind});
    await host.manage({action:'configure',id:kind,baseUrl:service.baseUrl});
    assert.equal((await host.call(kind,'doLogin',{userName:'listener',pwd:'test-only'},true)).code,200);
    assert.equal((await host.call(kind,'systemPing',{},true)).status,'login');
    const lists=await host.call(kind,'userPlaylist',{},true);
    assert.equal(lists.code,200);assert.equal(lists.playlists[0].id,'playlist-1');
    const input=lists.playlists[0].sourceContext;
    const tracks=await host.call(kind,'getPlaylistTracks',input,true);
    assert.equal(tracks.code,200);assert.equal(tracks.data[0].id,'song-1');
    const track=tracks.data[0],sourceContext=JSON.stringify(track.sourceContext);
    const location=await host.call(kind,'songUrl',track.sourceContext,true);
    assert.equal(location.code,200);assert.equal(JSON.stringify(track.sourceContext),sourceContext,'The host must not mutate sourceContext');
    let uri=location.data.url[0],headers={Range:'bytes=0-15'};
    if(uri.startsWith('vutron://')){
      const stream=await host.call(kind,'getStream',track.sourceContext,true);
      assert.match(stream.headers.Authorization,/fixture-token/);
      uri=stream.url;headers={...stream.headers,...headers};
    }
    const response=await fetch(uri,{headers});
    assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 0-15/124');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),wav.subarray(0,16));
    assert.equal(service.calls.filter(call=>call.path.includes('stream')).length,1);
    const rawApi=service.calls.find(call=>kind==='navidrome'?call.path==='/api/playlist/playlist-1/tracks':call.path==='/Items'&&call.query.ParentId==='playlist-1'||call.path==='/Users/user-1/Items'&&call.query.ParentId==='playlist-1');
    assert.ok(rawApi,'The playlist must be read through the configured source');
  }finally{
    host.close();await new Promise(resolve=>setTimeout(resolve,80));
    await new Promise(resolve=>service.server.close(resolve));
    if(previousTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTmp;
    fs.rmSync(root,{recursive:true,force:true});
  }
});

for(const kind of ['navidrome','emby','jellyfin'])test(`unchanged ${kind}: disabled configuration is read lazily by the next worker and new-origin HTTP`,async()=>{
  const oldService=await fixture(kind),nextService=await fixture(kind),root=fs.mkdtempSync(path.join(tempRoot,'vutron-plugin-address-')),previousTmp=process.env.TMPDIR;
  const starts=path.join(root,'worker-starts.txt'),worker=path.join(root,'worker-entry.cjs');
  fs.writeFileSync(worker,`require('node:fs').appendFileSync(${JSON.stringify(starts)},'start\\n');require(${JSON.stringify(path.join(runtime,'plugin-worker.cjs'))});`);
  const host=createPluginHost({root,builtins:path.join(runtime,'plugins'),workerFile:worker,validateMeta,validateResult});
  const startCount=()=>fs.existsSync(starts)?fs.readFileSync(starts,'utf8').split('start').length-1:0;
  try{
    await host.manage({action:'enable',id:kind});await host.manage({action:'configure',id:kind,baseUrl:oldService.baseUrl});
    assert.equal((await host.call(kind,'doLogin',{userName:'listener',pwd:'test-only'},true)).code,200);
    assert.equal((await host.call(kind,'getAccount',{},false)).baseUrl,oldService.baseUrl);
    const previousScope=host.list().plugins.find(row=>row.id===kind).accountScope,stateFile=path.join(root,kind+'.state.json'),stored=JSON.parse(fs.readFileSync(stateFile));
    stored.db.Playlist=[{id:'private-playlist',name:'Must remain'}];fs.writeFileSync(stateFile,JSON.stringify(stored));
    const previousAccount=JSON.stringify(stored.db.PluginData),oldRequests=oldService.calls.length,started=startCount();
    await host.manage({action:'disable',id:kind});
    await host.manage({action:'configure',id:kind,baseUrl:nextService.baseUrl});
    const configured=JSON.parse(fs.readFileSync(stateFile)),metadata=host.list().plugins.find(row=>row.id===kind);
    assert.equal(metadata.enabled,false);assert.equal(metadata.baseUrl,nextService.baseUrl);assert.equal(configured.store.baseUrl,nextService.baseUrl);
    assert.equal(JSON.stringify(configured.db.PluginData),previousAccount);assert.equal(configured.db.Playlist[0].name,'Must remain');
    assert.notEqual(metadata.accountScope,previousScope,'Changing the server isolates the previous account scope');
    assert.equal(startCount(),started,'Saving while disabled must not execute the original plugin');assert.equal(oldService.calls.length,oldRequests);assert.equal(nextService.calls.length,0);
    await host.manage({action:'enable',id:kind});assert.equal(startCount(),started,'Enable itself only updates metadata');assert.equal(nextService.calls.length,0);
    const currentScope=host.list().plugins.find(row=>row.id===kind).accountScope;
    const account=await host.call(kind,'getAccount',{},false,true,currentScope);
    assert.equal(account.baseUrl,nextService.baseUrl,'The original getAccount must read the saved new store.baseUrl');assert.equal(account.userName,'listener');assert.equal(startCount(),started+1);
    assert.equal(oldService.calls.length,oldRequests);assert.equal(nextService.calls.length,0,'Reading configuration offline must not probe the server');
    await assert.rejects(host.call(kind,'systemPing',{},true,true,previousScope),{code:'PLUGIN_ACCOUNT_CHANGED'});
    assert.equal(oldService.calls.length,oldRequests);assert.equal(nextService.calls.length,0,'Stale server/account scopes cannot make HTTP requests');
    assert.equal((await host.call(kind,'systemPing',{},true,true,currentScope)).status,'login');
    assert.equal((await host.call(kind,'userPlaylist',{},true,true,currentScope)).code,200);
    assert.ok(nextService.calls.length>0);assert.equal(oldService.calls.length,oldRequests,'Subsequent original plugin HTTP must use only the new origin');
    assert.equal(JSON.parse(fs.readFileSync(stateFile)).store.baseUrl,nextService.baseUrl);
  }finally{
    host.close();await new Promise(resolve=>setTimeout(resolve,80));
    await new Promise(resolve=>oldService.server.close(resolve));await new Promise(resolve=>nextService.server.close(resolve));
    if(previousTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTmp;
    fs.rmSync(root,{recursive:true,force:true});
  }
});
