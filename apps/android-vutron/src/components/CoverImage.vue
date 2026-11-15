<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { displayArtworkUri, fetchArtwork } from '../platform/artwork'
import { localOnlyMode } from '../platform/localOnlyMode'
import { observeArtworkVisibility } from '../composables/artworkVisibility'
import originalArtwork from '../../../../src/renderer/assets/images/vutronmusic-icon.png'
import { artworkPixelEdge } from '@vutronmusic/core/artwork'

const props = withDefaults(defineProps<{ src?: string; remoteSrc?: string; alt?: string; loading?: 'eager' | 'lazy'; size?: 'auto' | 'small' | 'large'; prepared?: boolean }>(), {
  src: '', remoteSrc: '', alt: '', loading: 'lazy', size: 'auto', prepared: false
})
const placeholder = originalArtwork
const element = ref<HTMLImageElement>()
const displayed = ref(placeholder)
const state = ref<'loading' | 'loaded' | 'missing'>('loading')
let stopObserving: (() => void) | undefined
let visible = false
let generation = 0
let triedRemote = false
let alive = true

async function loadSource(useRemote = false) {
  if (!visible) return
  const token = ++generation
  const source = useRemote ? props.remoteSrc : props.src || props.remoteSrc
  if (!source) { displayed.value = placeholder; state.value = 'missing'; return }
  state.value = 'loading'
  try {
    const isRemote = source.startsWith('http://') || source.startsWith('https://')
    const size = props.size === 'large' ? 512 : artworkPixelEdge(element.value?.clientWidth || (props.size === 'small' ? 48 : 160), window.devicePixelRatio)
    const uri = props.prepared ? isRemote ? localOnlyMode.value ? '' : source : displayArtworkUri(source)
      : await fetchArtwork(isRemote ? source : props.remoteSrc || source, size, isRemote ? '' : source)
    if (alive && token === generation) { displayed.value = uri || placeholder; if (!uri) state.value = 'missing' }
  } catch (error) {
    if (!alive || token !== generation) return
    // Native fetching carries provider headers; a plain URL remains a useful
    // fallback for providers that support WebView image requests.
    console.warn('Artwork unavailable', error instanceof Error ? error.message : String(error))
    displayed.value = localOnlyMode.value ? placeholder : displayArtworkUri(source) || placeholder
    if (displayed.value === placeholder) state.value = 'missing'
  }
}

function onError() {
  if (!triedRemote && props.remoteSrc && props.remoteSrc !== props.src) {
    triedRemote = true
    void loadSource(true)
  } else { displayed.value = placeholder; state.value = 'missing' }
}
function onLoad() { if (displayed.value !== placeholder) state.value = 'loaded' }

watch(() => [props.src, props.remoteSrc, localOnlyMode.value], () => {
  ++generation; triedRemote = false; displayed.value = placeholder
  void loadSource()
})
watch(() => props.size, () => { void loadSource() }, { flush: 'post' })
onMounted(() => {
  if (props.loading === 'eager' || !('IntersectionObserver' in window)) { visible = true; void loadSource(); return }
  if (element.value) stopObserving = observeArtworkVisibility(element.value, '180px', () => { visible = true; void loadSource() })
})
onUnmounted(() => { alive = false; ++generation; stopObserving?.() })
</script>

<template>
  <img ref="element" :src="displayed" :alt="alt" :loading="loading" :data-artwork-state="state" decoding="async" @error="onError" @load="onLoad" />
</template>
