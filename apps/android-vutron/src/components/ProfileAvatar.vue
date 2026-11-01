<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { fetchArtwork } from '../platform/artwork'
import { localOnlyMode } from '../platform/localOnlyMode'
const props = defineProps<{ userId: number; nickname: string; src?: string }>()
const root = ref<HTMLElement>(), uri = ref(''), visible = ref(false)
const initial = computed(() => Array.from(props.nickname.trim())[0]?.toLocaleUpperCase() || 'V')
let generation = 0, alive = true, observer: IntersectionObserver | undefined
async function load() {
  const token = ++generation; uri.value = ''
  if (!visible.value || !props.src) return
  try { const next = await fetchArtwork(props.src); if (alive && token === generation) uri.value = next }
  catch { /* The account remains usable with its letter placeholder. */ }
}
watch(() => [props.userId, props.src, localOnlyMode.value, visible.value], () => { void load() })
onMounted(() => {
  if (!('IntersectionObserver' in window)) { visible.value = true; return }
  observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { visible.value = true; observer?.disconnect() } }, { rootMargin: '100px' })
  if (root.value) observer.observe(root.value)
})
onUnmounted(() => { alive = false; ++generation; observer?.disconnect() })
</script>
<template><div ref="root" class="settings-avatar profile-avatar"><span>{{ initial }}</span><img v-if="uri" :key="userId + ':' + uri" :src="uri" alt="" loading="lazy" decoding="async" @error="uri = ''" /></div></template>
<style scoped>
.profile-avatar { position:relative; overflow:hidden; flex-shrink:0; }.profile-avatar img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
</style>
