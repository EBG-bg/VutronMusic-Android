import { vutronPlugin as base } from './sliders-native.mock.js'
const key='personal-ui-state'
const read=()=>JSON.parse(localStorage.getItem(key)||'{}')
const write=values=>localStorage.setItem(key,JSON.stringify({...read(),...values}))
const avatar='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#1db9b5"/></svg>')
const playlists=[{id:71,name:'Zulu',createTime:10},{id:72,name:'Alpha',createTime:30},{id:73,name:'Beta',createTime:20}].map(p=>({...p,creatorUserId:7,trackCount:1}))
export const personalUIBackend={set(values){write(values)},lastBackup:null} // isolated fixture, no account writes
export const vutronPlugin={...base,
  async getSession(){return {loggedIn:true,profile:{userId:7,nickname:'Listener',avatarUrl:avatar}}},
  async getPlaylists(){return {playlists}},
  async getPlaylistTracks({playlistId}){return {tracks:[{id:playlistId+100,name:'Song '+playlistId,artists:['Artist'],duration:180000}]}},
  async getPlaybackState(){const s=read();return {...await base.getPlaybackState(),playing:s.playing??false,mode:s.mode??0,...(s.track?{track:s.track,trackId:s.track.id,title:s.track.name}:{})}},
  async play({track,queue,index}){write({track,queue,index,playing:true})},
  async setPlaybackMode({mode}){write({mode});return {mode}},
  async getSleepTimer(){const deadlineMs=read().deadlineMs||0;return {deadlineMs,remainingMs:Math.max(0,deadlineMs-Date.now())}},
  async setSleepTimer({durationMs}){write({deadlineMs:Date.now()+durationMs});return this.getSleepTimer()},
  async clearSleepTimer(){write({deadlineMs:0});return this.getSleepTimer()},
  async exportUserBackup(value){personalUIBackend.lastBackup=structuredClone(value);return {collectionCount:1}},
  async importUserBackup(){return {collectionCount:1,orders:{},frontend:{'vutron:font-scale':'120','vutron:timer-preset':'90','vutron:player-lyrics':'true'}}}
}
