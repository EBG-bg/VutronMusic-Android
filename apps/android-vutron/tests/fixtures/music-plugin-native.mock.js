const picture='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="12" fill="#19b9b4"/></svg>')
const context=id=>({opaque:{provider:'fixture',cursor:id},extra:['unchanged',id]})
const artist={id:'artist-a',name:'Fixture artist',picUrl:picture,pluginId:'fixture',sourceContext:context('artist')}
const album={id:'album-a',name:'Fixture album',picUrl:picture,pluginId:'fixture',sourceContext:context('album'),artists:[artist]}
const tracks=[1,2,3].map(id=>({id:'track-'+id,name:'Fixture song '+id,picUrl:picture,duration:180000,album,artists:[artist],albumArtists:[artist],pluginId:'fixture',sourceContext:{id:'track-'+id,...context('track-'+id)},playable:true,reason:'',alias:[],no:id,createTime:1,mvid:0,playCount:0,type:'stream'}))
const playlist={id:'playlist-a',name:'Owned playlist',picUrl:picture,sourceContext:context('playlist'),pluginId:'fixture',isMine:true,isPrivate:false,trackCount:3,creator:{userId:'user-a',nickname:'Fixture listener'}}
const mv={id:'mv-a',name:'Fixture MV',picUrl:picture,sourceContext:context('mv'),pluginId:'fixture',artists:[artist]}
const methodNames=['systemPing','getAccount','updateBaseUrl','doLogin','doLogout','loginQrKey','loginQrCodeCheck','getAllTracks','search','getRecommendPlaylist','getRecommendTracks','getBanner','userPlaylist','getPlaylistDetail','getPlaylistTracks','createPlaylist','editPlaylist','deletePlaylist','subscribePlaylist','likeATrack','addOrRemoveTracksToPlaylist','reorderPlaylistTracks','likelist','albumDetail','artistDetail','artistAlbums','artistMVs','simiArtists','followArtist','subscribeAlbum','rankList','rankTop','topSong','newAlbums','topAlbums','catlist','getCategoryPlaylist','getTrackCatlist','getAlbumCatlist','getArtistCatlist','artistsList','userLikedArtists','userLikedMVs','cloudDisk','userRecord','personalFM','fmTrash','intelligencePlaylist','mvDetail','likeAMV','subAMV','getTrackDetail','getLyric','getCommentTab','getComments','likeAComment','submitAComment','getFloorComments','matchTrack']
const primary={id:'fixture',baseId:'fixture',name:'Fixture media',type:'stream',enabled:true,builtIn:true,installed:true,methods:methodNames,status:'login',accountScope:'fixture-account-a',baseUrl:'https://fixture.invalid',capabilities:{getComments:true,getLyric:true,matchTrack:'search',comment:{read:true,like:true,submit:true,floor:true,types:['track','album','playlist','mv']},mv:{detail:true,like:true,subscribe:true}}}
const builtins=[primary,...Array.from({length:6},(_,index)=>({...primary,id:'optional-'+index,baseId:'optional-'+index,name:'Optional source '+(index+1)}))]
let plugins=builtins.map(row=>({...structuredClone(row),enabled:false}))
const state=()=>({plugins:structuredClone(plugins),catalog:builtins.map(({accountScope,baseUrl,...row})=>({...row,installed:true}))})
const comment={id:'comment-a',content:'Safe plain comment',time:1,owner:true,liked:false,likedCount:2,replyCount:1,user:{id:'user-a',nickname:'Fixture listener',avatarUrl:picture},sourceContext:context('comment'),beReplied:null}
let searchPage=0,playlistPage=0,comments=[],failNext='',loginStatus='login',sourcePriorities={lyric:['fixture'],comment:['fixture']}
const likedByAccount=new Map(),likeKey=(id,scope)=>JSON.stringify([id,scope||''])
export const pluginBackend={calls:[],tracks,playlist,context,links:[],commentCandidates:[],emptyCommentSource:'',holdPlaylistPage:false,pendingPlaylistResolve:undefined,holdInstall:false,pendingInstall:undefined,
 likeReadMode:'normal',holdLikeRead:false,pendingLikeRead:undefined,holdLikeWrite:false,pendingLikeWrite:undefined,
 setLikedFor(id,values,scope=plugins.find(row=>row.id===id)?.accountScope){likedByAccount.set(likeKey(id,scope),new Set(values))},
 getLikedFor(id,scope=plugins.find(row=>row.id===id)?.accountScope){return [...(likedByAccount.get(likeKey(id,scope))||[])]},
 setFailure(method){failNext=method},get plugins(){return plugins}}
