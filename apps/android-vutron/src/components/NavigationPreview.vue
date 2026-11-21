<script setup lang="ts">
import OriginalIcon from './OriginalIcon.vue'

defineProps<{ tab: string; sourceName?: string }>()
const labels: Record<string, string> = { home: 'nav.home', library: 'nav.library', search: 'mobile.shellUi.searchMusic' }
</script>

<template>
  <section v-if="sourceName" class="page">
    <div class="section-heading"><div><h2>{{ $t(labels[tab] ?? 'nav.library') }}</h2></div></div>
    <div class="navigation-preview-source"><OriginalIcon name="library" /><b>{{ sourceName }}</b></div>
  </section>
</template>

<style scoped>
.navigation-preview-source { display: flex; gap: 10px; align-items: center; padding: 18px; border-radius: var(--radius-card); background: var(--surface); }
</style>
