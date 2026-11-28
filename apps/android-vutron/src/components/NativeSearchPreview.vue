<script setup lang="ts">
import { computed } from 'vue'
import { nativeSearchCategories } from '../composables/nativeSearchCategories'
import type { VutronSearchCategory, VutronSearchItem } from '../platform/vutronPlugin'
import { useAndroidShellStore } from '../stores/androidShell'
import NativeSearchHeader from './NativeSearchHeader.vue'
import NativeSearchResults from './NativeSearchResults.vue'

// Mounted only inside NavigationPeek, which disables input and artwork fetching.
const props = defineProps<{ nestedCategory?: string; previewCategory?: VutronSearchCategory; items?: readonly VutronSearchItem[]; moreResults?: boolean }>()
const store = useAndroidShellStore()
const category = computed(() => nativeSearchCategories.find(value => value === (props.nestedCategory ?? props.previewCategory)) ?? store.searchCategory)
const adjacent = computed(() => category.value !== store.searchCategory)
const hasSubmittedQuery = computed(() => Boolean(store.submittedSearch.keywords) && store.searchKeywords.trim() === store.submittedSearch.keywords)
const snapshot = computed(() => adjacent.value && hasSubmittedQuery.value && store.adjacentSearch?.category === category.value ? store.adjacentSearch : undefined)
const items = computed(() => {
  if (adjacent.value) return snapshot.value?.items ?? []
  const current = props.items ?? store.searchResults
  // WindowedTrackList has its own preview budget; cap non-windowed lists here.
  return category.value === 'tracks' ? current : current.slice(0, 24)
})
const loading = computed(() => adjacent.value ? hasSubmittedQuery.value && !snapshot.value : store.searchLoading)
const searched = computed(() => adjacent.value ? hasSubmittedQuery.value : Boolean(store.searchKeywords))
// The neighbor snapshot contains only leading rows, not a pagination boundary.
const more = computed(() => adjacent.value ? null : Boolean(store.searchNextPage || category.value !== 'tracks' && props.moreResults))
const stateKey = computed(() => JSON.stringify(['search-tracks', store.profile?.userId, store.submittedSearch]))
</script>

<template>
  <component :is="nestedCategory ? 'div' : 'section'" :class="nestedCategory ? 'content-switch-stage swipe-surface' : 'page search-page'">
    <NativeSearchHeader v-if="!nestedCategory" :active-category="category" />
    <NativeSearchResults :category="category" :items="items" :loading="loading" :searched="searched" :more="more" :state-key="stateKey" />
  </component>
</template>
