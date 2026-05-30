import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ConversionJob } from '../types'

interface ConversionContextValue {
  jobs: ConversionJob[]
  setJobs: React.Dispatch<React.SetStateAction<ConversionJob[]>>
  /** Smoothed ETA in milliseconds per job. `null` when the job has progress 0
   *  (no rate to estimate from yet). Keyed by job id. */
  jobEtas: Map<string, number | null>
  /** Active-only elapsed milliseconds per job — only increments while the job
   *  is 'running'. Pause / download / replace time never counts. */
  jobElapsed: Map<string, number>
  /** Snapshot of jobElapsed taken when a job transitions to 'done'. The page
   *  shows this on completed rows so the elapsed display freezes at the real
   *  active-only total rather than continuing to tick. */
  jobFinalElapsed: Map<string, number>
}

const ConversionContext = createContext<ConversionContextValue>({
  jobs: [],
  setJobs: () => {},
  jobEtas: new Map(),
  jobElapsed: new Map(),
  jobFinalElapsed: new Map(),
})

// EMA smoothing factor for ETA. Matches the previous in-page value so the
// felt smoothing is unchanged.
const ETA_ALPHA = 0.25

/** Provider owns all conversion job state: persisted-jobs load, IPC progress
 *  / status / complete / error / added listeners, and the once-a-second ETA
 *  tick. Lifted out of ConverterPage so the sidebar widget keeps getting
 *  fresh data while the user is on any other page. */
export function ConversionProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<ConversionJob[]>([])
  // ETA / elapsed are stored in refs and re-rendered via the tick state.
  // Storing them in state would force a full Map clone on every job tick,
  // which adds up when many jobs run in parallel.
  const jobEtas = useRef<Map<string, number | null>>(new Map())
  const jobElapsed = useRef<Map<string, number>>(new Map())
  const jobFinalElapsed = useRef<Map<string, number>>(new Map())
  const lastTickAt = useRef<number>(Date.now())
  const jobsRef = useRef(jobs)
  // Re-render trigger that fires once a second while jobs are running.
  const [, setTick] = useState(0)

  useEffect(() => { jobsRef.current = jobs }, [jobs])

  // Pull any queued jobs persisted from a previous session so the converter
  // page and sidebar widget show them on startup.
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

  // IPC listeners — kept at the provider so events keep landing in shared
  // state regardless of which page is mounted.
  useEffect(() => {
    const unsubProgress = window.api.onJobProgress(({ jobId, percent }: { jobId: string; percent: number }) => {
      setJobs(prev => prev.map(j => {
        if (j.id !== jobId) return j
        // Don't override transient sub-states ('downloading', 'replacing',
        // 'paused') just because a progress tick arrived. Only nudge
        // queued → running.
        const next = (j.status === 'queued') ? 'running' : j.status
        return { ...j, progress: percent, status: next }
      }))
    })
    const unsubStatus = window.api.onJobStatus(({ jobId, status }) => {
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status } : j))
    })
    const unsubComplete = window.api.onJobComplete(({ jobId }: { jobId: string }) => {
      const elapsed = jobElapsed.current.get(jobId)
      if (elapsed !== undefined) jobFinalElapsed.current.set(jobId, elapsed)
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'done', progress: 100 } : j))
    })
    const unsubError = window.api.onJobError(({ jobId, error }: { jobId: string; error: string }) => {
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'error', error } : j))
    })
    const unsubAdded = window.api.onJobAdded((job: ConversionJob) => {
      setJobs(prev => prev.some(j => j.id === job.id) ? prev : [...prev, job])
    })
    return () => { unsubProgress(); unsubStatus(); unsubComplete(); unsubError(); unsubAdded() }
  }, [])

  // Tick every second. Accumulates active-only elapsed time and recomputes
  // ETA using EMA smoothing. Skips work (but still updates lastTickAt) when
  // no jobs are running, so pauses don't inflate the next post-resume rate.
  useEffect(() => {
    lastTickAt.current = Date.now()
    const id = setInterval(() => {
      const now = Date.now()
      const delta = now - lastTickAt.current
      lastTickAt.current = now
      if (!jobsRef.current.some(j => j.status === 'running')) return
      jobsRef.current.forEach(j => {
        if (j.status !== 'running') return
        const elapsed = (jobElapsed.current.get(j.id) ?? 0) + delta
        jobElapsed.current.set(j.id, elapsed)
        if (j.progress > 0) {
          const raw = elapsed / (j.progress / 100) - elapsed
          const prev = jobEtas.current.get(j.id)
          jobEtas.current.set(j.id, prev != null ? ETA_ALPHA * raw + (1 - ETA_ALPHA) * prev : raw)
        } else {
          jobEtas.current.set(j.id, null)
        }
      })
      setTick(t => t + 1)
    }, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <ConversionContext.Provider
      value={{
        jobs,
        setJobs,
        jobEtas: jobEtas.current,
        jobElapsed: jobElapsed.current,
        jobFinalElapsed: jobFinalElapsed.current,
      }}
    >
      {children}
    </ConversionContext.Provider>
  )
}

export function useConversionJobs() {
  return useContext(ConversionContext)
}