const record=(method,params)=>pluginBackend.calls.push({method,params:JSON.parse(JSON.stringify(params||{}))})
export const musicPluginBridge={
 async listMusicPlugins(){record('list');return state()},
 async importMusicPlugin(){record('import');const plugin={...primary,id:'imported',baseId:'imported',name:'Imported plugin',builtIn:false};plugins.push(plugin);return {plugin,...state()}},
 async manageMusicPlugin(params){
  record('manage',params)
  if(params.action==='install')return state() // Legacy registration never enables a provided source.
  if(params.action==='sourcePriorities')return structuredClone(sourcePriorities)
  if(params.action==='setSourcePriorities'){record('setSourcePriorities',params);sourcePriorities={lyric:params.lyric,comment:params.comment};return structuredClone(sourcePriorities)}
  if(params.action==='sourceLink'){record('sourceLink',params);if(failNext==='sourceLink'){failNext='';throw new Error('Fixture link save failed')}pluginBackend.links.push(JSON.parse(JSON.stringify(params)));return{saved:true}}
  if(params.action==='sourceCandidates')return{candidates:pluginBackend.commentCandidates.length?structuredClone(pluginBackend.commentCandidates):[{pluginId:params.pluginId,accountScope:params.accountScope,trackId:params.track.id,sourceContext:params.track.sourceContext}]}
  const plugin=plugins.find(row=>row.id===params.id);if(!plugin)throw new Error('Unknown plugin');if(params.action==='enable')plugin.enabled=true;if(params.action==='disable')plugin.enabled=false;if(params.action==='configure')plugin.baseUrl=params.baseUrl;if(params.action==='reset'){if(failNext==='reset'){failNext='';throw new Error('Fixture reset failed')}plugin.enabled=false;plugin.status='logout';plugin.accountScope='reset-'+plugin.id;plugin.baseUrl='';return state()}if(params.action==='remove'){if(plugin.builtIn)throw new Error('Built-in sources are provided; use reset');if(failNext==='remove'){failNext='';throw new Error('Fixture uninstall failed')}if(plugins.some(row=>row.id!==plugin.id&&row.baseId===plugin.id))throw new Error('Remove instances first');plugins=plugins.filter(row=>row.id!==params.id)}if(params.action==='instance')plugins.push({...plugin,id:'fixture:instance',baseId:plugin.id,name:params.name,builtIn:false});if(params.action==='logs')return{logs:['Safe runtime event']};return state()
 },
 async renderMusicPluginQr(){return{imageData:picture}},
 async resolveMusicPluginArtwork(){return{uri:picture}},
 async resolveMusicPluginMedia(params){record('resolveMedia',params);return{uri:'data:video/mp4;base64,'}},
 async getMusicPluginPlaylistProgress(params){record('playlistProgress',params);const source=plugins.find(row=>row.id===params.pluginId);if(params.accountScope&&params.accountScope!==source?.accountScope)throw new Error('Fixture progress scope changed');return{available:params.playlistKey==='playlist-a',trackId:'track-2',sourcePluginId:'fixture',position:42000}},
 async callMusicPlugin({pluginId,accountScope,method,params}){
  record(method,{...params,_calledPluginId:pluginId,_calledAccountScope:accountScope});const active=plugins.find(row=>row.id===pluginId);if(!active?.enabled)throw new Error('Fixture source disabled');if(accountScope&&active?.accountScope!==accountScope)throw new Error('Fixture account scope changed');if(method===failNext){failNext='';throw new Error('Fixture write failed')}
  if(method==='systemPing')return{code:200,status:loginStatus}
  if(method==='getAccount')return{code:200,baseUrl:'https://fixture.invalid',userName:'fixture-user',pwd:'never-fill-this-password'}
  if(method==='updateBaseUrl'){active.baseUrl=params.url;active.accountScope='fixture-server@'+params.url;return{code:200}}
  if(method==='doLogin'){loginStatus='login';active.accountScope='fixture-user@'+params.userName+'@'+active.baseUrl;return{code:200,data:{userId:'user-a',nickname:'Fixture listener',avatarUrl:picture,isVip:false,signature:''}}}
  if(method==='doLogout'){loginStatus='logout';return{code:200}}
  if(method==='likelist'){
    const ids=pluginBackend.getLikedFor(pluginId,accountScope),data=structuredClone(tracks.filter(row=>ids.includes(row.id)))
    const response=pluginBackend.likeReadMode==='partial'?{code:200,data:[],count:3,sourceContext:context('likes-partial')}:{code:200,data,count:data.length,sourceContext:{}}
    if(pluginBackend.holdLikeRead){pluginBackend.holdLikeRead=false;return await new Promise(resolve=>pluginBackend.pendingLikeRead=()=>{pluginBackend.pendingLikeRead=undefined;resolve(response)})}
    return response
  }
  if(method==='likeATrack'){
    const key=likeKey(pluginId,accountScope)
    if(pluginBackend.holdLikeWrite){pluginBackend.holdLikeWrite=false;await new Promise(resolve=>pluginBackend.pendingLikeWrite=()=>{pluginBackend.pendingLikeWrite=undefined;resolve()})}
    const ids=likedByAccount.get(key)||new Set()
    for(const row of params.tracks||[])params.op==='add'?ids.add(row.id):ids.delete(row.id)
    likedByAccount.set(key,ids);return{code:200}
  }
  if(method==='loginQrKey')return{code:200,data:{url:'https://fixture.invalid/login?key=key-a',qrcode:'key-a'}}
  if(method==='loginQrCodeCheck')return{code:801,message:'Waiting'}
  if(method==='getBanner')return{code:200,data:[{id:1,sourceId:'playlist-a',name:'Fixture banner',picUrl:picture,type:'playlist',typeTitle:'Fixture banner',sourceContext:context('playlist')}]}
  if(method==='userPlaylist')return{code:200,liked:{...playlist,id:'liked',name:'Liked playlist'},playlists:[structuredClone(playlist)],albums:[album],sourceContext:{}}
  if(method==='getPlaylistDetail'){playlistPage=0;return{code:200,data:{...structuredClone(playlist),description:'Fixture description',tags:['Fixture'],tracks:structuredClone(tracks.slice(0,2)),trackIds:tracks.map(row=>row.id),sourceContext:context('playlist-first')}}}
  if(method==='getPlaylistTracks'){playlistPage++;const result={code:200,data:playlistPage===1?structuredClone(tracks.slice(2)):[],sourceContext:context('playlist-next')};if(pluginBackend.holdPlaylistPage)return await new Promise(resolve=>pluginBackend.pendingPlaylistResolve=()=>{pluginBackend.holdPlaylistPage=false;pluginBackend.pendingPlaylistResolve=undefined;resolve(result)});return result}
  if(method==='albumDetail')return{code:200,data:{...album,name:'Fixture album',songs:structuredClone(tracks),subscribed:false,sourceContext:context('album')}}
  if(method==='artistDetail')return{code:200,artist:{...artist,followed:false},songs:structuredClone(tracks),sourceContext:context('artist')}
  if(method==='mvDetail')return{code:200,data:{...mv,liked:false,subed:false,sources:[{url:'http://fixture.invalid/video.mp4',quality:'720p',type:'mp4'},{url:'http://fixture.invalid/video-hd.mp4',quality:'1080p',type:'mp4'}]}}
  if(method==='getComments'){if(pluginBackend.emptyCommentSource===pluginId)return{code:200,data:[],count:0,sourceContext:{}};if(params.reset)comments=[structuredClone(comment)];return{code:200,data:comments,count:comments.length,sourceContext:context('comments')}}
  if(method==='getFloorComments')return{code:200,data:[{...structuredClone(comment),id:'reply-a',content:'Floor reply'}],count:1,sourceContext:{}}
  if(method==='getCommentTab')return{code:200,data:[{name:'推荐',code:99,active:true},{name:'最新',code:3,active:false}]}
  if(method==='submitAComment'){comments=params.t==='del'?[]:[{...structuredClone(comment),id:'written',content:params.comment}];return{code:200,data:comments[0]||null}}
  if(method==='search'){searchPage=params.reset?1:searchPage+1;const values={tracks:tracks.slice(searchPage===1?0:2,searchPage===1?2:3),playlists:[playlist],albums:[album],artists:[artist],mvs:[mv]};return{code:200,data:structuredClone(values[params.tab]||[]),count:3,sourceContext:context('search-'+searchPage)}}
  if(method==='catlist')return{code:200,data:{static:[{id:1,name:'Category A',sourceContext:context('category-a')}],tagList:[]}}
  if(method==='getArtistCatlist')return{code:200,data:[{name:'Area',code:'area',sub:[{name:'All areas',code:'all',sourceContext:context('area')}]},{name:'Type',code:'type',sub:[{name:'All types',code:'all',sourceContext:context('type')}]}]}
  if(method==='getAlbumCatlist'||method==='getTrackCatlist')return{code:200,data:[{name:'Category A',code:1,sourceContext:context('category-a')}]}
  if(['getRecommendPlaylist','rankTop','rankList','getCategoryPlaylist'].includes(method))return{code:200,data:[structuredClone(playlist)],sourceContext:{}}
  if(['topAlbums','newAlbums','artistAlbums'].includes(method))return{code:200,data:[album],albums:[album],sourceContext:{}}
  if(['topArtists','simiArtists','artistsList','userLikedArtists'].includes(method))return{code:200,data:[artist],sourceContext:{}}
  if(['artistMVs','userLikedMVs'].includes(method))return{code:200,data:[mv],sourceContext:{}}
  if(method==='userRecord')return{code:200,weekData:[tracks[1]],allData:tracks,sourceContext:{}}
  if(['getAllTracks','getRecommendTracks','personalFM','cloudDisk','topSong','intelligencePlaylist'].includes(method))return{code:200,data:structuredClone(tracks),count:3,sourceContext:{}}
  if(method==='getTrackDetail')return{code:200,data:structuredClone(params.tracks.map(row=>tracks.find(track=>track.id===row.id)||tracks[0]))}
  if(method==='matchTrack')return{code:200,data:{...structuredClone(tracks[0]),confidence:98}}
  return{code:200}
 }
}
