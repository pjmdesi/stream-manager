import { useState, useRef, useCallback, useEffect } from 'react'
import { VideoInfo } from '../types'

export interface TrackState {
  index: number
  volume: number
  muted: boolean
  audioEl: HTMLAudioElement | null
  tempPath: string | null
}

export interface VideoPlayerState {
  videoInfo: VideoInfo | null
  tracks: TrackState[]
  isExtracting: boolean
  extractProgress: Record<number, number>
  tracksExtracted: boolean
  isPlaying: boolean
  currentTime: number
  duration: number
  videoUrl: string | null
  filePath: string | null
  error: string | null
}

export function useVideoPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<VideoPlayerState>({
    videoInfo: null,
    tracks: [],
    isExtracting: false,
    extractProgress: {},
    tracksExtracted: false,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    videoUrl: null,
    filePath: null,
    error: null
  })

  const audioElements = useRef<HTMLAudioElement[]>([])
  const tempPaths = useRef<string[]>([])
  const syncInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const isSeeking = useRef(false)
  const pendingSeekTime = useRef<number | null>(null)
  const setupSyncRef = useRef<() => void>(() => {})

  // Cleanup old tracks
  const cleanupTracks = useCallback(async () => {
    audioElements.current.forEach(el => {
      el.pause()
      el.src = ''
    })
    audioElements.current = []

    if (tempPaths.current.length > 0) {
      await window.api.cleanupTracks(tempPaths.current)
      tempPaths.current = []
    }

    if (syncInterval.current) {
      clearInterval(syncInterval.current)
      syncInterval.current = null
    }
  }, [])

  const loadFile = useCallback(async (filePath: string) => {
    setState(prev => ({ ...prev, error: null, isExtracting: false }))
    await cleanupTracks()

    try {
      const info = await window.api.probeFile(filePath)
      const videoUrl = `file://${filePath.replace(/\\/g, '/')}`

      // Unmute video element so the user can play immediately without extraction
      if (videoRef.current) videoRef.current.muted = false

      setState(prev => ({
        ...prev,
        videoInfo: info,
        videoUrl,
        filePath,
        duration: info.duration,
        tracksExtracted: false,
        extractProgress: {},
        tracks: info.audioTracks.map(t => ({
          index: t.index,
          volume: 1,
          muted: false,
          audioEl: null,
          tempPath: null
        }))
      }))
    } catch (err: any) {
      setState(prev => ({ ...prev, error: err.message }))
    }
  }, [cleanupTracks])

  const extractTracks = useCallback(async (selectedIndices: number[]) => {
    const { filePath, videoInfo } = state
    if (!filePath || !videoInfo || videoInfo.audioTracks.length === 0) return

    setState(prev => ({ ...prev, isExtracting: true, extractProgress: {} }))

    // Mute the video element — audio will come from extracted track elements
    if (videoRef.current) videoRef.current.muted = true

    try {
      const unsubProgress = window.api.onExtractProgress(({ trackIndex, percent }) => {
        setState(prev => ({
          ...prev,
          extractProgress: { ...prev.extractProgress, [trackIndex]: percent }
        }))
      })

      const paths = await window.api.extractAudioTracks(filePath, selectedIndices)
      unsubProgress()
      tempPaths.current = paths.filter(Boolean)

      // Only create audio elements for selected (non-empty) paths
      const audioEls: (HTMLAudioElement | null)[] = paths.map((p) => {
        if (!p) return null
        const el = new Audio(`file://${p.replace(/\\/g, '/')}`)
        el.preload = 'auto'
        el.volume = 1
        if (videoRef.current) el.currentTime = videoRef.current.currentTime
        return el
      })
      audioElements.current = audioEls.filter((el): el is HTMLAudioElement => el !== null)

      setState(prev => ({
        ...prev,
        isExtracting: false,
        tracksExtracted: true,
        tracks: prev.tracks.map((t, i) => ({
          ...t,
          audioEl: audioEls[i] || null,
          tempPath: paths[i] || null
        }))
      }))

      setupSyncRef.current()
    } catch (err: any) {
      if (err.message?.includes('cancelled')) return  // handled by cancelExtraction
      if (videoRef.current) videoRef.current.muted = false
      setState(prev => ({ ...prev, error: err.message, isExtracting: false }))
    }
  }, [state])

  const setupSync = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)
    video.addEventListener('seeked', handleSeeked)
    video.addEventListener('timeupdate', handleTimeUpdate)

    // Drift correction every 500ms
    syncInterval.current = setInterval(() => {
      if (!video || video.paused) return
      audioElements.current.forEach(audio => {
        if (!audio) return
        const drift = Math.abs(audio.currentTime - video.currentTime)
        if (drift > 0.15) {
          audio.currentTime = video.currentTime
        }
      })
    }, 500)

    return () => {
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('seeked', handleSeeked)
      video.removeEventListener('timeupdate', handleTimeUpdate)
    }
  }, [])
  setupSyncRef.current = setupSync

  const handlePlay = useCallback(() => {
    setState(prev => ({ ...prev, isPlaying: true }))
    audioElements.current.forEach(audio => {
      if (audio && !audio.muted) audio.play().catch(() => {})
    })
  }, [])

  const handlePause = useCallback(() => {
    setState(prev => ({ ...prev, isPlaying: false }))
    audioElements.current.forEach(audio => audio && audio.pause())
  }, [])

  const handleSeeked = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    audioElements.current.forEach(audio => {
      if (audio) audio.currentTime = video.currentTime
    })
  }, [])

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current
    if (video) {
      setState(prev => ({ ...prev, currentTime: video.currentTime }))
    }
  }, [])

  // Called when video element mounts
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onPlay = () => {
      setState(prev => ({ ...prev, isPlaying: true }))
      audioElements.current.forEach(audio => {
        if (audio) audio.play().catch(() => {})
      })
    }
    const onPause = () => {
      setState(prev => ({ ...prev, isPlaying: false }))
      audioElements.current.forEach(audio => audio && audio.pause())
    }
    const onSeeked = () => {
      audioElements.current.forEach(audio => {
        if (audio) audio.currentTime = video.currentTime
      })
      // Flush any pending scrub position that arrived while a seek was in-flight
      const pending = pendingSeekTime.current
      if (pending !== null) {
        pendingSeekTime.current = null
        video.currentTime = pending
        audioElements.current.forEach(audio => { if (audio) audio.currentTime = pending })
      } else {
        isSeeking.current = false
      }
    }
    const onTimeUpdate = () => {
      setState(prev => ({ ...prev, currentTime: video.currentTime }))
    }

    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('timeupdate', onTimeUpdate)

    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('timeupdate', onTimeUpdate)
    }
  }, [state.videoUrl])

  // Drift correction
  useEffect(() => {
    const id = setInterval(() => {
      const video = videoRef.current
      if (!video || video.paused) return
      audioElements.current.forEach(audio => {
        if (!audio || audio.muted) return
        const drift = Math.abs(audio.currentTime - video.currentTime)
        if (drift > 0.15) {
          audio.currentTime = video.currentTime
        }
      })
    }, 500)
    return () => clearInterval(id)
  }, [state.videoUrl])

  const setTrackVolume = useCallback((trackIndex: number, volume: number) => {
    const audio = audioElements.current[trackIndex]
    if (audio) audio.volume = volume
    setState(prev => ({
      ...prev,
      tracks: prev.tracks.map(t =>
        t.index === trackIndex ? { ...t, volume } : t
      )
    }))
  }, [])

  const setTrackMuted = useCallback((trackIndex: number, muted: boolean) => {
    const audio = audioElements.current[trackIndex]
    if (audio) {
      audio.muted = muted
      if (!muted && videoRef.current && !videoRef.current.paused) {
        audio.play().catch(() => {})
      }
    }
    setState(prev => ({
      ...prev,
      tracks: prev.tracks.map(t =>
        t.index === trackIndex ? { ...t, muted } : t
      )
    }))
  }, [])

  const seek = useCallback((time: number) => {
    const video = videoRef.current
    if (!video) return
    // Cancel any queued scrub position — this is an authoritative exact seek
    pendingSeekTime.current = null
    isSeeking.current = true
    video.currentTime = time
    audioElements.current.forEach(audio => {
      if (audio) audio.currentTime = time
    })
  }, [])

  // Throttled seek for scrub drags. Only one seek is ever in-flight at a time;
  // intermediate positions are dropped, keeping only the latest pending one.
  // Call seek() on mouseup to land on the exact frame.
  const fastSeek = useCallback((time: number) => {
    const video = videoRef.current
    if (!video) return
    if (isSeeking.current) {
      pendingSeekTime.current = time
    } else {
      isSeeking.current = true
      video.currentTime = time
      audioElements.current.forEach(audio => { if (audio) audio.currentTime = time })
    }
  }, [])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      video.play()
    } else {
      video.pause()
    }
  }, [])

  const cancelExtraction = useCallback(async () => {
    await window.api.cancelExtractAudioTracks()
    // Delete any partially-written temp files and reset
    if (tempPaths.current.length > 0) {
      await Promise.allSettled(tempPaths.current.map(p => window.api.deleteFile(p)))
      tempPaths.current = []
    }
    audioElements.current.forEach(el => { el.pause(); el.src = '' })
    audioElements.current = []
    if (videoRef.current) videoRef.current.muted = false
    setState(prev => ({ ...prev, isExtracting: false, extractProgress: {}, tracks: prev.tracks.map(t => ({ ...t, audioEl: null, tempPath: null })) }))
  }, [])

  const resetExtraction = useCallback(() => {
    audioElements.current.forEach(el => { el.pause(); el.src = '' })
    audioElements.current = []
    if (videoRef.current) videoRef.current.muted = false
    setState(prev => ({
      ...prev,
      tracksExtracted: false,
      extractProgress: {},
      tracks: prev.tracks.map(t => ({ ...t, audioEl: null, tempPath: null }))
    }))
  }, [])

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }))
  }, [])

  const closeVideo = useCallback(async () => {
    await cleanupTracks()
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.src = ''
    }
    setState({
      videoInfo: null,
      tracks: [],
      isExtracting: false,
      extractProgress: {},
      tracksExtracted: false,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      videoUrl: null,
      filePath: null,
      error: null
    })
  }, [cleanupTracks])

  return {
    videoRef,
    state,
    loadFile,
    extractTracks,
    cancelExtraction,
    resetExtraction,
    clearError,
    closeVideo,
    setTrackVolume,
    setTrackMuted,
    seek,
    fastSeek,
    togglePlay,
    cleanupTracks,
    audioElements,
  }
}
