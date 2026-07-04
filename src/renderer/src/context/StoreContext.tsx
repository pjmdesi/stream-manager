import React, { useState, useEffect, useCallback } from 'react'
import { StoreContext, defaultConfig } from '../hooks/useStore'
import type { AppConfig } from '../types'

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfigState] = useState<AppConfig>(defaultConfig)
  const [loading, setLoading] = useState(true)

  const refreshConfig = useCallback(async () => {
    const cfg = await window.api.getConfig()
    setConfigState(cfg)
  }, [])

  useEffect(() => {
    window.api.getConfig().then((cfg) => {
      setConfigState(cfg)
      setLoading(false)
    })
    // Every config write in the app — renderer IPC or main-side (tray
    // toggles, relay bookkeeping) — broadcasts 'config:changed'; re-fetch so
    // this shared state can never go stale. Before this, out-of-band writes
    // were invisible until relaunch (the convert-dump-folder flow left the
    // whole app behaving as dump mode) and a Settings save could clobber
    // them with its stale snapshot.
    const off = window.api.onConfigChanged(() => { void refreshConfig() })
    return () => { off() }
  }, [refreshConfig])

  const updateConfig = useCallback(async (partial: Partial<AppConfig>) => {
    setConfigState(prev => ({ ...prev, ...partial }))
    await window.api.setConfig(partial)
  }, [])

  return (
    <StoreContext.Provider value={{ config, loading, updateConfig, refreshConfig }}>
      {children}
    </StoreContext.Provider>
  )
}
