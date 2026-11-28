<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { nativeSearchCategories, nativeSearchCategoryLabel } from '../composables/nativeSearchCategories'
import { useNavigationIndicator } from '../composables/navigationIndicator'
import { navigationPreviewKey } from '../composables/navigationPreview'
import type { VutronSearchCategory } from '../platform/vutronPlugin'
import { useAndroidShellStore } from '../stores/androidShell'
import OriginalIcon from './OriginalIcon.vue'

const props = defineProps<{ swipePosition?: number; swiping?: boolean; activeCategory?: VutronSearchCategory }>()
const emit = defineEmits<{ submit: []; category: [VutronSearchCategory] }>()
const store = useAndroidShellStore()
const preview = inject(navigationPreviewKey, false)
const tabs = ref<HTMLElement>()
const currentCategory = computed(() => props.activeCategory ?? store.searchCategory)
const position = computed(() => props.swipePosition ?? nativeSearchCategories.indexOf(currentCategory.value))
const indicator = !preview ? useNavigationIndicator(tabs, position, ref(nativeSearchCategories.length)) : undefined
const keywords = computed({ get: () => store.searchKeywords, set: value => { if (!preview) store.searchKeywords = value } })
</script>

<template>
  <div class="section-heading"><div><h2>{{ $t('mobile.shellUi.searchMusic') }}</h2></div></div>
  <form class="remote-search-box" @submit.prevent="!preview && emit('submit')">
    <span><OriginalIcon name="search" /></span>
    <input v-model="keywords" type="search" autocomplete="off" :placeholder="$t('mobile.shellUi.searchPlaceholder')" />
    <button type="submit" :disabled="store.searchLoading || !keywords.trim()">{{ $t('nav.search') }}</button>
  </form>
  <div ref="tabs" class="search-categories" :class="{ 'navigation-tabs': !preview }" :data-swiping="swiping ? '' : undefined" role="tablist" :aria-label="$t('mobile.shellUi.searchCategories')">
    <span v-if="!preview" class="navigation-tab-indicator" :style="indicator" aria-hidden="true"></span>
    <button v-for="category in nativeSearchCategories" :key="category" type="button" role="tab" :aria-selected="currentCategory === category" :class="{ selected: currentCategory === category }" @click="!preview && emit('category', category)">{{ $t(nativeSearchCategoryLabel[category]) }}</button>
  </div>
  <div v-if="keywords" class="search-result-heading">
    <b>“{{ keywords }}”</b>
    <small>{{ store.searchCount ? $t('mobile.shellUi.resultsCount', { count: store.searchCount }) : $t(store.searchLoading ? 'mobile.shellUi.searching' : 'mobile.shellUi.searchResults') }}</small>
  </div>
</template>

<style scoped>
.search-categories:not(.navigation-tabs) > button.selected { border-radius: var(--radius-control); }
</style>
