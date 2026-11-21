<script setup lang="ts">
import type { VutronTrack } from '../platform/vutronPlugin'
import { useAndroidShellStore } from '../stores/androidShell'
import { buildInfo } from '../platform/buildInfo'
import { formatTime } from '../utils/formatting'
import OriginalIcon from './OriginalIcon.vue'
import PlaybackModeControl from './PlaybackModeControl.vue'
import PlayerVisual from './PlayerVisual.vue'
import PlayerPlaybackStatus from './PlayerPlaybackStatus.vue'
import ThumbRange from './ThumbRange.vue'
import TrackMenuButton from './TrackMenuButton.vue'

const props = defineProps<{ track: VutronTrack; cover: string; speed?: number }>()
const store = useAndroidShellStore()
</script>

<template>
  <section class="page player-page">
    <div class="player-overline">
      <PlayerPlaybackStatus :state="store.playback" />
      <div class="player-quick-controls">
        <button class="icon-button ab-loop-button" :class="{ selected: store.abLoopEnabled }" type="button"><OriginalIcon name="abLoop" /></button>
        <button class="secondary-button playback-tuning-button" type="button">{{ (props.speed ?? store.playback.rate ?? 1).toFixed(2) }}×</button>
      </div>
    </div>
    <PlayerVisual :cover="cover" :remote-cover="track.picUrl" :plugin-id="track.pluginId" :plugin-context="track.pluginSourceContext" />
    <div class="player-title-row">
      <div class="player-title"><h2>{{ track.name }}</h2><p>{{ track.artists?.join(' / ') || store.playback.artist || buildInfo.displayName }}</p></div>
      <TrackMenuButton v-if="track.id > 0" :name="track.name" />
    </div>
    <div class="progress-control">
      <ThumbRange min="0" :max="Math.max(1, store.playback.duration)" :value="store.playback.position" :disabled="!store.playback.duration" />
      <div><span>{{ formatTime(store.playback.position) }}</span><span>{{ formatTime(store.playback.duration) }}</span></div>
    </div>
    <div class="transport-controls">
      <PlaybackModeControl />
      <button class="icon-button transport-small" type="button"><OriginalIcon name="previous" /></button>
      <button class="main-play-button" type="button"><OriginalIcon :name="store.playback.playing || store.playback.loading ? 'pause' : 'play'" /></button>
      <button class="icon-button transport-small" type="button"><OriginalIcon name="next" /></button>
      <button class="icon-button collapse-player" type="button"><OriginalIcon name="down" /></button>
    </div>
  </section>
</template>
