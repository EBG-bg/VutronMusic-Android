<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { musicPluginBridge as bridge } from '../plugins/bridge'
import { notifyMusicSourcesChanged } from '../plugins/useMusicSources'
import { declaresPluginMethod, hasPluginMethod, type MusicPlugin } from '../plugins/protocol'
import { actionDialog, askAction } from '../platform/actionDialog'
import { useModalFocus } from '../composables/modalFocus'
import { useModalIsolation } from '../composables/modalIsolation'
import { useSheetDrag } from '../composables/sheetDrag'
import CollapsibleSettingsCard from './CollapsibleSettingsCard.vue'
import OriginalIcon from './OriginalIcon.vue'
import SheetDragHandle from './SheetDragHandle.vue'

const props = defineProps<{ localOnly: boolean }>()
const emit = defineEmits<{ open: [id: string]; back: [] }>()
const { t } = useI18n()
const plugins = ref<MusicPlugin[]>([]), loading = ref(false), busy = ref(false), error = ref('')
const noticeToken=ref(''),notice=computed(()=>noticeToken.value?t('mobile.plugins.'+noticeToken.value):'')
const confirming=ref(false)
const dependencies=(plugin:MusicPlugin)=>plugins.value.filter(row=>row.id!==plugin.id&&row.baseId===plugin.id)
const sourceGroups=computed(()=>[
  {id:'main',title:'sourcesSection',subtitle:'providedSourcesHint',plugins:plugins.value.filter(row=>!['netease','local','demo'].includes(row.baseId||row.id))},
  {id:'compatibility',title:'advancedSourcesTitle',subtitle:'advancedSourcesSubtitle',plugins:plugins.value.filter(row=>['netease','local'].includes(row.baseId||row.id))},
  {id:'development',title:'developmentSourcesTitle',subtitle:'developmentSourcesSubtitle',plugins:plugins.value.filter(row=>(row.baseId||row.id)==='demo')}
])
const selected = ref<MusicPlugin>(), mode = ref<'account' | 'instance' | 'logs'>(), panel = ref<HTMLElement>()
const name = ref(''), baseUrl = ref(''), userName = ref(''), password = ref(''), cookie = ref(''), logs = ref('')
const customKugouApi = ref(false)
const qrImage = ref(''), qrUrl = ref(''), qrStatus = ref('')
type SourceState='localReady'|'needsConfig'|'needsLogin'|'savedLogin'|'ready'|'unverified'|'unavailable'|'disabled'
const checked=ref<Record<string,{scope:string;state:SourceState}>>({}),nextId=ref(''),nextPanel=ref<HTMLElement>()
const nextSource=computed(()=>plugins.value.find(row=>row.id===nextId.value))
const isNetease=(plugin:MusicPlugin)=>plugin.baseId==='netease'||plugin.id==='netease'
const isKugou=(plugin:MusicPlugin)=>(plugin.baseId||plugin.id)==='kugou'
const hasDefaultApi=(plugin:MusicPlugin)=>isNetease(plugin)||isKugou(plugin)
const dialogCaption=computed(()=>t('mobile.plugins.'+(mode.value==='account'&&selected.value&&isKugou(selected.value)?'kugouAccountTitle':mode.value==='account'?'account':mode.value==='instance'?'newInstance':'logs')))
const connectionChanged=computed(()=>customKugouApi.value!==Boolean(selected.value?.baseUrl?.trim())||customKugouApi.value&&baseUrl.value.trim().replace(/\/$/,'')!==(selected.value?.baseUrl||'').trim().replace(/\/$/,''))
const canLogOut=computed(()=>selected.value&&declaresPluginMethod(selected.value,'doLogout')&&(!isKugou(selected.value)||selected.value.status==='login'||['savedLogin','ready'].includes(sourceState(selected.value))))
const canSignIn=(plugin:MusicPlugin)=>declaresPluginMethod(plugin,'doLogin')||declaresPluginMethod(plugin,'loginQrKey')
const canConfigure=(plugin:MusicPlugin)=>canSignIn(plugin)||declaresPluginMethod(plugin,'getAccount')||declaresPluginMethod(plugin,'updateBaseUrl')
function sourceState(plugin:MusicPlugin):SourceState{
  if(!plugin.enabled)return 'disabled'
  if(plugin.type==='local')return 'localReady'
  const fact=checked.value[plugin.id]
  if(fact&&fact.scope===(plugin.accountScope||''))return fact.state
  if(!hasDefaultApi(plugin)&&!plugin.baseUrl?.trim()&&(declaresPluginMethod(plugin,'getAccount')||declaresPluginMethod(plugin,'updateBaseUrl')))return 'needsConfig'
  if(plugin.status==='login')return 'savedLogin'
  if(plugin.status==='offline')return 'unavailable'
  return canSignIn(plugin)?'needsLogin':'unverified'
}
const stateKeys:Record<SourceState,string>={localReady:'statusLocalReady',needsConfig:'statusNeedsConfig',needsLogin:'statusNeedsLogin',savedLogin:'statusSavedLogin',ready:'statusReady',unverified:'statusUnverified',unavailable:'statusUnavailable',disabled:'statusDisabled'}
const hintKeys:Record<SourceState,string>={localReady:'localSourceHint',needsConfig:'needAddressHint',needsLogin:'needLoginHint',savedLogin:'savedLoginHint',ready:'readyHint',unverified:'notCheckedHint',unavailable:'sourceCheckFailed',disabled:'disabledHint'}
function sourceHint(plugin:MusicPlugin){
  if(isNetease(plugin)&&sourceState(plugin)==='savedLogin')return 'neteaseSavedLoginHint'
  if(isKugou(plugin)&&!plugin.baseUrl?.trim()&&sourceState(plugin)==='needsLogin')return 'kugouBuiltInHint'
  return hintKeys[sourceState(plugin)]
}
function mark(plugin:MusicPlugin,state:SourceState){checked.value={...checked.value,[plugin.id]:{scope:plugin.accountScope||'',state}}}
function profileConfirmed(value:unknown){if(!value||typeof value!=='object'||Array.isArray(value))return false;const id=(value as {userId?:unknown}).userId;return typeof id==='number'?Number.isFinite(id)&&id>0:typeof id==='string'&&Boolean(id.trim())&&id.trim()!=='0'}
function resultFailure(response:{code?:number;message?:string},fallback:string){return new Error(response.message||t('mobile.plugins.'+fallback))}
const canNetwork = computed(() => !props.localOnly || selected.value?.type === 'local')
const canExecute=computed(()=>canNetwork.value&&Boolean(selected.value?.enabled))
let generation = 0, timer: ReturnType<typeof setTimeout> | undefined, alive = true
function message(cause: unknown) { return cause instanceof Error ? cause.message : t('mobile.plugins.failed') }
async function refresh() {
  if (loading.value || !alive) return
  loading.value = true; error.value = ''
  try { const result=await bridge.listMusicPlugins();if(alive){plugins.value=result.plugins;if(selected.value)selected.value=result.plugins.find(row=>row.id===selected.value?.id)||selected.value;notifyMusicSourcesChanged(result.plugins)} }
  catch (cause) { error.value = message(cause) }
  finally { loading.value = false }
}
function stopQr() { ++generation; clearTimeout(timer); timer = undefined }
function close() { stopQr(); busy.value=false;mode.value = undefined; selected.value = undefined; password.value = ''; cookie.value = ''; qrImage.value = ''; qrUrl.value = ''; qrStatus.value = ''; error.value = '' }
function handleBack() { if (!mode.value) return false; close(); return true }
defineExpose({ handleBack, refresh })
useModalFocus(panel, { close, enabled: () => Boolean(mode.value) && !actionDialog.value })
useModalIsolation(panel,()=>Boolean(mode.value))
useSheetDrag(panel, { close, enabled: () => Boolean(mode.value) && !actionDialog.value && !busy.value })
async function importPlugin() {
  if (busy.value) return
  if (await askAction({ title: t('mobile.plugins.import'), message: t('mobile.plugins.importHint'), confirmLabel: t('mobile.plugins.chooseFile'), cancelLabel: t('mobile.management.cancel') }) !== 'confirm') return
  busy.value = true; error.value = ''
  try { const result = await bridge.importMusicPlugin(); if (!result.cancelled) { await refresh(); noticeToken.value='imported';nextId.value=result.plugin?.id||'';await nextTick();nextPanel.value?.focus({preventScroll:true});nextPanel.value?.scrollIntoView({block:'nearest'}) } }
  catch (cause) { error.value = message(cause) }
  finally { busy.value = false }
}
async function toggle(plugin: MusicPlugin) {
  if (busy.value || confirming.value || loading.value) return
  busy.value = true; error.value = ''
  try { await bridge.manageMusicPlugin({ action: plugin.enabled ? 'disable' : 'enable', id: plugin.id }); await refresh() }
  catch (cause) { error.value = message(cause) }
  finally { busy.value = false }
}
async function remove(plugin: MusicPlugin) {
  if (busy.value || loading.value || confirming.value) return
  if(!plugin.builtIn&&dependencies(plugin).length){error.value=t('mobile.plugins.removeInstancesFirst');return}
  confirming.value=true
  let answer
  try{answer=await askAction({ title: t(plugin.builtIn?'mobile.plugins.clearData':'mobile.plugins.remove'), message: t(plugin.builtIn?'mobile.plugins.clearDataHint':'mobile.plugins.removeHint', { name: plugin.name }), confirmLabel: t(plugin.builtIn?'mobile.plugins.clearData':'mobile.plugins.remove'), cancelLabel: t('mobile.management.cancel') })}
  finally{confirming.value=false}
  if(answer!=='confirm'||!alive)return
  busy.value = true; error.value = ''
  try { const result=await bridge.manageMusicPlugin({ action: plugin.builtIn?'reset':'remove', id: plugin.id });if(alive&&result.plugins){plugins.value=result.plugins;notifyMusicSourcesChanged(result.plugins)}else await refresh();if(alive){const next={...checked.value};delete next[plugin.id];checked.value=next;noticeToken.value=plugin.builtIn?'dataCleared':'removed';if(!plugin.builtIn){await nextTick();(document.querySelector<HTMLElement>('.plugin-group-main .plugin-manager-list > details > summary')||document.querySelector<HTMLElement>('.plugin-manager-toolbar button'))?.focus({preventScroll:true})}} }
  catch (cause) { error.value = message(cause) }
  finally { busy.value = false }
}
function setupNext(plugin:MusicPlugin){
  if(busy.value||loading.value||confirming.value)return
  if(!plugin.enabled){void toggle(plugin);return}
  if(plugin.type==='local'||sourceState(plugin)==='ready'){emit('open',plugin.id);return}
  if(canConfigure(plugin))void openDialog(plugin,'account')
  else emit('open',plugin.id)
}
function nextLabel(plugin:MusicPlugin){return !plugin.enabled?'enableSource':plugin.type==='local'||sourceState(plugin)==='ready'||!canConfigure(plugin)?'open':'configureLogin'}
async function dismissNext(){const id=nextId.value;nextId.value='';await nextTick();Array.from(document.querySelectorAll<HTMLElement>('[data-settings-section]')).find(row=>row.dataset.settingsSection==='plugin-'+id)?.querySelector<HTMLElement>('summary')?.focus({preventScroll:true})}
async function checkSource(plugin:MusicPlugin){
  if(busy.value||loading.value||confirming.value||props.localOnly||plugin.type==='local'||!hasPluginMethod(plugin,'systemPing'))return
  busy.value=true;error.value='';noticeToken.value='';const owner=plugin.id,scope=plugin.accountScope;let classified=false
  try{
    // The original NetEase systemPing always returns true; it cannot verify a session.
    // Read public configuration only when explicitly requested, retaining any real login proof.
    const netease=isNetease(plugin)
    const response=await bridge.callMusicPlugin({pluginId:owner,accountScope:scope,method:netease?'getAccount':'systemPing',params:{}})
    if(!alive)return
    if(isKugou(plugin)&&response.code===404&&response.status==='logout'){mark(plugin,'needsLogin');noticeToken.value='needLoginHint';return}
    if(response.code!==200){mark(plugin,[301,401,403].includes(response.code)?'needsLogin':'unavailable');classified=true;throw resultFailure(response,'sourceCheckFailed')}
    if(netease){if(!['ready','savedLogin'].includes(sourceState(plugin)))mark(plugin,'unverified');noticeToken.value=sourceState(plugin)==='savedLogin'?'neteaseSavedLoginHint':'checkUnknownHint';return}
    if(response.status==='login'){mark(plugin,'ready');noticeToken.value='readyHint'}
    else if(response.status==='logout'){mark(plugin,'needsLogin');noticeToken.value='needLoginHint'}
    else if(response.status==='offline'){mark(plugin,'unavailable');classified=true;throw resultFailure(response,'sourceCheckFailed')}
    else{mark(plugin,'unverified');noticeToken.value='checkUnknownHint'}
    await refresh()
  }catch(cause){if(alive){if(!classified)mark(plugin,'unavailable');error.value=message(cause)}}
  finally{if(alive)busy.value=false}
}
async function openDialog(plugin: MusicPlugin, nextMode: 'account' | 'instance' | 'logs') {
  close(); selected.value = plugin; mode.value = nextMode; name.value = plugin.name; baseUrl.value = plugin.baseUrl || ''; userName.value = ''
  customKugouApi.value = isKugou(plugin) && Boolean(plugin.baseUrl?.trim())
  if (nextMode === 'logs') {
    const token=generation
    busy.value = true
    try { const result = await bridge.manageMusicPlugin({ action: 'logs', id: plugin.id }); if(token===generation)logs.value = Array.isArray(result.logs) ? result.logs.join('\n') : String(result.logs || '') }
    catch (cause) { if(token===generation)error.value = message(cause) }
    finally { if(token===generation)busy.value = false }
  } else if (nextMode === 'account' && canNetwork.value && hasPluginMethod(plugin, 'getAccount')) {
    const token = generation,initialAddress=baseUrl.value,initialUser=userName.value
    try {
      const result = await bridge.callMusicPlugin({ pluginId: plugin.id, accountScope:plugin.accountScope,method: 'getAccount', params: {} })
      if(token!==generation||!alive)return
      if(result.code!==200){if([301,401,403].includes(result.code))mark(plugin,'needsLogin');throw resultFailure(result,'sourceCheckFailed')}
      if (token === generation && mode.value === 'account') { if(baseUrl.value===initialAddress)baseUrl.value = String(result.baseUrl || baseUrl.value);if(userName.value===initialUser)userName.value = String(result.userName || '') }
    } catch (cause) { if (token === generation) error.value = message(cause) }
  }
}
async function saveAddress() {
  if (!selected.value) return
  const plugin = selected.value,previous=(plugin.baseUrl||'').trim().replace(/\/$/,'')
  if(isKugou(plugin)) {
    const next = customKugouApi.value ? baseUrl.value.trim().replace(/\/$/,'') : ''
    if(customKugouApi.value&&!next)throw new Error(t('mobile.plugins.credentialsRequired'))
    if(next) {
      let parsed:URL
      try { parsed=new URL(next) } catch { throw new Error(t('mobile.plugins.invalidAddress')) }
      if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.hash)throw new Error(t('mobile.plugins.invalidAddress'))
      if(['open.kugou.com','www.kugou.com','kugou.com'].includes(parsed.hostname.toLowerCase()))throw new Error(t('mobile.plugins.kugouApiHint'))
    }
    if(next!==previous) {
      await bridge.manageMusicPlugin({action:'configure',id:plugin.id,baseUrl:next})
      await refresh()
      if(selected.value?.id===plugin.id)mark(selected.value,'needsLogin')
    }
    return selected.value
  }
  if(!baseUrl.value.trim()&&!isNetease(plugin)&&(declaresPluginMethod(plugin,'getAccount')||declaresPluginMethod(plugin,'updateBaseUrl')))throw new Error(t('mobile.plugins.credentialsRequired'))
  if (baseUrl.value.trim()) {
    const parsed = new URL(baseUrl.value.trim())
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(t('mobile.plugins.invalidAddress'))
    if(canExecute.value&&hasPluginMethod(plugin,'updateBaseUrl')) {
    const response = await bridge.callMusicPlugin({ pluginId: plugin.id, accountScope:plugin.accountScope,method: 'updateBaseUrl', params: { url: baseUrl.value.trim() } })
      if (response.code !== 200) throw new Error(response.message || t('mobile.plugins.failed'))
    }
    await bridge.manageMusicPlugin({ action: 'configure', id: plugin.id, baseUrl: baseUrl.value.trim() })
    await refresh()
    if(selected.value?.id===plugin.id)selected.value=plugins.value.find(row=>row.id===plugin.id)||selected.value
    if(selected.value?.id===plugin.id&&previous!==baseUrl.value.trim().replace(/\/$/,''))mark(selected.value,canSignIn(selected.value)?'needsLogin':'unverified')
  }
  return selected.value
}
async function submit(login: boolean) {
  if (!selected.value || busy.value) return
  busy.value = true; error.value = '';noticeToken.value=''
  const token=generation,plugin=selected.value,params={userName:userName.value.trim(),pwd:password.value,cookie:cookie.value.trim()}
  try {
    if (mode.value === 'instance') { await bridge.manageMusicPlugin({ action: 'instance', id: plugin.id, name: name.value.trim() }); if(token!==generation)return;await refresh();if(token===generation)close();return }
    if (login&&!canNetwork.value) throw new Error(t('mobile.plugins.offline'))
    if(login&&!canExecute.value)throw new Error(t('mobile.plugins.enableBeforeLogin'))
    const updated=await saveAddress()
    if(token!==generation)return
    if (login && hasPluginMethod(plugin,'doLogin')) {
      const response = await bridge.callMusicPlugin({ pluginId: plugin.id, accountScope:updated?.accountScope||plugin.accountScope,method: 'doLogin', params })
      if(token!==generation)return
      if (response.code !== 200){mark(updated||plugin,[301,401,403].includes(response.code)?'needsLogin':'unavailable');throw resultFailure(response,'loginFailed')}
      await refresh()
      if(token!==generation)return
      const current=plugins.value.find(row=>row.id===plugin.id)||updated||plugin
      if(selected.value?.id===plugin.id)selected.value=current
      if(!profileConfirmed(response.data)){mark(current,'unverified');throw new Error(t('mobile.plugins.checkUnknownHint'))}
      mark(current,'ready')
      noticeToken.value='loggedIn'
    } else noticeToken.value=isKugou(plugin)?'connectionSaved':'saved'
    await refresh();if(token===generation)close()
  } catch (cause) { if(token===generation)error.value = message(cause) }
  finally { if(token===generation)busy.value = false }
}
async function logout() {
  if (!selected.value || busy.value || !canExecute.value) return
  busy.value = true; error.value = ''
  const token=generation
  const plugin=selected.value
  try { const response=await bridge.callMusicPlugin({ pluginId: plugin.id, accountScope:plugin.accountScope,method: 'doLogout', params: {} });if(token!==generation)return;if(response.code!==200){if([301,401,403].includes(response.code))mark(plugin,'needsLogin');throw resultFailure(response,'logoutFailed')}await refresh();if(token===generation){const current=plugins.value.find(row=>row.id===plugin.id)||plugin;mark(current,'needsLogin');noticeToken.value='status_logout';close()} }
  catch (cause) { if(token===generation)error.value = message(cause) }
  finally { if(token===generation)busy.value = false }
}
async function createQr() {
  if (!selected.value || busy.value || !canExecute.value) return
  stopQr(); const token = generation, pluginId = selected.value.id
  busy.value = true; error.value = ''; qrImage.value = ''; qrStatus.value = ''
  try {
    const updated=await saveAddress(),accountScope=updated?.accountScope
    if(token!==generation||!alive)return
    const response = await bridge.callMusicPlugin({ pluginId, accountScope,method: 'loginQrKey', params: {} })
    const data = response.data as { url?: string; qrcode?: string } | undefined
    if (response.code !== 200 || !data?.url || !data.qrcode) throw new Error(response.message || t('mobile.plugins.qrFailed'))
    if (token !== generation || !alive) return
    qrUrl.value = data.url
    if (bridge.renderMusicPluginQr) {
      const image = await bridge.renderMusicPluginQr({ url: data.url })
      if (token === generation) qrImage.value = image.imageData
    }
    const poll = async () => {
      if (!alive || token !== generation || !mode.value || !canNetwork.value) return
      if (document.visibilityState === 'hidden') { timer = setTimeout(poll, 2000); return }
      try {
        const check = await bridge.callMusicPlugin({ pluginId, accountScope,method: 'loginQrCodeCheck', params: { key: data.qrcode, qrcode: data.qrcode } })
        if (token !== generation) return
        qrStatus.value = String(check.message || t('mobile.plugins.qrWaiting'))
        if (check.code === 803) { await refresh();if(token!==generation||!alive)return;const current=plugins.value.find(row=>row.id===pluginId)||updated;if(current)mark(current,'ready');noticeToken.value='loggedIn'; close(); return }
        if (check.code === 800) { qrStatus.value = t('mobile.plugins.qrExpired'); return }
        if(check.code!==801&&check.code!==802){if(updated)mark(updated,[301,401,403].includes(check.code)?'needsLogin':'unverified');throw resultFailure(check,'loginFailed')}
        timer = setTimeout(poll, 2000)
      } catch (cause) { if (token === generation) error.value = message(cause) }
    }
    timer = setTimeout(poll, 1000)
  } catch (cause) { if (token === generation) error.value = message(cause) }
  finally { if(token===generation)busy.value = false }
}
onMounted(refresh)
onUnmounted(() => { alive = false; stopQr(); password.value = ''; cookie.value = '' })
</script>
<template>
  <section class="page plugin-manager-page">
    <div class="section-heading"><div><h2>{{ $t('mobile.plugins.title') }}</h2><p class="setting-note">{{ $t('mobile.plugins.description') }}</p></div><button type="button" class="icon-button plugin-header-back" :aria-label="$t('mobile.common.back')" @click="emit('back')"><OriginalIcon name="back" /></button></div>
    <div class="plugin-manager-toolbar"><button type="button" class="secondary-button" :disabled="busy" @click="importPlugin"><OriginalIcon name="plus" />{{ $t('mobile.plugins.import') }}</button><button type="button" class="text-button" :disabled="loading || busy" @click="refresh"><OriginalIcon name="refresh" />{{ $t('mobile.plugins.refresh') }}</button></div>
    <CollapsibleSettingsCard section-id="plugin-guide" :title="$t('mobile.plugins.managerGuideTitle')" :subtitle="$t('mobile.plugins.managerGuideSubtitle')" :remember="false"><p class="setting-note">{{ $t('mobile.plugins.guideCatalog') }}</p><p class="setting-note">{{ $t('mobile.plugins.guideLifecycle') }}</p><p class="setting-note">{{ $t('mobile.plugins.guideNetease') }}</p></CollapsibleSettingsCard>
    <p class="setting-note plugin-main-entry-hint">{{ $t('mobile.plugins.mainEntriesHint') }}</p>
    <p v-if="localOnly" class="setting-note">{{ $t('mobile.plugins.offline') }}</p>
    <p v-if="error && !mode" class="inline-error" role="alert">{{ error }}</p><p v-if="notice" class="setting-note" role="status">{{ notice }}</p>
    <section v-if="nextSource" ref="nextPanel" class="settings-card plugin-next-steps" tabindex="-1" aria-labelledby="plugin-next-title"><header><h3 id="plugin-next-title">{{ $t('mobile.plugins.addedName',{name:nextSource.name}) }}</h3><button type="button" class="icon-button" :aria-label="$t('mobile.common.close')" @click="dismissNext"><OriginalIcon name="close" /></button></header><p class="setting-note">{{ $t('mobile.plugins.nextStepHint') }}</p><p class="setting-note">{{ $t('mobile.plugins.'+sourceHint(nextSource)) }}</p><div class="plugin-actions"><button type="button" class="secondary-button" :disabled="busy||loading||confirming||localOnly&&nextSource.type!=='local'&&nextSource.enabled" @click="setupNext(nextSource)"><OriginalIcon :name="nextSource.type==='local'||sourceState(nextSource)==='ready'?'library':'settings'" />{{ $t('mobile.plugins.'+nextLabel(nextSource)) }}</button></div></section>
    <p v-if="loading && !plugins.length" class="setting-note">{{ $t('mobile.plugins.loading') }}</p>
    <component :is="group.id==='main'?'section':CollapsibleSettingsCard" v-for="group in sourceGroups" :key="group.id" class="plugin-source-group" :class="'plugin-group-'+group.id" :section-id="'plugin-group-'+group.id" :title="group.id==='main'?undefined:$t('mobile.plugins.'+group.title)" :subtitle="$t('mobile.plugins.'+group.subtitle)" :remember="false">
      <h3 v-if="group.id==='main'" class="plugin-group-heading">{{ $t('mobile.plugins.'+group.title) }} <small>{{ group.plugins.length }}</small></h3>
      <p v-if="group.id==='main'" class="setting-note">{{ $t('mobile.plugins.'+group.subtitle) }}</p>
      <p v-else class="setting-note">{{ $t('mobile.plugins.'+(group.id==='compatibility'?'advancedSourcesHint':'developmentSourcesHint')) }}</p>
      <TransitionGroup name="plugin-lifecycle" tag="div" class="plugin-manager-list">
        <CollapsibleSettingsCard v-for="plugin in group.plugins" :key="plugin.id" :section-id="'plugin-' + plugin.id" :title="plugin.name" :remember="false">
          <template #heading><span class="settings-icon violet"><OriginalIcon name="explore" /></span><div><h3>{{ plugin.name }}</h3><p>{{ $t('mobile.plugins.' + plugin.type) }} · {{ $t(plugin.builtIn ? 'mobile.plugins.provided' : 'mobile.plugins.importedType') }}</p><p class="plugin-source-state" :data-source-state="sourceState(plugin)">{{ $t('mobile.plugins.'+stateKeys[sourceState(plugin)]) }}</p><p v-if="plugin.baseUrl">{{ plugin.baseUrl }}</p></div></template>
          <p class="setting-note">{{ $t('mobile.plugins.'+sourceHint(plugin)) }}</p>
          <div class="settings-detail"><span>{{ $t('mobile.plugins.enabled') }}</span><button class="switch" type="button" role="switch" :aria-label="$t('mobile.plugins.enableName', { name: plugin.name })" :aria-checked="plugin.enabled" :class="{ on: plugin.enabled }" :disabled="busy||confirming||loading" @click="toggle(plugin)"><i /></button></div>
          <div class="plugin-actions"><button type="button" class="secondary-button plugin-open" :disabled="!plugin.enabled || busy || confirming || localOnly && plugin.type !== 'local'" @click="emit('open', plugin.id)"><OriginalIcon name="library" />{{ $t('mobile.plugins.open') }}</button><div class="plugin-secondary-actions"><button v-if="canConfigure(plugin)" type="button" class="text-button plugin-configure" :disabled="busy || confirming" @click="openDialog(plugin, 'account')"><OriginalIcon name="settings" />{{ $t('mobile.plugins.account') }}</button><button type="button" class="text-button" :disabled="busy||confirming" @click="openDialog(plugin, 'instance')"><OriginalIcon name="plus" />{{ $t('mobile.plugins.newInstance') }}</button><button type="button" class="text-button" :disabled="busy||confirming" @click="openDialog(plugin, 'logs')"><OriginalIcon name="list" />{{ $t('mobile.plugins.logs') }}</button><button type="button" class="text-button danger-text" :disabled="busy||confirming||!plugin.builtIn&&Boolean(dependencies(plugin).length)" @click="remove(plugin)">{{ $t(plugin.builtIn?'mobile.plugins.clearData':'mobile.plugins.remove') }}</button></div></div>
          <button v-if="declaresPluginMethod(plugin,'systemPing')" type="button" class="text-button plugin-check-status" :disabled="!plugin.enabled||busy||loading||confirming||localOnly||sourceState(plugin)==='needsConfig'" @click="checkSource(plugin)"><OriginalIcon name="refresh" />{{ $t('mobile.plugins.checkSource') }}</button>
          <p v-if="!plugin.builtIn&&dependencies(plugin).length" class="setting-note plugin-dependency-note">{{ $t('mobile.plugins.removeInstancesFirst') }}</p>
          <p class="setting-note">{{ $t('mobile.plugins.methodCount', { count: plugin.methods.filter(method=>declaresPluginMethod(plugin,method)).length }) }}</p>
        </CollapsibleSettingsCard>
      </TransitionGroup>
    </component>
    <Teleport to="body"><div v-if="mode" class="plugin-dialog-layer" :inert="Boolean(actionDialog)" @click.self="!busy && close()"><section ref="panel" class="plugin-dialog" role="dialog" aria-modal="true" :aria-label="selected?.name" tabindex="-1"><SheetDragHandle @close="!busy && close()" /><header><h3>{{ selected?.name }} · {{ dialogCaption }}</h3><button type="button" class="icon-button" :aria-label="$t('mobile.common.close')" @click="close"><OriginalIcon name="close" /></button></header>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      <pre v-if="mode === 'logs'" class="plugin-log">{{ logs || $t('mobile.plugins.noLogs') }}</pre>
      <form v-else @submit.prevent="mode==='account'&&selected&&isKugou(selected)?createQr():submit(mode === 'account')">
        <label v-if="mode === 'instance'">{{ $t('mobile.plugins.instanceName') }}<input v-model="name" required maxlength="80" autocomplete="off" /></label>
        <template v-else>
          <p v-if="!canNetwork" class="setting-note">{{ $t('mobile.plugins.offline') }}</p>
          <p v-if="selected&&!selected.enabled" class="setting-note plugin-disabled-config">{{ $t('mobile.plugins.disabledConfigHint') }}</p>
          <p v-if="selected&&isNetease(selected)" class="setting-note">{{ $t('mobile.plugins.neteaseBuiltInApiHint') }}</p>
          <p v-if="selected&&isNetease(selected)" class="setting-note">{{ $t('mobile.plugins.guideNetease') }}</p>
          <template v-if="selected&&isKugou(selected)">
            <p class="plugin-connection-intro">{{ $t(customKugouApi ? 'mobile.plugins.kugouCustomHint' : 'mobile.plugins.kugouBuiltInHint') }}</p>
          </template>
          <template v-else><label>{{ $t('mobile.plugins.server') }}<input v-model="baseUrl" type="url" inputmode="url" autocomplete="url" placeholder="https://" :disabled="busy" /></label><p class="setting-note">{{ $t('mobile.plugins.serverHint') }}</p></template>
          <template v-if="selected&&!isNetease(selected)&&!isKugou(selected)&&declaresPluginMethod(selected,'doLogin')"><label>{{ $t('mobile.plugins.username') }}<input v-model="userName" autocomplete="username" :disabled="busy || !canExecute" /></label><label>{{ $t('mobile.plugins.password') }}<input v-model="password" type="password" autocomplete="current-password" :disabled="busy || !canExecute" /></label></template>
          <details v-if="selected?.type === 'library'&&!isKugou(selected)&&declaresPluginMethod(selected,'doLogin')" class="plugin-cookie"><summary>{{ $t('mobile.plugins.cookie') }}</summary><textarea v-model="cookie" rows="3" autocomplete="off" spellcheck="false" :aria-label="$t('mobile.plugins.cookie')" :disabled="busy || !canExecute" /></details>
          <div v-if="declaresPluginMethod(selected, 'loginQrKey')" class="plugin-qr"><button type="button" class="secondary-button" :disabled="busy || !canExecute" @click="createQr">{{ $t('mobile.plugins.qrLogin') }}</button><img v-if="qrImage" :src="qrImage" :alt="$t('mobile.plugins.qrLogin')" /><p v-if="qrUrl && !qrImage" class="setting-note">{{ qrUrl }}</p><p v-if="qrStatus" role="status">{{ qrStatus }}</p></div>
          <CollapsibleSettingsCard v-if="selected&&isKugou(selected)" section-id="plugin-connection" class="plugin-connection-settings" :title="$t('mobile.plugins.advancedConnection')" :remember="false" :initially-open="Boolean(selected.baseUrl?.trim())">
            <template #heading><span>{{ $t('mobile.plugins.advancedConnection') }}</span></template>
            <label class="checkbox-row"><input v-model="customKugouApi" type="checkbox" :disabled="busy" />{{ $t('mobile.plugins.useCustomApi') }}</label>
            <template v-if="customKugouApi"><label>{{ $t('mobile.plugins.server') }}<input v-model="baseUrl" type="url" inputmode="url" autocomplete="url" placeholder="https://" :disabled="busy" /></label><p class="setting-note">{{ $t('mobile.plugins.kugouApiHint') }}</p></template>
          </CollapsibleSettingsCard>
        </template>
        <div class="plugin-actions"><button v-if="mode==='instance'||selected&&!isKugou(selected)&&declaresPluginMethod(selected,'doLogin')" type="submit" class="secondary-button" :disabled="busy || mode === 'account' && !canExecute">{{ $t(mode === 'account' ? 'mobile.plugins.login' : 'mobile.plugins.create') }}</button><button v-if="mode === 'account'&&(!selected||!isKugou(selected)||connectionChanged)" type="button" class="text-button" :disabled="busy" @click="submit(false)">{{ $t(selected&&isKugou(selected)?'mobile.plugins.saveConnection':'mobile.plugins.saveAddress') }}</button><button v-if="mode === 'account' && canLogOut" type="button" class="text-button" :disabled="busy || !canExecute" @click="logout">{{ $t('mobile.plugins.logout') }}</button></div>
      </form>
    </section></div></Teleport>
  </section>
