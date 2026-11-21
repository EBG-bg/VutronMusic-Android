<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'
import { fetchArtwork } from '../platform/artwork'
import { localOnlyMode } from '../platform/localOnlyMode'
import { navigationPreviewKey } from '../composables/navigationPreview'
import { observeArtworkVisibility } from '../composables/artworkVisibility'
import { artworkPixelEdge } from '@vutronmusic/core/artwork'
const props = defineProps<{ userId: number; nickname: string; src?: string }>()
const preview = inject(navigationPreviewKey, false)
const root = ref<HTMLElement>(), uri = ref(preview && props.src?.startsWith('data:image/') ? props.src : ''), visible = ref(false)
const initial = computed(() => Array.from(props.nickname.trim())[0]?.toLocaleUpperCase() || 'V')
let generation = 0, alive = true, stopObserving: (() => void) | undefined
async function load() {
  if (preview) { uri.value = props.src?.startsWith('data:image/') ? props.src : ''; return }
  const token = ++generation; uri.value = ''
  if (!visible.value || !props.src) return
  try { const next = await fetchArtwork(props.src, artworkPixelEdge(root.value?.clientWidth || 44, window.devicePixelRatio)); if (alive && token === generation) uri.value = next }
  catch { /* The account remains usable with its letter placeholder. */ }
}
watch(() => [props.userId, props.src, localOnlyMode.value, visible.value], () => { void load() })
onMounted(() => {
  if (preview) return
  if (!('IntersectionObserver' in window)) { visible.value = true; return }
  if (root.value) stopObserving = observeArtworkVisibility(root.value, '100px', () => { visible.value = true })
})
onUnmounted(() => { alive = false; ++generation; stopObserving?.() })
</script>
<template><div ref="root" class="settings-avatar profile-avatar"><span>{{ initial }}</span><img v-if="uri" :key="userId + ':' + uri" :src="uri" alt="" loading="lazy" decoding="async" @error="uri = ''" /></div></template>
<style scoped>
.profile-avatar { position:relative; overflow:hidden; flex-shrink:0; }.profile-avatar img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
</style>
