import { useSyncExternalStore } from 'react'

/**
 * Subscribe to a CSS media query and re-render when it changes.
 *
 * Uses useSyncExternalStore so React stays in sync with the browser's
 * media-query state even when SSR or concurrent rendering is in play.
 *
 *   const isXl = useMediaQuery('(min-width: 1280px)')
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query)
      // Both addEventListener and the legacy addListener are used by tests
      // and older Electron builds — prefer the modern API when available.
      if (mql.addEventListener) {
        mql.addEventListener('change', cb)
        return () => mql.removeEventListener('change', cb)
      }
      mql.addListener(cb)
      return () => mql.removeListener(cb)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
