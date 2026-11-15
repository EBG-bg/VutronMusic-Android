type VisibilityPool = { observer: IntersectionObserver; callbacks: Map<Element, () => void> }
const pools = new Map<string, VisibilityPool>()

/** Images with the same preload margin share an observer until they are visible. */
export function observeArtworkVisibility(element: Element, rootMargin: string, visible: () => void): () => void {
  let pool = pools.get(rootMargin)
  if (!pool) {
    const callbacks = new Map<Element, () => void>()
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const callback = callbacks.get(entry.target)
        if (!callback) continue
        callbacks.delete(entry.target)
        observer.unobserve(entry.target)
        callback()
      }
      if (!callbacks.size) { observer.disconnect(); if (pools.get(rootMargin)?.observer === observer) pools.delete(rootMargin) }
    }, { rootMargin })
    pool = { observer, callbacks }
    pools.set(rootMargin, pool)
  }
  const selected = pool
  selected.callbacks.set(element, visible)
  selected.observer.observe(element)
  return () => {
    if (selected.callbacks.get(element) !== visible) return
    selected.callbacks.delete(element)
    selected.observer.unobserve(element)
    if (!selected.callbacks.size) { selected.observer.disconnect(); if (pools.get(rootMargin) === selected) pools.delete(rootMargin) }
  }
}
