<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { musicPluginBridge as bridge } from '../plugins/bridge'
import { allowsPluginComments, hasPluginMethod, pluginParams, type MusicPlugin, type PluginComment, type PluginContext, type PluginItem, type PluginSourceCandidate } from '../plugins/protocol'
import { useModalFocus } from '../composables/modalFocus'
import { useModalIsolation } from '../composables/modalIsolation'
import { useSheetDrag } from '../composables/sheetDrag'
import { actionDialog, askAction } from '../platform/actionDialog'
import OriginalIcon from './OriginalIcon.vue'
import SheetDragHandle from './SheetDragHandle.vue'

const props = defineProps<{ plugin: MusicPlugin; item: PluginItem; contentType: 'track' | 'playlist' | 'album' | 'mv'; localOnly: boolean; returnFocus?: HTMLElement }>()
const emit = defineEmits<{ close: [] }>(), { t } = useI18n()
const sheet = ref<HTMLElement>(), composer = ref<HTMLTextAreaElement>()
const rows = ref<PluginComment[]>([]), total = ref(0), loading = ref(false), busy = ref(false), error = ref(''), more = ref(true)
const tabs = ref<{name: string; code: string | number; active?: boolean}[]>([]), selectedTab = ref<string | number>('推荐')
const context = ref<PluginContext>({}), text = ref(''), reply = ref<PluginComment>()
const floors = reactive<Record<string, {rows: PluginComment[]; context: PluginContext; more: boolean; open: boolean; loading: boolean; error: string}>>({})
const actualPlugin=ref(props.plugin),actualItem=ref(props.item),sourceFixed=ref(false)
const enabled = computed(() => actualPlugin.value.enabled && (!props.localOnly || actualPlugin.value.type === 'local'))
const caps = computed(() => actualPlugin.value.capabilities?.comment)
let generation = 0, disposed = false
const valid = (token: number) => token === generation && !disposed
const message = (cause: unknown) => cause instanceof Error ? cause.message : t('mobile.plugins.failed')
async function call(method: string, params: PluginContext) {
  if (!enabled.value) throw new Error(t('mobile.plugins.offline'))
  if(!hasPluginMethod(actualPlugin.value,method))throw new Error(t('mobile.plugins.unsupported'))
  const response = await bridge.callMusicPlugin({ pluginId: actualPlugin.value.id, accountScope:actualPlugin.value.accountScope,method, params })
  if (response.code !== 200) throw new Error(response.message || t(response.code === 404 ? 'mobile.plugins.unsupported' : 'mobile.plugins.failed'))
  return response
}
function append(previous: PluginComment[], incoming: PluginComment[]) {
  const seen = new Set(previous.map(row => String(row.id)))
  return [...previous, ...incoming.filter(row => !seen.has(String(row.id)) && Boolean(seen.add(String(row.id))))]
}
async function load(reset = false) {
  if (loading.value && !reset || !enabled.value || !sourceFixed.value || !more.value && !reset) return
  if (reset) { ++generation; rows.value = []; context.value = {}; more.value = true; for (const key of Object.keys(floors)) delete floors[key] }
  const token = generation; loading.value = true; error.value = ''
  try {
    const response = await call('getComments', pluginParams({ ...actualItem.value.sourceContext, ...context.value }, {id:actualItem.value.id,type:props.contentType,sortType:tabs.value.find(row=>row.code===selectedTab.value)?.name || selectedTab.value,reset}))
    if (!valid(token)) return
    const incoming = Array.isArray(response.data) ? response.data as PluginComment[] : []
    const previous = rows.value.length
    rows.value = append(rows.value, incoming); total.value = response.count ?? rows.value.length
    more.value = incoming.length > 0 && rows.value.length > previous && (total.value > rows.value.length || Object.keys(response.sourceContext || {}).length > 0)
    context.value = response.sourceContext || {}
  } catch (cause) { if (valid(token)) error.value = message(cause) }
  finally { if (token === generation) loading.value = false }
}
async function floor(row: PluginComment, moreRows = false) {
  const key = String(row.id)
  if (floors[key] && !moreRows) { floors[key].open = !floors[key].open; return }
  if(!floors[key])floors[key] = {rows:[],context:{},more:true,open:true,loading:false,error:''}
  const state = floors[key]
  if (state.loading || !state.more) return
  const token = generation; state.loading = true; state.error = ''
  try {
    const response = await call('getFloorComments', pluginParams({...actualItem.value.sourceContext,...state.context},{id:actualItem.value.id,type:props.contentType,commentInfo:row}))
    if (!valid(token)) return
    const before = state.rows.length
    state.rows = append(state.rows, Array.isArray(response.data) ? response.data as PluginComment[] : [])
    state.context = response.sourceContext || {}; state.more = state.rows.length > before && (Number(response.count || 0) > state.rows.length || Object.keys(state.context).length > 0)
  } catch (cause) { if (valid(token)) state.error = message(cause) }
  finally { if (token === generation) state.loading = false }
}
function collapseFloor(row: PluginComment,event:MouseEvent) {
  const trigger=(event.currentTarget as HTMLElement).closest('.plugin-comment-row')?.querySelector<HTMLButtonElement>('button[aria-expanded]')
  const state=floors[String(row.id)];if(state)state.open=false
  void nextTick(()=>{trigger?.focus({preventScroll:true});trigger?.scrollIntoView({block:'nearest',behavior:'instant'})})
}
async function like(row: PluginComment) {
  if (busy.value) return
  busy.value = true; error.value = ''; const token = generation
  try {
    await call('likeAComment', pluginParams(actualItem.value.sourceContext, {id:actualItem.value.id,type:props.contentType,commentInfo:row,currentStatus:row.liked}))
    if (valid(token)) { row.liked = !row.liked; row.likedCount = Math.max(0,row.likedCount+(row.liked?1:-1)) }
  } catch (cause) { if (valid(token)) error.value = message(cause) }
  finally { busy.value = false }
}
async function send(action: 'sub' | 'reply' | 'del', row?: PluginComment) {
  if (busy.value) return
  if (action !== 'del' && (!text.value.trim() || Array.from(text.value).length > 140)) return
  const requestGeneration=generation
  if (action === 'del' && await askAction({title:t('mobile.comments.delete'),message:t('mobile.comments.deleteHint'),confirmLabel:t('mobile.comments.delete'),cancelLabel:t('mobile.management.cancel')}) !== 'confirm') return
  if(requestGeneration!==generation)return
  busy.value = true; error.value = ''; const token = generation
  try {
    await call('submitAComment', pluginParams(actualItem.value.sourceContext,{id:actualItem.value.id,type:props.contentType,t:action,comment:text.value.trim(),commentId:row?.id}))
    if (!valid(token)) return
    text.value = ''; reply.value = undefined; await load(true)
  } catch (cause) { if (valid(token)) error.value = message(cause) }
  finally { busy.value = false }
}
function replyTo(row: PluginComment) { reply.value = row; void nextTick(()=>composer.value?.focus()) }
async function initialize() {
  ++generation; rows.value = []; context.value = {}; more.value = true; error.value = ''; loading.value = true;sourceFixed.value=false;total.value=0
  actualPlugin.value=props.plugin;actualItem.value=props.item;tabs.value=[];reply.value=undefined;text.value=''
  for(const key of Object.keys(floors))delete floors[key]
  const token = generation
  try {
    const installed=(await bridge.listMusicPlugins()).plugins
    const response=props.contentType==='track'?await bridge.manageMusicPlugin({action:'sourceCandidates',pluginId:props.plugin.id,accountScope:props.plugin.accountScope||'',track:props.item,kind:'comment'}):undefined
    if(!valid(token))return
    const candidates:PluginSourceCandidate[]=response?.candidates?.length?response.candidates:[{pluginId:props.plugin.id,accountScope:props.plugin.accountScope,trackId:props.item.id,sourceContext:props.item.sourceContext}]
    let lastError:unknown,empty:{plugin:MusicPlugin;item:PluginItem;tabs:typeof tabs.value;selected:string|number;context:PluginContext}|undefined
    for(const candidate of candidates){
      const source=installed.find(row=>row.id===candidate.pluginId)
      if(!source || !allowsPluginComments(source,props.contentType) || props.localOnly&&source.type!=='local' || candidate.accountScope&&candidate.accountScope!==source.accountScope)continue
      actualPlugin.value=source;actualItem.value={...props.item,id:candidate.trackId,pluginId:source.id,sourceContext:candidate.sourceContext};tabs.value=[];selectedTab.value='推荐'
      try{
        if(hasPluginMethod(source,'getCommentTab')){
          let tabResponse
          try{tabResponse=await call('getCommentTab',pluginParams(candidate.sourceContext,{type:props.contentType}))}catch(cause){lastError=cause}
          if(!valid(token))return
          tabs.value=Array.isArray(tabResponse?.data)?tabResponse.data as typeof tabs.value:[]
          selectedTab.value=tabs.value.find(row=>row.active)?.code??tabs.value[0]?.code??'推荐'
        }
        const first=await call('getComments',pluginParams(candidate.sourceContext,{id:candidate.trackId,type:props.contentType,sortType:tabs.value.find(row=>row.code===selectedTab.value)?.name||selectedTab.value,reset:true}))
        if(!valid(token))return
        if(!Array.isArray(first.data)||!first.data.length){empty??={plugin:source,item:actualItem.value,tabs:tabs.value,selected:selectedTab.value,context:first.sourceContext||{}};continue}
        rows.value=Array.isArray(first.data)?first.data as PluginComment[]:[];total.value=first.count??rows.value.length;context.value=first.sourceContext||{}
        more.value=rows.value.length>0&&(total.value>rows.value.length||Object.keys(context.value).length>0);sourceFixed.value=true
        return
      }catch(cause){if(!valid(token))return;lastError=cause}
    }
    if(empty){actualPlugin.value=empty.plugin;actualItem.value=empty.item;tabs.value=empty.tabs;selectedTab.value=empty.selected;context.value=empty.context;more.value=false;sourceFixed.value=true;if(lastError)error.value=message(lastError);return}
    throw lastError||new Error(t('mobile.plugins.noCommentSource'))
  } catch (cause) { if (valid(token)) error.value = message(cause) }
  finally{if(valid(token))loading.value=false}
}
useModalFocus(sheet,{close:()=>emit('close'),enabled:()=>!actionDialog.value,returnFocus:()=>props.returnFocus})
useModalIsolation(sheet)
useSheetDrag(sheet,{close:()=>emit('close'),enabled:()=>!actionDialog.value})
watch(()=>[props.plugin.id,props.item.id,props.localOnly],initialize,{immediate:true})
onUnmounted(()=>{disposed=true;++generation})
</script>
<template>
  <Teleport to="body"><div class="plugin-comments-layer" :inert="Boolean(actionDialog)" @click.self="emit('close')"><section ref="sheet" class="plugin-comments-sheet" role="dialog" aria-modal="true" :aria-label="$t('mobile.plugins.comments')" tabindex="-1"><SheetDragHandle @close="emit('close')" /><header data-sheet-drag-handle><div><h3>{{ $t('mobile.plugins.comments') }} · {{ total }}</h3><p>{{ item.name }}</p></div><button type="button" class="icon-button" :aria-label="$t('mobile.common.close')" @click="emit('close')"><OriginalIcon name="close" /></button></header>
    <div class="plugin-comment-tabs"><button v-for="tab in tabs" :key="tab.code" type="button" class="text-button" :class="{selected:selectedTab===tab.code}" :disabled="busy" @click="selectedTab=tab.code;load(true)">{{ tab.name }}</button></div>
    <p v-if="!enabled" class="setting-note">{{ $t('mobile.plugins.offline') }}</p><p v-if="sourceFixed" class="setting-note">{{ $t('mobile.plugins.commentSource',{name:actualPlugin.name}) }}</p><p v-if="error" class="inline-error" role="alert">{{ error }}<button type="button" class="text-button" :disabled="loading" @click="load()">{{ $t('mobile.plugins.retry') }}</button></p>
    <article v-for="row in rows" :key="String(row.id)" class="plugin-comment-row"><b>{{ row.user.nickname }}</b><small>{{ row.time ? new Date(row.time).toLocaleDateString() : '' }}</small><p>{{ row.content }}</p><blockquote v-if="row.beReplied">{{ row.beReplied.nickname }}：{{ row.beReplied.content }}</blockquote><div class="plugin-comment-actions"><button v-if="caps?.like" type="button" class="text-button" :disabled="busy" :aria-pressed="row.liked" @click="like(row)"><OriginalIcon :name="row.liked?'heartSolid':'heart'" />{{ row.likedCount }}</button><button v-if="caps?.submit" type="button" class="text-button" :disabled="busy" @click="replyTo(row)">{{ $t('mobile.comments.reply') }}</button><button v-if="caps?.floor && row.replyCount" type="button" class="text-button" :aria-expanded="Boolean(floors[String(row.id)]?.open)" @click="floor(row)">{{ $t(floors[String(row.id)]?.open?'mobile.playbackReview.collapseReplies':'mobile.comments.floor') }} {{ row.replyCount }}</button><button v-if="caps?.submit&&row.owner" type="button" class="text-button" :disabled="busy" @click="send('del',row)">{{ $t('mobile.comments.delete') }}</button></div>
      <div v-if="floors[String(row.id)]" class="plugin-comment-floor" :class="{expanded:floors[String(row.id)].open}" :inert="!floors[String(row.id)].open" :aria-hidden="!floors[String(row.id)].open"><div><section>
        <article v-for="child in floors[String(row.id)].rows" :key="String(child.id)"><b>{{ child.user.nickname }}</b><p>{{ child.content }}</p><div class="plugin-comment-actions"><button v-if="caps?.like" type="button" class="text-button" :disabled="busy" @click="like(child)">{{ child.likedCount || $t('mobile.comments.like') }}</button><button v-if="caps?.submit" type="button" class="text-button" :disabled="busy" @click="replyTo(child)">{{ $t('mobile.comments.reply') }}</button><button v-if="caps?.submit&&child.owner" type="button" class="text-button" :disabled="busy" @click="send('del',child)">{{ $t('mobile.comments.delete') }}</button></div></article>
        <p v-if="floors[String(row.id)].error" class="inline-error">{{ floors[String(row.id)].error }}</p>
        <button v-if="floors[String(row.id)].more" type="button" class="text-button" :disabled="floors[String(row.id)].loading" @click="floor(row,true)">{{ $t('mobile.comments.moreReplies') }}</button>
        <button v-if="floors[String(row.id)].open" type="button" class="text-button comment-floor-collapse" aria-expanded="true" @click="collapseFloor(row,$event)"><OriginalIcon name="up" />{{ $t('mobile.playbackReview.collapseReplies') }}</button>
      </section></div></div>
    </article>
    <p v-if="loading" class="setting-note">{{ $t('mobile.plugins.loading') }}</p><p v-else-if="!rows.length&&!error" class="setting-note">{{ $t('mobile.comments.empty') }}</p><div class="plugin-comment-actions"><span class="setting-note">{{ rows.length }} / {{ total }}</span><button v-if="more" type="button" class="text-button" :disabled="loading" @click="load()">{{ $t('mobile.plugins.loadMore') }}</button></div>
    <form v-if="caps?.submit&&enabled" class="plugin-comment-composer" @submit.prevent="send(reply?'reply':'sub',reply)"><button v-if="reply" type="button" class="text-button" @click="reply=undefined">{{ $t('mobile.comments.replyTo',{name:reply.user.nickname}) }}</button><textarea ref="composer" v-model="text" rows="2" :aria-label="$t('mobile.comments.content')" :placeholder="$t('mobile.comments.draft')" :disabled="busy" /><div><small>{{ Array.from(text).length }}/140</small><button type="submit" class="secondary-button" :disabled="busy||!text.trim()||Array.from(text).length>140">{{ $t('mobile.comments.send') }}</button></div></form>
  </section></div></Teleport>
