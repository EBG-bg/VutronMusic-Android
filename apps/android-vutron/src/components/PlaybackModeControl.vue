<script setup lang="ts">
import { useAndroidShellStore } from '../stores/androidShell'
import OriginalIcon from './OriginalIcon.vue'
const store = useAndroidShellStore()
const labels = ['mobile.player.listLoop','mobile.player.singleLoop','mobile.player.shuffle']
</script>
<template><button class="playback-mode-control" type="button" :aria-label="$t('mobile.refinements.playbackOrder') + ': ' + $t(labels[store.playback.mode ?? 0])" :title="$t(labels[store.playback.mode ?? 0])" :data-mode="store.playback.mode ?? 0" :disabled="store.playbackModeBusy" :aria-busy="store.playbackModeBusy" @click="store.cyclePlaybackMode"><OriginalIcon :name="store.playback.mode === 1 ? 'repeatOne' : store.playback.mode === 2 ? 'shuffle' : 'repeat'" /><span aria-live="polite">{{ $t(labels[store.playback.mode ?? 0]) }}</span></button></template>
<style scoped>
.playback-mode-control { display:flex; flex-direction:column; align-items:center; justify-content:center; width:62px; min-height:52px; padding:5px 2px; flex-shrink:0; gap:4px; border-radius:12px; color:var(--accent); background:transparent; }.original-icon { font-size:21px; }.playback-mode-control > span:last-child { max-width:100%; font-size: calc(10px * var(--ui-font-scale, 1)); line-height:1.3; overflow-wrap:anywhere; }
</style>
