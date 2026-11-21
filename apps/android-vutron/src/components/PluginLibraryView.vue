<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, onUnmounted, ref, toRef, watch } from 'vue'
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
import PlaylistMenuButton from './PlaylistMenuButton.vue'
import { vutronPlugin } from '../platform/vutronPlugin'
import { libraryMutationBusy } from '../platform/libraryActivity'
import AppSelect from './AppSelect.vue'
import PluginArtwork from './PluginArtwork.vue'
import PluginCommentSheet from './PluginCommentSheet.vue'
import SheetDragHandle from './SheetDragHandle.vue'
import PluginTrackActions from './PluginTrackActions.vue'
import { appNavigation, useNavigationDraft } from '../composables/navigationGuard'
import { useCollectionTrackOrder, type CollectionOrder } from '../composables/localTrackOrdering'
import { vRangeSelect } from '../composables/rangeSelect'
import { useTrackSelection } from '../composables/trackSelection'
import TrackSelectionBar from './TrackSelectionBar.vue'
import WindowedTrackList from './WindowedTrackList.vue'
import { useAndroidShellStore } from '../stores/androidShell'
import { isCurrentPluginTrack } from '../platform/currentTrack'
import { useMainNavigationSwipe } from '../composables/mainNavigationSwipe'
import { useNavigationIndicator } from '../composables/navigationIndicator'
import { activeAppSelect } from '../platform/appSelect'
const CollectionOrderHistorySheet = defineAsyncComponent(() => import('./CollectionOrderHistorySheet.vue'))

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
const shell = useAndroidShellStore()
const canSavePlaylist = computed(() => Boolean(vutronPlugin.cachePluginPlaylist && allowed.value && !props.localOnly
  && plugin.value?.type !== 'local' && plugin.value?.accountScope && hasPluginMethod(plugin.value, 'getPlaylistDetail')))
