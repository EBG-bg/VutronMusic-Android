<script setup lang="ts">
import FloatingField from './FloatingField.vue'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAndroidShellStore } from '../stores/androidShell'
import OriginalIcon from './OriginalIcon.vue'
import AppSelect from './AppSelect.vue'
import { actionDialog } from '../platform/actionDialog'
import { libraryMutationBusy } from '../platform/libraryActivity'
import { useModalFocus } from '../composables/modalFocus'
import { useModalIsolation } from '../composables/modalIsolation'

const store = useAndroidShellStore(), { t } = useI18n()
const dialog = ref<HTMLElement>(), name = ref(''), description = ref(''), tags = ref(''), privacy = ref(0)
const state = computed(() => store.onlinePlaylistDialog)
const open = () => Boolean(state.value) && store.onlineAvailable
useModalIsolation(dialog, open)
useModalFocus(dialog, { close: () => store.closeOnlinePlaylistDialog(), open, enabled: () => !actionDialog.value })
const disabled = computed(() => store.onlineMutationBusy || store.onlineNeedsRefresh)
const title = computed(() => state.value?.kind === 'create' ? t('mobile.netease.create') : state.value?.kind === 'add' ? t('mobile.netease.addTo') : state.value?.kind === 'more' ? state.value.playlist.name : t('mobile.netease.edit'))
watch(state, value => {
  if (!value) return
  const playlist = 'playlist' in value ? value.playlist : undefined
  name.value = playlist?.name || ''; description.value = playlist?.description || ''; tags.value = playlist?.tags?.join('; ') || ''; privacy.value = playlist?.privacy === 10 ? 10 : 0
}, { immediate: true })
async function save() { await store.saveOnlinePlaylist({ name: name.value, description: description.value, tags: tags.value.split(/[;；,，]/).map(value => value.trim()).filter(Boolean), privacy: Number(privacy.value) }) }
function cachePlaylist() {
  if (state.value?.kind !== 'more') return
  const playlist = state.value.playlist
  store.closeOnlinePlaylistDialog()
  void store.cachePlaylist(playlist)
}
</script>

<template>
  <Teleport to="body"><Transition name="online-dialog">
    <div v-if="state && store.onlineAvailable" class="online-dialog-layer" @click.self="store.closeOnlinePlaylistDialog">
      <section ref="dialog" class="online-playlist-dialog" tabindex="-1" role="dialog" aria-modal="true" :aria-label="title">
        <header><h2>{{ title }}</h2><button class="icon-button" type="button" :aria-label="$t('mobile.common.close')" @click="store.closeOnlinePlaylistDialog"><OriginalIcon name="close" /></button></header>
        <div v-if="state.kind === 'more'" class="online-dialog-actions">
          <button class="secondary-button" type="button" :disabled="libraryMutationBusy || store.cachingPlaylistId !== undefined || store.cachingPluginPlaylist" @click="cachePlaylist"><OriginalIcon name="storage" />{{ $t('mobile.playlistCache.action') }}</button>
          <template v-if="store.canManageOnlinePlaylist(state.playlist)">
            <button class="secondary-button" type="button" :disabled="disabled" @click="store.openEditOnlinePlaylist(state.playlist)">{{ $t('mobile.netease.edit') }}</button>
            <button v-if="state.playlist.specialType !== 5" class="text-button danger-text" type="button" :disabled="disabled" @click="store.deleteOnlinePlaylist(state.playlist)">{{ $t('mobile.netease.delete') }}</button>
          </template>
        </div>
        <div v-else-if="state.kind === 'add'" class="online-playlist-picker">
          <p class="setting-note">{{ state.tracks.length > 1 ? $t('mobile.common.tracks', {count:state.tracks.length}) : state.track.name }}</p>
          <button v-for="playlist in store.ownedPlaylists" :key="playlist.id" class="online-playlist-choice" type="button" :disabled="disabled" @click="store.addTrackToOnlinePlaylist(playlist)"><OriginalIcon name="library" /><span><b>{{ playlist.name }}</b><small>{{ $t('mobile.common.tracks', { count: playlist.trackCount || 0 }) }}</small></span><OriginalIcon name="plus" /></button>
          <p v-if="!store.ownedPlaylists.length" class="setting-note">{{ $t('mobile.netease.emptyOwn') }}</p>
        </div>
        <form v-else @submit.prevent="save">
          <fieldset :disabled="disabled"><FloatingField :label="$t('mobile.netease.name')" :value="name"><input v-model="name" type="text" required maxlength="40" autocomplete="off" /></FloatingField>
            <template v-if="state.kind === 'edit'"><FloatingField :label="$t('mobile.netease.description')" :value="description" multiline><textarea v-model="description" rows="4" maxlength="10000" /></FloatingField><div><FloatingField :label="$t('mobile.netease.tags')" :value="tags"><input v-model="tags" type="text" maxlength="194" :placeholder="$t('mobile.netease.tagsHint')" /></FloatingField></div></template>
            <div v-else class="playlist-visibility"><span>{{ $t('mobile.netease.visibility') }}</span><AppSelect v-model="privacy" :disabled="disabled" :label="$t('mobile.netease.visibility')" :options="[{ value: 0, label: $t('mobile.netease.public') }, { value: 10, label: $t('mobile.netease.private') }]" /></div>
          </fieldset>
          <footer><button class="text-button" type="button" @click="store.closeOnlinePlaylistDialog">{{ $t('mobile.management.cancel') }}</button><button class="primary-button" type="submit" :disabled="disabled || !name.trim()">{{ $t('mobile.netease.save') }}</button></footer>
        </form>
        <p v-if="store.onlineMutationBusy" class="setting-note" role="status">{{ $t('mobile.netease.busy') }}</p>
        <div v-if="store.onlineNeedsRefresh && (state.kind !== 'more' || store.canManageOnlinePlaylist(state.playlist))" class="online-sync-message"><p>{{ store.onlineOperationNotice || $t('mobile.netease.refreshRequired') }}</p><button class="secondary-button" type="button" :disabled="store.onlineMutationBusy" @click="store.refreshOnlineLibrary"><OriginalIcon name="refresh" />{{ $t('mobile.netease.refresh') }}</button></div>
      </section>
    </div>
  </Transition></Teleport>
