import { ref, shallowRef, type Ref } from 'vue'
import type { VutronSearchCategory, VutronSearchItem, VutronSearchResult } from '../../platform/vutronPlugin'
import { vutronPlugin } from '../../platform/vutronPlugin'

export interface ShellSearchOptions {
  onlineAvailable: Ref<boolean>
  getAccountId?: () => number | undefined
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

  const adjacentSearch = shallowRef<{ category: VutronSearchCategory; items: VutronSearchItem[] }>()
  let searchRequestId = 0
  let warmed: { category: VutronSearchCategory; keywords: string; account?: number; at: number; request: Promise<VutronSearchResult | undefined>; result?: VutronSearchResult } | undefined

  function clearAdjacentSearch() { warmed = undefined; adjacentSearch.value = undefined }
  function incrementSearchRequest() { ++searchRequestId; clearAdjacentSearch() }

  function warmSearchCategory(category: VutronSearchCategory) {
    const keywords = searchKeywords.value.trim(), account = options.getAccountId?.()
    // Only prefetch already-submitted keywords. Typing alone should never submit.
    if (!onlineAvailable.value || !vutronPlugin.search || !keywords || keywords !== submittedSearch.value.keywords || category === searchCategory.value) return
    if (warmed?.category === category && warmed.keywords === keywords && warmed.account === account && Date.now() - warmed.at < 15_000) return
    adjacentSearch.value = undefined
    const request = vutronPlugin.search({ category, keywords, page: 1 }).then(result => {
      if (warmed?.request === request && onlineAvailable.value && options.getAccountId?.() === account && searchKeywords.value.trim() === keywords) {
        warmed.result = result
        adjacentSearch.value = { category, items: result.items.slice(0, 6) }
      }
      return result
    }, () => undefined)
    warmed = { category, keywords, account, at: Date.now(), request }
  }

  async function runSearch(
    category = searchCategory.value,
    keywords = searchKeywords.value,
    reset = true,
    useWarmed = false,
  ) {
    if (!onlineAvailable.value) return
    const requestId = ++searchRequestId
    const normalizedKeywords = keywords.trim()
    if (!reset && (submittedSearch.value.category !== category || submittedSearch.value.keywords !== normalizedKeywords)) reset = true
    const prepared = reset && useWarmed && warmed?.category === category && warmed.keywords === normalizedKeywords
      && warmed.account === options.getAccountId?.() && Date.now() - warmed.at < 15_000 ? warmed : undefined
    if (reset) clearAdjacentSearch()
    if (!vutronPlugin.search || !normalizedKeywords) {
      submittedSearch.value = { category, keywords: '' }
      searchResults.value = []; searchCount.value = 0; searchNextPage.value = 0; searchLoading.value = false
      return
    }
    if (reset) {
      searchCategory.value = category; searchKeywords.value = keywords
      submittedSearch.value = { category, keywords: normalizedKeywords }
    }
    if (prepared?.result) {
      searchResults.value = prepared.result.items; searchCount.value = prepared.result.count; searchNextPage.value = prepared.result.nextPage
      searchLoading.value = false
      return
    }
    if (reset) { searchResults.value = []; searchCount.value = 0; searchNextPage.value = 0 }
    searchLoading.value = true
    try {
      const page = reset ? 1 : searchNextPage.value
      let result = prepared ? await prepared.request : undefined
      if (requestId !== searchRequestId || !onlineAvailable.value) return
      result ??= await vutronPlugin.search({ category, keywords: normalizedKeywords, page })
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
    incrementSearchRequest()
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
    incrementSearchRequest, runSearch, loadMoreSearch, resetSearch, warmSearchCategory, adjacentSearch,
  }
}