const playlistMenuBusy = computed(() => shell.cachingPluginPlaylist || shell.cachingPlaylistId !== undefined || libraryMutationBusy.value)
async function savePlaylistForOffline(playlist: PluginItem) {
  const account = plugin.value?.accountScope, owner = props.pluginId
  if (!canSavePlaylist.value || !account || playlistMenuBusy.value || actionDialog.value) return
  const choice = await askAction({ title: playlist.name, message: t('mobile.playlistCache.pluginHint'),
    confirmLabel: t('mobile.playlistCache.pluginSave'), cancelLabel: t('mobile.management.cancel') })
  if (choice !== 'confirm' || owner !== props.pluginId || account !== plugin.value?.accountScope || !canSavePlaylist.value) return
  void shell.cachePluginPlaylist(owner, account, playlist)
}
const banners=ref<PluginItem[]>([])
const videoIndex=ref(0),videoUri=ref(''),videoLoading=ref(false),trackSort=ref('name'),trackOrder=ref('ASC')
const artistGroups = ref<{name: string; code: string | number; sub: {name:string; code:string|number; sourceContext:PluginContext}[]}[]>([])
const artistSelection = ref<(string | number)[]>([])
const consumedNavigation = ref(0),initializing=ref(true),readyPluginId=ref('')
const orderDraft = ref<PluginItem[]>(), drag = ref<{pointer:number; id:string; x:number; y:number}>(), listElement = ref<HTMLElement>()
const sharedTrackActions=new Map<string,{handleBack():boolean}>()
function registerTrackActions(value:unknown,track:PluginItem){const key=pluginItemKey(track);if(value&&typeof (value as {handleBack?:unknown}).handleBack==='function')sharedTrackActions.set(key,value as {handleBack():boolean});else sharedTrackActions.delete(key)}
const preparedTrackActions = ref(new Set<string>())
function prepareTrackActions(event: Event, track: PluginItem) {
  if ((event.currentTarget as HTMLDetailsElement).open) preparedTrackActions.value.add(pluginItemKey(track))
}
function resetTrackActions() {
  listElement.value?.querySelectorAll<HTMLDetailsElement>('.plugin-track-options[open]').forEach(row => { row.open = false })
  preparedTrackActions.value.clear()
  sharedTrackActions.clear()
}
const playlistPreparing=ref(false)
const playlistProgress=ref<PluginPlaylistProgress>(),progressLoading=ref(false)
let dragFrame = 0
let generation = 0,videoGeneration=0,dialogRevision=0,progressGeneration=0
const visibleRows = computed(() => kind.value === 'tracks' ? (orderDraft.value || sortedPlaylistRows.value) : rows.value.slice(0, visibleCount.value))
const store = useAndroidShellStore()
const currentRecording = computed(() => store.playback.track)
const trackWindow = ref<{ scrollToIndex(index:number, options?:{align?:'center'}):Promise<void> }>()
const currentTrackIndex = computed(() => visibleRows.value.findIndex(row => isCurrentPluginTrack(row, currentRecording.value, props.pluginId, itemPlugin(row)?.accountScope)))
const batchChoices = ref<PluginItem[]>(), batchTargets = ref<PluginItem[]>([]), batchPanel = ref<HTMLElement>(), batchTrigger = ref<HTMLElement>()
const batchSubmitting = ref(false)
let batchDialogRevision = 0
const batchActions = computed(() => [
  {id:'next',label:t('mobile.plugins.playNext')},{id:'append',label:t('mobile.plugins.appendQueue')},
  ...(supported('userPlaylist') && supported('addOrRemoveTracksToPlaylist') ? [{id:'add',label:t('mobile.plugins.addToPlaylist')}] : []),
  ...(editablePlaylist.value && currentKind.value === 'playlists' && supported('addOrRemoveTracksToPlaylist') ? [{id:'remove',label:t('mobile.plugins.removeFromPlaylist'),danger:true}] : [])
])
async function runBatch(action:string, tracks:PluginItem[]):Promise<boolean> {
  const owner=props.pluginId, account=plugin.value?.accountScope, token=generation
  try {
    if (action === 'next' || action === 'append') return await store.queuePluginBatch({pluginId:owner,accountScope:account,tracks:tracks.filter(row=>row.playable!==false)},action)
    if (action === 'add') {
      const revision = ++batchDialogRevision
      batchTrigger.value=document.activeElement instanceof HTMLElement?document.activeElement:undefined
      batchTargets.value=tracks.slice();batchChoices.value=[]
      const result=await library.call('userPlaylist')
      if(owner!==props.pluginId||account!==plugin.value?.accountScope||token!==generation||revision!==batchDialogRevision)return false
      batchChoices.value=pluginItems(result.playlists).filter(row=>row.isMine&&row.id!==result.liked?.id)
      return false
    }
    if (action === 'remove' && detail.value && editablePlaylist.value) {
      if(await askAction({title:t('mobile.plugins.removeFromPlaylist'),message:t('mobile.batch.removeHint',{count:tracks.length}),confirmLabel:t('mobile.plugins.removeFromPlaylist'),cancelLabel:t('mobile.management.cancel')})!=='confirm')return false
      if(owner!==props.pluginId||account!==plugin.value?.accountScope||token!==generation)return false
      return await library.mutate('addOrRemoveTracksToPlaylist',{op:'del',playlist:pluginParams(detail.value.sourceContext,{id:detail.value.id}),tracks})
    }
  } catch(cause) { if(owner===props.pluginId&&account===plugin.value?.accountScope)trackNotice.value=causeMessage(cause) }
  return false
}
function closeBatchAdd(){if(!batchSubmitting.value){++batchDialogRevision;batchChoices.value=undefined;batchTargets.value=[]}}
async function addBatchTo(playlist:PluginItem){
  if(batchBusy.value||!batchTargets.value.length)return
  const owner=props.pluginId,account=plugin.value?.accountScope,token=generation,revision=batchDialogRevision
  batchBusy.value=true;batchSubmitting.value=true
  try{
    await library.call('addOrRemoveTracksToPlaylist',{op:'add',playlist:pluginParams(playlist.sourceContext,{id:playlist.id}),tracks:batchTargets.value.map(track=>({pluginId:track.pluginId||owner,sourceContext:track.sourceContext}))})
    if(owner===props.pluginId&&account===plugin.value?.accountScope&&token===generation&&revision===batchDialogRevision){batchChoices.value=undefined;batchTargets.value=[];selectedKeys.value=new Set();trackNotice.value=t('mobile.plugins.added');await refresh()}
  }catch(cause){if(owner===props.pluginId&&account===plugin.value?.accountScope)trackNotice.value=causeMessage(cause)}
  finally{if(revision===batchDialogRevision){batchBusy.value=false;batchSubmitting.value=false}}
}
useModalFocus(batchPanel,{close:closeBatchAdd,open:()=>Boolean(batchChoices.value),returnFocus:()=>batchTrigger.value})
useModalIsolation(batchPanel,()=>Boolean(batchChoices.value))
useSheetDrag(batchPanel,{close:closeBatchAdd,enabled:()=>Boolean(batchChoices.value)&&!batchBusy.value})
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
const playlistOrderKey = computed(() => JSON.stringify(['plugin', props.pluginId, plugin.value?.accountScope || '', currentKind.value === 'playlists' ? detail.value?.id : '']))
const sortablePlaylist = computed(() => Boolean(detail.value && currentKind.value === 'playlists'))
const orderSource = computed(() => sortablePlaylist.value ? rows.value.map((item, id) => ({ id, name: item.name, localKey: pluginItemKey(item), artists: item.artists?.map(artist => artist.name), album: item.album?.name, item })) : [])
const playlistOrder = useCollectionTrackOrder(orderSource, playlistOrderKey)
const playlistSort = playlistOrder.mode
const historyMounted = ref(false), historyOpen = ref(false), historyError = ref('')
const historyTrigger = ref<HTMLElement>(), historySheet = ref<{ handleBack(): boolean }>()
const historyItems = computed(() => orderSource.value.map(row => ({ key: row.localKey, name: row.name, artists: row.artists, album: row.album })))
const sortedPlaylistRows = computed(() => sortablePlaylist.value && playlistSort.value !== 'original' ? playlistOrder.ordered.value.map(row => row.item) : rows.value)
const selectionScope = computed(() => JSON.stringify([props.pluginId, plugin.value?.accountScope, detail.value?.id, library.method.value, library.requestParams.value.keywords]))
const trackListStateKey = computed(()=>JSON.stringify(['plugin-tracks',selectionScope.value,props.section,playlistSort.value,library.requestParams.value]))
const rangeAppending = ref(false)
const selection = useTrackSelection(visibleRows, pluginItemKey, selectionScope, async () => {
  if (!more.value || loading.value || kind.value !== 'tracks') return false
  const count = rows.value.length
  rangeAppending.value = true
  try {
    const page = await library.list(library.method.value, 'tracks', {}, true, false)
    return Boolean(page) && rows.value.length > count
  } finally {
    rangeAppending.value = false
  }
})
const { active: selecting, keys: selectedKeys, selected, selectedCount, allSelected, busy: batchBusy } = selection
watch(selectionScope,()=>{++batchDialogRevision;batchChoices.value=undefined;batchTargets.value=[];batchSubmitting.value=false},{flush:'sync'})
const playlistSortModes = ['original', 'title', 'artist', 'album', 'custom'] as const
const playlistSortLabels = { original: 'mobile.library.originalOrder', title: 'mobile.library.title', artist: 'nav.artist', album: 'nav.album', custom: 'mobile.ordering.custom' }
const syncBusy = ref(false)
const playlistOrderSignature = computed(() => JSON.stringify(sortedPlaylistRows.value.map(pluginItemKey)))
const orderDirty = computed(() => sortablePlaylist.value && !loading.value && (playlistOrder.dirty.value || Boolean(orderDraft.value && JSON.stringify(orderDraft.value.map(pluginItemKey)) !== playlistOrderSignature.value)))
let orderSyncTask: Promise<boolean> | undefined
async function completePlaylist() {
  const key = playlistOrderKey.value
  while (more.value) {
    const response = await library.list('getPlaylistTracks', 'tracks', {}, true, false)
    if (!response || playlistOrderKey.value !== key) return false
  }
  return true
}
async function changePlaylistSort(mode: CollectionOrder) {
  if (syncBusy.value || loading.value) return
  if (more.value && !await completePlaylist()) return
  const key = playlistOrderKey.value
  const apply = () => {
    if (key !== playlistOrderKey.value) return
    cancelOrder()
    try { playlistOrder.selectView(mode) }
    catch (cause) { trackNotice.value = cause instanceof Error ? cause.message : t('mobile.ordering.saveFailed') }
  }
  if (mode === 'original' && orderDirty.value) appNavigation.run(apply)
  else apply()
}
async function openOrderHistory() {
  if (syncBusy.value || loading.value || busy.value || orderDraft.value) return
  const key = playlistOrderKey.value
  if (more.value && !await completePlaylist() || key !== playlistOrderKey.value) return
  historyError.value = ''
  try { playlistOrder.ensureLegacy() }
  catch (cause) { console.warn('Plugin playlist order history migration failed', cause); historyError.value = t('mobile.orderHistory.saveFailed') }
  historyMounted.value = true; historyOpen.value = true
}
function historyAction(action: () => boolean | void) {
  if (syncBusy.value || loading.value || busy.value) return
  historyError.value = ''
  try { if (action() === false) historyError.value = t('mobile.orderHistory.unavailable') }
  catch (cause) { console.warn('Plugin playlist order history update failed', cause); historyError.value = t('mobile.orderHistory.saveFailed') }
}
function loadOrderHistory(id: string) {
  historyAction(() => {
    if (!playlistOrder.loadHistory(id)) return false
    historyOpen.value = false
    trackNotice.value = playlistOrder.dirty.value ? t('mobile.orderDraft.changed') : ''
  })
}
function syncPlaylistOrder(): Promise<boolean> {
  if (orderSyncTask) return orderSyncTask
  if (!orderDirty.value || !detail.value) return Promise.resolve(true)
  const key = playlistOrderKey.value
  syncBusy.value = true; trackNotice.value = ''
  orderSyncTask = Promise.resolve().then(async () => {
    try {
      if (!await completePlaylist() || key !== playlistOrderKey.value || !detail.value) return false
      if(orderDraft.value){playlistOrder.commit(orderDraft.value.map(pluginItemKey));cancelOrder()}
      const selected = sortedPlaylistRows.value.slice(), signature = playlistOrderSignature.value
      try { playlistOrder.prepareDraftSave() }
      catch (cause) { console.warn('Plugin playlist order history could not be saved before sync', cause); trackNotice.value = t('mobile.orderHistory.saveBeforeSyncFailed'); return false }
      const success = !playlistOrder.sequenceDirty.value || !editablePlaylist.value || !supported('reorderPlaylistTracks') || signature === JSON.stringify(rows.value.map(pluginItemKey)) || await library.mutate('reorderPlaylistTracks', pluginParams(detail.value.sourceContext, { id: detail.value.id, orderedIds: selected.map(row => row.id) }))
      if (success && key === playlistOrderKey.value) {playlistOrder.saveDraft();trackNotice.value=t('mobile.ordering.saved')}
      else if(key === playlistOrderKey.value)trackNotice.value=t('mobile.ordering.syncFailed')
      return success
    } catch (cause) {
      if (key === playlistOrderKey.value) trackNotice.value = cause instanceof Error ? cause.message : t('mobile.ordering.saveFailed')
      return false
    } finally { syncBusy.value = false; orderSyncTask = undefined }
  })
  return orderSyncTask
}
useNavigationDraft({
  dirty: () => orderDirty.value,
  save: syncPlaylistOrder,
  discard: discardPlaylistOrder,
  question: () => ({ title: t('mobile.orderDraft.title'), message: t('mobile.orderDraft.message'), confirmLabel: t('mobile.orderDraft.save'), secondaryLabel: t('mobile.orderDraft.discard'), cancelLabel: t('mobile.ordering.continueEditing') }),
  cancelInteraction: () => { if (historyOpen.value) { if (!historySheet.value?.handleBack()) historyOpen.value = false; return true }; if (!drag.value) return false;cancelAnimationFrame(dragFrame);dragFrame=0;drag.value=undefined;return true }
})
function discardPlaylistOrder(){cancelOrder();playlistOrder.discardDraft();trackNotice.value=''}
watch(playlistOrderKey, () => { historyOpen.value = false; historyError.value = '' })
const methodLabel = computed(() => features.value.find(row => row.method === library.method.value)?.label)
const caption = computed(() => detail.value?.name || (methodLabel.value ? t('mobile.plugins.' + methodLabel.value) : props.integrated?t('mobile.plugins.'+(props.section==='search'?'search':props.section==='home'?'integratedHomeTitle':'integratedLibraryTitle')):t('mobile.plugins.open')))
const discoveryMethods=['getRecommendPlaylist','getRecommendTracks','rankList','topSong','topArtists','topAlbums','newAlbums','personalFM']
const libraryMethods=['userPlaylist','getAllTracks','likelist','userLikedArtists','userLikedMVs','cloudDisk','userRecord']
const sectionFeatures=computed(()=>props.integrated?features.value.filter(row=>(props.section==='home'?discoveryMethods:props.section==='library'?libraryMethods:[]).includes(row.method)):features.value)
const isDetail=computed(()=>Boolean(detail.value)||library.history.value.length>0)
const canGoBack=computed(()=>isDetail.value||Boolean(comments.value||editMode.value||orderDraft.value||playlistPreparing.value||historyOpen.value))
const rootTools=computed(()=>!props.integrated||!isDetail.value)
const discoveryTools=computed(()=>rootTools.value&&(!props.integrated||props.section==='home'))
const searchTabs = ref<HTMLElement>(), featureTabs = ref<HTMLElement>(), swipeViewport = ref<HTMLElement>()
const swipeSearch = computed(() => supported('search') && (props.integrated ? props.section === 'search' : library.method.value === 'search' || Boolean(keywords.value.trim())))
const swipeTabs = computed(() => swipeSearch.value ? searchKinds : sectionFeatures.value.map(item => item.method))
const swipeCurrent = computed(() => swipeSearch.value ? searchTab.value : selectedFeature.value || library.method.value)
const swipeReady = computed(() => Boolean(allowed.value) && !isDetail.value && !initializing.value && !busy.value
    && !syncBusy.value && !playlistPreparing.value && !orderDraft.value && !drag.value && !orderDirty.value && !selecting.value
    && !comments.value && !editMode.value && !historyOpen.value && !batchChoices.value && !actionDialog.value && !activeAppSelect.value && !appNavigation.pending.value)
