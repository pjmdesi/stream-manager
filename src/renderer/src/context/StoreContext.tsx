import React, { useState, useEffect, useCallback } from 'react'
import { StoreContext, defaultConfig } from '../hooks/useStore'
import type { AppConfig } from '../types'

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfigState] = useState<AppConfig>(defaultConfig)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.getConfig().then((cfg) => {
      setConfigState(cfg)
      setLoading(false)
    })
  }, [])

  const updateConfig = useCallback(async (partial: Partial<AppConfig>) => {
    setConfigState(prev => ({ ...prev, ...partial }))
    await window.api.setConfig(partial)
  }, [])

  const refreshConfig = useCallback(async () => {
    const cfg = await window.api.getConfig()
    setConfigState(cfg)
  }, [])

  return (
    <StoreContext.Provider value={{ config, loading, updateConfig, refreshConfig }}>
      {children}
    </StoreContext.Provider>
  )
}
