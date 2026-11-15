import { ref, shallowRef, type Ref } from 'vue'
import type { VutronSearchCategory, VutronSearchItem } from '../../platform/vutronPlugin'
import { vutronPlugin } from '../../platform/vutronPlugin'

export interface ShellSearchOptions {
  onlineAvailable: Ref<boolean>
  error: Ref<string>
  t(key: string): string
  formatError(cause: unknown, fallback: string): string
}

/** Owns keyword/category input, results list, and pagination. */
export function createShellSearch(options: ShellSearchOptions) {
  const { onlineAvailable, error, t, formatError } = options

  const searchKeywords = ref('')
  const searchCategory = ref<VutronSearchCategory>('tracks')
  const submittedSearch = shallowRef<{ category: VutronSearchCategory; keywords: string }>({ category: 'tracks', keywords: '' })
  const searchResults = ref<VutronSearchItem[]>([])
  const searchCount = ref(0)
  const searchNextPage = ref(0)
  const searchLoading = ref(false)

  let searchRequestId = 0

  function incrementSearchRequest() { ++searchRequestId }

  async function runSearch(
    category = searchCategory.value,
    keywords = searchKeywords.value,
    reset = true,
  ) {
    if (!onlineAvailable.value) return
    const requestId = ++searchRequestId
    const normalizedKeywords = keywords.trim()
    if (!reset && (submittedSearch.value.category !== category || submittedSearch.value.keywords !== normalizedKeywords)) reset = true
    if (!vutronPlugin.search || !normalizedKeywords) {
      submittedSearch.value = { category, keywords: '' }
      searchResults.value = []; searchCount.value = 0; searchNextPage.value = 0; searchLoading.value = false
      return
    }
    if (reset) {
      searchCategory.value = category; searchKeywords.value = keywords
      submittedSearch.value = { category, keywords: normalizedKeywords }
    }
    if (reset) { searchResults.value = []; searchCount.value = 0; searchNextPage.value = 0 }
    searchLoading.value = true
    try {
      const page = reset ? 1 : searchNextPage.value
      const result = await vutronPlugin.search({ category, keywords: normalizedKeywords, page })
      if (requestId !== searchRequestId || submittedSearch.value.category !== category || submittedSearch.value.keywords !== normalizedKeywords) return
      searchResults.value = reset ? result.items : [...searchResults.value, ...result.items]
      searchCount.value = result.count; searchNextPage.value = result.nextPage
    } catch (cause) {
      if (requestId === searchRequestId && submittedSearch.value.category === category && submittedSearch.value.keywords === normalizedKeywords)
        error.value = formatError(cause, t('mobile.runtimeText.searchFailed'))
    } finally {
      if (requestId === searchRequestId) searchLoading.value = false
    }
  }

  async function loadMoreSearch() {
    if (searchNextPage.value > 0 && !searchLoading.value)
      await runSearch(submittedSearch.value.category, submittedSearch.value.keywords, false)
  }

  function resetSearch() {
    ++searchRequestId
    searchKeywords.value = ''
    submittedSearch.value = { category: searchCategory.value, keywords: '' }
    searchResults.value = []
    searchCount.value = 0
    searchNextPage.value = 0
    searchLoading.value = false
  }

  return {
    searchKeywords, searchCategory, submittedSearch,
    searchResults, searchCount, searchNextPage, searchLoading,
    incrementSearchRequest, runSearch, loadMoreSearch, resetSearch,
  }
}
