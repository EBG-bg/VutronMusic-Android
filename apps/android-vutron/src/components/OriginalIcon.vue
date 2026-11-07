<script setup lang="ts">
import { computed } from 'vue'
import logo from '../assets/icons/original-logo.svg?url'
import library from '../../../../src/renderer/assets/icons/library.svg?url'
import search from '../../../../src/renderer/assets/icons/search.svg?url'
import settings from '../../../../src/renderer/assets/icons/settings.svg?url'
import previous from '../../../../src/renderer/assets/icons/previous.svg?url'
import next from '../../../../src/renderer/assets/icons/next.svg?url'
import play from '../../../../src/renderer/assets/icons/play.svg?url'
import pause from '../../../../src/renderer/assets/icons/pause.svg?url'
import back from '../../../../src/renderer/assets/icons/arrow-left.svg?url'
import refresh from '../../../../src/renderer/assets/icons/recovery.svg?url'
import down from '../../../../src/renderer/assets/icons/arrow-down.svg?url'
import up from '../../../../src/renderer/assets/icons/arrow-up.svg?url'
import check from '../../../../src/renderer/assets/icons/checked.svg?url'
import local from '../../../../src/renderer/assets/icons/local-music.svg?url'
import folder from '../../../../src/renderer/assets/icons/folder.svg?url'
import lyrics from '../../../../src/renderer/assets/icons/osd-lyrics.svg?url'
import close from '../../../../src/renderer/assets/icons/close.svg?url'
import explore from '../../../../src/renderer/assets/icons/explore.svg?url'
import list from '../../../../src/renderer/assets/icons/list.svg?url'
import repeat from '../assets/icons/playback-repeat.svg?url'
import repeatOne from '../assets/icons/playback-repeat-one.svg?url'
import shuffle from '../assets/icons/playback-shuffle.svg?url'
import more from '../../../../src/renderer/assets/icons/more.svg?url'
import heart from '../../../../src/renderer/assets/icons/heart.svg?url'
import heartSolid from '../../../../src/renderer/assets/icons/heart-solid.svg?url'
import plus from '../../../../src/renderer/assets/icons/plus.svg?url'
import palette from '../../../../src/renderer/assets/icons/color-plate.svg?url'
import timer from '../assets/icons/timer.svg?url'
import sort from '../assets/icons/sort.svg?url'
import drag from '../assets/icons/drag.svg?url'
import storage from '../assets/icons/storage.svg?url'
import update from '../assets/icons/update.svg?url'
import empty from '../assets/icons/empty.svg?url'
import error from '../assets/icons/error.svg?url'

const icons = { logo, library, search, settings, previous, next, play, pause, back, refresh, down, up, check, local, folder, lyrics, close, explore, list, repeat, repeatOne, shuffle, more, heart, heartSolid, plus, palette, timer, sort, drag, storage, update, empty, error }
const props = defineProps<{ name: keyof typeof icons }>()
const iconStyle = computed(() => ({ '--original-icon': `url("${icons[props.name]}")` }))
</script>

<template>
  <span class="original-icon" :data-original-icon="name" :style="iconStyle" aria-hidden="true"></span>
</template>

<style scoped>
.original-icon {
  display: inline-block;
  width: 1em;
  height: 1em;
  flex: 0 0 auto;
  vertical-align: -0.125em;
  background-color: currentColor;
  -webkit-mask: var(--original-icon) center / contain no-repeat;
  mask: var(--original-icon) center / contain no-repeat;
  pointer-events: none;
}
</style>
