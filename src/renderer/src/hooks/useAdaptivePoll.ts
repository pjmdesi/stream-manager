import { useEffect, useRef } from 'react'

interface AdaptivePollOptions {
  /** Interval while the window is visible and the user is interacting. */
  activeMs: number
  /** Interval while the window is visible but idle (no interaction for
   *  `idleAfterMs`) — the user's around but not touching the app. */
  idleMs: number
  /** Interval while the window is minimized to the taskbar or hidden to the
   *  tray (`document.hidden`). The user's away. */
  hiddenMs: number
  /** No interaction for this long (while visible) flips to `idleMs`. */
  idleAfterMs: number
  /** When false, the poll is suspended entirely — no timer, no listeners. */
  enabled?: boolean
  /** Change this to force an immediate poll + reschedule, e.g. when the set of
   *  things being polled changes. */
  resetKey?: unknown
}

/**
 * Runs `callback` on an interval that adapts to how present the user is, so
 * idle/background polling doesn't quietly burn API quota:
 *   - visible + recently interacted → `activeMs`
 *   - visible but idle (no interaction for `idleAfterMs`) → `idleMs`
 *   - minimized to taskbar / hidden to tray → `hiddenMs`
 *
 * Fires immediately on mount, and again the moment the window regains focus or
 * visibility, or the user interacts after being idle — so returning to the app
 * always shows fresh data right away. Slowing down is lazy (it doesn't need to
 * react the instant you go idle); speeding back up is immediate.
 *
 * `document.hidden` flips to true on minimize-to-taskbar and hide-to-tray, but
 * NOT when the window is merely unfocused behind another app — which is the
 * intended distinction.
 */
export function useAdaptivePoll(callback: () => void, opts: AdaptivePollOptions): void {
  const { activeMs, idleMs, hiddenMs, idleAfterMs, enabled = true, resetKey } = opts
  const cbRef = useRef(callback)
  useEffect(() => { cbRef.current = callback })
  const lastInteractionRef = useRef(Date.now())

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const nextDelay = (): number => {
      if (document.hidden) return hiddenMs
      if (Date.now() - lastInteractionRef.current >= idleAfterMs) return idleMs
      return activeMs
    }
    const schedule = () => { timer = setTimeout(fire, nextDelay()) }
    const fire = () => { cbRef.current(); schedule() }
    // Fire now + reschedule — used when the user returns so they don't wait out
    // a slow interval for fresh data.
    const wake = () => { if (timer) clearTimeout(timer); cbRef.current(); schedule() }
    const onInteraction = () => {
      const wasIdle = Date.now() - lastInteractionRef.current >= idleAfterMs
      lastInteractionRef.current = Date.now()
      if (wasIdle && !document.hidden) wake()
    }
    const onVisibility = () => { if (!document.hidden) wake() }

    cbRef.current()
    schedule()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', wake)
    const interactionEvents: (keyof WindowEventMap)[] = ['mousedown', 'mousemove', 'keydown', 'wheel', 'touchstart']
    for (const ev of interactionEvents) window.addEventListener(ev, onInteraction, { passive: true })
    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', wake)
      for (const ev of interactionEvents) window.removeEventListener(ev, onInteraction)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMs, idleMs, hiddenMs, idleAfterMs, enabled, resetKey])
}
