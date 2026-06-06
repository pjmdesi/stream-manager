import { useReducedMotion } from 'motion/react'
import { useStore } from './useStore'

/**
 * Resolves the user's animation preferences into concrete numbers a
 * component can apply to CSS transitions or setTimeout durations.
 *
 * Combines three signals:
 *   1. `prefers-reduced-motion` (OS-level)
 *   2. `config.disableAnimations` — user toggle in Settings
 *   3. `config.slowAnimations` — dev-only 5x slowdown
 *
 * Use anywhere a transition/setTimeout should respect these prefs.
 * The returned `duration()` helper takes a base ms value and applies
 * the multiplier (or returns 0 when animations are disabled).
 *
 *   const anim = useAnimationConfig()
 *   <div style={{ transitionDuration: `${anim.duration(200)}ms` }} />
 *   setTimeout(fn, anim.duration(230))
 */
export function useAnimationConfig() {
  const { config } = useStore()
  const osReducedMotion = useReducedMotion()
  const noAnimation = osReducedMotion || !!config.disableAnimations
  const animMult = config.slowAnimations ? 5 : 1
  return {
    noAnimation,
    animMult,
    duration: (baseMs: number) => (noAnimation ? 0 : baseMs * animMult),
    /** Convenience for `scrollIntoView({ behavior })` and similar APIs. */
    scrollBehavior: (noAnimation ? 'instant' : 'smooth') as ScrollBehavior,
  }
}
