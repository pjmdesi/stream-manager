import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { WatchRule, WatchEvent } from '../types'

interface WatcherContextValue {
  rules: WatchRule[]
  running: boolean
  events: WatchEvent[]
  saveRules: (updated: WatchRule[]) => Promise<void>
  startWatcher: () => Promise<void>
  stopWatcher: () => Promise<void>
  toggleRule: (id: string) => Promise<void>
}

const WatcherContext = createContext<WatcherContextValue>({
  rules: [],
  running: false,
  events: [],
  saveRules: async () => {},
  startWatcher: async () => {},
  stopWatcher: async () => {},
  toggleRule: async () => {},
})

export function WatcherProvider({ children }: { children: React.ReactNode }) {
  const [rules, setRules] = useState<WatchRule[]>([])
  const [running, setRunning] = useState(false)
  const [events, setEvents] = useState<WatchEvent[]>([])

  useEffect(() => {
    Promise.all([window.api.getWatchRules(), window.api.getConfig()]).then(([savedRules, config]) => {
      setRules(savedRules)
      if (config.autoStartWatcher) {
        const enabled = savedRules.filter(r => r.enabled)
        if (enabled.length > 0) {
          window.api.startWatcher(enabled).then(() => setRunning(true))
        }
      }
    })
    const unsub = window.api.onFileMatched((event: WatchEvent) => {
      setEvents(prev => [event, ...prev].slice(0, 200))
    })
    return () => { unsub() }
  }, [])

  const saveRules = useCallback(async (updated: WatchRule[]) => {
    setRules(updated)
    await window.api.setWatchRules(updated)
    if (running) {
      await window.api.startWatcher(updated.filter(r => r.enabled))
    }
  }, [running])

  const startWatcher = useCallback(async () => {
    const enabled = rules.filter(r => r.enabled)
    if (enabled.length === 0) return
    await window.api.startWatcher(enabled)
    setRunning(true)
  }, [rules])

  const stopWatcher = useCallback(async () => {
    await window.api.stopWatcher()
    setRunning(false)
  }, [])

  const toggleRule = useCallback(async (id: string) => {
    const updated = rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r)
    await saveRules(updated)
  }, [rules, saveRules])

  return (
    <WatcherContext.Provider value={{ rules, running, events, saveRules, startWatcher, stopWatcher, toggleRule }}>
      {children}
    </WatcherContext.Provider>
  )
}

export function useWatcher() {
  return useContext(WatcherContext)
}
