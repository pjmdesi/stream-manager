import { isAnyModalOpen } from '../components/ui/Modal'

export { isAnyModalOpen }

/** True when a keyboard event originates from an editable field (so character /
 *  text-editing shortcuts should stand down — the user is typing). */
export function isTypingTarget(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}
