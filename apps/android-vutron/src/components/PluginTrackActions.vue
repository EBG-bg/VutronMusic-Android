<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { musicPluginBridge as bridge } from '../plugins/bridge'
import { allowsPluginComments, hasPluginMethod, pluginItems, pluginParams, type MusicPlugin, type PluginContext, type PluginItem, type PluginPlayback } from '../plugins/protocol'
import { useModalFocus } from '../composables/modalFocus'
import { useModalIsolation } from '../composables/modalIsolation'
import { useSheetDrag } from '../composables/sheetDrag'
import { actionDialog, askAction } from '../platform/actionDialog'
import { usePluginTrackLikes } from '../plugins/usePluginLikes'
import OriginalIcon from './OriginalIcon.vue'
import SheetDragHandle from './SheetDragHandle.vue'
import PluginCommentSheet from './PluginCommentSheet.vue'
import PluginMatchSheet from './PluginMatchSheet.vue'

const props=defineProps<{track:PluginItem;pluginId:string;accountScope?:string;plugins?:MusicPlugin[];localOnly:boolean;disabled?:boolean}>()
const emit=defineEmits<{play:[value:PluginPlayback];modal:[value:boolean]}>(),{t}=useI18n()
const known=ref<MusicPlugin[]>([]),installed=computed(()=>props.plugins||known.value),sourceId=computed(()=>props.track.pluginId||props.pluginId)
const source=computed(()=>installed.value.find(row=>row.id===sourceId.value)),busy=ref(false),error=ref(''),notice=ref('')
const choosingLike=ref(false)
const accountValid=computed(()=>!props.accountScope||source.value?.accountScope===props.accountScope)
const actionsRoot=ref<HTMLElement>(),likesVisible=ref(false)
const {value:liked,loading:likesLoading,saving:likesSaving,error:likesError,load:loadLikes,setLiked}=usePluginTrackLikes({
  plugin:()=>source.value,track:()=>props.track,accountScope:()=>props.accountScope,localOnly:()=>props.localOnly,active:()=>likesVisible.value
})
const adding=ref(false),choices=ref<PluginItem[]>([]),matching=ref(false),comments=ref(false),trigger=ref<HTMLElement>(),panel=ref<HTMLElement>()
const nested=computed(()=>adding.value||matching.value||comments.value)
let generation=0,alive=true
const supported=(method:string)=>accountValid.value&&hasPluginMethod(source.value,method)&&(!props.localOnly||source.value?.type==='local')
const canMatch=computed(()=>accountValid.value&&installed.value.some(row=>hasPluginMethod(row,'matchTrack')&&row.capabilities?.matchTrack!==false&&(!props.localOnly||row.type==='local')))
const canComment=computed(()=>accountValid.value&&installed.value.some(row=>allowsPluginComments(row,'track')&&(!props.localOnly||row.type==='local')))
function message(cause:unknown,reading=false){
  const value=cause instanceof Error?cause.message:typeof cause==='string'?cause:t('mobile.plugins.failed')
  if(value==='PLUGIN_LIKES_MEMBER_CONTEXT_REQUIRED')return t('mobile.plugins.likeMemberContextRequired')
  if(value.startsWith('PLUGIN_LIKES_'))return t(reading?'mobile.plugins.likeReadFailed':'mobile.plugins.likeOperationFailed')+' ('+value+')'
  return value
}
const likeReadError=computed(()=>likesError.value?message(likesError.value,true):'')
async function call(method:string,params:PluginContext={}){
  if(!supported(method))throw new Error(t(props.localOnly?'mobile.plugins.offline':'mobile.plugins.unsupported'))
  const result=await bridge.callMusicPlugin({pluginId:sourceId.value,accountScope:props.accountScope||source.value?.accountScope,method,params})
  if(result.code!==200)throw new Error(result.message||t('mobile.plugins.failed'))
  return result
}
async function like(event?:Event){
  if(busy.value||choosingLike.value||props.disabled||likesLoading.value||likesSaving.value||!supported('likeATrack'))return
  choosingLike.value=true;error.value='';const token=generation,origin=event?.currentTarget as HTMLButtonElement|undefined
  try{
    let next=liked.value===undefined?undefined:!liked.value
    if(next===undefined){
      const choice=await askAction({title:t('mobile.plugins.likeStatusUnknown'),message:t('mobile.plugins.likeUnknownHint'),confirmLabel:t('mobile.plugins.like'),secondaryLabel:t('mobile.plugins.unlike'),cancelLabel:t('mobile.management.cancel')})
      if(choice==='cancel')return
      next=choice==='confirm'
    }
    if(token!==generation||!alive)return
    busy.value=true
    const changed=await setLiked(next)
    if(changed&&token===generation&&alive)notice.value=t(next?'mobile.plugins.trackLiked':'mobile.plugins.trackUnliked')
  }catch(cause){if(token===generation&&alive)error.value=message(cause)}
  finally{if(token===generation){busy.value=false;choosingLike.value=false;await nextTick();if(alive&&origin?.isConnected&&!origin.closest('[inert]')&&!actionDialog.value&&(document.activeElement===document.body||document.activeElement===origin||Boolean(document.activeElement?.closest('.action-dialog'))))origin.focus({preventScroll:true})}}
}
function closeAdd(){++generation;adding.value=false;choices.value=[];busy.value=false;error.value=''}
function handleBack(){if(matching.value){matching.value=false;return true}if(comments.value){comments.value=false;return true}if(adding.value){closeAdd();return true}return false}
defineExpose({handleBack})
async function add(event:Event){
  if(busy.value||props.disabled)return
  trigger.value=event.currentTarget as HTMLElement;adding.value=true;busy.value=true;error.value='';const token=++generation
  try{const result=await call('userPlaylist');if(token===generation&&alive)choices.value=pluginItems(result.playlists).filter(row=>row.isMine&&row.id!==result.liked?.id)}
  catch(cause){if(token===generation&&alive)error.value=message(cause)}
  finally{if(token===generation)busy.value=false}
}
async function addTo(playlist:PluginItem){
  if(busy.value||!adding.value)return
  const token=generation;busy.value=true;error.value=''
  try{
    await call('addOrRemoveTracksToPlaylist',{op:'add',playlist:pluginParams(playlist.sourceContext,{id:playlist.id}),tracks:[{pluginId:sourceId.value,sourceContext:props.track.sourceContext}]})
    if(token===generation&&alive){closeAdd();notice.value=t('mobile.plugins.added')}
  }catch(cause){if(token===generation&&alive)error.value=message(cause)}
  finally{if(token===generation)busy.value=false}
}
function openComments(event:Event){trigger.value=event.currentTarget as HTMLElement;comments.value=true}
function matched(value:PluginPlayback){matching.value=false;emit('play',value)}
useModalFocus(panel,{close:closeAdd,open:()=>adding.value,returnFocus:()=>trigger.value})
useModalIsolation(panel,()=>adding.value)
useSheetDrag(panel,{close:closeAdd,enabled:()=>adding.value&&!busy.value})
watch(nested,value=>emit('modal',value),{flush:'sync'})
watch(()=>[props.pluginId,props.track.id,props.track.pluginId,props.accountScope,source.value?.accountScope,props.localOnly],()=>{++generation;adding.value=false;matching.value=false;comments.value=false;busy.value=false;choosingLike.value=false;error.value='';notice.value=''})
let rowDetails:HTMLDetailsElement|null= null
function updateLikesVisibility(){likesVisible.value=!rowDetails||rowDetails.open}
onMounted(async()=>{
  rowDetails=actionsRoot.value?.closest('details')??null
  rowDetails?.addEventListener('toggle',updateLikesVisibility);updateLikesVisibility()
  if(props.plugins)return
  try{const result=await bridge.listMusicPlugins();if(alive)known.value=result.plugins}catch(cause){if(alive)error.value=message(cause)}
})
onUnmounted(()=>{alive=false;++generation;rowDetails?.removeEventListener('toggle',updateLikesVisibility);emit('modal',false)})
</script>
<template>
  <div ref="actionsRoot" class="plugin-shared-track-actions">
    <button v-if="supported('likeATrack')" type="button" class="text-button" data-plugin-like-action :aria-pressed="liked===undefined?undefined:liked" :aria-busy="likesLoading||likesSaving" :disabled="busy||disabled||likesLoading||likesSaving" @click="like"><OriginalIcon :name="liked===true?'heartSolid':'heart'" />{{ $t(likesLoading?'mobile.plugins.likeLoading':liked===undefined?'mobile.plugins.likeStatusUnknown':liked?'mobile.plugins.unlike':'mobile.plugins.like') }}</button>
    <p v-if="supported('likeATrack')&&liked===undefined&&!likesLoading" class="setting-note">{{ $t('mobile.plugins.likeUnknownHint') }}</p>
    <p v-if="likeReadError&&!likesLoading" class="inline-error" role="alert">{{ likeReadError }}</p>
    <button v-if="supported('likeATrack')&&liked===undefined&&!likesLoading" type="button" class="text-button" :disabled="busy||disabled||likesSaving" @click="loadLikes(true)"><OriginalIcon name="refresh" />{{ $t('mobile.plugins.likeRefresh') }}</button>
    <button v-if="supported('userPlaylist')&&supported('addOrRemoveTracksToPlaylist')" type="button" class="text-button" :disabled="busy||disabled" @click="add"><OriginalIcon name="plus" />{{ $t('mobile.plugins.addToPlaylist') }}</button>
    <button v-if="canComment&&source" type="button" class="text-button" :disabled="busy||disabled" @click="openComments"><OriginalIcon name="list" />{{ $t('mobile.plugins.comments') }}</button>
    <button v-if="canMatch" type="button" class="text-button" :disabled="busy||disabled" @click="matching=true"><OriginalIcon name="search" />{{ $t('mobile.plugins.match') }}</button>
    <p v-if="error&&!adding" class="inline-error" role="alert">{{ error }}</p><p v-if="notice" class="setting-note" role="status">{{ notice }}</p>
    <p v-if="source&&!accountValid" class="setting-note">{{ $t('mobile.plugins.accountChanged') }}</p>
  </div>
  <PluginCommentSheet v-if="comments&&source" :plugin="source" :item="track" content-type="track" :local-only="localOnly" :return-focus="trigger" @close="comments=false" />
  <PluginMatchSheet v-if="matching" :track="track" :source-plugin-id="pluginId" :source-account-scope="accountScope" :plugins="installed" :local-only="localOnly" @close="matching=false" @play="matched" />
  <Teleport to="body"><div v-if="adding" class="plugin-add-track-layer" @click.self="closeAdd"><section ref="panel" class="plugin-edit-panel plugin-add-track-panel" role="dialog" aria-modal="true" :aria-label="$t('mobile.plugins.addToPlaylist')" tabindex="-1"><SheetDragHandle @close="closeAdd" /><header><h3>{{ $t('mobile.plugins.addToPlaylist') }}</h3><button type="button" class="icon-button" :aria-label="$t('mobile.common.close')" @click="closeAdd"><OriginalIcon name="close" /></button></header><p v-if="error" class="inline-error" role="alert">{{ error }}</p><p v-if="busy" class="setting-note" role="status">{{ $t('mobile.plugins.loading') }}</p><button v-for="playlist in choices" :key="String(playlist.id)" type="button" class="plugin-playlist-choice" :disabled="busy" @click="addTo(playlist)">{{ playlist.name }}</button><p v-if="!busy&&!choices.length&&!error" class="setting-note">{{ $t('mobile.plugins.noOwnedPlaylist') }}</p></section></div></Teleport>
