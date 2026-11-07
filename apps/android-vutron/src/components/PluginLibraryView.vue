<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUnmounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { musicPluginBridge } from '../plugins/bridge'
import { usePluginLibrary } from '../plugins/usePluginLibrary'
import { pendingPluginNavigation, consumePluginNavigation, type PluginNavigation } from '../plugins/navigation'
import { allowsPluginComments, hasPluginMethod, pluginItems, pluginItemKey, pluginParams, pluginSubscriptionParams, type MusicPlugin, type PluginContext, type PluginEntityKind, type PluginItem, type PluginPlayback, type PluginResult,type PluginPlaylistProgress } from '../plugins/protocol'
import { actionDialog, askAction } from '../platform/actionDialog'
import { useModalFocus } from '../composables/modalFocus'
import { useModalIsolation } from '../composables/modalIsolation'
import { useSheetDrag } from '../composables/sheetDrag'
import OriginalIcon from './OriginalIcon.vue'
import AppSelect from './AppSelect.vue'
import PluginArtwork from './PluginArtwork.vue'
import PluginCommentSheet from './PluginCommentSheet.vue'
import SheetDragHandle from './SheetDragHandle.vue'
import PluginTrackActions from './PluginTrackActions.vue'

const props = withDefaults(defineProps<{ pluginId: string; localOnly: boolean; integrated?:boolean;section?:'home'|'library'|'search' }>(),{integrated:false,section:'library'})
const emit = defineEmits<{ back: []; manage: []; play: [value: PluginPlayback]; next: [value: PluginPlayback]; append: [value: PluginPlayback]; radioTrash:[value:PluginPlayback]; openSource:[value:Omit<PluginNavigation,'key'>];viewState:[value:{isDetail:boolean;canGoBack:boolean;caption:string;loading:boolean}] }>()
const pageKey=computed(()=>props.integrated?'integrated:'+props.section:'standalone')
const { t } = useI18n(), library = usePluginLibrary(toRef(props, 'pluginId'), toRef(props, 'localOnly'),musicPluginBridge,pageKey)
const { plugin, loading, busy, error, rows, kind, detail, features, allowed, count, more, context } = library
const keywords = ref(''), searchTab = ref<PluginEntityKind>('tracks'), visibleCount = ref(80)
const searchKinds: PluginEntityKind[] = ['tracks', 'playlists', 'albums', 'artists', 'mvs']
const selectedFeature = ref(''), comments = ref<{ item: PluginItem; plugin:MusicPlugin; type: 'track' | 'playlist' | 'album' | 'mv'; trigger?: HTMLElement }>()
const panel = ref<HTMLElement>(), editMode = ref<'create' | 'edit'>()
const playlistName = ref(''), description = ref(''), tags = ref(''), privatePlaylist = ref(false)
const dialogBusy = ref(false), dialogError = ref(''), trackNotice = ref('')
const categoryMethod = ref(''), categories = ref<{ label: string; context: PluginContext; id: string | number }[]>([]), category = ref(0)
const currentKind = ref<PluginEntityKind>('tracks')
const banners=ref<PluginItem[]>([])
const videoIndex=ref(0),videoUri=ref(''),videoLoading=ref(false),trackSort=ref('name'),trackOrder=ref('ASC')
const artistGroups = ref<{name: string; code: string | number; sub: {name:string; code:string|number; sourceContext:PluginContext}[]}[]>([])
const artistSelection = ref<(string | number)[]>([])
const consumedNavigation = ref(0),initializing=ref(true),readyPluginId=ref('')
const orderDraft = ref<PluginItem[]>(), drag = ref<{pointer:number; id:string; x:number; y:number}>(), listElement = ref<HTMLElement>()
const sharedTrackActions=ref<{handleBack():boolean}[]>([])
const playlistPreparing=ref(false)
const playlistProgress=ref<PluginPlaylistProgress>(),progressLoading=ref(false)
let dragFrame = 0
let generation = 0,videoGeneration=0,dialogRevision=0,progressGeneration=0
const visibleRows = computed(() => (orderDraft.value || rows.value).slice(0, visibleCount.value))
const supported = (name: string) => hasPluginMethod(plugin.value, name)
const itemPlugin = (item:PluginItem) => library.plugins.value.find(row=>row.id===(item.pluginId||props.pluginId))
const itemSupported = (item:PluginItem,name:string) => hasPluginMethod(itemPlugin(item),name)
async function callSource(id:string,name:string,params:PluginContext={}):Promise<PluginResult> {
  const source=library.plugins.value.find(row=>row.id===id)
  if(!source?.enabled)throw new Error('PLUGIN_DISABLED')
  if(props.localOnly&&source.type!=='local')throw new Error('PLUGIN_OFFLINE')
  if(!hasPluginMethod(source,name))throw new Error('PLUGIN_UNSUPPORTED')
  const result=await musicPluginBridge.callMusicPlugin({pluginId:id,accountScope:source.accountScope,method:name,params})
  if(result.code!==200&&result.code!==803)throw new Error(result.message||'PLUGIN_REQUEST_'+result.code)
  return result
}
const editablePlaylist = computed(()=>Boolean(detail.value?.isMine && detail.value.playlistRole!=='liked'))
const methodLabel = computed(() => features.value.find(row => row.method === library.method.value)?.label)
const caption = computed(() => detail.value?.name || (methodLabel.value ? t('mobile.plugins.' + methodLabel.value) : props.integrated?t('mobile.plugins.'+(props.section==='search'?'search':props.section==='home'?'integratedHomeTitle':'integratedLibraryTitle')):t('mobile.plugins.open')))
const discoveryMethods=['getRecommendPlaylist','getRecommendTracks','rankList','topSong','topArtists','topAlbums','newAlbums','personalFM']
const libraryMethods=['userPlaylist','getAllTracks','likelist','userLikedArtists','userLikedMVs','cloudDisk','userRecord']
const sectionFeatures=computed(()=>props.integrated?features.value.filter(row=>(props.section==='home'?discoveryMethods:props.section==='library'?libraryMethods:[]).includes(row.method)):features.value)
const isDetail=computed(()=>Boolean(detail.value)||library.history.value.length>0)
const canGoBack=computed(()=>isDetail.value||Boolean(comments.value||editMode.value||orderDraft.value||playlistPreparing.value))
const rootTools=computed(()=>!props.integrated||!isDetail.value)
const discoveryTools=computed(()=>rootTools.value&&(!props.integrated||props.section==='home'))
function causeMessage(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message === 'PLUGIN_OFFLINE' ? t('mobile.plugins.offline') : message === 'PLUGIN_UNSUPPORTED' ? t('mobile.plugins.unsupported') : message === 'PLUGIN_DISABLED' ? t('mobile.plugins.disabled') : message
}
function closeDialog() { ++dialogRevision; editMode.value = undefined; dialogError.value = ''; dialogBusy.value = false }
function captureView() {
  return { keywords:keywords.value, searchTab:searchTab.value, selectedFeature:selectedFeature.value, visibleCount:visibleCount.value,
    categoryMethod:categoryMethod.value,categories:categories.value,category:category.value,currentKind:currentKind.value,banners:banners.value,
    videoIndex:videoIndex.value,trackSort:trackSort.value,trackOrder:trackOrder.value,artistGroups:artistGroups.value,artistSelection:artistSelection.value,consumedNavigation:consumedNavigation.value }
}
function rememberView() { library.viewState.value = captureView() }
function restoreView() {
  const saved = library.viewState.value as Partial<ReturnType<typeof captureView>>
  keywords.value=saved.keywords??'';searchTab.value=saved.searchTab??'tracks';selectedFeature.value=saved.selectedFeature??'';visibleCount.value=saved.visibleCount??80
  categoryMethod.value=saved.categoryMethod??'';categories.value=saved.categories??[];category.value=saved.category??0;currentKind.value=saved.currentKind??'tracks';banners.value=saved.banners??[]
  videoIndex.value=saved.videoIndex??0;trackSort.value=saved.trackSort??'name';trackOrder.value=saved.trackOrder??'ASC';artistGroups.value=saved.artistGroups??[];artistSelection.value=saved.artistSelection??[]
  consumedNavigation.value=saved.consumedNavigation??0
}
function handleBack() {
  if(sharedTrackActions.value.some(row=>row.handleBack()))return true
  if(playlistPreparing.value){cancelPreparation();return true}
  if (comments.value) { comments.value = undefined; return true }
  if (editMode.value) { closeDialog(); return true }
  if (orderDraft.value) { cancelOrder(); return true }
  if(library.back()){restoreView();return true}
  if(props.integrated&&detail.value){void goRoot();return true}
  return false
}
async function refresh() {
  if(playlistPreparing.value)cancelPreparation()
  const account=plugin.value?.accountScope,enabled=plugin.value?.enabled
  await library.refreshPlugins()
  if(account!==plugin.value?.accountScope||enabled!==plugin.value?.enabled){await initializeSurface(false);return}
  if(detail.value && currentKind.value!=='tracks')await library.open(detail.value,currentKind.value,false)
  else if(library.method.value)await library.list(library.method.value,kind.value,library.requestParams.value,false,false)
  else await initializeSurface(false)
}
async function goRoot(){
  if(playlistPreparing.value)cancelPreparation()
  comments.value=undefined;closeDialog();cancelOrder()
  if(library.backToRoot()){restoreView();return}
  if(isDetail.value)await initializeSurface(false)
}
defineExpose({ handleBack, refresh,goRoot,isDetail,canGoBack })
watch(()=>({isDetail:isDetail.value,canGoBack:canGoBack.value,caption:caption.value,loading:initializing.value||loading.value||playlistPreparing.value}),value=>emit('viewState',value),{immediate:true})
useModalFocus(panel, { close: closeDialog, enabled: () => Boolean(editMode.value) && !actionDialog.value })
useModalIsolation(panel,()=>Boolean(editMode.value))
useSheetDrag(panel, { close: closeDialog, enabled: () => Boolean(editMode.value) && !actionDialog.value && !dialogBusy.value })
function cancelPreparation(){++generation;library.cancelReads();playlistPreparing.value=false}
async function play(track: PluginItem,resume=false) {
  if(playlistPreparing.value)return
  const progress=resume?playlistProgress.value:undefined
  if(resume&&!progress?.available)return
  if (!resume && track.playable === false) { trackNotice.value = track.reason || t('mobile.plugins.unplayable'); return }
  if(detail.value&&currentKind.value==='playlists'&&more.value){
    const token=++generation,owner=props.pluginId,key=detail.value.id;playlistPreparing.value=true
    try{
      while(more.value){
        const result=await library.list('getPlaylistTracks','tracks',{},true,false)
        if(token!==generation||owner!==props.pluginId||detail.value?.id!==key)return
        if(!result)return
      }
    }finally{if(token===generation)playlistPreparing.value=false}
    if(token!==generation||owner!==props.pluginId||detail.value?.id!==key)return
  }
  if(progress){
    const saved=rows.value.find(row=>String(row.id)===String(progress.trackId)&&(row.pluginId||props.pluginId)===(progress.sourcePluginId||props.pluginId))
    if(!saved||saved.playable===false){trackNotice.value=t('mobile.plugins.resumeTrackMissing');return}
    track=saved
  }
  emit('play', { pluginId: props.pluginId, accountScope:plugin.value?.accountScope,track, queue: rows.value.filter(row => row.playable !== false), ...(detail.value&&currentKind.value==='playlists'?{playlistKey:String(detail.value.id),playlistName:detail.value.name,playlistSourceContext:detail.value.sourceContext}:{}),...(library.method.value==='personalFM'?{sourceMethod:'personalFM'}:{}),...(progress?{position:Math.max(0,Number(progress.position)||0),resumePlaylist:true}:{}) })
}
watch(()=>[props.pluginId,plugin.value?.accountScope,currentKind.value,detail.value?.id,allowed.value] as const,async()=>{
  const token=++progressGeneration;playlistProgress.value=undefined;progressLoading.value=false
  if(!detail.value||currentKind.value!=='playlists'||!allowed.value||!musicPluginBridge.getMusicPluginPlaylistProgress)return
  const owner=props.pluginId,key=String(detail.value.id),accountScope=plugin.value?.accountScope;progressLoading.value=true
  try{
    const progress=await musicPluginBridge.getMusicPluginPlaylistProgress({pluginId:owner,accountScope,playlistKey:key})
    if(token===progressGeneration&&owner===props.pluginId&&key===String(detail.value?.id))playlistProgress.value=progress
  }catch(cause){if(token===progressGeneration)trackNotice.value=causeMessage(cause)}
  finally{if(token===progressGeneration)progressLoading.value=false}
})
async function chooseFeature(method: string) {
  const feature = sectionFeatures.value.find(item => item.method === method)
  if (!feature) return
  if(playlistPreparing.value)cancelPreparation()
  rememberView()
  selectedFeature.value = method; categories.value = []; artistGroups.value = []; visibleCount.value = 80; cancelOrder()
  if(method==='newAlbums'&&supported('getAlbumCatlist')){await loadCategories('albums');return}
  if(method==='topSong'&&supported('getTrackCatlist')){await loadCategories('tracks');return}
  await library.list(method, feature.kind, { reset: true, sort:trackSort.value, order:trackOrder.value,pageSize:80 },false,!props.integrated)
}
async function search() { if(!keywords.value.trim())return;if(playlistPreparing.value)cancelPreparation();rememberView();visibleCount.value = 80; categories.value = []; await library.list('search', searchTab.value, { tab: searchTab.value, keywords: keywords.value.trim(), page: 1, reset: true },false,!props.integrated) }
async function open(item: PluginItem) { await openAs(item,kind.value) }
async function openAs(item: PluginItem,nextKind:PluginEntityKind) {
  if(playlistPreparing.value)cancelPreparation()
  if(item.pluginId && item.pluginId!==props.pluginId){emit('openSource',{pluginId:item.pluginId,kind:nextKind,item});return}
  rememberView();currentKind.value=nextKind;visibleCount.value=80;await library.open(item,nextKind)
}
async function followNavigation() {
  if(initializing.value || readyPluginId.value!==props.pluginId || !allowed.value)return false
  const navigation=consumePluginNavigation(props.pluginId,consumedNavigation.value)
  if(!navigation)return false
  ++generation;consumedNavigation.value=navigation.key
  await openAs(navigation.item,navigation.kind)
  return true
}
async function related(method: string, nextKind: PluginEntityKind) {
  if (!detail.value) return
  if(playlistPreparing.value)cancelPreparation()
  rememberView()
  await library.list(method, nextKind, pluginParams(detail.value.sourceContext, { id: detail.value.id, reset: true,...(method==='intelligencePlaylist'?{trackIds:detail.value.trackIds||rows.value.map(row=>row.id)}:{}) }))
  visibleCount.value = 80
}
async function loadCategories(group: 'playlists' | 'tracks' | 'albums' | 'artists') {
  if(playlistPreparing.value)cancelPreparation()
  rememberView()
  const token = ++generation
  const method = { playlists: 'catlist', tracks: 'getTrackCatlist', albums: 'getAlbumCatlist', artists: 'getArtistCatlist' }[group]
  try {
    const response = await library.call(method)
    if (token !== generation) return
    const data = response.data
    if (group === 'artists' && Array.isArray(data)) {
      artistGroups.value = data as typeof artistGroups.value; artistSelection.value = artistGroups.value.map(row=>row.sub[0]?.code ?? '')
      categories.value = [];currentKind.value='artists';await selectArtistCategory();return
    }
    artistGroups.value=[]
    const result: typeof categories.value = []
    function append(entries: unknown) {
      if (!Array.isArray(entries)) return
      for (const raw of entries) {
        if (!raw || typeof raw !== 'object') continue
        const row = raw as { name?: string; id?: number | string; code?: number | string; sourceContext?: PluginContext; sub?: unknown }
        if (row.sourceContext) result.push({ label: String(row.name || ''), id: row.id ?? row.code ?? result.length, context: row.sourceContext })
        append(row.sub)
      }
    }
    if (group === 'playlists' && data && typeof data === 'object') {
      const object = data as { static?: unknown; tagList?: unknown }
      append(object.static); append(object.tagList)
    } else append(data)
    categories.value = result; category.value = 0; currentKind.value = group
    categoryMethod.value = {playlists:'getCategoryPlaylist',tracks:'topSong',albums:'newAlbums',artists:'artistsList'}[group]
    if (result.length) await selectCategory(0)
  } catch (cause) { if(token===generation)error.value = causeMessage(cause) }
}
async function selectCategory(index: number) {
  const item = categories.value[index]
  if (!item) return
  rememberView()
  category.value = index; visibleCount.value = 80
  await library.list(categoryMethod.value, currentKind.value, pluginParams(item.context, { reset: true }),false,!props.integrated)
}
async function changeSubscription(method: string, item: PluginItem, selected: boolean) {
  if(await library.mutate(method, pluginSubscriptionParams(method,item,selected),false))await library.open(item,currentKind.value,false)
}
async function refreshTrack(track:PluginItem) {
  const owner=props.pluginId,token=generation
  try {
    const response=await callSource(track.pluginId||props.pluginId,'getTrackDetail',{tracks:[track.sourceContext]})
    if(owner!==props.pluginId||token!==generation)return
    const updated=pluginItems(response.data)[0]
    if(updated)rows.value=rows.value.map(row=>pluginItemKey(row)===pluginItemKey(track)?updated:row)
  }catch(cause){if(owner===props.pluginId&&token===generation)error.value=causeMessage(cause)}
}
async function openBanner(item:PluginItem){
  const source={...item,id:(item.sourceId as string|number)||item.id}
  if(item.type==='track'){
    try{const response=await library.call('getTrackDetail',{tracks:[pluginParams(source.sourceContext,{id:source.id})]});const track=pluginItems(response.data)[0];if(track)emit('play',{pluginId:props.pluginId,track,queue:[track]})}catch(cause){error.value=causeMessage(cause)}
  }else if(item.type==='playlist'||item.type==='album'||item.type==='mv')await openAs(source,({playlist:'playlists',album:'albums',mv:'mvs'} as const)[item.type])
}
async function selectArtistCategory() {
  rememberView()
  const query=artistGroups.value.map((group,index)=>({code:group.code,tag:group.sub.find(row=>row.code===artistSelection.value[index]) || group.sub[0]}))
  await library.list('artistsList','artists',{query,reset:true},false,!props.integrated);visibleCount.value=80
}
function startOrder() { if(!more.value&&editablePlaylist.value)orderDraft.value=rows.value.slice() }
function cancelOrder() { cancelAnimationFrame(dragFrame);dragFrame=0;drag.value=undefined;orderDraft.value=undefined }
async function saveOrder() {
  if(!orderDraft.value||!detail.value)return
  if(await library.mutate('reorderPlaylistTracks',pluginParams(detail.value.sourceContext,{id:detail.value.id,orderedIds:orderDraft.value.map(row=>row.id)})))cancelOrder()
}
function moveOrder(id:string,target:string) {
  const list=orderDraft.value;if(!list||id===target)return
  const from=list.findIndex(row=>pluginItemKey(row)===id),to=list.findIndex(row=>pluginItemKey(row)===target)
  if(from<0||to<0)return
  const copy=list.slice(),[item]=copy.splice(from,1);copy.splice(to,0,item);orderDraft.value=copy
}
function dragScroll() {
  const state=drag.value;if(!state)return
  const direction=state.y<100?-Math.min(18,(100-state.y)/3):state.y>innerHeight-100?Math.min(18,(state.y-innerHeight+100)/3):0
  if(direction){window.scrollBy({top:direction,behavior:'instant'});if(visibleCount.value<(orderDraft.value?.length||0)&&listElement.value&&listElement.value.getBoundingClientRect().bottom<innerHeight+120)visibleCount.value+=80}
  const target=document.elementFromPoint(state.x,state.y)?.closest<HTMLElement>('[data-plugin-track-id]')
  if(target&&listElement.value?.contains(target))moveOrder(state.id,target.dataset.pluginTrackId||'')
  dragFrame=requestAnimationFrame(dragScroll)
}
function startDrag(event:PointerEvent,track:PluginItem) {
  if(!orderDraft.value||event.button!==0||!event.isPrimary)return
  event.preventDefault();listElement.value?.setPointerCapture(event.pointerId);drag.value={pointer:event.pointerId,id:pluginItemKey(track),x:event.clientX,y:event.clientY};dragFrame=requestAnimationFrame(dragScroll)
}
function moveDrag(event:PointerEvent){if(drag.value?.pointer===event.pointerId){drag.value.x=event.clientX;drag.value.y=event.clientY}}
function endDrag(event:PointerEvent){if(drag.value?.pointer===event.pointerId){cancelAnimationFrame(dragFrame);dragFrame=0;drag.value=undefined}}
function visibilityChanged(){if(document.visibilityState==='hidden'){cancelAnimationFrame(dragFrame);dragFrame=0;drag.value=undefined}}
function keyboardMove(event:KeyboardEvent,index:number){if(!orderDraft.value||!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const row=orderDraft.value[index],other=orderDraft.value[index+(event.key==='ArrowUp'?-1:1)];if(other)moveOrder(pluginItemKey(row),pluginItemKey(other))}
async function trashRadio(track:PluginItem){
  if(await library.mutate('fmTrash',pluginParams(track.sourceContext,{id:track.id}),false)){
    emit('radioTrash',{pluginId:props.pluginId,track,queue:rows.value,sourceMethod:'personalFM'})
    await library.list('personalFM','tracks',{reset:true},false,false)
  }
}
async function editPlaylist(mode: 'create' | 'edit') {
  closeDialog()
  editMode.value = mode; playlistName.value = mode === 'edit' ? detail.value?.name || '' : ''
  description.value = mode === 'edit' ? detail.value?.description || '' : ''
  tags.value = mode === 'edit' ? detail.value?.tags?.join(';') || '' : ''
  privatePlaylist.value = mode === 'edit' ? Boolean(detail.value?.isPrivate) : false
}
async function savePlaylist() {
  if (dialogBusy.value) return
  dialogBusy.value = true; dialogError.value = ''
  const revision=dialogRevision,owner=props.pluginId
  try {
    const editing = editMode.value === 'edit', item = detail.value
    await library.call(editing ? 'editPlaylist' : 'createPlaylist', editing && item
      ? pluginParams(item.sourceContext, { id: item.id, name: playlistName.value.trim(), desc: description.value.trim(), tags: tags.value })
      : { name: playlistName.value.trim(), isPrivate: privatePlaylist.value,description:description.value.trim(),desc:description.value.trim() })
    if(revision!==dialogRevision||owner!==props.pluginId)return
    closeDialog()
    if (editing && item) await library.open(item, 'playlists',false)
    else await library.list('userPlaylist', 'playlists', {}, false, false)
  } catch (cause) { if(revision===dialogRevision)dialogError.value = causeMessage(cause) }
  finally { if(revision===dialogRevision)dialogBusy.value = false }
}
async function removeTrack(track: PluginItem) { if (detail.value && editablePlaylist.value) await library.mutate('addOrRemoveTracksToPlaylist', { op: 'del', playlist:pluginParams(detail.value.sourceContext,{id:detail.value.id}), tracks: [track] }) }
async function removePlaylist() {
  const item = detail.value,owner=props.pluginId,token=generation
  if (!item || !editablePlaylist.value) return
  if (await askAction({ title: t('mobile.plugins.deletePlaylist'), message: t('mobile.plugins.deletePlaylistHint', { name: item.name }), confirmLabel: t('mobile.plugins.deletePlaylist'), cancelLabel: t('mobile.management.cancel') }) !== 'confirm') return
  if(owner!==props.pluginId||token!==generation)return
  if (await library.mutate('deletePlaylist', pluginParams(item.sourceContext, { id: item.id }), false)) {
    library.back(); await library.list('userPlaylist', 'playlists', {}, false, false)
  }
}
function openComments(item: PluginItem, type: 'track' | 'playlist' | 'album' | 'mv', event: Event) { const source=itemPlugin(item);if(source)comments.value = { item,plugin:source, type, trigger: event.currentTarget as HTMLElement } }
const mvSources = computed(() => Array.isArray(detail.value?.sources) ? detail.value!.sources as { url: string; quality: string; type: string }[] : [])
watch(()=>detail.value?.id,()=>{videoIndex.value=0})
watch(mvSources,()=>{if(videoIndex.value>=mvSources.value.length)videoIndex.value=0})
watch(()=>[mvSources.value,videoIndex.value,allowed.value] as const,async()=>{
  const token=++videoGeneration,source=mvSources.value[videoIndex.value];videoUri.value=''
  if(!source||!allowed.value){videoLoading.value=false;return}
  videoLoading.value=true
  try{
    const response=musicPluginBridge.resolveMusicPluginMedia?await musicPluginBridge.resolveMusicPluginMedia({pluginId:props.pluginId,uri:source.url,sourceContext:detail.value?.sourceContext||{}}):{uri:source.url}
    if(token===videoGeneration)videoUri.value=response.uri
  }catch(cause){if(token===videoGeneration)error.value=causeMessage(cause)}
  finally{if(token===videoGeneration)videoLoading.value=false}
})
async function initializeSurface(restore=true){
  rememberView();library.saveSnapshot()
  comments.value = undefined;banners.value=[];closeDialog();cancelOrder();playlistPreparing.value=false;visibleCount.value = 80;trackNotice.value=''
  initializing.value=true;readyPluginId.value=''
  const token=++generation;await library.initialize(restore,!props.integrated&&pendingPluginNavigation.value?.pluginId!==props.pluginId)
  if(token!==generation)return
  initializing.value=false;readyPluginId.value=props.pluginId
  restoreView()
  if(await followNavigation() || library.restored.value)return
  if(props.integrated&&allowed.value){
    const preference=props.section==='home'?discoveryMethods:props.section==='library'?libraryMethods:[]
    const first=preference.map(method=>sectionFeatures.value.find(row=>row.method===method)).find(Boolean)
    if(first){selectedFeature.value=first.method;await library.list(first.method,first.kind,{reset:true,sort:trackSort.value,order:trackOrder.value,pageSize:80},false,false)}
  }
  if(token!==generation||!allowed.value||!supported('getBanner')||props.integrated&&props.section!=='home')return
  try{const response=await library.call('getBanner');if(token===generation)banners.value=pluginItems(response.data)}catch{ /* An unavailable banner does not hide the library. */ }
}
watch(() => [props.pluginId, props.localOnly,props.integrated,props.section],()=>{void initializeSurface()}, { immediate: true })
watch(()=>pendingPluginNavigation.value?.key,()=>{void followNavigation()})
watch(rows, () => { visibleCount.value = Math.max(80, Math.min(visibleCount.value, rows.value.length)) })
onMounted(()=>document.addEventListener('visibilitychange',visibilityChanged))
onBeforeUnmount(()=>{rememberView();library.saveSnapshot()})
onUnmounted(() => { ++generation;++videoGeneration;++progressGeneration;cancelOrder();document.removeEventListener('visibilitychange',visibilityChanged) })
</script>
<template>
  <section class="page plugin-library-page" :class="{'plugin-library-integrated':integrated}" :data-integrated-section="integrated?section:undefined">
    <div v-if="!integrated" class="section-heading plugin-standalone-header"><div><div class="eyebrow">{{ $t('mobile.plugins.title') }}</div><h2>{{ plugin?.name || pluginId }}</h2></div><div class="plugin-header-actions"><button type="button" class="text-button" @click="handleBack() || emit('back')"><OriginalIcon name="back" />{{ $t('mobile.common.back') }}</button><button type="button" class="text-button" @click="emit('manage')"><OriginalIcon name="settings" />{{ $t('mobile.plugins.manage') }}</button></div></div>
    <p v-if="!integrated&&['login','logout','offline'].includes(library.status.value)" class="setting-note" role="status">{{ $t('mobile.plugins.status_'+library.status.value) }}</p>
    <p v-if="!allowed" class="setting-note">{{ $t(localOnly ? 'mobile.plugins.offline' : 'mobile.plugins.disabled') }}</p>
    <template v-if="allowed">
      <div v-if="banners.length&&rootTools" class="plugin-banners"><template v-for="banner in banners" :key="String(banner.id)"><a v-if="banner.type==='activity'&&/^https?:\/\//.test(String(banner.url||''))" :href="String(banner.url)" target="_blank" rel="noopener noreferrer" class="plugin-banner"><PluginArtwork :plugin-id="pluginId" :uri="banner.picUrl" :source-context="banner.sourceContext" /><span>{{ banner.typeTitle }}</span></a><button v-else type="button" class="plugin-banner" :aria-label="String(banner.typeTitle||$t('mobile.plugins.banner'))" @click="openBanner(banner)"><PluginArtwork :plugin-id="pluginId" :uri="banner.picUrl" :source-context="banner.sourceContext" /><span>{{ banner.typeTitle }}</span></button></template></div>
      <form v-if="rootTools&&supported('search')&&(!integrated||section==='search')" class="plugin-search" @submit.prevent="search"><input v-model="keywords" type="search" :placeholder="$t('mobile.plugins.searchHint')" :aria-label="$t('mobile.plugins.searchHint')" /><AppSelect v-model="searchTab" :label="$t('mobile.plugins.searchType')" :options="searchKinds.map(value => ({ value, label: $t('mobile.plugins.' + value) }))" /><button type="submit" class="secondary-button" :disabled="loading || !keywords.trim()"><OriginalIcon name="search" />{{ $t('mobile.plugins.search') }}</button></form>
      <div v-if="rootTools&&sectionFeatures.length" class="plugin-feature-picker"><AppSelect :model-value="selectedFeature || library.method.value" :label="$t('mobile.plugins.browse')" :options="sectionFeatures.map(item => ({ value:item.method,label:$t('mobile.plugins.'+item.label) }))" @update:model-value="chooseFeature" /><button v-if="supported('createPlaylist')&&(!integrated||section==='library')" type="button" class="text-button" :disabled="busy" @click="editPlaylist('create')"><OriginalIcon name="plus" />{{ $t('mobile.plugins.createPlaylist') }}</button></div>
      <div v-if="discoveryTools" class="plugin-category-tools"><button v-if="supported('catlist')" type="button" class="text-button" :disabled="loading" @click="loadCategories('playlists')">{{ $t('mobile.plugins.playlistCategories') }}</button><button v-if="supported('getTrackCatlist')" type="button" class="text-button" :disabled="loading" @click="loadCategories('tracks')">{{ $t('mobile.plugins.trackCategories') }}</button><button v-if="supported('getAlbumCatlist')" type="button" class="text-button" :disabled="loading" @click="loadCategories('albums')">{{ $t('mobile.plugins.albumCategories') }}</button><button v-if="supported('getArtistCatlist')" type="button" class="text-button" :disabled="loading" @click="loadCategories('artists')">{{ $t('mobile.plugins.artistCategories') }}</button><AppSelect v-if="categories.length" :model-value="category" :label="$t('mobile.plugins.category')" :options="categories.map((item,index)=>({value:index,label:item.label}))" @update:model-value="selectCategory" /></div>
      <div v-if="discoveryTools&&artistGroups.length" class="plugin-category-tools"><AppSelect v-for="(group,index) in artistGroups" :key="group.code" :model-value="artistSelection[index]" :label="group.name" :options="group.sub.map(item=>({value:item.code,label:item.name}))" @update:model-value="artistSelection[index]=$event;selectArtistCategory()" /></div>
      <div v-if="rootTools&&(!integrated||section==='library')" class="plugin-category-tools"><button v-if="supported('userPlaylist')" type="button" class="text-button" :disabled="loading" @click="library.list('userPlaylist','albums')">{{ $t('mobile.plugins.savedAlbums') }}</button><button v-if="supported('userRecord')" type="button" class="text-button" :disabled="loading" @click="library.list('userRecord','tracks',{period:'week'})">{{ $t('mobile.plugins.weekHistory') }}</button><button v-if="supported('rankTop')" type="button" class="text-button" :disabled="loading" @click="library.list('rankTop','playlists')">{{ $t('mobile.plugins.featuredCharts') }}</button></div>
      <div v-if="error" class="inline-error" role="alert">{{ causeMessage(error) }} <button type="button" class="text-button" :disabled="loading" @click="refresh">{{ $t('mobile.plugins.retry') }}</button></div>
      <p v-if="trackNotice" class="setting-note" role="status">{{ trackNotice }}</p>
      <section v-if="detail" class="plugin-detail"><PluginArtwork :plugin-id="pluginId" :uri="detail.picUrl" :source-context="detail.sourceContext" eager /><div><h3>{{ detail.name }}</h3><p v-if="detail.description" class="plugin-description">{{ detail.description }}</p><div class="plugin-detail-actions">
        <button v-if="rows.length" type="button" class="secondary-button" :disabled="playlistPreparing" @click="play(rows[0])"><OriginalIcon name="play" />{{ $t('mobile.plugins.playAll') }}</button>
        <button v-if="rows.length&&currentKind==='playlists'&&playlistProgress?.available" type="button" class="secondary-button" :disabled="playlistPreparing||progressLoading" @click="play(rows[0],true)"><OriginalIcon name="play" />{{ $t('mobile.plugins.continuePlaylist') }}</button>
        <template v-if="currentKind === 'playlists'"><button v-if="editablePlaylist && supported('editPlaylist')" type="button" class="text-button" :disabled="busy" @click="editPlaylist('edit')">{{ $t('mobile.plugins.edit') }}</button><button v-if="editablePlaylist && supported('deletePlaylist')" type="button" class="text-button danger-text" :disabled="busy" @click="removePlaylist">{{ $t('mobile.plugins.deletePlaylist') }}</button><button v-if="!detail.isMine && supported('subscribePlaylist')" type="button" class="text-button" :disabled="busy" @click="changeSubscription('subscribePlaylist',detail,Boolean(detail.subscribed))">{{ $t(detail.subscribed?'mobile.plugins.unsubscribe':'mobile.plugins.subscribe') }}</button><button v-if="supported('intelligencePlaylist')" type="button" class="text-button" :disabled="loading" @click="related('intelligencePlaylist','tracks')">{{ $t('mobile.plugins.intelligence') }}</button></template>
        <template v-if="currentKind === 'albums'"><button v-if="supported('subscribeAlbum')" type="button" class="text-button" :disabled="busy" @click="changeSubscription('subscribeAlbum',detail,Boolean(detail.subscribed))">{{ $t(detail.subscribed?'mobile.plugins.unsubscribe':'mobile.plugins.subscribe') }}</button></template>
        <template v-if="currentKind === 'artists'"><button v-if="supported('followArtist')" type="button" class="text-button" :disabled="busy" @click="changeSubscription('followArtist',detail,Boolean(detail.followed))">{{ $t(detail.followed?'mobile.plugins.unfollow':'mobile.plugins.follow') }}</button><button v-if="supported('artistAlbums')" type="button" class="text-button" @click="related('artistAlbums','albums')">{{ $t('mobile.plugins.albums') }}</button><button v-if="supported('artistMVs')" type="button" class="text-button" @click="related('artistMVs','mvs')">{{ $t('mobile.plugins.mvs') }}</button><button v-if="supported('simiArtists')" type="button" class="text-button" @click="related('simiArtists','artists')">{{ $t('mobile.plugins.similarArtists') }}</button></template>
        <button v-if="allowsPluginComments(plugin,currentKind==='playlists'?'playlist':currentKind==='albums'?'album':'mv') && currentKind!=='artists'" type="button" class="text-button" @click="openComments(detail,currentKind==='playlists'?'playlist':currentKind==='albums'?'album':'mv',$event)">{{ $t('mobile.plugins.comments') }}</button>
      </div></div></section>
      <div v-if="mvSources.length" class="plugin-video"><AppSelect v-if="mvSources.length>1" v-model="videoIndex" :label="$t('mobile.plugins.videoQuality')" :options="mvSources.map((source,index)=>({value:index,label:source.quality||String(index+1)}))" /><p v-if="videoLoading" class="setting-note">{{ $t('mobile.plugins.loading') }}</p><video v-if="videoUri" controls playsinline preload="metadata" :src="videoUri" /><div class="plugin-detail-actions"><button v-if="supported('likeAMV') && detail" type="button" class="text-button" :disabled="busy" @click="changeSubscription('likeAMV',detail,Boolean(detail.liked))">{{ $t(detail.liked?'mobile.plugins.unlike':'mobile.plugins.like') }}</button><button v-if="supported('subAMV') && detail" type="button" class="text-button" :disabled="busy" @click="changeSubscription('subAMV',detail,Boolean(detail.subed))">{{ $t(detail.subed?'mobile.plugins.unsubscribe':'mobile.plugins.subscribe') }}</button></div></div>
      <div v-if="library.method.value==='getAllTracks'" class="plugin-category-tools"><AppSelect v-model="trackSort" :label="$t('mobile.plugins.trackSort')" :options="[{value:'name',label:$t('mobile.plugins.byName')},{value:'createTime',label:$t('mobile.plugins.byCreated')},{value:'playCount',label:$t('mobile.plugins.byPlayCount')}]" @update:model-value="chooseFeature('getAllTracks')" /><AppSelect v-model="trackOrder" :label="$t('mobile.plugins.sortDirection')" :options="[{value:'ASC',label:$t('mobile.plugins.ascending')},{value:'DESC',label:$t('mobile.plugins.descending')}]" @update:model-value="chooseFeature('getAllTracks')" /></div>
      <div class="plugin-results-heading"><h3>{{ caption }}</h3><small>{{ rows.length }} / {{ count }}</small></div>
      <div v-if="editablePlaylist&&currentKind==='playlists'&&supported('reorderPlaylistTracks')" class="plugin-detail-actions"><button v-if="!orderDraft" type="button" class="text-button" :disabled="loading||more" @click="startOrder"><OriginalIcon name="drag" />{{ $t('mobile.plugins.reorder') }}</button><template v-else><span class="setting-note">{{ $t('mobile.plugins.reorderHint') }}</span><button type="button" class="secondary-button" :disabled="busy" @click="saveOrder">{{ $t('mobile.plugins.saveOrder') }}</button><button type="button" class="text-button" :disabled="busy" @click="cancelOrder">{{ $t('mobile.management.cancel') }}</button></template></div>
      <div v-if="kind==='tracks'" ref="listElement" class="track-list plugin-track-list" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag"><TransitionGroup name="plugin-track-move" tag="div"><article v-for="(track,index) in visibleRows" :key="pluginItemKey(track)" :data-plugin-track-id="pluginItemKey(track)" class="plugin-track" :class="{'plugin-track-dragging':drag?.id===pluginItemKey(track)}"><button v-if="orderDraft" type="button" class="plugin-order-handle" :aria-label="$t('mobile.plugins.moveTrack',{name:track.name})" @pointerdown="startDrag($event,track)" @keydown="keyboardMove($event,index)"><OriginalIcon name="drag" /></button><button type="button" class="plugin-track-play" :disabled="track.playable===false||Boolean(orderDraft)" @click="play(track)"><PluginArtwork :plugin-id="track.pluginId||pluginId" :uri="track.picUrl" :source-context="track.sourceContext" /><span><b>{{ track.name }}</b><small>{{ track.artists?.map(item=>item.name).join(' / ') || track.album?.name }}</small><small v-if="track.playable===false">{{ track.reason }}</small></span></button><details v-if="!orderDraft" class="plugin-track-options"><summary :aria-label="$t('mobile.plugins.trackActions',{name:track.name})"><OriginalIcon name="more" /></summary><div><button type="button" class="text-button" @click="emit('next',{pluginId,track,queue:[track]})">{{ $t('mobile.plugins.playNext') }}</button><button type="button" class="text-button" @click="emit('append',{pluginId,track,queue:[track]})">{{ $t('mobile.plugins.appendQueue') }}</button><button v-if="itemSupported(track,'getTrackDetail')" type="button" class="text-button" :disabled="busy" @click="refreshTrack(track)">{{ $t('mobile.plugins.refreshTrack') }}</button><button v-if="track.album&&itemSupported(track.album,'albumDetail')" type="button" class="text-button" @click="openAs(track.album,'albums')">{{ track.album.name }}</button><button v-for="artist in track.artists||[]" v-show="itemSupported(artist,'artistDetail')" :key="artist.id" type="button" class="text-button" @click="openAs(artist,'artists')">{{ artist.name }}</button><PluginTrackActions ref="sharedTrackActions" :track="track" :plugin-id="pluginId" :plugins="library.plugins.value" :local-only="localOnly" :disabled="busy" @play="emit('play',$event)" /><button v-if="editablePlaylist && currentKind==='playlists' && supported('addOrRemoveTracksToPlaylist')" type="button" class="text-button" :disabled="busy" @click="removeTrack(track)">{{ $t('mobile.plugins.removeFromPlaylist') }}</button><button v-if="library.method.value==='personalFM'&&supported('fmTrash')" type="button" class="text-button" :disabled="busy" @click="trashRadio(track)">{{ $t('mobile.plugins.dislikeFm') }}</button></div></details></article></TransitionGroup></div>
      <div v-else class="plugin-result-grid"><button v-for="item in visibleRows" :key="pluginItemKey(item)" type="button" class="plugin-result-card" @click="open(item)"><PluginArtwork :plugin-id="pluginId" :uri="item.picUrl" :source-context="item.sourceContext" /><b>{{ item.name }}</b><small>{{ item.copywriter || item.artists?.map(artist=>artist.name).join(' / ') }}</small></button></div>
      <p v-if="playlistPreparing" class="setting-note plugin-playlist-preparing" role="status">{{ $t('mobile.plugins.preparingPlaylist') }} <button type="button" class="text-button" @click="cancelPreparation">{{ $t('mobile.management.cancel') }}</button></p><p v-if="loading&&!playlistPreparing" class="setting-note" role="status">{{ $t('mobile.plugins.loading') }}</p><p v-else-if="!rows.length&&!error&&!mvSources.length" class="empty-state">{{ $t(integrated&&!library.method.value?'mobile.plugins.'+(section==='search'?(supported('search')?'integratedSearchHint':'integratedSearchUnavailable'):section==='home'?'integratedHomeUnavailable':'integratedLibraryUnavailable'):'mobile.plugins.empty') }}</p>
      <div class="plugin-pagination"><button v-if="visibleCount<rows.length" type="button" class="text-button" @click="visibleCount+=80">{{ $t('mobile.plugins.showMore') }}</button><button v-else-if="more" type="button" class="text-button" :disabled="loading" @click="library.list(library.method.value,kind,{},true,false)">{{ $t('mobile.plugins.loadMore') }}</button></div>
    </template>
    <PluginCommentSheet v-if="comments" :plugin="comments.plugin" :item="comments.item" :content-type="comments.type" :local-only="localOnly" :return-focus="comments.trigger" @close="comments=undefined" />
    <Teleport to="body"><div v-if="editMode" class="plugin-edit-layer" :inert="Boolean(actionDialog)" @click.self="!dialogBusy&&closeDialog()"><section ref="panel" class="plugin-edit-panel" role="dialog" aria-modal="true" :aria-label="$t('mobile.plugins.'+(editMode==='edit'?'edit':'createPlaylist'))" tabindex="-1"><SheetDragHandle @close="!dialogBusy&&closeDialog()" /><header><h3>{{ $t('mobile.plugins.'+(editMode==='edit'?'edit':'createPlaylist')) }}</h3><button type="button" class="icon-button" :aria-label="$t('mobile.common.close')" @click="closeDialog"><OriginalIcon name="close" /></button></header><p v-if="dialogError" class="inline-error" role="alert">{{ dialogError }}</p><form @submit.prevent="savePlaylist"><label>{{ $t('mobile.plugins.playlistName') }}<input v-model="playlistName" required maxlength="120" /></label><label v-if="editMode==='edit'||plugin?.type==='local'">{{ $t('mobile.plugins.descriptionField') }}<textarea v-model="description" rows="3" maxlength="1000" /></label><template v-if="editMode==='edit'"><label>{{ $t('mobile.plugins.tags') }}<input v-model="tags" maxlength="200" /></label></template><label v-if="editMode==='create'" class="plugin-private-label"><input v-model="privatePlaylist" type="checkbox" />{{ $t('mobile.plugins.privatePlaylist') }}</label><button type="submit" class="secondary-button" :disabled="dialogBusy||!playlistName.trim()">{{ $t('mobile.plugins.save') }}</button></form></section></div></Teleport>
  </section>
</template>
<style scoped>
.plugin-banners{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding:8px 0 16px;}.plugin-banner{flex:0 0 min(75vw,360px);min-width:0;display:block;position:relative;padding:0;overflow:hidden;border:0;border-radius:18px;color:var(--ink);background:var(--surface);text-decoration:none;scroll-snap-align:start;}.plugin-banner .plugin-artwork{aspect-ratio:2.4;}.plugin-banner>span:last-child{position:absolute;bottom:8px;left:10px;padding:4px 8px;background:var(--color-body-bg);border-radius:8px;font-size:calc(11px * var(--ui-font-scale,1));}
.plugin-order-handle { min-width:44px;min-height:48px;touch-action:none;border:0;border-radius:12px;background:var(--surface);color:var(--muted);cursor:grab; }.plugin-track-dragging { background:var(--accent-soft);box-shadow:var(--shadow);border-radius:12px; }.plugin-track-move-move { transition:transform var(--motion-state) ease; }html[data-motion='reduced'] .plugin-track-move-move { transition:none; }
.plugin-header-actions,.plugin-feature-picker,.plugin-category-tools,.plugin-detail-actions,.plugin-results-heading,.plugin-pagination { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }.plugin-feature-picker,.plugin-category-tools { margin:12px 0; }.plugin-results-heading { justify-content:space-between; margin-top:18px; }.plugin-results-heading h3 { font-size:calc(17px * var(--ui-font-scale,1)); }.plugin-results-heading small { color:var(--muted); }.plugin-search { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }.plugin-search input { flex:1 1 130px; min-width:0; min-height:44px; padding:10px 12px; background:var(--surface); color:var(--ink); font:inherit; border:1px solid var(--line); border-radius:12px; }.plugin-search button { display:flex; align-items:center; gap:6px; }.plugin-detail { display:grid; grid-template-columns:minmax(70px,120px) minmax(0,1fr); gap:16px; margin-top:18px; padding:14px; border:1px solid var(--line); border-radius:18px; background:var(--color-body-bg); box-shadow:var(--shadow); }.plugin-detail>.plugin-artwork { border-radius:14px; }.plugin-detail h3 { margin:0 0 8px; font-size:calc(18px * var(--ui-font-scale,1)); overflow-wrap:anywhere; }.plugin-description { white-space:pre-wrap; overflow-wrap:anywhere; max-height:140px; overflow:auto; color:var(--muted); font-size:calc(12px * var(--ui-font-scale,1)); }.plugin-result-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:14px; }.plugin-result-card { min-width:0; display:grid; align-content:start; gap:7px; padding:0; border:0; border-radius:15px; background:transparent; color:var(--ink); text-align:left; }.plugin-result-card .plugin-artwork { border-radius:15px; }.plugin-result-card b,.plugin-result-card small { overflow:hidden; overflow-wrap:anywhere; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; }.plugin-result-card small { color:var(--muted); font-size:calc(11px * var(--ui-font-scale,1)); }.plugin-track { display:flex; align-items:start; gap:8px; border-bottom:1px solid var(--line); padding:8px 0; }.plugin-track-play { flex:1; min-width:0; display:flex; align-items:center; gap:10px; border:0; border-radius:12px; background:transparent; color:var(--ink); padding:6px; text-align:left; }.plugin-track-play>.plugin-artwork { width:46px; flex:0 0 46px; border-radius:10px; }.plugin-track-play>span { min-width:0; }.plugin-track-play b,.plugin-track-play small { display:block; overflow-wrap:anywhere; }.plugin-track-play b { font-size:calc(13px * var(--ui-font-scale,1)); }.plugin-track-play small { color:var(--muted); font-size:calc(11px * var(--ui-font-scale,1)); margin-top:4px; }.plugin-track-options { flex:0 0 auto; }.plugin-track-options summary { display:grid; place-items:center; min-width:44px; min-height:44px; list-style:none; cursor:pointer; border-radius:12px; }.plugin-track-options summary::-webkit-details-marker { display:none; }.plugin-track-options[open] { flex:1 1 160px; border-radius:12px; background:var(--surface); }.plugin-track-options>div { display:grid; padding:6px; }.plugin-track:has(.plugin-track-options[open]) { flex-wrap:wrap; }.plugin-track:has(.plugin-track-options[open])>.plugin-track-play { flex-basis:calc(100% - 60px); }.plugin-video video { display:block; width:100%; max-height:60dvh; border-radius:16px; background:#111; }.plugin-edit-layer { position:fixed; inset:0; z-index:145; display:flex; justify-content:center; align-items:flex-end; background:rgb(0 0 0 / 38%); padding-top:max(12px,env(safe-area-inset-top)); }.plugin-edit-panel { width:min(100%,600px); max-height:90dvh; overflow:auto; overscroll-behavior:contain; padding:16px max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left)); border-radius:22px 22px 0 0; background:var(--color-body-bg); color:var(--ink); box-shadow:0 -8px 32px rgb(0 0 0 / 18%); animation:plugin-sheet-enter var(--motion-panel,320ms) ease both; }.plugin-edit-panel header { display:flex; align-items:center; justify-content:space-between; gap:10px; }.plugin-edit-panel h3 { font-size:calc(17px * var(--ui-font-scale,1)); }.plugin-edit-panel form label { display:grid; gap:7px; margin:14px 0; font-size:calc(13px * var(--ui-font-scale,1)); }.plugin-edit-panel form input:not([type=checkbox]),.plugin-edit-panel textarea { width:100%; box-sizing:border-box; min-height:44px; padding:10px 12px; font:inherit; color:var(--ink); background:var(--surface); border:1px solid var(--line); border-radius:12px; }.plugin-private-label { display:flex!important; align-items:center; }.plugin-private-label input { width:24px; height:24px; accent-color:var(--accent); }.plugin-playlist-choice { width:100%; min-height:48px; padding:12px; border:0; border-radius:12px; color:var(--ink); background:var(--surface); text-align:left; margin:5px 0; font:inherit; }
@media(max-width:400px) { .plugin-detail { grid-template-columns:minmax(56px,80px) minmax(0,1fr); gap:10px; padding:10px; } }.plugin-result-card,.plugin-track-play,.plugin-track-options summary { transition:background-color var(--motion-feedback),transform var(--motion-feedback); }@media(hover:hover) { .plugin-result-card:hover,.plugin-track-play:hover,.plugin-track-options summary:hover { background:var(--accent-soft); } }.plugin-result-card:active,.plugin-track-play:active { transform:scale(.98); }@keyframes plugin-sheet-enter { from { opacity:0;transform:translateY(22px); } to { opacity:1;transform:none; } }html[data-motion='reduced'] .plugin-edit-panel { animation:none; }
</style>
