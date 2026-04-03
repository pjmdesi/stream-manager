import { useState, useEffect, useCallback } from 'react'
import { AppConfig } from '../types'

const defaultConfig: AppConfig = {
  defaultWatchDir: '',
  defaultOutputDir: '',
  presetsDir: '',
  tempDir: '',
  theme: 'dark',
  autoStartWatcher: false,
  streamerName: '',
  defaultGame: '',
  streamsDir: '',
  archivePresetId: '',
  defaultThumbnailTemplate: '',
  checkEpisodeIteration: true,
  audioCacheLimit: 1_073_741_824,
  youtubeClientId: '',
  youtubeClientSecret: '',
  twitchClientId: '',
  twitchClientSecret: '',
}

export function useStore() {
  const [config, setConfigState] = useState<AppConfig>(defaultConfig)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.getConfig().then((cfg) => {
      setConfigState(cfg)
      setLoading(false)
    })
  }, [])

  const updateConfig = useCallback(async (partial: Partial<AppConfig>) => {
    const updated = { ...config, ...partial }
    setConfigState(updated)
    await window.api.setConfig(partial)
  }, [config])

  return { config, updateConfig, loading }
}
