import { useEffect, useState } from 'react'

/** OS-level connectivity via navigator.onLine + the online/offline events.
 *  `false` is definitive (no network interface); `true` only means the
 *  interface is up — actual internet reachability is verified separately
 *  (netCheckInternet) when a request fails despite `true`. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}
