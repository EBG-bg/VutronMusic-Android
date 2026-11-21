<script setup lang="ts">
import { useAndroidShellStore } from '../stores/androidShell'
import OriginalIcon from './OriginalIcon.vue'
const store = useAndroidShellStore()
const labels = ['mobile.player.listLoop','mobile.player.singleLoop','mobile.player.shuffle']
</script>
<template><button class="playback-mode-control" type="button" :aria-label="$t('mobile.refinements.playbackOrder') + ': ' + $t(labels[store.playback.mode ?? 0])" :title="$t(labels[store.playback.mode ?? 0])" :data-mode="store.playback.mode ?? 0" :disabled="store.playbackModeBusy" :aria-busy="store.playbackModeBusy" @click="store.cyclePlaybackMode"><OriginalIcon :name="store.playback.mode === 1 ? 'repeatOne' : store.playback.mode === 2 ? 'shuffle' : 'repeat'" /><span aria-hidden="true">{{ $t(labels[store.playback.mode ?? 0]) }}</span></button></template>
<style scoped>
.playback-mode-control { position: relative; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 0; flex-shrink: 0; border: 0; border-radius: 50%; color: var(--muted); background: transparent; cursor: pointer; }
.playback-mode-control:not([data-mode='0']) { color: var(--accent-ink, var(--accent)); }
.original-icon { font-size: 20px; }
.playback-mode-control > span:last-child { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
