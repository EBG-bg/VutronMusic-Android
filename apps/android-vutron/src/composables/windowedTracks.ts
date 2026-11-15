export interface WindowedScrollPosition { key: string | number; index: number; offset: number }
type WindowedViewState = { measured: Map<string | number, number>; position?: WindowedScrollPosition }
const viewStates = new Map<string, WindowedViewState>()
export function readWindowedViewState(key: string) {
  const state = viewStates.get(key)
  if (state) { viewStates.delete(key); viewStates.set(key, state) }
  return state
}
export function saveWindowedViewState(key: string, measured: ReadonlyMap<string | number, number>, position?: WindowedScrollPosition) {
  const values = [...measured].slice(-20_000)
  viewStates.delete(key); viewStates.set(key, { measured: new Map(values), position })
  let count = [...viewStates.values()].reduce((total, state) => total + state.measured.size, 0)
  while (viewStates.size > 24 || count > 20_000 && viewStates.size > 1) {
    const first = viewStates.keys().next().value!
    count -= viewStates.get(first)!.measured.size; viewStates.delete(first)
  }
}
export interface WindowedTrackListHandle {
  scrollToIndex(index: number, options?: { align?: 'start' | 'center' | 'end' | 'nearest'; behavior?: ScrollBehavior }): Promise<void>
  refresh(): void
  indexAtClientY(y: number): number
  captureScrollPosition(): WindowedScrollPosition
  restoreScrollPosition(position: WindowedScrollPosition): Promise<void>
}

/** Prefix heights keep scrolling and measurement updates logarithmic in library size. */
export class MeasuredTrackHeights {
  private tree: number[]
  private values: number[]
  constructor(readonly keys: readonly (string | number)[], estimate: number, measured: ReadonlyMap<string | number, number> = new Map()) {
    this.values = keys.map(key => measured.get(key) ?? estimate)
    this.tree = [0, ...this.values]
    for (let i = 1; i < this.tree.length; i++) {
      const parent = i + (i & -i)
      if (parent < this.tree.length) this.tree[parent]! += this.tree[i]!
    }
  }
  get length() { return this.values.length }
  offset(index: number) {
    let sum = 0
    for (let i = Math.min(this.length, Math.max(0, index)); i > 0; i -= i & -i) sum += this.tree[i]!
    return sum
  }
  get total() { return this.offset(this.length) }
  update(index: number, height: number) {
    if (index < 0 || index >= this.length || !Number.isFinite(height) || height <= 0) return false
    const delta = height - this.values[index]!
    if (Math.abs(delta) < .5) return false
    this.values[index] = height
    for (let i = index + 1; i < this.tree.length; i += i & -i) this.tree[i]! += delta
    return true
  }
  /** The row containing the offset, including the last row at the lower boundary. */
  indexAt(offset: number) {
    if (!this.length) return 0
    let index = 0, sum = 0, step = 1
    while (step * 2 <= this.length) step *= 2
    for (; step; step >>= 1) {
      const next = index + step
      if (next <= this.length && sum + this.tree[next]! <= offset) { index = next; sum += this.tree[next]! }
    }
    return Math.min(index, this.length - 1)
  }
}