</template>

<style scoped>
.playlist-visibility { display: grid; gap: 6px; font-size: calc(12px * var(--ui-font-scale, 1)); }
.online-dialog-layer { position: fixed; inset: 0; z-index: 450; display: grid; align-items: center; padding: 16px; background: var(--scrim); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); }
.online-playlist-dialog { width: min(100%, 440px); max-height: calc(100dvh - 40px); overflow: auto; box-sizing: border-box; margin: auto; padding: 18px; border: 1px solid var(--line); border-radius: 22px; background: var(--color-body-bg); color: var(--ink); box-shadow: var(--shadow-float); }
header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-bottom: 10px; margin-bottom: 14px; border-bottom: 1px solid var(--line); }
header .icon-button { flex: 0 0 44px; width: 44px; height: 44px; border-radius: 12px; }
h2 { margin: 0; font-size: calc(17px * var(--ui-font-scale, 1)); font-weight: 700; overflow-wrap: anywhere; }
fieldset { display: grid; gap: 12px; border: 0; padding: 0; margin: 0; min-width: 0; }
footer, .online-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.online-dialog-actions { flex-direction: column; }
.online-playlist-picker { display: grid; gap: 8px; }
.online-playlist-choice { display: flex; align-items: center; gap: 10px; width: 100%; padding: 11px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-card); color: var(--ink); text-align: left; transition: border-color var(--motion-feedback), background-color var(--motion-feedback); }
@media (hover: hover) and (pointer: fine) { .online-playlist-choice:hover { border-color: var(--accent-border); background: var(--accent-soft); } }
.online-playlist-choice span { flex: 1; min-width: 0; }
.online-playlist-choice b, .online-playlist-choice small { display: block; overflow: hidden; text-overflow: ellipsis; }
.online-playlist-choice small { margin-top: 3px; color: var(--muted); font-size: calc(11px * var(--ui-font-scale, 1)); font-variant-numeric: tabular-nums; }
.online-sync-message { margin-top: 12px; padding: 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-card); font-size: calc(12px * var(--ui-font-scale, 1)); line-height: 1.6; }
.online-sync-message button { display: inline-flex; align-items: center; gap: 6px; }
.online-dialog-enter-active { transition:opacity var(--motion-panel) ease; }.online-dialog-leave-active { transition:opacity var(--motion-panel-exit) ease; }.online-dialog-enter-active .online-playlist-dialog { transition:transform var(--motion-panel) cubic-bezier(.2,.75,.25,1); }.online-dialog-leave-active .online-playlist-dialog { transition:transform var(--motion-panel-exit) ease-in-out; }.online-dialog-enter-from,.online-dialog-leave-to { opacity:0; }.online-dialog-enter-from .online-playlist-dialog,.online-dialog-leave-to .online-playlist-dialog { transform:translateY(8px) scale(.98); }
html[data-motion='reduced'] :is(.online-dialog-enter-active,.online-dialog-leave-active,.online-dialog-enter-active .online-playlist-dialog,.online-dialog-leave-active .online-playlist-dialog) { transition:none; }
.online-dialog-actions button { display:flex; align-items:center; justify-content:center; gap:8px; min-height:44px; }
</style>