const localSwipe = useMainNavigationSwipe(swipeTabs, swipeCurrent, () => swipeReady.value,
  value => { if (swipeSearch.value) searchTab.value = value as PluginEntityKind; else void chooseFeature(value) }, { yieldAtBoundary: () => props.integrated, viewport: () => swipeViewport.value })
const swipeCaption = computed(() => {
  const next = localSwipe.neighbor.value
  return next ? t('mobile.plugins.' + (swipeSearch.value ? next : sectionFeatures.value.find(item => item.method === next)?.label || 'browse')) : ''
})
const searchIndicator = useNavigationIndicator(searchTabs, computed(() => swipeSearch.value ? localSwipe.position.value ?? searchKinds.indexOf(searchTab.value) : searchKinds.indexOf(searchTab.value)), computed(() => searchKinds.length))
const featureIndicator = useNavigationIndicator(featureTabs, computed(() => !swipeSearch.value ? localSwipe.position.value ?? swipeTabs.value.indexOf(swipeCurrent.value) : sectionFeatures.value.findIndex(item => item.method === (selectedFeature.value || library.method.value))), computed(() => sectionFeatures.value.length))
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
  if (batchChoices.value) { closeBatchAdd(); return true }
  if (historyOpen.value) { if (!historySheet.value?.handleBack()) historyOpen.value = false; return true }
  if([...sharedTrackActions.values()].some(row=>row.handleBack()))return true
  if(playlistPreparing.value){cancelPreparation();return true}
  if (comments.value) { comments.value = undefined; return true }
  if (editMode.value) { closeDialog(); return true }
  if (selecting.value) {selection.close();return true}
  if (orderDraft.value && !orderDirty.value) { cancelOrder(); return true }
  if (library.history.value.length) { appNavigation.run(() => { if (library.back()) restoreView() }); return true }
  if(props.integrated&&detail.value){void goRoot();return true}
  return false
}
async function refresh() {
  if(orderDirty.value && appNavigation.intercept(()=>{void refresh()}))return
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
  comments.value=undefined;closeDialog()
  appNavigation.run(() => {
    cancelOrder()
    if(library.backToRoot()){restoreView();return}
    if(isDetail.value)void initializeSurface(false)
  })
}
defineExpose({ handleBack, refresh,goRoot,isDetail,canGoBack })
watch(()=>({isDetail:isDetail.value,canGoBack:canGoBack.value,caption:caption.value,loading:initializing.value||loading.value||playlistPreparing.value}),value=>emit('viewState',value),{immediate:true})
useModalFocus(panel, { close: closeDialog, enabled: () => Boolean(editMode.value) && !actionDialog.value })
useModalIsolation(panel,()=>Boolean(editMode.value))
useSheetDrag(panel, { close: closeDialog, enabled: () => Boolean(editMode.value) && !actionDialog.value && !dialogBusy.value })
function cancelPreparation(){++generation;library.cancelReads();playlistPreparing.value=false}
async function play(track: PluginItem,resume=false) {
  if(playlistPreparing.value)return
  if (orderDirty.value && appNavigation.intercept(() => { void play(track, resume) })) return
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
  emit('play', { pluginId: props.pluginId, accountScope:plugin.value?.accountScope,track, queue: sortedPlaylistRows.value.filter(row => row.playable !== false), ...(detail.value&&currentKind.value==='playlists'?{playlistKey:String(detail.value.id),playlistName:detail.value.name,playlistSourceContext:detail.value.sourceContext}:{}),...(library.method.value==='personalFM'?{sourceMethod:'personalFM'}:{}),...(progress?{position:Math.max(0,Number(progress.position)||0),resumePlaylist:true}:{}) })
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
  if(orderDirty.value && appNavigation.intercept(()=>{void chooseFeature(method)}))return
  const feature = sectionFeatures.value.find(item => item.method === method)
  if (!feature) return
  if(playlistPreparing.value)cancelPreparation()
  rememberView()
  // A new root feature supersedes an earlier in-flight read; stale replies
  // remain isolated by the library generation and account checks.
  if (loading.value) library.cancelReads()
  ++generation
  selectedFeature.value = method; categories.value = []; artistGroups.value = []; visibleCount.value = 80; cancelOrder()
  if(method==='newAlbums'&&supported('getAlbumCatlist')){await loadCategories('albums');return}
  if(method==='topSong'&&supported('getTrackCatlist')){await loadCategories('tracks');return}
  await library.list(method, feature.kind, { reset: true, sort:trackSort.value, order:trackOrder.value,pageSize:80 },false,!props.integrated)
}
async function search() { if(!keywords.value.trim())return;if(orderDirty.value&&appNavigation.intercept(()=>{void search()}))return;if(playlistPreparing.value)cancelPreparation();rememberView();visibleCount.value = 80; categories.value = []; await library.list('search', searchTab.value, { tab: searchTab.value, keywords: keywords.value.trim(), page: 1, reset: true },false,!props.integrated) }
async function open(item: PluginItem) { await openAs(item,kind.value) }
async function openAs(item: PluginItem,nextKind:PluginEntityKind) {
  if (orderDirty.value && appNavigation.intercept(() => { void openAs(item, nextKind) })) return
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
  if(orderDirty.value && appNavigation.intercept(()=>{void related(method,nextKind)}))return
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
async function startOrder() { if (more.value && !await completePlaylist()) return; if(sortablePlaylist.value){selection.close();orderDraft.value=sortedPlaylistRows.value.slice()} }
function cancelOrder() { cancelAnimationFrame(dragFrame);dragFrame=0;drag.value=undefined;orderDraft.value=undefined }
async function saveOrder() {
  if(!orderDraft.value||!detail.value)return
  try {
    playlistOrder.commit(orderDraft.value.map(pluginItemKey)); cancelOrder()
    await syncPlaylistOrder()
  } catch (cause) { trackNotice.value = cause instanceof Error ? cause.message : t('mobile.ordering.saveFailed') }
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
  if (editMode.value === 'edit' && detail.value && playlistName.value.trim() === detail.value.name.trim() && description.value.trim() === (detail.value.description || '').trim() && tags.value.split(/[;；,，]/).map(value=>value.trim()).filter(Boolean).join(';') === (detail.value.tags || []).map(value=>value.trim()).filter(Boolean).join(';')) { closeDialog(); return }
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
  resetTrackActions()
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
watch(() => plugin.value?.accountScope, resetTrackActions)
watch(()=>pendingPluginNavigation.value?.key,()=>{void followNavigation()})
watch(rows, () => { visibleCount.value = Math.max(80, Math.min(visibleCount.value, rows.value.length)) })
onMounted(()=>document.addEventListener('visibilitychange',visibilityChanged))
onBeforeUnmount(()=>{rememberView();library.saveSnapshot()})
onUnmounted(() => { ++generation;++videoGeneration;++progressGeneration;cancelOrder();document.removeEventListener('visibilitychange',visibilityChanged) })
</script>
<template>
  <section class="page plugin-library-page" :class="{'plugin-library-integrated':integrated}" :data-integrated-section="integrated?section:undefined" :data-no-page-swipe="integrated && !swipeReady ? '' : undefined" @pointerdown="localSwipe.pointerStart" @touchstart.passive="localSwipe.start" @touchmove="localSwipe.move" @touchend="localSwipe.end" @touchcancel="localSwipe.cancel" @click.capture="localSwipe.click" @dragstart.capture="localSwipe.dragStart">
    <div v-if="!integrated" class="section-heading plugin-standalone-header"><div><div class="eyebrow">{{ $t('mobile.plugins.title') }}</div><h2>{{ plugin?.name || pluginId }}</h2></div><div class="plugin-header-actions"><button type="button" class="icon-button plugin-header-back" :aria-label="$t('mobile.common.back')" @click="handleBack() || emit('back')"><OriginalIcon name="back" /></button><button type="button" class="icon-button plugin-header-back" :aria-label="$t('mobile.plugins.manage')" @click="emit('manage')"><OriginalIcon name="settings" /></button></div></div>
    <p v-if="!integrated&&['login','logout','offline'].includes(library.status.value)" class="setting-note" role="status">{{ $t('mobile.plugins.status_'+library.status.value) }}</p>
    <p v-if="!allowed" class="setting-note">{{ $t(localOnly ? 'mobile.plugins.offline' : 'mobile.plugins.disabled') }}</p>
    <template v-if="allowed">
      <button v-if="integrated && isDetail" type="button" class="text-button plugin-detail-back" @click="handleBack"><OriginalIcon name="back" />{{ $t('mobile.common.back') }}</button>
      <div :key="String(detail?.id || '') + ':' + library.method.value" class="plugin-library-content">
      <div v-if="banners.length&&rootTools" class="plugin-banners"><template v-for="banner in banners" :key="String(banner.id)"><a v-if="banner.type==='activity'&&/^https?:\/\//.test(String(banner.url||''))" :href="String(banner.url)" target="_blank" rel="noopener noreferrer" class="plugin-banner"><PluginArtwork :plugin-id="pluginId" :uri="banner.picUrl" :source-context="banner.sourceContext" /><span>{{ banner.typeTitle }}</span></a><button v-else type="button" class="plugin-banner" :aria-label="String(banner.typeTitle||$t('mobile.plugins.banner'))" @click="openBanner(banner)"><PluginArtwork :plugin-id="pluginId" :uri="banner.picUrl" :source-context="banner.sourceContext" /><span>{{ banner.typeTitle }}</span></button></template></div>
      <form v-if="rootTools&&supported('search')&&(!integrated||section==='search')" class="remote-search-box plugin-search" @submit.prevent="search"><span><OriginalIcon name="search" /></span><input v-model="keywords" type="search" :placeholder="$t('mobile.plugins.searchHint')" :aria-label="$t('mobile.plugins.searchHint')" /><button type="submit" :disabled="loading || !keywords.trim()">{{ $t('mobile.plugins.search') }}</button></form>
      <section v-if="rootTools&&supported('search')&&(!integrated||section==='search')" class="plugin-section"><div class="plugin-section-title"><span class="eyebrow">{{ $t('mobile.plugins.searchType') }}</span></div><div ref="searchTabs" class="search-categories navigation-tabs plugin-search-tabs" :data-swiping="swipeSearch && localSwipe.holding.value ? '' : undefined" role="group" :aria-label="$t('mobile.plugins.searchType')"><span class="navigation-tab-indicator" :style="searchIndicator" aria-hidden="true"></span><button v-for="value in searchKinds" :key="value" type="button" :class="{selected:searchTab===value}" :aria-pressed="searchTab===value" @click="searchTab=value">{{ $t('mobile.plugins.' + value) }}</button></div></section>
      <section v-if="rootTools&&sectionFeatures.length" class="plugin-section"><div class="plugin-section-title"><span class="eyebrow">{{ $t('mobile.plugins.browse') }}</span></div><div ref="featureTabs" class="search-categories navigation-tabs plugin-feature-tabs" :data-swiping="!swipeSearch && localSwipe.holding.value ? '' : undefined" role="group" :aria-label="$t('mobile.plugins.browse')"><span class="navigation-tab-indicator" :style="featureIndicator" aria-hidden="true"></span><button v-for="item in sectionFeatures" :key="item.method" type="button" :class="{selected:(selectedFeature||library.method.value)===item.method}" :aria-pressed="(selectedFeature||library.method.value)===item.method" :disabled="loading" @click="chooseFeature(item.method)">{{ $t('mobile.plugins.'+item.label) }}</button><button v-if="supported('createPlaylist')&&(!integrated||section==='library')" type="button" :disabled="busy" @click="editPlaylist('create')">{{ $t('mobile.plugins.createPlaylist') }}</button></div></section>
      <section v-if="discoveryTools&&(supported('catlist')||supported('getTrackCatlist')||supported('getAlbumCatlist')||supported('getArtistCatlist'))" class="plugin-section"><div class="plugin-section-title"><span class="eyebrow">{{ $t('mobile.plugins.category') }}</span></div><div class="search-categories" role="group" :aria-label="$t('mobile.plugins.category')"><button v-if="supported('catlist')" type="button" :disabled="loading" @click="loadCategories('playlists')">{{ $t('mobile.plugins.playlistCategories') }}</button><button v-if="supported('getTrackCatlist')" type="button" :disabled="loading" @click="loadCategories('tracks')">{{ $t('mobile.plugins.trackCategories') }}</button><button v-if="supported('getAlbumCatlist')" type="button" :disabled="loading" @click="loadCategories('albums')">{{ $t('mobile.plugins.albumCategories') }}</button><button v-if="supported('getArtistCatlist')" type="button" :disabled="loading" @click="loadCategories('artists')">{{ $t('mobile.plugins.artistCategories') }}</button></div></section><div v-if="discoveryTools&&categories.length" class="plugin-filter-card"><AppSelect :model-value="category" :label="$t('mobile.plugins.category')" :options="categories.map((item,index)=>({value:index,label:item.label}))" @update:model-value="selectCategory" /></div>
      <div v-if="discoveryTools&&artistGroups.length" class="plugin-filter-card"><AppSelect v-for="(group,index) in artistGroups" :key="group.code" :model-value="artistSelection[index]" :label="group.name" :options="group.sub.map(item=>({value:item.code,label:item.name}))" @update:model-value="artistSelection[index]=$event;selectArtistCategory()" /></div>
      <section v-if="rootTools&&(!integrated||section==='library')&&(supported('userPlaylist')||supported('userRecord')||supported('rankTop'))" class="plugin-section"><div class="plugin-section-title"><span class="eyebrow">{{ $t('mobile.plugins.integratedLibraryTitle') }}</span></div><div class="search-categories" role="group" :aria-label="$t('mobile.plugins.integratedLibraryTitle')"><button v-if="supported('userPlaylist')" type="button" :disabled="loading" @click="library.list('userPlaylist','albums')">{{ $t('mobile.plugins.savedAlbums') }}</button><button v-if="supported('userRecord')" type="button" :disabled="loading" @click="library.list('userRecord','tracks',{period:'week'})">{{ $t('mobile.plugins.weekHistory') }}</button><button v-if="supported('rankTop')" type="button" :disabled="loading" @click="library.list('rankTop','playlists')">{{ $t('mobile.plugins.featuredCharts') }}</button></div></section>
      <div ref="swipeViewport" class="swipe-deck">
      <Transition name="swipe-peek">
        <div v-if="localSwipe.neighbor.value" class="swipe-peek plugin-swipe-peek" :style="localSwipe.peekStyle.value" :data-peek-tab="localSwipe.neighbor.value" inert aria-hidden="true">
          <div class="plugin-results-heading"><h3>{{ swipeCaption }}</h3></div>
          <p class="empty-state">{{ $t(swipeSearch ? 'mobile.plugins.integratedSearchHint' : 'mobile.plugins.loading') }}</p>
        </div>
      </Transition>
      <div class="plugin-swipe-results swipe-surface" data-slide-active :style="localSwipe.style.value" :data-swiping="localSwipe.holding.value ? '' : undefined">
      <div v-if="error" class="inline-error" role="alert">{{ causeMessage(error) }} <button type="button" class="text-button" :disabled="loading" @click="refresh">{{ $t('mobile.plugins.retry') }}</button></div>
      <p v-if="trackNotice" class="setting-note" role="status">{{ trackNotice }}</p>
      <section v-if="detail" class="plugin-detail"><PluginArtwork :plugin-id="pluginId" :uri="detail.picUrl" :source-context="detail.sourceContext" eager /><div><div class="plugin-detail-title"><h3>{{ detail.name }}</h3><PlaylistMenuButton v-if="currentKind === 'playlists' && canSavePlaylist" :label="detail.name" :disabled="playlistMenuBusy" @open="savePlaylistForOffline(detail)" /></div><p v-if="detail.description" class="plugin-description">{{ detail.description }}</p><div class="plugin-detail-actions">
        <button v-if="sortedPlaylistRows.length" type="button" class="secondary-button" :disabled="playlistPreparing" @click="play(sortedPlaylistRows[0])"><OriginalIcon name="play" />{{ $t('mobile.plugins.playAll') }}</button>
        <button v-if="rows.length&&currentKind==='playlists'&&playlistProgress?.available" type="button" class="secondary-button" :disabled="playlistPreparing||progressLoading" @click="play(rows[0],true)"><OriginalIcon name="play" />{{ $t('mobile.plugins.continuePlaylist') }}</button>
        <template v-if="currentKind === 'playlists'"><button v-if="editablePlaylist && supported('editPlaylist')" type="button" class="text-button" :disabled="busy" @click="editPlaylist('edit')">{{ $t('mobile.plugins.edit') }}</button><button v-if="editablePlaylist && supported('deletePlaylist')" type="button" class="text-button danger-text" :disabled="busy" @click="removePlaylist">{{ $t('mobile.plugins.deletePlaylist') }}</button><button v-if="!detail.isMine && supported('subscribePlaylist')" type="button" class="text-button" :disabled="busy" @click="changeSubscription('subscribePlaylist',detail,Boolean(detail.subscribed))">{{ $t(detail.subscribed?'mobile.plugins.unsubscribe':'mobile.plugins.subscribe') }}</button><button v-if="supported('intelligencePlaylist')" type="button" class="text-button" :disabled="loading" @click="related('intelligencePlaylist','tracks')">{{ $t('mobile.plugins.intelligence') }}</button></template>
        <template v-if="currentKind === 'albums'"><button v-if="supported('subscribeAlbum')" type="button" class="text-button" :disabled="busy" @click="changeSubscription('subscribeAlbum',detail,Boolean(detail.subscribed))">{{ $t(detail.subscribed?'mobile.plugins.unsubscribe':'mobile.plugins.subscribe') }}</button></template>
        <template v-if="currentKind === 'artists'"><button v-if="supported('followArtist')" type="button" class="text-button" :disabled="busy" @click="changeSubscription('followArtist',detail,Boolean(detail.followed))">{{ $t(detail.followed?'mobile.plugins.unfollow':'mobile.plugins.follow') }}</button><button v-if="supported('artistAlbums')" type="button" class="text-button" @click="related('artistAlbums','albums')">{{ $t('mobile.plugins.albums') }}</button><button v-if="supported('artistMVs')" type="button" class="text-button" @click="related('artistMVs','mvs')">{{ $t('mobile.plugins.mvs') }}</button><button v-if="supported('simiArtists')" type="button" class="text-button" @click="related('simiArtists','artists')">{{ $t('mobile.plugins.similarArtists') }}</button></template>
        <button v-if="allowsPluginComments(plugin,currentKind==='playlists'?'playlist':currentKind==='albums'?'album':'mv') && currentKind!=='artists'" type="button" class="text-button" @click="openComments(detail,currentKind==='playlists'?'playlist':currentKind==='albums'?'album':'mv',$event)">{{ $t('mobile.plugins.comments') }}</button>
      </div></div></section>
      <div v-if="mvSources.length" class="plugin-video"><AppSelect v-if="mvSources.length>1" v-model="videoIndex" :label="$t('mobile.plugins.videoQuality')" :options="mvSources.map((source,index)=>({value:index,label:source.quality||String(index+1)}))" /><p v-if="videoLoading" class="setting-note">{{ $t('mobile.plugins.loading') }}</p><video v-if="videoUri" controls playsinline preload="metadata" :src="videoUri" /><div class="plugin-detail-actions"><button v-if="supported('likeAMV') && detail" type="button" class="text-button" :disabled="busy" @click="changeSubscription('likeAMV',detail,Boolean(detail.liked))">{{ $t(detail.liked?'mobile.plugins.unlike':'mobile.plugins.like') }}</button><button v-if="supported('subAMV') && detail" type="button" class="text-button" :disabled="busy" @click="changeSubscription('subAMV',detail,Boolean(detail.subed))">{{ $t(detail.subed?'mobile.plugins.unsubscribe':'mobile.plugins.subscribe') }}</button></div></div>
      <div v-if="library.method.value==='getAllTracks'" class="plugin-filter-card"><AppSelect v-model="trackSort" :label="$t('mobile.plugins.trackSort')" :options="[{value:'name',label:$t('mobile.plugins.byName')},{value:'createTime',label:$t('mobile.plugins.byCreated')},{value:'playCount',label:$t('mobile.plugins.byPlayCount')}]" @update:model-value="chooseFeature('getAllTracks')" /><AppSelect v-model="trackOrder" :label="$t('mobile.plugins.sortDirection')" :options="[{value:'ASC',label:$t('mobile.plugins.ascending')},{value:'DESC',label:$t('mobile.plugins.descending')}]" @update:model-value="chooseFeature('getAllTracks')" /></div>
      <div class="plugin-results-heading"><h3>{{ caption }}</h3><small>{{ rows.length }} / {{ count }}</small></div>
      <div v-if="sortablePlaylist" class="plugin-playlist-order"><AppSelect :model-value="playlistSort" :disabled="busy || loading || syncBusy || Boolean(orderDraft) || selecting" :label="$t('mobile.library.sortLabel')" :options="playlistSortModes.map(value => ({ value, label: $t(value === 'original' && plugin?.type !== 'local' ? 'mobile.orderHistory.serverOrder' : playlistSortLabels[value]) }))" @update:model-value="changePlaylistSort" /><button ref="historyTrigger" type="button" class="text-button playlist-order-history-button" :disabled="loading || busy || syncBusy || Boolean(orderDraft) || selecting" aria-haspopup="dialog" :aria-expanded="historyOpen" @click="openOrderHistory"><OriginalIcon name="list" />{{ $t('mobile.orderHistory.title') }}</button><button v-if="!orderDraft" type="button" class="text-button" :disabled="loading || busy || syncBusy" @click="startOrder"><OriginalIcon name="drag" />{{ $t('mobile.plugins.reorder') }}</button><template v-else><button type="button" class="secondary-button" :disabled="busy || syncBusy" @click="saveOrder">{{ $t('mobile.orderDraft.save') }}</button><button type="button" class="text-button" :disabled="busy || syncBusy" @click="discardPlaylistOrder">{{ $t('mobile.orderDraft.discard') }}</button></template></div>
      <div v-if="orderDirty && !orderDraft" class="plugin-playlist-order order-draft-actions"><span>{{ $t('mobile.orderDraft.changed') }}</span><button type="button" class="text-button" :disabled="syncBusy" @click="discardPlaylistOrder">{{ $t('mobile.orderDraft.discard') }}</button><button type="button" class="secondary-button" :disabled="syncBusy" @click="syncPlaylistOrder">{{ $t('mobile.orderDraft.save') }}</button></div>
      <p v-if="syncBusy" class="setting-note" role="status">{{ $t('mobile.ordering.syncing') }}</p>
      <p v-else-if="sortablePlaylist && playlistSort !== 'original' && (!editablePlaylist || !supported('reorderPlaylistTracks'))" class="setting-note">{{ $t('mobile.ordering.localViewOnly') }}</p>
      <div v-if="kind === 'tracks'" class="plugin-playlist-order"><button v-if="!selecting && !orderDraft && rows.length" type="button" class="text-button" :disabled="loading || syncBusy" @click="selecting=true">{{ $t('mobile.batch.select') }}</button><button v-if="currentTrackIndex >= 0" type="button" class="text-button" @click="trackWindow?.scrollToIndex(currentTrackIndex, {align:'center'})"><OriginalIcon name="locate" />{{ $t('mobile.player.locateCurrent') }}</button></div>
      <TrackSelectionBar v-if="kind === 'tracks' && selecting" :count="selectedCount" :total="visibleRows.length" :all="allSelected" :busy="batchBusy" :actions="batchActions" @all="selection.selectAll" @close="selection.close" @action="action=>selection.run(action,runBatch)" />
      <div v-if="kind==='tracks'" v-range-select="(loading && !rangeAppending) || syncBusy || batchBusy || orderDraft || busy ? undefined : selection.range.value" ref="listElement" class="track-list plugin-track-list" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag">
        <WindowedTrackList ref="trackWindow" :items="visibleRows" :item-key="pluginItemKey" :state-key="trackListStateKey" :restore-ready="!loading && !playlistPreparing" :gap="0" animate-changes :pinned-index="drag ? visibleRows.findIndex(row=>pluginItemKey(row)===drag?.id) : undefined"><template #default="{item:track,index}">
        <article :data-range-key="pluginItemKey(track)" :data-plugin-track-id="pluginItemKey(track)" class="plugin-track" :class="{'plugin-track-dragging':drag?.id===pluginItemKey(track),'track-current':index===currentTrackIndex,'track-selected':selectedKeys.has(pluginItemKey(track))}" :aria-current="index === currentTrackIndex ? 'true' : undefined">
          <button v-if="selecting" type="button" data-range-handle class="track-selection-toggle icon-button" :aria-label="track.name" :aria-pressed="selectedKeys.has(pluginItemKey(track))" @click="selection.toggle(track)"><span class="track-selection-check" :class="{checked:selectedKeys.has(pluginItemKey(track))}"><OriginalIcon v-if="selectedKeys.has(pluginItemKey(track))" name="check" /></span></button>
          <button v-else-if="orderDraft" type="button" class="plugin-order-handle" :aria-label="$t('mobile.plugins.moveTrack',{name:track.name})" @pointerdown="startDrag($event,track)" @keydown="keyboardMove($event,index)"><OriginalIcon name="drag" /></button>
          <button type="button" data-range-handle class="plugin-track-play" :disabled="!selecting && (track.playable===false||Boolean(orderDraft))" @click="selecting ? selection.toggle(track) : play(track)"><PluginArtwork :plugin-id="track.pluginId||pluginId" :uri="track.picUrl" :source-context="track.sourceContext" /><span><b>{{ track.name }}</b><small>{{ track.artists?.map(item=>item.name).join(' / ') || track.album?.name }}</small><small v-if="track.playable===false">{{ track.reason }}</small></span></button>
          <details v-if="!orderDraft && !selecting" class="plugin-track-options" @toggle="prepareTrackActions($event,track)"><summary :aria-label="$t('mobile.plugins.trackActions',{name:track.name})"><OriginalIcon name="more" /></summary><div v-if="preparedTrackActions.has(pluginItemKey(track))"><button type="button" class="text-button" @click="emit('next',{pluginId,track,queue:[track]})">{{ $t('mobile.plugins.playNext') }}</button><button type="button" class="text-button" @click="emit('append',{pluginId,track,queue:[track]})">{{ $t('mobile.plugins.appendQueue') }}</button><button v-if="itemSupported(track,'getTrackDetail')" type="button" class="text-button" :disabled="busy" @click="refreshTrack(track)">{{ $t('mobile.plugins.refreshTrack') }}</button><button v-if="track.album&&itemSupported(track.album,'albumDetail')" type="button" class="text-button" @click="openAs(track.album,'albums')">{{ track.album.name }}</button><button v-for="artist in track.artists||[]" v-show="itemSupported(artist,'artistDetail')" :key="artist.id" type="button" class="text-button" @click="openAs(artist,'artists')">{{ artist.name }}</button><PluginTrackActions :ref="value=>registerTrackActions(value,track)" :track="track" :plugin-id="pluginId" :plugins="library.plugins.value" :local-only="localOnly" :disabled="busy" @play="emit('play',$event)" /><button v-if="editablePlaylist && currentKind==='playlists' && supported('addOrRemoveTracksToPlaylist')" type="button" class="text-button" :disabled="busy" @click="removeTrack(track)">{{ $t('mobile.plugins.removeFromPlaylist') }}</button><button v-if="library.method.value==='personalFM'&&supported('fmTrash')" type="button" class="text-button" :disabled="busy" @click="trashRadio(track)">{{ $t('mobile.plugins.dislikeFm') }}</button></div></details>
        </article></template></WindowedTrackList>
      </div>
      <div v-else class="plugin-result-strip">
        <div v-for="item in visibleRows" :key="pluginItemKey(item)" class="plugin-result-item">
          <button type="button" class="plugin-result-card" @click="open(item)"><PluginArtwork :plugin-id="pluginId" :uri="item.picUrl" :source-context="item.sourceContext" /><b>{{ item.name }}</b><small>{{ item.copywriter || item.artists?.map(artist=>artist.name).join(' / ') }}</small></button>
          <PlaylistMenuButton v-if="kind === 'playlists' && canSavePlaylist" :label="item.name" placement="card" :disabled="playlistMenuBusy" @open="savePlaylistForOffline(item)" />
        </div>
      </div>
      <p v-if="playlistPreparing" class="setting-note plugin-playlist-preparing" role="status">{{ $t('mobile.plugins.preparingPlaylist') }} <button type="button" class="text-button" @click="cancelPreparation">{{ $t('mobile.management.cancel') }}</button></p><p v-if="loading&&!playlistPreparing" class="setting-note" role="status">{{ $t('mobile.plugins.loading') }}</p><p v-else-if="!rows.length&&!error&&!mvSources.length" class="empty-state">{{ $t(integrated&&!library.method.value?'mobile.plugins.'+(section==='search'?(supported('search')?'integratedSearchHint':'integratedSearchUnavailable'):section==='home'?'integratedHomeUnavailable':'integratedLibraryUnavailable'):'mobile.plugins.empty') }}</p>
      <div class="plugin-pagination"><button v-if="kind !== 'tracks' && visibleCount<rows.length" type="button" class="text-button" @click="visibleCount+=80">{{ $t('mobile.plugins.showMore') }}</button><button v-else-if="more" type="button" class="text-button" :disabled="loading" @click="library.list(library.method.value,kind,{},true,false)">{{ $t('mobile.plugins.loadMore') }}</button></div>
      </div>
      </div>
      </div>
    </template>
    <CollectionOrderHistorySheet v-if="historyMounted" ref="historySheet" :open="historyOpen" :scope-key="playlistOrderKey" :entries="playlistOrder.history.value" :limit="playlistOrder.historyLimit.value" :recent-custom-id="playlistOrder.recentCustomId.value" :active-id="historyOpen ? playlistOrder.activeHistoryId.value : undefined" :items="historyItems" :disabled="loading || busy || syncBusy || Boolean(orderDraft)" :error="historyError || playlistOrder.historyError.value" :return-focus="historyTrigger" @close="historyOpen = false" @load="loadOrderHistory" @update:limit="value => historyAction(() => { playlistOrder.setHistoryLimit(value) })" @rename="(id, name) => historyAction(() => playlistOrder.renameHistory(id, name))" @pin="(id, pinned) => historyAction(() => playlistOrder.pinHistory(id, pinned))" @remove="id => historyAction(() => playlistOrder.removeHistory(id))" />
    <PluginCommentSheet v-if="comments" :plugin="comments.plugin" :item="comments.item" :content-type="comments.type" :local-only="localOnly" :return-focus="comments.trigger" @close="comments=undefined" />
    <Teleport to="body"><Transition name="online-dialog"><div v-if="batchChoices" class="plugin-edit-layer" @click.self="closeBatchAdd"><section ref="batchPanel" class="plugin-edit-panel" role="dialog" aria-modal="true" :aria-label="$t('mobile.plugins.addToPlaylist')" tabindex="-1"><SheetDragHandle @close="closeBatchAdd" /><header><h3>{{ $t('mobile.plugins.addToPlaylist') }}</h3><button type="button" class="icon-button" :disabled="batchBusy" :aria-label="$t('mobile.common.close')" @click="closeBatchAdd"><OriginalIcon name="close" /></button></header><p class="setting-note">{{ $t('mobile.common.tracks',{count:batchTargets.length}) }}</p><p v-if="trackNotice" class="setting-note" role="status">{{ trackNotice }}</p><button v-for="playlist in batchChoices" :key="pluginItemKey(playlist)" type="button" class="plugin-playlist-choice" :disabled="batchBusy" @click="addBatchTo(playlist)">{{ playlist.name }}</button><p v-if="!batchChoices.length" class="setting-note">{{ $t(batchBusy?'mobile.plugins.loading':'mobile.plugins.noOwnedPlaylist') }}</p></section></div></Transition></Teleport>
    <Teleport to="body"><div v-if="editMode" class="plugin-edit-layer" :inert="Boolean(actionDialog)" @click.self="!dialogBusy&&closeDialog()"><section ref="panel" class="plugin-edit-panel" role="dialog" aria-modal="true" :aria-label="$t('mobile.plugins.'+(editMode==='edit'?'edit':'createPlaylist'))" tabindex="-1"><SheetDragHandle @close="!dialogBusy&&closeDialog()" /><header><h3>{{ $t('mobile.plugins.'+(editMode==='edit'?'edit':'createPlaylist')) }}</h3><button type="button" class="icon-button" :aria-label="$t('mobile.common.close')" @click="closeDialog"><OriginalIcon name="close" /></button></header><p v-if="dialogError" class="inline-error" role="alert">{{ dialogError }}</p><form @submit.prevent="savePlaylist"><label>{{ $t('mobile.plugins.playlistName') }}<input v-model="playlistName" required maxlength="120" /></label><label v-if="editMode==='edit'||plugin?.type==='local'">{{ $t('mobile.plugins.descriptionField') }}<textarea v-model="description" rows="3" maxlength="1000" /></label><template v-if="editMode==='edit'"><label>{{ $t('mobile.plugins.tags') }}<input v-model="tags" maxlength="200" /></label></template><label v-if="editMode==='create'" class="plugin-private-label"><input v-model="privatePlaylist" type="checkbox" />{{ $t('mobile.plugins.privatePlaylist') }}</label><button type="submit" class="secondary-button" :disabled="dialogBusy||!playlistName.trim()">{{ $t('mobile.plugins.save') }}</button></form></section></div></Teleport>
  </section>
</template>
<style scoped>
.plugin-detail-back { display:inline-flex; align-items:center; gap:7px; margin:0 0 10px; }
.plugin-playlist-order { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin:10px 0; }
.plugin-playlist-order :deep(.app-select) { flex:1 1 140px; min-width:0; max-width:220px; }
.plugin-library-content { animation:plugin-content-enter var(--motion-page,300ms) cubic-bezier(.2,.75,.25,1) both; }
@keyframes plugin-content-enter { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
html[data-motion='reduced'] .plugin-library-content { animation:none; }
.plugin-standalone-header{flex-wrap:wrap;align-items:flex-start}
.plugin-standalone-header h2{overflow-wrap:anywhere}
.plugin-standalone-header .plugin-header-actions{display:flex;gap:8px;align-items:center;flex:none;margin-left:auto}
.plugin-standalone-header .plugin-header-back{min-width:44px;min-height:44px;border:1px solid var(--line);border-radius:8px;background:var(--surface)}

.plugin-banners{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding:8px 0 16px;}.plugin-banner{flex:0 0 min(75vw,360px);min-width:0;display:block;position:relative;padding:0;overflow:hidden;border:0;border-radius:12px;color:var(--ink);background:var(--surface);text-decoration:none;scroll-snap-align:start;}.plugin-banner .plugin-artwork{aspect-ratio:2.4;}.plugin-banner>span:last-child{position:absolute;bottom:8px;left:10px;padding:4px 8px;background:var(--color-body-bg);border-radius:6px;font-size:calc(11px * var(--ui-font-scale,1));}
.plugin-order-handle { min-width:44px;min-height:48px;touch-action:none;border:0;border-radius:8px;background:var(--surface);color:var(--muted);cursor:grab; }.plugin-track-dragging { background:var(--accent-soft);box-shadow:var(--shadow);border-radius:10px; }.plugin-track-move-move { transition:transform var(--motion-state) ease; }html[data-motion='reduced'] .plugin-track-move-move { transition:none; }
.plugin-library-integrated { margin-top: 12px; padding-top: 14px; border-top: 1px solid var(--line); }
.plugin-library-integrated .plugin-chips { margin-left: 0; margin-right: 0; padding-left: 0; padding-right: 0; }
.plugin-section { margin-top: 20px; }
.plugin-section-title { display: flex; align-items: end; margin: 0 2px 10px; }
.plugin-results-heading { display: flex; align-items: baseline; justify-content: space-between; margin-top: 22px; }
.plugin-results-heading h3 { font-size: calc(17px * var(--ui-font-scale, 1)); }
.plugin-results-heading small { color: var(--muted); font-variant-numeric: tabular-nums; }
.plugin-search { display: flex; margin: 4px 0 12px; }
.plugin-chips { display: flex; gap: 8px; margin: 0 calc(-1 * var(--page-gutter, 18px)) 12px; padding: 0 var(--page-gutter, 18px) 2px; overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain; }
.plugin-chips::-webkit-scrollbar { display: none; }
.plugin-search .plugin-chips { margin-bottom: 0; }
.plugin-chips button { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 14px; border: 1px solid var(--line); border-radius: 10px; color: var(--ink); background: var(--surface-card); font: inherit; font-size: calc(13px * var(--ui-font-scale, 1)); font-weight: 600; white-space: nowrap; transition: color var(--motion-feedback), background-color var(--motion-feedback), transform var(--motion-feedback); }
.plugin-chips button .original-icon { font-size: 18px; }
.plugin-chips button.selected { color: var(--accent-ink); background: var(--accent-soft); border-color: var(--accent-border); }
.plugin-chips button:active { transform: scale(.96); }
.plugin-chips button:disabled { opacity: .5; }
.plugin-chips .plugin-chip-action { color: var(--accent-ink); background: transparent; border-color: var(--line); }
.plugin-filter-card { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(140px, 100%), 1fr)); gap: 8px; margin: 0 0 12px; padding: 10px; border: 1px solid var(--line); border-radius: 13px; background: var(--surface); }
.plugin-detail { display: grid; grid-template-columns: minmax(70px, 120px) minmax(0, 1fr); gap: 14px; align-items: center; margin: 4px 0 16px; padding: 13px; border: 1px solid var(--line); border-radius: 18px; background: var(--surface-card); box-shadow: var(--shadow); }
.plugin-detail > .plugin-artwork { border-radius: 14px; }
.plugin-detail h3 { margin: 0 0 5px; font-size: calc(16px * var(--ui-font-scale, 1)); font-weight: 700; overflow-wrap: anywhere; }
.plugin-description { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 96px; overflow: auto; margin: 0; color: var(--muted); font-size: calc(11px * var(--ui-font-scale, 1)); line-height: 1.55; }
.plugin-result-strip { display: flex; gap: 13px; margin: 0 calc(-1 * var(--page-gutter, 18px)); padding: 2px var(--page-gutter, 18px) 11px; overflow-x: auto; scrollbar-width: none; scroll-snap-type: x mandatory; }
.plugin-result-strip::-webkit-scrollbar { display: none; }
.plugin-result-card { min-width: 0; display: grid; align-content: start; gap: 6px; padding: 0; border: 0; border-radius: 14px; background: transparent; color: var(--ink); text-align: left; width:100%; }
.plugin-result-card .plugin-artwork { aspect-ratio: 1; border-radius: 13px; box-shadow: 0 4px 12px rgb(0 0 0 / 9%); }
.plugin-result-card b, .plugin-result-card small { overflow: hidden; padding: 0 2px; text-overflow: ellipsis; white-space: nowrap; }
.plugin-result-card b { font-size: calc(13px * var(--ui-font-scale, 1)); font-weight: 600; }
.plugin-result-card small { color: var(--muted); font-size: calc(11px * var(--ui-font-scale, 1)); }
.plugin-track { display: flex; align-items: center; gap: 8px; min-height: 58px; border: 1px solid var(--line); border-radius: 13px; background: var(--surface-card); padding: 6px 4px 6px 6px; margin-bottom: 6px; transition: background-color var(--motion-feedback), border-color var(--motion-feedback); }
.plugin-track:active { background: var(--accent-soft); }
.plugin-track-play { flex: 1; min-width: 0; min-height: 48px; display: flex; align-items: center; gap: 11px; border: 0; border-radius: 11px; background: transparent; color: var(--ink); padding: 6px; text-align: left; }
.plugin-track-play > .plugin-artwork { width: 46px; flex: 0 0 46px; border-radius: 10px; }
.plugin-track-play > span { min-width: 0; }
.plugin-track-play b, .plugin-track-play small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plugin-track-play b { font-size: calc(13px * var(--ui-font-scale, 1)); font-weight: 620; }
.plugin-track-play small { color: var(--muted); font-size: calc(11px * var(--ui-font-scale, 1)); margin-top: 3px; }
.plugin-track-options { flex: 0 0 auto; }
.plugin-track-options summary { display: grid; place-items: center; min-width: 44px; min-height: 44px; list-style: none; cursor: pointer; border-radius: 10px; }
.plugin-track-options summary::-webkit-details-marker { display: none; }
.plugin-track-options[open] { flex: 1 1 160px; border-radius: 10px; background: var(--surface); }
.plugin-track-options > div { display: grid; padding: 6px; }
.plugin-track:has(.plugin-track-options[open]) { flex-wrap: wrap; }
.plugin-track:has(.plugin-track-options[open]) > .plugin-track-play { flex-basis: calc(100% - 60px); }
.plugin-video video { display: block; width: 100%; max-height: 60dvh; border-radius: 14px; background: #111; }
.plugin-edit-layer { position: fixed; inset: 0; z-index: 145; display: flex; justify-content: center; align-items: flex-end; background: var(--scrim, rgb(0 0 0 / 42%)); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); padding-top: max(12px, env(safe-area-inset-top)); }
.plugin-edit-panel { width: min(100%, 600px); max-height: 90dvh; overflow: auto; overscroll-behavior: contain; padding: 16px max(16px, env(safe-area-inset-right)) max(18px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); border: 1px solid var(--line); border-bottom: 0; border-radius: var(--radius-sheet, 24px) var(--radius-sheet, 24px) 0 0; background: var(--color-body-bg); color: var(--ink); box-shadow: var(--shadow-sheet, 0 -10px 36px rgb(0 0 0 / 16%)); animation: plugin-sheet-enter var(--motion-panel, 320ms) ease both; }
.plugin-edit-panel header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
.plugin-edit-panel h3 { margin: 0; font-size: calc(17px * var(--ui-font-scale, 1)); font-weight: 700; }
.plugin-edit-panel form label { display: grid; gap: 7px; margin: 14px 0; font-size: calc(13px * var(--ui-font-scale, 1)); }
.plugin-edit-panel form input:not([type=checkbox]), .plugin-edit-panel textarea { width: 100%; box-sizing: border-box; min-height: 44px; padding: 10px 12px; font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 11px; }
.plugin-private-label { display: flex !important; align-items: center; }
.plugin-private-label input { width: 24px; height: 24px; accent-color: var(--accent); }
.plugin-playlist-choice { width: 100%; min-height: 48px; padding: 12px; border: 1px solid var(--line); border-radius: 12px; color: var(--ink); background: var(--surface); text-align: left; margin: 5px 0; font: inherit; }
@media (max-width: 400px) { .plugin-detail { grid-template-columns: minmax(56px, 80px) minmax(0, 1fr); gap: 10px; padding: 10px; } }
.plugin-result-card, .plugin-track-play, .plugin-track-options summary { transition: background-color var(--motion-feedback), transform var(--motion-feedback); }
@media (hover: hover) { .plugin-result-card:hover, .plugin-track-play:hover, .plugin-track-options summary:hover { background: var(--accent-soft); } }
.plugin-result-card:active, .plugin-track-play:active { transform: scale(.98); }
.plugin-track-play:active { background: var(--accent-soft); }
@keyframes plugin-sheet-enter { from { opacity: 0; transform: translateY(22px); } to { opacity: 1; transform: none; } }
html[data-motion='reduced'] .plugin-edit-panel { animation: none; }
.plugin-swipe-peek { min-height:160px; }
.plugin-detail-title { display:flex; align-items:center; justify-content:space-between; gap:4px; }
.plugin-result-item { position:relative; flex:0 0 126px; min-width:0; scroll-snap-align:start; }
</style>
