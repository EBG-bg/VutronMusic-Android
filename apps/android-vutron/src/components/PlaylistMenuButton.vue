<script setup lang="ts">
import { useAndroidShellStore } from '../stores/androidShell'
import type { VutronPlaylist } from '../platform/vutronPlugin'
import ButtonIcon from '../../../../packages/ui/src/ButtonIcon.vue'
import OriginalIcon from './OriginalIcon.vue'

defineProps<{ playlist?: VutronPlaylist; label?: string; placement?: 'card' | 'list'; disabled?: boolean }>()
const emit = defineEmits<{ open: [] }>()
const store = useAndroidShellStore()
function open(playlist?: VutronPlaylist) {
  if (playlist) store.openOnlinePlaylistMore(playlist)
  else emit('open')
}
</script>

<template>
  <ButtonIcon v-if="label || playlist && store.onlineAvailable && !playlist.offlineSnapshot && playlist.id > 0" :prevent-blur="true" type="button" :disabled="disabled"
    class="icon-button playlist-menu-button" :class="placement && 'playlist-menu-' + placement"
    aria-haspopup="dialog" :aria-label="$t('mobile.playlistCache.menuFor', { name: label || playlist?.name })" @click.stop="open(playlist)">
    <OriginalIcon name="more" />
  </ButtonIcon>
</template>

<style scoped>
.playlist-menu-button.button-icon { width:44px; height:44px; flex:0 0 44px; padding:0; margin:0; border-radius:var(--radius-control); color:var(--muted); font-size:20px; }
.playlist-menu-button.button-icon:is([data-original-feedback],:focus-visible) { color:var(--accent-ink); background:var(--accent-soft); }
.playlist-menu-card.button-icon { position:absolute; inset:2px 2px auto auto; z-index:1; background:var(--color-body-bg); }
@media (hover:hover) and (pointer:fine) { .playlist-menu-button.button-icon:hover { color:var(--accent-ink); background:var(--accent-soft); } }
</style>
