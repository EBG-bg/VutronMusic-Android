<script setup lang="ts">
import { playlistView, playlistColumns } from '../platform/libraryLayout'
import OriginalIcon from './OriginalIcon.vue'
import AppSelect from './AppSelect.vue'
const columns = [1, 2, 3, 4, 5, 6]
</script>
<template>
  <div class="library-layout-controls" role="group" :aria-label="$t('mobile.refinements.layout')">
    <button type="button" :aria-pressed="playlistView === 'cards'" :class="{ selected: playlistView === 'cards' }" @click="playlistView = 'cards'"><OriginalIcon name="library" /><span>{{ $t('mobile.refinements.cards') }}</span></button>
    <button type="button" :aria-pressed="playlistView === 'list'" :class="{ selected: playlistView === 'list' }" @click="playlistView = 'list'"><OriginalIcon name="list" /><span>{{ $t('mobile.refinements.list') }}</span></button>
    <Transition name="layout-count"><div v-if="playlistView === 'cards'" class="layout-count-control"><span>{{ $t('mobile.refinements.columns') }}</span><AppSelect v-model="playlistColumns" :label="$t('mobile.refinements.columns')" :options="columns.map(value => ({ value, label: String(value) }))" /></div></Transition>
  </div>
</template>

<style scoped>
.library-layout-controls > button { transition: background-color 125ms ease-out, color 125ms ease-out, transform .2s ease; }
.layout-count-enter-active, .layout-count-leave-active { transition: opacity 125ms ease-out, transform 125ms ease-out; }
.layout-count-enter-from, .layout-count-leave-to { opacity: 0; transform: translateX(8px); }
html[data-motion="reduced"] .library-layout-controls > button, html[data-motion="reduced"] .layout-count-enter-active, html[data-motion="reduced"] .layout-count-leave-active { transition: none; }
</style>
