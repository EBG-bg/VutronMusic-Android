<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'
import CoverImage from './CoverImage.vue'
import { musicPluginBridge } from '../plugins/bridge'
import type { PluginContext } from '../plugins/protocol'
import { observeArtworkVisibility } from '../composables/artworkVisibility'
import { navigationPreviewKey } from '../composables/navigationPreview'
import { artworkPixelEdge } from '@vutronmusic/core/artwork'

const props = withDefaults(defineProps<{ pluginId: string; uri?: string; sourceContext?: PluginContext; eager?: boolean; size?: 'auto' | 'small' | 'large' }>(), { uri: '', sourceContext: () => ({}), size: 'auto' })
const preview = inject(navigationPreviewKey, false)
const root = ref<HTMLElement>(), resolved = ref(''), visible = ref(false)
const localArtwork = computed(() => /^(file:|content:|data:image\/)/i.test(props.uri))
let stopObserving: (() => void) | undefined, generation = 0, alive = true
async function load(reset = true) {
  const token = ++generation
  if (reset) resolved.value = ''
  if (!visible.value || !props.uri) return
  try {
    if (localArtwork.value) { resolved.value = props.uri; return }
    const size = props.size === 'large' ? 512 : artworkPixelEdge(root.value?.clientWidth || (props.size === 'small' ? 48 : 160), window.devicePixelRatio)
    if (!musicPluginBridge.resolveMusicPluginArtwork) return
    const response = await musicPluginBridge.resolveMusicPluginArtwork({ pluginId: props.pluginId, uri: props.uri, sourceContext: props.sourceContext, size })
    if (alive && token === generation) resolved.value = response.uri
  } catch (cause) { console.warn('Plugin artwork unavailable', cause instanceof Error ? cause.message : String(cause)) }
}
if (!preview) {
  watch(() => [props.pluginId, props.uri, props.sourceContext, visible.value], () => { void load() })
  watch(() => props.size, () => { void load(false) }, { flush: 'post' })
  onMounted(() => {
    if (props.eager || !('IntersectionObserver' in window)) { visible.value = true; return }
    if (root.value) stopObserving = observeArtworkVisibility(root.value, '160px', () => { visible.value = true })
  })
  onUnmounted(() => { alive = false; ++generation; stopObserving?.() })
}
</script>
<template><span ref="root" class="plugin-artwork"><CoverImage :src="preview ? uri : resolved" :size="size" loading="eager" alt="" :prepared="!localArtwork" /></span></template>
<style scoped>.plugin-artwork { display:block; overflow:hidden; border-radius:inherit; aspect-ratio:1; background:var(--surface); }.plugin-artwork :deep(img) { display:block; width:100%; height:100%; object-fit:cover; }</style>