</template>
<style scoped>
.plugin-shared-track-actions{display:grid;gap:5px}.plugin-shared-track-actions>button{display:flex;align-items:center;gap:10px;min-height:44px;border-radius:12px;text-align:left;justify-content:flex-start;font-size:calc(14px * var(--ui-font-scale,1))}.plugin-shared-track-actions .original-icon{flex:0 0 20px;font-size:20px}.plugin-add-track-layer{position:fixed;inset:0;z-index:145;display:flex;align-items:flex-end;justify-content:center;background:rgb(0 0 0 / 38%);padding-top:max(12px,env(safe-area-inset-top))}.plugin-add-track-panel{width:min(100%,620px);max-height:90dvh;overflow:auto;overscroll-behavior:contain;padding:16px max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));border-radius:22px 22px 0 0;background:var(--color-body-bg);color:var(--ink);box-shadow:0 -8px 32px rgb(0 0 0 / 18%);animation:plugin-add-in var(--motion-panel) ease both}.plugin-add-track-panel header{display:flex;justify-content:space-between;align-items:center;gap:8px}.plugin-add-track-panel h3{font-size:calc(17px * var(--ui-font-scale,1))}.plugin-playlist-choice{display:block;width:100%;min-height:48px;margin:6px 0;border:0;border-radius:12px;background:var(--surface);color:var(--ink);text-align:left;padding:12px;font:inherit}@keyframes plugin-add-in{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
</style>
