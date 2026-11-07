<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { musicPluginBridge as bridge } from '../plugins/bridge'
import { hasPluginMethod, type MusicPlugin, type PluginItem, type PluginPlayback } from '../plugins/protocol'
import { useModalFocus } from '../composables/modalFocus'
import { useModalIsolation } from '../composables/modalIsolation'
import { useSheetDrag } from '../composables/sheetDrag'
import OriginalIcon from './OriginalIcon.vue'
import AppSelect from './AppSelect.vue'
import PluginArtwork from './PluginArtwork.vue'
import SheetDragHandle from './SheetDragHandle.vue'

const props=defineProps<{track:PluginItem;plugins:MusicPlugin[];localOnly:boolean;sourcePluginId?:string;sourceAccountScope?:string}>()
const emit=defineEmits<{close:[];play:[value:PluginPlayback]}>(),{t}=useI18n()
const targets=computed(()=>props.plugins.filter(row=>hasPluginMethod(row,'matchTrack')&&row.capabilities?.matchTrack!==false&&(!props.localOnly||row.type==='local')))
const target=ref(targets.value[0]?.id||''),matched=ref<PluginItem>(),matchedPlugin=ref(''),busy=ref(false),error=ref(''),panel=ref<HTMLElement>()
let generation=0
async function match(){
  if(busy.value||!target.value)return
  const token=++generation,pluginId=target.value;busy.value=true;error.value='';matched.value=undefined
  try{
    const result=await bridge.callMusicPlugin({pluginId,accountScope:targets.value.find(row=>row.id===pluginId)?.accountScope,method:'matchTrack',params:{name:props.track.name,album:props.track.album?.name||'',artists:props.track.artists?.map(row=>row.name)||[],duration:props.track.duration||0}})
    if(token!==generation)return
    if(result.code!==200||!result.data)throw new Error(result.message||t('mobile.plugins.noMatch'))
    matched.value=result.data as PluginItem;matchedPlugin.value=pluginId
  }catch(cause){if(token===generation)error.value=cause instanceof Error?cause.message:t('mobile.plugins.failed')}
  finally{if(token===generation)busy.value=false}
}
async function play(){
  if(!matched.value||busy.value)return
  const pluginId=matchedPlugin.value,token=++generation;busy.value=true;error.value=''
  try{
    let track=matched.value
    const plugin=targets.value.find(row=>row.id===pluginId)
    if(hasPluginMethod(plugin,'getTrackDetail')){
      const result=await bridge.callMusicPlugin({pluginId,accountScope:plugin?.accountScope,method:'getTrackDetail',params:{tracks:[track.sourceContext]}})
      if(token!==generation)return
      if(result.code!==200||!Array.isArray(result.data)||!result.data[0])throw new Error(result.message||t('mobile.plugins.failed'))
      track=result.data[0] as PluginItem
    }
    const fromPluginId=props.track.pluginId||props.sourcePluginId||'',from=props.plugins.find(row=>row.id===fromPluginId)
    if(!fromPluginId)throw new Error(t('mobile.plugins.failed'))
    await bridge.manageMusicPlugin({action:'sourceLink',fromPluginId,fromTrack:props.track,fromAccountScope:props.sourceAccountScope||from?.accountScope||'',toPluginId:pluginId,toTrack:track,toAccountScope:plugin?.accountScope||'',matched:1})
    if(token!==generation)return
    emit('play',{pluginId,accountScope:plugin?.accountScope,track,queue:[track]});emit('close')
  }catch(cause){if(token===generation)error.value=cause instanceof Error?cause.message:t('mobile.plugins.failed')}
  finally{if(token===generation)busy.value=false}
}
useModalFocus(panel,{close:()=>emit('close')})
useModalIsolation(panel)
useSheetDrag(panel,{close:()=>emit('close'),enabled:()=>!busy.value})
onUnmounted(()=>{++generation})
</script>
<template><Teleport to="body"><div class="plugin-match-layer" @click.self="emit('close')"><section ref="panel" class="plugin-match-sheet" role="dialog" aria-modal="true" :aria-label="$t('mobile.plugins.match')" tabindex="-1"><SheetDragHandle @close="emit('close')" /><header><h3>{{ $t('mobile.plugins.match') }}</h3><button type="button" class="icon-button" :aria-label="$t('mobile.common.close')" @click="emit('close')"><OriginalIcon name="close" /></button></header><p>{{ track.name }}</p><p class="setting-note">{{ $t('mobile.plugins.matchHint') }}</p><AppSelect v-model="target" :label="$t('mobile.plugins.matchSource')" :options="targets.map(row=>({value:row.id,label:row.name}))" :disabled="busy" /><button type="button" class="secondary-button" :disabled="busy||!target" @click="match">{{ $t('mobile.plugins.match') }}</button><p v-if="error" class="inline-error" role="alert">{{ error }}</p><p v-if="!targets.length" class="setting-note">{{ $t('mobile.plugins.noMatchSource') }}</p><section v-if="matched" class="plugin-match-result"><PluginArtwork :plugin-id="matchedPlugin" :uri="matched.picUrl" :source-context="matched.sourceContext" eager /><div><b>{{ matched.name }}</b><p>{{ matched.artists?.map(row=>row.name).join(' / ') }}</p><p>{{ matched.album?.name }}</p><p v-if="typeof matched.confidence==='number'" class="setting-note">{{ $t('mobile.plugins.matchConfidence',{value:matched.confidence}) }}</p><button type="button" class="secondary-button" :disabled="busy" @click="play"><OriginalIcon name="play" />{{ $t('mobile.plugins.playMatched') }}</button></div></section></section></div></Teleport></template>
<style scoped>
.plugin-match-layer{position:fixed;inset:0;z-index:140;display:flex;align-items:flex-end;justify-content:center;background:rgb(0 0 0 / 38%);padding-top:max(12px,env(safe-area-inset-top));}.plugin-match-sheet{width:min(100%,600px);max-height:90dvh;overflow:auto;overscroll-behavior:contain;padding:16px max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));border-radius:22px 22px 0 0;background:var(--color-body-bg);color:var(--ink);box-shadow:0 -8px 32px rgb(0 0 0 / 18%);animation:plugin-match-in var(--motion-panel) ease both;}.plugin-match-sheet header{display:flex;align-items:center;justify-content:space-between;gap:10px;}.plugin-match-sheet h3{font-size:calc(17px * var(--ui-font-scale,1));}.plugin-match-sheet>.secondary-button{margin:12px 0;}.plugin-match-result{display:grid;grid-template-columns:90px minmax(0,1fr);gap:12px;padding:12px;background:var(--surface);border-radius:16px;}.plugin-match-result .plugin-artwork{border-radius:12px;}.plugin-match-result p{margin:7px 0;color:var(--muted);font-size:calc(12px * var(--ui-font-scale,1));overflow-wrap:anywhere;}@keyframes plugin-match-in{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}html[data-motion='reduced'] .plugin-match-sheet{animation:none;}
</style>
