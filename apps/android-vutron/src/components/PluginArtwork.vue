<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import CoverImage from './CoverImage.vue'
import { musicPluginBridge } from '../plugins/bridge'
import type { PluginContext } from '../plugins/protocol'

const props = withDefaults(defineProps<{ pluginId: string; uri?: string; sourceContext?: PluginContext; eager?: boolean }>(), { uri: '', sourceContext: () => ({}) })
const root = ref<HTMLElement>(), resolved = ref(''), visible = ref(false)
let observer: IntersectionObserver | undefined, generation = 0, alive = true
async function load() {
  const token = ++generation
  resolved.value = ''
  if (!visible.value || !props.uri) return
  if (/^(file:|content:|data:image\/)/i.test(props.uri)) { resolved.value = props.uri; return }
  if (!musicPluginBridge.resolveMusicPluginArtwork) return
  try {
    const response = await musicPluginBridge.resolveMusicPluginArtwork({ pluginId: props.pluginId, uri: props.uri, sourceContext: props.sourceContext })
    if (alive && token === generation) resolved.value = response.uri
  } catch (cause) { console.warn('Plugin artwork unavailable', cause instanceof Error ? cause.message : String(cause)) }
}
watch(() => [props.pluginId, props.uri, props.sourceContext, visible.value], load)
onMounted(() => {
  if (props.eager || !('IntersectionObserver' in window)) { visible.value = true; return }
  observer = new IntersectionObserver(entries => { if (entries.some(row => row.isIntersecting)) { visible.value = true; observer?.disconnect() } }, { rootMargin: '160px' })
  if (root.value) observer.observe(root.value)
})
onUnmounted(() => { alive = false; ++generation; observer?.disconnect() })
</script>
<template><span ref="root" class="plugin-artwork"><CoverImage :src="resolved" :loading="eager ? 'eager' : 'lazy'" alt="" /></span></template>
<style scoped>.plugin-artwork { display:block; overflow:hidden; border-radius:inherit; aspect-ratio:1; background:var(--surface); }.plugin-artwork :deep(img) { display:block; width:100%; height:100%; object-fit:cover; }</style>
