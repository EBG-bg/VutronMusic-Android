<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAndroidShellStore } from '../stores/androidShell'
import { useNavigationIndicator } from '../composables/navigationIndicator'
import type { LibraryMode } from '../composables/navigationPreview'
import OriginalIcon from './OriginalIcon.vue'

const props = defineProps<{ libraryMode: LibraryMode; swiping?: boolean; position?: number }>()
const emit = defineEmits<{ navigate: [mode: LibraryMode] }>()
const store = useAndroidShellStore()
const navigation = ref<HTMLElement>()
const modes = computed<LibraryMode[]>(() => store.onlineAvailable ? ['playlists', 'local', 'offline'] : ['local', 'offline'])
const indicator = useNavigationIndicator(navigation, computed(() => props.position ?? modes.value.indexOf(props.libraryMode)), computed(() => modes.value.length))
</script>

<template>
  <div class="section-heading"><div><h2>{{ $t('nav.library') }}</h2></div></div>
  <p v-if="store.localOnly" class="library-mode-description" role="status">{{ $t(store.manualLocalOnly ? 'mobile.network.manualHint' : !store.networkConnected ? (store.networkReason === 'unreachable' ? 'mobile.network.unreachableHint' : 'mobile.network.automaticHint') : 'mobile.network.guestHint') }} <button v-if="store.manualLocalOnly" class="text-button" type="button" :disabled="store.localModeLoading" @click="store.useAutomaticMode">{{ $t('mobile.network.useAutomatic') }}</button><button v-else-if="!store.networkConnected" class="text-button" type="button" :disabled="store.connectivityRetrying" :aria-busy="store.connectivityRetrying" @click="store.retryConnectivity()">{{ $t(store.connectivityRetrying ? 'mobile.network.checkingConnectivity' : 'mobile.network.retryConnectivity') }}</button></p>
  <p v-if="store.localOnly && !store.manualLocalOnly && !store.networkConnected && store.connectivityError" class="inline-error" role="alert">{{ store.connectivityError }}</p>
  <div class="library-shortcuts">
    <button v-if="store.onlineAvailable" class="shortcut-card favorite-shortcut" type="button" @click="emit('navigate', 'playlists')">
      <span class="shortcut-icon"><OriginalIcon name="library" /></span><span><b>{{ $t('mobile.library.myPlaylists') }}</b><small>{{ $t('mobile.shellUi.playlists', { count: store.playlists.length }) }}</small></span>
    </button>
    <button class="shortcut-card local-shortcut" type="button" @click="emit('navigate', 'local')">
      <span class="shortcut-icon"><OriginalIcon name="local" /></span><span><b>{{ $t('mobile.offline.deviceMusic') }}</b><small>{{ $t('mobile.offline.deviceSummary', { count: store.localTracks.length, playlists: store.localLibrary.playlists.length }) }}</small></span>
    </button>
  </div>
  <div ref="navigation" class="segmented-control navigation-tabs" :data-swiping="swiping ? '' : undefined" role="tablist">
    <span class="navigation-tab-indicator" :style="indicator" aria-hidden="true"></span>
    <button v-if="store.onlineAvailable" type="button" role="tab" :aria-selected="libraryMode === 'playlists'" :class="{ selected: libraryMode === 'playlists' }" @click="emit('navigate', 'playlists')">{{ $t('mobile.offline.onlinePlaylists') }}</button>
    <button type="button" role="tab" :aria-selected="libraryMode === 'local'" :class="{ selected: libraryMode === 'local' }" @click="emit('navigate', 'local')">{{ $t('mobile.offline.deviceMusic') }}</button>
    <button type="button" role="tab" :aria-selected="libraryMode === 'offline'" :class="{ selected: libraryMode === 'offline' }" @click="emit('navigate', 'offline')">{{ $t('mobile.offline.library') }}</button>
  </div>
</template>
