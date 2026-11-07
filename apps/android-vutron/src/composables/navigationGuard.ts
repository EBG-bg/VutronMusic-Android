import { onScopeDispose, shallowRef } from 'vue'
import { askAction, type ActionChoice, type ActionQuestion } from '../platform/actionDialog'

export interface NavigationDraft {
  dirty(): boolean
  question(): ActionQuestion
  save(): Promise<boolean>
  discard(): void
  resume?(): void | Promise<void>
  cancelInteraction?(): boolean
}

/** Guard explicit in-app navigation; permissions and app visibility do not pass here. */
export function createNavigationGuard(ask: (question: ActionQuestion) => Promise<ActionChoice> = askAction) {
  const drafts = new Set<NavigationDraft>()
  const pending = shallowRef<Promise<void>>()
  let continuing = false
  function register(draft: NavigationDraft) {
    drafts.add(draft)
    return () => drafts.delete(draft)
  }
  function cancelInteraction() {
    for (const draft of drafts) if (draft.cancelInteraction?.()) return true
    return false
  }
  function intercept(action: () => unknown): boolean {
    if (continuing) return false
    if (pending.value) return true
    cancelInteraction()
    const draft = [...drafts].find(item => item.dirty())
    if (!draft) return false
    pending.value = (async () => {
      const choice = await ask(draft.question())
      if (!drafts.has(draft)) return
      if (choice === 'cancel') { await draft.resume?.(); return }
      if (choice === 'confirm' && draft.dirty() && !await draft.save()) {
        await draft.resume?.()
        return
      }
      if (choice === 'secondary') draft.discard()
      continuing = true
      try { action() } finally { continuing = false }
    })().finally(() => { pending.value = undefined })
    return true
  }
  function run(action: () => unknown) { if (!intercept(action)) action() }
  return { register, pending, cancelInteraction, intercept, run }
}

export const appNavigation = createNavigationGuard()
export function useNavigationDraft(draft: NavigationDraft) {
  const release = appNavigation.register(draft)
  onScopeDispose(release)
}
