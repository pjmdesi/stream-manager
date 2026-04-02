import React, { createContext, useContext, useState } from 'react'
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
  return (
    <ConversionContext.Provider value={{ jobs, setJobs }}>
      {children}
    </ConversionContext.Provider>
  )
}

export function useConversionJobs() {
  return useContext(ConversionContext)
}