</template>
<style scoped>
.plugin-manager-page, .plugin-dialog { --source-accent-ink: color-mix(in srgb, var(--accent) 45%, var(--ink)); --source-muted: color-mix(in srgb, var(--muted) 75%, var(--ink)); }
.plugin-manager-page > .section-heading { align-items: flex-start; gap: 14px; margin-bottom: 14px; }
.plugin-manager-page > .section-heading h2 { font-size: calc(23px * var(--ui-font-scale, 1)); letter-spacing: -.025em; }
.plugin-manager-page > .section-heading .setting-note { margin: 9px 0 0; max-width: 48ch; }
.plugin-manager-page .setting-note { color: var(--source-muted); line-height: 1.65; }
.plugin-header-back { flex: 0 0 44px; width: 44px; height: 44px; min-width: 44px; min-height: 44px; border: 1px solid var(--line); border-radius: 50%; background: var(--color-body-bg); box-shadow: none; }
.plugin-manager-toolbar, .plugin-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.plugin-manager-toolbar { margin: 0 0 18px; }
.plugin-manager-toolbar button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; }
.plugin-manager-toolbar .secondary-button { padding: 10px 15px; border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--line)); border-radius: 12px; color: var(--source-accent-ink); background: var(--accent-soft); font-weight: 700; }
.plugin-manager-toolbar .text-button { color: var(--source-muted); }
.plugin-main-entry-hint { margin: 12px 0 20px; padding: 10px 13px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); box-shadow: none; }
.plugin-disabled-config { padding: 11px 13px; border: 1px solid var(--line); border-radius: 12px; color: var(--source-muted); background: var(--surface); box-shadow: none; }
.plugin-source-group { margin: 22px 0; }
.plugin-group-heading { display: flex; align-items: center; gap: 9px; margin: 0 2px 6px; color: var(--ink); font-size: calc(16px * var(--ui-font-scale, 1)); font-weight: 700; }
.plugin-group-heading small { display: inline-grid; place-items: center; min-width: 24px; min-height: 24px; padding: 2px 7px; border-radius: 999px; color: var(--source-muted); background: var(--surface); font-size: calc(11px * var(--ui-font-scale, 1)); font-weight: 600; }
.plugin-source-group > .setting-note { margin: 0 2px 12px; }
.plugin-manager-list { display: grid; gap: 11px; }
.plugin-manager-list :deep(.settings-collapse) { padding: 14px; border: 1px solid var(--line); border-radius: 18px; box-shadow: 0 2px 6px rgb(0 0 0 / 3%); }
.plugin-manager-list :deep(.settings-collapse > summary) { min-height: 52px; align-items: flex-start; }
.plugin-manager-list :deep(.settings-title) { align-items: flex-start; gap: 11px; }
.plugin-manager-list :deep(.settings-title h3) { font-size: calc(14px * var(--ui-font-scale, 1)); line-height: 1.4; font-weight: 700; }
.plugin-manager-list :deep(.settings-title p) { color: var(--source-muted); overflow-wrap: anywhere; }
.plugin-manager-list :deep(.settings-icon) { flex: 0 0 36px; width: 36px; height: 36px; margin-top: 2px; border-radius: 12px; color: var(--source-accent-ink); background: var(--accent-soft); }
.plugin-manager-list :deep(.settings-chevron) { margin-top: 10px; }
.plugin-manager-list :deep(.settings-collapse-inner) { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); }
.plugin-manager-list :deep(.settings-title .plugin-source-state) { display: inline-flex; max-width: 100%; margin: 7px 0 0; padding: 3px 8px; border: 1px solid var(--line); border-radius: 999px; color: var(--source-muted); background: var(--surface); font-size: calc(11px * var(--ui-font-scale, 1)); line-height: 1.5; font-weight: 600; overflow-wrap: anywhere; }
.plugin-manager-list :deep(.plugin-source-state[data-source-state='localReady']), .plugin-manager-list :deep(.plugin-source-state[data-source-state='ready']), .plugin-manager-list :deep(.plugin-source-state[data-source-state='needsLogin']), .plugin-manager-list :deep(.plugin-source-state[data-source-state='savedLogin']), .plugin-manager-list :deep(.plugin-source-state[data-source-state='unverified']) { color: var(--source-accent-ink); border-color: color-mix(in srgb, var(--accent) 30%, var(--line)); background: var(--accent-soft); }
.plugin-manager-list :deep(.plugin-source-state[data-source-state='unavailable']) { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 30%, var(--line)); background: color-mix(in srgb, var(--danger) 7%, var(--color-body-bg)); }
.plugin-actions { margin-top: 12px; }
.plugin-actions button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 44px; padding: 10px 12px; line-height: 1.5; }
.plugin-manager-list .plugin-actions { display: grid; gap: 9px; }
.plugin-manager-list .plugin-open { width: 100%; border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--line)); border-radius: 12px; color: var(--source-accent-ink); background: var(--accent-soft); font-weight: 700; }
.plugin-secondary-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.plugin-secondary-actions > :last-child:nth-child(odd) { grid-column: 1 / -1; }
.plugin-secondary-actions button { min-width: 0; border: 1px solid transparent; border-radius: 10px; color: var(--ink); background: var(--surface); white-space: normal; overflow-wrap: anywhere; text-align: center; font-size: calc(12px * var(--ui-font-scale, 1)); }
.plugin-secondary-actions .danger-text { color: var(--danger); border-color: var(--line); background: transparent; }
.plugin-secondary-actions .original-icon { flex: 0 0 18px; font-size: 18px; }
.plugin-check-status { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; margin-top: 8px; padding-inline: 2px; color: var(--source-muted); white-space: normal; text-align: start; }
.plugin-next-steps { margin: 16px 0; border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line)); border-radius: 18px; background: var(--accent-soft); box-shadow: none; overflow-wrap: anywhere; }
.plugin-next-steps > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.plugin-next-steps h3 { min-width: 0; margin: 0; font-size: calc(16px * var(--ui-font-scale, 1)); line-height: 1.5; }
.plugin-next-steps > header > .icon-button { flex-shrink: 0; background: transparent; box-shadow: none; }
.plugin-next-steps:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.plugin-next-steps .plugin-actions > button { min-width: 0; color: var(--source-accent-ink); border-color: color-mix(in srgb, var(--accent) 30%, var(--line)); background: var(--color-body-bg); white-space: normal; text-align: start; }
.plugin-lifecycle-enter-active, .plugin-lifecycle-leave-active, .plugin-lifecycle-move { transition: opacity var(--motion-state), transform var(--motion-state); }
.plugin-lifecycle-enter-from, .plugin-lifecycle-leave-to { opacity: 0; transform: translateY(6px); }
.plugin-dialog-layer { position: fixed; inset: 0; z-index: 145; display: flex; align-items: flex-end; justify-content: center; padding-top: max(12px, env(safe-area-inset-top)); background: rgb(0 0 0 / 38%); }
.plugin-dialog { width: min(100%, 620px); min-width: 0; max-height: 92dvh; overflow: auto; overscroll-behavior: contain; padding: 12px max(18px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left)); border: 1px solid var(--line); border-bottom: 0; border-radius: 24px 24px 0 0; color: var(--ink); background: var(--color-body-bg); box-shadow: 0 -8px 32px rgb(0 0 0 / 15%); animation: plugin-dialog-enter var(--motion-panel) ease both; }
.plugin-dialog header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 7px 0 14px; border-bottom: 1px solid var(--line); }
.plugin-dialog h3 { min-width: 0; margin: 5px 0 0; font-size: calc(18px * var(--ui-font-scale, 1)); line-height: 1.4; font-weight: 700; overflow-wrap: anywhere; }
.plugin-dialog header > .icon-button { flex: 0 0 44px; width: 44px; height: 44px; background: var(--surface); box-shadow: none; }
.plugin-dialog label { display: grid; gap: 7px; margin: 15px 0; font-size: calc(13px * var(--ui-font-scale, 1)); line-height: 1.55; }
.plugin-dialog input:not([type='checkbox']), .plugin-dialog textarea { box-sizing: border-box; min-width: 0; width: 100%; min-height: 46px; padding: 11px 12px; border: 1px solid var(--line); border-radius: 12px; color: var(--ink); background: var(--surface); font: inherit; font-size: calc(14px * var(--ui-font-scale, 1)); transition: border-color var(--motion-feedback), background-color var(--motion-feedback); }
.plugin-dialog input:not([type='checkbox']):focus-visible, .plugin-dialog textarea:focus-visible { border-color: var(--accent); }
.plugin-dialog form > .plugin-actions { margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--line); }
.plugin-dialog form > .plugin-actions > button { flex: 1 1 auto; min-width: 0; white-space: normal; overflow-wrap: anywhere; }
.plugin-dialog .setting-note { color: var(--source-muted); font-size: calc(12px * var(--ui-font-scale, 1)); line-height: 1.65; overflow-wrap: anywhere; }
.plugin-connection-intro { margin: 16px 0; padding: 13px 14px; border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--line)); border-radius: 16px; color: var(--source-accent-ink); background: var(--accent-soft); font-size: calc(13px * var(--ui-font-scale, 1)); line-height: 1.65; }
.plugin-dialog .plugin-connection-intro .setting-note { margin: 5px 0 0; color: var(--source-muted); }
.plugin-connection-settings { margin: 16px 0; padding: 0; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); box-shadow: none; }
.plugin-connection-settings :deep(> summary) { min-height: 48px; padding: 12px 13px; border-radius: 14px; color: var(--source-muted); font-size: calc(13px * var(--ui-font-scale, 1)); font-weight: 600; line-height: 1.55; }
.plugin-connection-settings :deep(> summary[aria-expanded='true']) { color: var(--ink); }
.plugin-connection-settings :deep(.settings-title) { min-width: 0; }
.plugin-connection-settings :deep(.settings-chevron) { font-size: 14px; }
.plugin-connection-settings :deep(.settings-collapse-inner) { margin: 0 13px; padding: 0 0 8px; }
.plugin-connection-settings .checkbox-row { display: flex; align-items: flex-start; gap: 10px; min-height: 44px; padding: 3px 0; }
.plugin-connection-settings .checkbox-row input[type='checkbox'] { flex: 0 0 22px; width: 22px; height: 22px; min-width: 22px; min-height: 22px; margin: 2px 0; padding: 0; }
.plugin-cookie { margin: 16px 0; border-top: 1px solid var(--line); }
.plugin-cookie summary { min-height: 44px; padding: 11px 2px; border-radius: 10px; color: var(--source-muted); font-size: calc(13px * var(--ui-font-scale, 1)); line-height: 1.55; cursor: pointer; }
.plugin-qr { display: grid; justify-items: center; gap: 12px; margin: 18px 0; }
.plugin-qr > .secondary-button { width: 100%; min-height: 46px; padding: 11px 16px; border: 1px solid transparent; border-radius: 12px; color: var(--color-body-bg); background: var(--source-accent-ink); font-size: calc(14px * var(--ui-font-scale, 1)); line-height: 1.55; font-weight: 700; white-space: normal; }
.plugin-qr img { width: min(236px, 70vw); height: auto; padding: 12px; border: 1px solid var(--line); border-radius: 18px; background: white; }
.plugin-qr > p { max-width: 100%; margin: 0; font-size: calc(12px * var(--ui-font-scale, 1)); line-height: 1.6; overflow-wrap: anywhere; text-align: center; }
.plugin-log { white-space: pre-wrap; overflow-wrap: anywhere; font-size: calc(12px * var(--ui-font-scale, 1)); line-height: 1.6; user-select: text; }
@media (hover: hover) { .plugin-open:enabled:hover, .plugin-manager-toolbar .secondary-button:enabled:hover { border-color: var(--accent); } .plugin-secondary-actions button:enabled:hover { border-color: var(--line); background: var(--accent-soft); } .plugin-dialog header > .icon-button:hover, .plugin-connection-settings :deep(> summary:hover) { background: var(--accent-soft); } }
@keyframes plugin-dialog-enter { from { opacity: 0; transform: translateY(22px); } to { opacity: 1; transform: none; } }
html[data-motion='reduced'] .plugin-dialog { animation: none; }
html[data-motion='reduced'] .plugin-lifecycle-enter-active, html[data-motion='reduced'] .plugin-lifecycle-leave-active, html[data-motion='reduced'] .plugin-lifecycle-move { transition: none; }
html[data-motion='reduced'] .plugin-lifecycle-enter-from, html[data-motion='reduced'] .plugin-lifecycle-leave-to { transform: none; }
</style>
