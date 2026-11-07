<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { musicPluginBridge as bridge } from '../plugins/bridge'
import { allowsPluginComments, hasPluginMethod, type MusicPlugin, type PluginSourcePriorities } from '../plugins/protocol'
import { moveTrackKey } from '../composables/localTrackOrdering'
import { reducedMotion } from '../platform/motion'
import { useNavigationDraft } from '../composables/navigationGuard'
import CollapsibleSettingsCard from './CollapsibleSettingsCard.vue'
import OriginalIcon from './OriginalIcon.vue'

type Kind = keyof PluginSourcePriorities
type Source = {id:string;name:string;enabled:boolean}
type Drag = {kind:Kind;id:string;pointer:number;x:number;y:number;width:number;grabX:number;grabY:number;anchor:string;after:boolean;base:string[];source:Source}
type Preview = {source:Source;kind:Kind;x:number;y:number;width:number}
const props=defineProps<{plugins?:MusicPlugin[]}>(),{t}=useI18n()
const kinds:Kind[]=['lyric','comment'],saved=ref<PluginSourcePriorities>({lyric:[],comment:[]}),draft=ref<PluginSourcePriorities>({lyric:[],comment:[]})
const installed=ref<MusicPlugin[]>([]),sources=computed(()=>props.plugins||installed.value)
const busy=ref(false),loading=ref(false),error=ref(''),notice=ref(''),container=ref<HTMLElement>(),previewElement=ref<HTMLElement>()
const drag=ref<Drag>(),settling=ref<Preview>()
const preview=computed<Preview|undefined>(()=>drag.value?{source:drag.value.source,kind:drag.value.kind,x:drag.value.x-drag.value.grabX,y:drag.value.y-drag.value.grabY,width:drag.value.width}:settling.value)
let frame=0,generation=0,settleRevision=0,suppressClickUntil=0,capture:HTMLElement|undefined,releaseAnimation:Animation|undefined,saving:Promise<boolean>|undefined
const copy=(value:PluginSourcePriorities):PluginSourcePriorities=>({lyric:[...value.lyric],comment:[...value.comment]})
function entries(kind:Kind):Source[] {
  const eligible=[{id:'self',name:t('mobile.plugins.ownSource'),enabled:true},...sources.value.filter(source=>kind==='lyric'?hasPluginMethod({...source,enabled:true},'getLyric')&&source.capabilities?.getLyric!==false:allowsPluginComments({...source,enabled:true},'track'))]
  return eligible.slice().sort((a,b)=>{const ai=draft.value[kind].indexOf(a.id),bi=draft.value[kind].indexOf(b.id);return (ai<0?Number.MAX_SAFE_INTEGER:ai)-(bi<0?Number.MAX_SAFE_INTEGER:bi)})
}
function display(kind:Kind):Source[]{
  const list=entries(kind),state=drag.value
  if(!state||state.kind!==kind||!state.anchor)return list
  const byId=new Map(list.map(row=>[row.id,row]))
  return moveTrackKey(state.base,state.id,state.anchor,state.after).flatMap(id=>byId.has(id)?[byId.get(id)!]:[])
}
const dirty=computed(()=>kinds.some(kind=>JSON.stringify(draft.value[kind])!==JSON.stringify(saved.value[kind])))
async function load(){
  const token=++generation;loading.value=true;error.value=''
  try{
    const [priority,metadata]=await Promise.all([bridge.manageMusicPlugin({action:'sourcePriorities'}),props.plugins?Promise.resolve(undefined):bridge.listMusicPlugins()])
    if(token!==generation)return
    if(metadata)installed.value=metadata.plugins
    saved.value={lyric:priority.lyric||[],comment:priority.comment||[]};draft.value=copy(saved.value)
  }catch(cause){if(token===generation)error.value=cause instanceof Error?cause.message:t('mobile.plugins.failed')}
  finally{if(token===generation)loading.value=false}
}
function commit(kind:Kind,ids:string[]){draft.value={...draft.value,[kind]:[...ids,...draft.value[kind].filter(id=>!ids.includes(id))]};notice.value=''}
function step(kind:Kind,id:string,direction:number){
  if(drag.value||loading.value||busy.value)return
  clearSettle()
  const ids=entries(kind).map(row=>row.id),index=ids.indexOf(id),target=ids[index+direction]
  if(target)commit(kind,moveTrackKey(ids,id,target,direction>0))
}
function keyboard(event:KeyboardEvent,kind:Kind,id:string){if(!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();step(kind,id,event.key==='ArrowUp'?-1:1)}
function clearSettle(){++settleRevision;releaseAnimation?.cancel();releaseAnimation=undefined;settling.value=undefined}
function releaseCapture(){
  cancelAnimationFrame(frame);frame=0
  const pointer=drag.value?.pointer;drag.value=undefined
  if(pointer!==undefined&&capture?.hasPointerCapture(pointer))capture.releasePointerCapture(pointer)
  capture=undefined
}
function targetRow(kind:Kind,id:string){return Array.from(container.value?.querySelectorAll<HTMLElement>('[data-plugin-priority-id]')||[]).find(row=>row.dataset.pluginPriorityKind===kind&&row.dataset.pluginPriorityId===id)}
async function stop(cancel=false,animate=true){
  const state=drag.value;if(!state)return
  suppressClickUntil=performance.now()+350
  const token=++settleRevision,from={source:state.source,kind:state.kind,x:state.x-state.grabX,y:state.y-state.grabY,width:state.width}
  if(!cancel&&state.anchor)commit(state.kind,moveTrackKey(state.base,state.id,state.anchor,state.after))
  settling.value=from;releaseCapture()
  if(!animate||reducedMotion.value){clearSettle();return}
  await nextTick()
  const row=targetRow(state.kind,state.id),element=previewElement.value
  if(token!==settleRevision||!row||!element){if(token===settleRevision)clearSettle();return}
  const rect=row.getBoundingClientRect(),matrix=new DOMMatrixReadOnly(getComputedStyle(row).transform)
  releaseAnimation=element.animate([{transform:`translate3d(${from.x}px,${from.y}px,0)`},{transform:`translate3d(${rect.left-matrix.m41}px,${rect.top-matrix.m42}px,0)`}],{duration:cancel?150:190,easing:'cubic-bezier(.2,.75,.25,1)',fill:'both'})
  try{await releaseAnimation.finished}catch{return}
  if(token===settleRevision)clearSettle()
}
function anchor(){
  const state=drag.value;if(!state)return
  const y=Math.max(70,Math.min(state.y,innerHeight-20)),row=document.elementFromPoint(state.x,y)?.closest<HTMLElement>('[data-plugin-priority-id]')
  if(!row||!container.value?.contains(row)||row.dataset.pluginPriorityKind!==state.kind||row.dataset.pluginPriorityId===state.id)return
  const rect=row.getBoundingClientRect();state.anchor=row.dataset.pluginPriorityId||'';state.after=y>rect.top+rect.height/2
}
function scrollDrag(){
  const state=drag.value;if(!state)return
  const lower=document.querySelector('.mini-player, .bottom-nav')?.getBoundingClientRect().top||innerHeight
  const speed=state.y<90?-Math.min(18,(90-state.y)/3):state.y>lower-90?Math.min(18,(state.y-lower+90)/3):0
  if(speed){window.scrollBy({top:speed,behavior:'instant'});anchor()}
  frame=requestAnimationFrame(scrollDrag)
}
function start(event:PointerEvent,kind:Kind,source:Source){
  if(event.button!==0||!event.isPrimary||busy.value||loading.value||drag.value)return
  const row=(event.currentTarget as HTMLElement).closest<HTMLElement>('[data-plugin-priority-id]');if(!row)return
  clearSettle();event.preventDefault();const rect=row.getBoundingClientRect();capture=container.value
  drag.value={kind,id:source.id,pointer:event.pointerId,x:event.clientX,y:event.clientY,width:rect.width,grabX:event.clientX-rect.left,grabY:event.clientY-rect.top,anchor:'',after:false,base:entries(kind).map(row=>row.id),source}
  capture?.setPointerCapture(event.pointerId);frame=requestAnimationFrame(scrollDrag)
}
function pointerMove(event:PointerEvent){const state=drag.value;if(state?.pointer!==event.pointerId)return;event.preventDefault();state.x=event.clientX;state.y=event.clientY;anchor()}
function pointerEnd(event:PointerEvent){if(drag.value?.pointer===event.pointerId){if(event.type==='pointerup')anchor();void stop(event.type!=='pointerup')}}
function touchMove(event:TouchEvent){if(drag.value)event.preventDefault()}
function suppressClick(event:MouseEvent){if(performance.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation()}}
function cancel(){void stop(true,false);clearSettle();draft.value=copy(saved.value);notice.value='';error.value=''}
function save():Promise<boolean>{
  if(saving)return saving
  if(loading.value||drag.value)return Promise.resolve(false)
  clearSettle();const token=++generation,value={lyric:entries('lyric').map(row=>row.id),comment:entries('comment').map(row=>row.id)};busy.value=true;error.value=''
  saving=(async()=>{
    try{await bridge.manageMusicPlugin({action:'setSourcePriorities',...value});if(token!==generation)return false;saved.value=copy(value);draft.value=copy(value);notice.value=t('mobile.plugins.prioritiesSaved');return true}
    catch(cause){if(token===generation)error.value=cause instanceof Error?cause.message:t('mobile.plugins.failed');return false}
    finally{if(token===generation)busy.value=false;saving=undefined}
  })()
  return saving
}
async function resumeEditing(){
  const section=document.querySelector<HTMLElement>('[data-settings-section="plugin-source-priorities"]')
  const summary=section?.querySelector<HTMLElement>('summary')
  if(summary?.getAttribute('aria-expanded')==='false')summary.click()
  await nextTick()
  const target=section?.querySelector<HTMLElement>(error.value?'.inline-error':'.plugin-priority-handle')
  target?.focus({preventScroll:true});target?.scrollIntoView({block:'nearest',behavior:'instant'})
}
useNavigationDraft({
  dirty:()=>dirty.value,
  question:()=>({title:t('mobile.plugins.pendingPrioritiesTitle'),message:t('mobile.plugins.pendingPrioritiesMessage'),confirmLabel:t('mobile.plugins.pendingPrioritiesSave'),secondaryLabel:t('mobile.plugins.pendingPrioritiesDiscard'),cancelLabel:t('mobile.plugins.pendingPrioritiesContinue')}),
  save,discard:cancel,resume:resumeEditing,
  cancelInteraction:()=>{if(!drag.value)return false;void stop(true,false);clearSettle();return true}
})
function escape(event:KeyboardEvent){if(event.key==='Escape'&&drag.value){event.preventDefault();event.stopImmediatePropagation();void stop(true)}}
function visibility(){if(document.visibilityState==='hidden'){void stop(true,false);clearSettle()}}
function cardToggle(event:Event){if(!(event.target as HTMLDetailsElement).open){void stop(true,false);clearSettle()}}
watch(reducedMotion,value=>{if(value)clearSettle()})
watch(()=>props.plugins,()=>{void stop(true,false);clearSettle()})
onMounted(()=>{void load();document.addEventListener('visibilitychange',visibility);document.addEventListener('keydown',escape,true)})
onUnmounted(()=>{++generation;void stop(true,false);clearSettle();document.removeEventListener('visibilitychange',visibility);document.removeEventListener('keydown',escape,true)})
</script>
<template>
  <CollapsibleSettingsCard section-id="plugin-source-priorities" :title="$t('mobile.plugins.sourcePriorities')" :subtitle="$t('mobile.plugins.prioritySubtitle')" @toggle="cardToggle">
    <slot name="before" />
    <p class="setting-note">{{ $t('mobile.plugins.priorityHint') }}</p>
    <p v-if="error" class="inline-error" role="alert" tabindex="-1">{{ error }} <button v-if="!dirty" type="button" class="text-button" :disabled="loading||busy" @click="load">{{ $t('mobile.plugins.retry') }}</button></p>
    <p v-if="loading" class="setting-note" role="status">{{ $t('mobile.plugins.loading') }}</p>
    <div ref="container" class="plugin-priority-lists" @pointermove="pointerMove" @touchmove="touchMove" @pointerup="pointerEnd" @pointercancel="pointerEnd" @lostpointercapture="drag&&stop(true)" @click.capture="suppressClick">
      <section v-for="kind in kinds" :key="kind" class="plugin-priority-group"><h4>{{ $t('mobile.plugins.'+(kind==='lyric'?'lyricPriority':'commentPriority')) }}</h4><TransitionGroup name="plugin-priority" tag="div" :css="!reducedMotion"><article v-for="(source,index) in display(kind)" :key="source.id" class="plugin-priority-row" :class="{'source-disabled':!source.enabled,dragging:drag?.id===source.id&&drag.kind===kind,settling:settling?.source.id===source.id&&settling.kind===kind}" :data-plugin-priority-id="source.id" :data-plugin-priority-kind="kind"><button type="button" class="plugin-priority-handle" :aria-label="$t('mobile.plugins.moveSource',{name:source.name})" :disabled="loading||busy" @pointerdown="start($event,kind,source)" @keydown="keyboard($event,kind,source.id)" @click.stop><OriginalIcon name="drag" /></button><span class="plugin-priority-source"><b>{{ source.name }}</b><small v-if="!source.enabled">{{ $t('mobile.plugins.disabledInPriority') }}</small></span><div class="plugin-priority-buttons"><button type="button" class="icon-button" :aria-label="$t('mobile.plugins.moveSourceUp',{name:source.name})" :disabled="index===0||loading||busy||Boolean(drag)" @click="step(kind,source.id,-1)"><OriginalIcon name="down" class="priority-up" /></button><button type="button" class="icon-button" :aria-label="$t('mobile.plugins.moveSourceDown',{name:source.name})" :disabled="index===entries(kind).length-1||loading||busy||Boolean(drag)" @click="step(kind,source.id,1)"><OriginalIcon name="down" /></button></div></article></TransitionGroup></section>
    </div>
    <div class="plugin-priority-actions"><button type="button" class="secondary-button" :disabled="loading||busy||!dirty||Boolean(drag)" @click="save">{{ $t('mobile.plugins.save') }}</button><button type="button" class="text-button" :disabled="loading||busy||!dirty&&!drag" @click="cancel">{{ $t('mobile.management.cancel') }}</button></div><p v-if="notice" class="setting-note" role="status">{{ notice }}</p><slot name="after" />
  </CollapsibleSettingsCard>
  <Teleport to="body"><div v-if="preview" ref="previewElement" class="plugin-priority-preview" :class="{'is-settling':Boolean(settling)}" :style="{width:preview.width+'px',transform:`translate3d(${preview.x}px,${preview.y}px,0)`}" aria-hidden="true"><div class="priority-preview-surface"><OriginalIcon name="drag" /><span>{{ preview.source.name }}</span></div></div></Teleport>
</template>
<style scoped>
.plugin-priority-source b{display:block;font-weight:500}.plugin-priority-source small{display:block;margin-top:3px;color:var(--muted);font-size:calc(11px * var(--ui-font-scale,1));line-height:1.5}.source-disabled{border-style:dashed}
.priority-up{transform:rotate(180deg)}.plugin-priority-group{margin:16px 0}.plugin-priority-group h4{font-size:calc(14px * var(--ui-font-scale,1));margin:8px 0}.plugin-priority-row{display:flex;align-items:center;gap:8px;min-height:48px;border-radius:12px;margin:6px 0;background:var(--surface);border:1px solid var(--line);transition:background var(--motion-feedback),opacity var(--motion-feedback),box-shadow var(--motion-state)}.plugin-priority-row>span{flex:1;min-width:0;overflow-wrap:anywhere;font-size:calc(13px * var(--ui-font-scale,1))}.plugin-priority-handle{display:grid;place-items:center;align-self:stretch;min-width:44px;min-height:48px;touch-action:none;user-select:none;border:0;border-radius:12px;background:transparent;color:var(--muted);cursor:grab}.plugin-priority-buttons,.plugin-priority-actions{display:flex;gap:4px;align-items:center;flex-wrap:wrap}.plugin-priority-buttons .icon-button{min-width:36px;min-height:40px}.plugin-priority-actions{gap:8px}.plugin-priority-row.dragging,.plugin-priority-row.settling{opacity:.18}.plugin-priority-move{transition:transform var(--motion-state) cubic-bezier(.2,.75,.25,1)}.plugin-priority-preview{position:fixed;top:0;left:0;z-index:10000;pointer-events:none;will-change:transform}.priority-preview-surface{display:flex;align-items:center;gap:12px;min-height:48px;padding:0 14px;border:1px solid var(--accent);border-radius:12px;background:var(--color-body-bg);color:var(--ink);box-shadow:0 12px 34px #0004;transform:scale(1.025);animation:priority-grab var(--motion-feedback) ease-out both;transition:transform var(--motion-state)}.priority-preview-surface>span{flex:1;min-width:0;overflow-wrap:anywhere;font-size:calc(13px * var(--ui-font-scale,1))}.is-settling .priority-preview-surface{animation:none;transform:scale(1)}@keyframes priority-grab{from{opacity:.8;transform:scale(1)}to{opacity:1;transform:scale(1.025)}}
</style>