</template>
<style scoped>
.plugin-comments-layer { position:fixed; inset:0; z-index:140; display:flex; align-items:flex-end; justify-content:center; padding-top:max(12px,env(safe-area-inset-top)); background:rgb(0 0 0 / 38%); }.plugin-comments-sheet { width:min(100%,640px); max-height:90dvh; overflow:auto; overscroll-behavior:contain; padding:16px max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left)); border-radius:22px 22px 0 0; color:var(--ink); background:var(--color-body-bg); box-shadow:0 -8px 32px rgb(0 0 0 / 18%); animation:plugin-comment-enter var(--motion-panel,320ms) ease both; }.plugin-comments-sheet header { display:flex; align-items:center; justify-content:space-between; gap:12px; }.plugin-comments-sheet header>div { min-width:0; flex:1; }.plugin-comments-sheet h3 { margin:0; font-size:calc(18px * var(--ui-font-scale,1)); }.plugin-comments-sheet header p { color:var(--muted); overflow-wrap:anywhere; }.plugin-comment-tabs,.plugin-comment-actions { display:flex; flex-wrap:wrap; align-items:center; gap:5px; }.plugin-comment-tabs .selected { background:var(--accent-soft); }.plugin-comment-row { padding:14px 0; border-bottom:1px solid var(--line); content-visibility:auto; contain-intrinsic-size:auto 150px; }.plugin-comment-row>b { font-size:calc(13px * var(--ui-font-scale,1)); }.plugin-comment-row>small { margin-left:10px; color:var(--muted); }.plugin-comment-row p,.plugin-comment-row blockquote { white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.65; user-select:text; font-size:calc(14px * var(--ui-font-scale,1)); }.plugin-comment-row blockquote { padding:10px; margin:8px 0; background:var(--surface); border-radius:12px; }.plugin-comment-floor { display:grid; grid-template-rows:0fr; opacity:0; transition:grid-template-rows var(--motion-state) ease,opacity var(--motion-state) ease; }.plugin-comment-floor.expanded { grid-template-rows:1fr; opacity:1; }.plugin-comment-floor>div { overflow:hidden; min-height:0; }.plugin-comment-floor section { padding:12px; border-radius:14px; background:var(--surface); margin-top:8px; }.plugin-comment-floor article { content-visibility:auto; contain-intrinsic-size:auto 90px; }.plugin-comment-floor article+article { border-top:1px solid var(--line); padding-top:10px; }.plugin-comment-composer { position:sticky; bottom:0; padding-top:10px; background:var(--color-body-bg); border-top:1px solid var(--line); }.plugin-comment-composer textarea { width:100%; box-sizing:border-box; min-height:70px; max-height:160px; resize:vertical; padding:10px; border:1px solid var(--line); border-radius:12px; color:var(--ink); background:var(--surface); font:inherit; }.plugin-comment-composer>div { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:8px; }@keyframes plugin-comment-enter { from { opacity:0;transform:translateY(22px); } to { opacity:1;transform:none; } }html[data-motion='reduced'] .plugin-comments-sheet { animation:none; }html[data-motion='reduced'] .plugin-comment-floor { transition:none; }
</style>
