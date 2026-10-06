import { createContext, useContext } from 'react'
import { AppConfig } from '../types'
import { CONFIG_DEFAULTS } from '../../../shared/config'

/** The context's value until main's config arrives (`loading` is true
 *  meanwhile). The same defaults main merges under a stored config, so a
 *  key that is new to this version reads the same before and after load. */
const defaultConfig: AppConfig = CONFIG_DEFAULTS

interface StoreContextValue {
  config: AppConfig
  loading: boolean
  updateConfig: (partial: Partial<AppConfig>) => Promise<void>
  refreshConfig: () => Promise<void>
}

export const StoreContext = createContext<StoreContextValue>({
  config: defaultConfig,
  loading: true,
  updateConfig: async () => {},
  refreshConfig: async () => {},
})

export function useStore() {
  return useContext(StoreContext)
}

export { defaultConfig }
