import React, { createContext, useContext, useEffect, useState } from 'react'
import type { ConversionJob } from '../types'

interface ConversionContextValue {
  jobs: ConversionJob[]
  setJobs: React.Dispatch<React.SetStateAction<ConversionJob[]>>
}

const ConversionContext = createContext<ConversionContextValue>({
  jobs: [],
  setJobs: () => {}
})

export function ConversionProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<ConversionJob[]>([])
  // Pull any queued jobs persisted from a previous session so the converter page
  // and conversion widget show them on startup.
  useEffect(() => {
    window.api.getJobs?.()
      .then(persisted => {
        if (persisted.length === 0) return
        setJobs(prev => {
          const seen = new Set(prev.map(j => j.id))
          const fresh = persisted.filter(j => !seen.has(j.id))
          return fresh.length > 0 ? [...prev, ...fresh] : prev
        })
      })
      .catch(() => {})
  }, [])
  return (
    <ConversionContext.Provider value={{ jobs, setJobs }}>
      {children}
    </ConversionContext.Provider>
  )
}

export function useConversionJobs() {
  return useContext(ConversionContext)
}
