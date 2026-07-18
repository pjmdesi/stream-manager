import { useState, useRef, useCallback, useEffect } from 'react'
import { VideoInfo, AudioTrackSetting } from '../types'

// Per-track status. Track 0 is the source's first audio track — always
// 'extracted' because it plays from the <video> element directly. Tracks
// 1+ require an ffmpeg pass (or a cache hit) before they become audible.
export type TrackStatus = 'unextracted' | 'extracting' | 'extracted'

export interface TrackState {
  index: number
  title?: string
  status: TrackStatus
  /** 0–100 while extracting; ignored otherwise. */
  extractProgress: number
  /** Filesystem path to the cached .opus, when status === 'extracted' and index > 0. */
  cachedPath?: string
  /** HTMLAudioElement playing this track. Only present for index > 0 in 'extracted' state. */
  audioEl?: HTMLAudioElement | null
  muted: boolean
  solo: boolean
  /** 0–1. */
  volume: number
  /** Tag-color key for the swatch dot + waveform fill. Undefined =
   *  fall back to the index-based default rotation in tagColors. */
  color?: string
}

export interface VideoPlayerState {
  videoInfo: VideoInfo | null
  tracks: TrackState[]
  /** True iff the user has explicitly enabled multi-track playback for this file. */
  multiTrackEnabled: boolean
  isPlaying: boolean
  currentTime: number
  duration: number
  videoUrl: string | null
  filePath: string | null
  error: string | null
}

/** Compute and apply effective audibility across the video element +
 *  all extracted audio elements, given the current set of M/S flags.
 *  When any track has solo=true, every non-solo track is forced silent
 *  regardless of its own muted flag — standard DAW behaviour. */
function applyAudibility(
  tracks: TrackState[],
  multiTrackEnabled: boolean,
  video: HTMLVideoElement | null,
) {
  if (!video) return
  if (!multiTrackEnabled) {
    // Plain single-track playback. Video plays at full volume; whatever
    // audio elements may exist (from a previous enable) should be silent.
    video.muted = false
    video.volume = 1
    for (const t of tracks) {
      if (t.audioEl) {
        t.audioEl.muted = true
        t.audioEl.pause()
      }
    }
    return
  }
  const anySolo = tracks.some(t => t.solo)
  for (const t of tracks) {
    const effectivelyMuted = anySolo ? !t.solo : t.muted
    if (t.index === 0) {
      video.muted = effectivelyMuted
      video.volume = t.volume
    } else if (t.audioEl) {
      t.audioEl.muted = effectivelyMuted
      t.audioEl.volume = t.volume
      if (!effectivelyMuted && !video.paused) {
        t.audioEl.play().catch(() => {})
      } else if (effectivelyMuted) {
        t.audioEl.pause()
      }
    }
  }
}

function makeDefaultTrackState(
  index: number,
  title?: string,
  saved?: AudioTrackSetting,
): TrackState {
  return {
    index,
    title,
    // Track 0 is always 'extracted' (lives on the <video> element).
    status: index === 0 ? 'extracted' : 'unextracted',
    extractProgress: 0,
    audioEl: null,
    muted: saved?.muted ?? false,
    solo: saved?.solo ?? false,
    volume: saved?.volume ?? 1,
    color: saved?.color,
  }
}

export function useVideoPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<VideoPlayerState>({
    videoInfo: null,
    tracks: [],
    multiTrackEnabled: false,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    videoUrl: null,
    filePath: null,
    error: null,
  })

  // Tracks snapshot kept in sync via effect — used by callbacks that need
  // the current per-track state without retriggering on every render.
  const tracksRef = useRef<TrackState[]>([])
  useEffect(() => { tracksRef.current = state.tracks }, [state.tracks])
  const multiTrackEnabledRef = useRef(false)
  useEffect(() => { multiTrackEnabledRef.current = state.multiTrackEnabled }, [state.multiTrackEnabled])

  const isSeeking = useRef(false)
  const pendingSeekTime = useRef<number | null>(null)
  // Current playback rate — remembered so audio-track elements created
  // later (extraction finishing mid-session) and files loaded later
  // inherit it. See setPlaybackRate below.
  const playbackRateRef = useRef(1)
  // True when the video was playing as a seek started — re-asserted once the
  // seek settles, so a pause sneaking in mid-seek (an aborted play() promise,
  // engine hiccups on rapid successive seeks) can't leave the video stuck
  // paused after a skip. Cleared by an explicit user pause.
  const resumeAfterSeek = useRef(false)
  // Monotonic load-session token, bumped by loadFile/closeVideo. Async work
  // started against a previous file (track extraction, its progress events)
  // checks it before landing results — a late extraction used to graft the
  // OLD file's audio onto the NEW file's track state and play it "in sync".
  const loadSessionRef = useRef(0)

  // Detach all extracted audio elements (does NOT delete cache files —
  // the persistent cache survives so re-enabling is cheap).
  const releaseAudioElements = useCallback(() => {
    for (const t of tracksRef.current) {
      if (t.audioEl) {
        t.audioEl.pause()
        t.audioEl.src = ''
      }
    }
  }, [])

  const loadFile = useCallback(async (
    filePath: string,
    savedSettings?: Record<number, AudioTrackSetting>,
  ) => {
    setState(prev => ({ ...prev, error: null }))
    loadSessionRef.current++
    // A stale resume flag from the previous file must not auto-play this one
    // on its first seek.
    resumeAfterSeek.current = false
    // A seek still settling on the previous file must not deaden scrubbing
    // on this one — these were never reset, so the scrollbar needle
    // (fastSeek-gated on !isSeeking) went inert until something forced a
    // full seek().
    isSeeking.current = false
    pendingSeekTime.current = null
    // Kill in-flight extractions from the previous file. Their late
    // resolutions are token-guarded in playTrack too; this just stops
    // orphaned ffmpeg jobs from burning CPU for a file we've left.
    void window.api.cancelExtractAudioTracks()
    releaseAudioElements()

    try {
      const info = await window.api.probeFile(filePath)
      const videoUrl = `file://${filePath.replace(/\\/g, '/')}`

      if (videoRef.current) {
        videoRef.current.muted = false
        videoRef.current.volume = 1
      }

      setState(prev => ({
        ...prev,
        videoInfo: info,
        videoUrl,
        filePath,
        duration: info.duration,
        multiTrackEnabled: false,
            tracks: info.audioTracks.map((t, i) =>
          makeDefaultTrackState(i, t.title, savedSettings?.[i]),
        ),
      }))
    } catch (err: any) {
      setState(prev => ({ ...prev, error: err.message }))
    }
  }, [releaseAudioElements])

  // ── Multi-track mode ────────────────────────────────────────────────────

  /** Enable the multi-track UI. Auto-attaches Audio elements for any
   *  tracks already in the persistent cache so re-opening a file the user
   *  has worked with skips the extraction round-trip. Track 0 needs no
   *  extraction — it's already on the <video>. */
  const enableMultiTrack = useCallback(async () => {
    const filePath = state.filePath
    if (!filePath) return
    setState(prev => ({ ...prev, multiTrackEnabled: true }))

    let cached: string[] | null = null
    try {
      cached = await window.api.getCachedAudioTracks(filePath)
    } catch { /* no-op */ }
    if (!cached) {
      // No cached tracks — Track 0 is already audible from the video
      // element; tracks 1+ will sit in 'unextracted' until the user
      // clicks "Play this track".
      requestAnimationFrame(() => {
        applyAudibility(tracksRef.current, true, videoRef.current)
      })
      return
    }

    // For each cached slot (index > 0), instantiate an Audio element and
    // mark the track as 'extracted'. Track 0 is always 'extracted'.
    setState(prev => {
      const tracks = prev.tracks.map((t, i) => {
        if (i === 0) return t
        const path = cached?.[i]
        if (!path) return t
        const el = new Audio(`file://${path.replace(/\\/g, '/')}`)
        el.preload = 'auto'
        el.volume = t.volume
        el.muted = t.muted
        el.playbackRate = playbackRateRef.current
        el.defaultPlaybackRate = playbackRateRef.current
        const video = videoRef.current
        if (video) el.currentTime = video.currentTime
        return { ...t, status: 'extracted' as TrackStatus, cachedPath: path, audioEl: el }
      })
      return { ...prev, tracks }
    })

    requestAnimationFrame(() => {
      applyAudibility(tracksRef.current, true, videoRef.current)
    })
  }, [state.filePath])

  /** Tear down: release Audio elements, reset video element, drop M/S/volume
   *  in-state (saved values stay in StreamMeta so a future re-enable still
   *  picks them up). Does NOT delete the cached .opus files. */
  const disableMultiTrack = useCallback(() => {
    // Kill any in-flight ffmpeg extractions so disabling doesn't leave
    // orphaned jobs running in the main process after teardown.
    void window.api.cancelExtractAudioTracks()
    releaseAudioElements()
    if (videoRef.current) {
      videoRef.current.muted = false
      videoRef.current.volume = 1
    }
    setState(prev => ({
      ...prev,
      multiTrackEnabled: false,
        tracks: prev.tracks.map((t, i) => ({
        ...t,
        status: i === 0 ? ('extracted' as TrackStatus) : ('unextracted' as TrackStatus),
        extractProgress: 0,
        audioEl: null,
        cachedPath: undefined,
      })),
    }))
  }, [releaseAudioElements])

  /** Extract a single track (cache-aware via the IPC handler). Multiple
   *  playTrack calls can run in parallel — the main process queues
   *  per-call cancel handles so each ffmpeg invocation lives on its own
   *  and cancelExtraction() kills every in-flight job at once. We skip
   *  duplicate triggers for a track that's already mid-extraction. */
  const playTrack = useCallback(async (index: number) => {
    const filePath = state.filePath
    if (!filePath || index === 0) return
    // Guards every async landing below: if the loaded file changed while
    // ffmpeg ran, this result belongs to the previous session and must be
    // dropped, not grafted onto the new file's track list.
    const session = loadSessionRef.current
    const already = tracksRef.current.find(t => t.index === index)?.status
    if (already === 'extracting' || already === 'extracted') return

    setState(prev => ({
      ...prev,
      tracks: prev.tracks.map(t =>
        t.index === index ? { ...t, status: 'extracting', extractProgress: 0 } : t
      ),
    }))

    const unsubProgress = window.api.onExtractProgress(({ trackIndex, percent }) => {
      if (trackIndex !== index || session !== loadSessionRef.current) return
      setState(prev => ({
        ...prev,
        tracks: prev.tracks.map(t =>
          t.index === trackIndex ? { ...t, extractProgress: percent } : t
        ),
      }))
    })

    try {
      const paths = await window.api.extractAudioTracks(filePath, [index])
      if (session !== loadSessionRef.current) return
      const path = paths[index]
      if (!path) throw new Error(`Track ${index} extraction returned no path`)

      const el = new Audio(`file://${path.replace(/\\/g, '/')}`)
      el.preload = 'auto'
      const trackBefore = tracksRef.current.find(t => t.index === index)
      el.volume = trackBefore?.volume ?? 1
      el.muted = trackBefore?.muted ?? false
      el.playbackRate = playbackRateRef.current
      el.defaultPlaybackRate = playbackRateRef.current
      const video = videoRef.current
      if (video) el.currentTime = video.currentTime

      setState(prev => ({
        ...prev,
            tracks: prev.tracks.map(t =>
          t.index === index
            ? { ...t, status: 'extracted' as TrackStatus, cachedPath: path, audioEl: el, extractProgress: 100 }
            : t
        ),
      }))

      requestAnimationFrame(() => {
        applyAudibility(tracksRef.current, multiTrackEnabledRef.current, videoRef.current)
      })
    } catch (err: any) {
      // A stale failure (including the cancel loadFile fires on switch)
      // must not touch the NEW file's track state — its track at this
      // index may be legitimately extracting right now.
      if (session !== loadSessionRef.current) return
      if (!err?.message?.includes('cancelled')) {
        setState(prev => ({ ...prev, error: err.message }))
      }
      setState(prev => ({
        ...prev,
            tracks: prev.tracks.map(t =>
          t.index === index ? { ...t, status: 'unextracted' as TrackStatus, extractProgress: 0 } : t
        ),
      }))
    } finally {
      unsubProgress()
    }
  }, [state.filePath])

  const cancelExtraction = useCallback(async () => {
    await window.api.cancelExtractAudioTracks()
    setState(prev => ({
      ...prev,
        tracks: prev.tracks.map(t =>
        t.status === 'extracting' ? { ...t, status: 'unextracted' as TrackStatus, extractProgress: 0 } : t
      ),
    }))
  }, [])

  /** Cancel a single in-flight track extraction, leaving any others running.
   *  The matching playTrack() promise will reject with 'cancelled' and reset
   *  the track too — resetting here first gives immediate UI feedback rather
   *  than waiting for ffmpeg to die. */
  const cancelTrackExtraction = useCallback(async (index: number) => {
    await window.api.cancelExtractAudioTracks(index)
    setState(prev => ({
      ...prev,
      tracks: prev.tracks.map(t =>
        t.index === index && t.status === 'extracting'
          ? { ...t, status: 'unextracted' as TrackStatus, extractProgress: 0 }
          : t
      ),
    }))
  }, [])

  // ── Per-track controls ─────────────────────────────────────────────────

  const setTrackMuted = useCallback((index: number, muted: boolean) => {
    setState(prev => {
      const tracks = prev.tracks.map(t => t.index === index ? { ...t, muted } : t)
      requestAnimationFrame(() => {
        applyAudibility(tracksRef.current, multiTrackEnabledRef.current, videoRef.current)
      })
      return { ...prev, tracks }
    })
  }, [])

  const setTrackSolo = useCallback((index: number, solo: boolean) => {
    setState(prev => {
      const tracks = prev.tracks.map(t => t.index === index ? { ...t, solo } : t)
      requestAnimationFrame(() => {
        applyAudibility(tracksRef.current, multiTrackEnabledRef.current, videoRef.current)
      })
      return { ...prev, tracks }
    })
  }, [])

  const setTrackVolume = useCallback((index: number, volume: number) => {
    setState(prev => {
      const tracks = prev.tracks.map(t => t.index === index ? { ...t, volume } : t)
      requestAnimationFrame(() => {
        applyAudibility(tracksRef.current, multiTrackEnabledRef.current, videoRef.current)
      })
      return { ...prev, tracks }
    })
  }, [])

  /** Update a track's color (tag-palette key). Purely visual — does not
   *  touch audibility. Pass undefined to clear and fall back to the
   *  index-based default. */
  const setTrackColor = useCallback((index: number, colorKey: string | undefined) => {
    setState(prev => ({
      ...prev,
      tracks: prev.tracks.map(t => t.index === index ? { ...t, color: colorKey } : t),
    }))
  }, [])

  // ── Video element wiring ───────────────────────────────────────────────

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onPlay = () => {
      setState(prev => ({ ...prev, isPlaying: true }))
      // Honour the effective-audibility table on play so muted/solo'd tracks
      // don't start sounding when the user hits Play.
      for (const t of tracksRef.current) {
        if (!t.audioEl) continue
        if (!t.audioEl.muted) t.audioEl.play().catch(() => {})
      }
    }
    const onPause = () => {
      setState(prev => ({ ...prev, isPlaying: false }))
      for (const t of tracksRef.current) {
        if (t.audioEl) t.audioEl.pause()
      }
    }
    const onSeeked = () => {
      for (const t of tracksRef.current) {
        if (t.audioEl) t.audioEl.currentTime = video.currentTime
      }
      const pending = pendingSeekTime.current
      if (pending !== null) {
        pendingSeekTime.current = null
        video.currentTime = pending
        for (const t of tracksRef.current) {
          if (t.audioEl) t.audioEl.currentTime = pending
        }
      } else {
        isSeeking.current = false
        // The seek settled — restore the play state captured when it started.
        // No-op in the normal case (still playing). Skips resuming at the very
        // end: a forward skip clamped to the duration legitimately ends (and
        // pauses) the video, and fighting that would loop the last frame.
        if (resumeAfterSeek.current) {
          resumeAfterSeek.current = false
          if (video.paused && !video.ended) video.play().catch(() => {})
        }
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

  // Drift correction — audio elements have independent clocks, so they
  // gradually slip from the video. Snap any track that strays beyond
  // 150ms back to the video's currentTime.
  useEffect(() => {
    const id = setInterval(() => {
      const video = videoRef.current
      if (!video || video.paused) return
      for (const t of tracksRef.current) {
        if (!t.audioEl || t.audioEl.muted) continue
        const drift = Math.abs(t.audioEl.currentTime - video.currentTime)
        if (drift > 0.15) t.audioEl.currentTime = video.currentTime
      }
    }, 500)
    return () => clearInterval(id)
  }, [state.videoUrl])

  // ── Seek + play control ────────────────────────────────────────────────

  const seek = useCallback((time: number) => {
    const video = videoRef.current
    if (!video) return
    if (!video.paused && !video.ended) resumeAfterSeek.current = true
    pendingSeekTime.current = null
    isSeeking.current = true
    video.currentTime = time
    for (const t of tracksRef.current) {
      if (t.audioEl) t.audioEl.currentTime = time
    }
  }, [])

  const fastSeek = useCallback((time: number) => {
    const video = videoRef.current
    if (!video) return
    if (!video.paused && !video.ended) resumeAfterSeek.current = true
    if (isSeeking.current) {
      pendingSeekTime.current = time
      // Keep the UI playhead/timecode advancing while the decoder lags —
      // held skips must stay responsive even when frame-accurate seeks
      // can't keep up; the frame renders when the chained seek lands
      // (possibly after the key is released).
      setState(prev => ({ ...prev, currentTime: time }))
    } else {
      isSeeking.current = true
      video.currentTime = time
      for (const t of tracksRef.current) {
        if (t.audioEl) t.audioEl.currentTime = time
      }
    }
  }, [])

  /** Apply a playback rate to the video AND every extracted audio track —
   *  rate-mismatched track elements drift instantly and the 500ms drift
   *  snapper would fight them forever. defaultPlaybackRate is set too so
   *  later loads (new src resets the element to its default) inherit it. */
  const setPlaybackRate = useCallback((rate: number) => {
    playbackRateRef.current = rate
    const video = videoRef.current
    if (video) { video.playbackRate = rate; video.defaultPlaybackRate = rate }
    for (const t of tracksRef.current) {
      if (t.audioEl) { t.audioEl.playbackRate = rate; t.audioEl.defaultPlaybackRate = rate }
    }
  }, [])

  /** The LOGICAL playhead: the newest requested target while a seek chain is
   *  in flight, else the element's current time. Repeated relative seeks
   *  (held skip keys) accumulate on this — basing them on the rendered time
   *  stalled the gesture whenever one seek outlived the repeat interval. */
  const getSeekTarget = useCallback((): number => {
    const video = videoRef.current
    if (!video) return 0
    return pendingSeekTime.current ?? video.currentTime
  }, [])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      video.play().catch((err: DOMException) => {
        // AbortError = a load/pause interrupted the play() — routine
        // during rapid seeks and file switches. Anything else (e.g.
        // NotSupportedError on an undecodable file) used to vanish
        // silently, leaving a black frame with live-looking controls.
        if (err?.name === 'AbortError') return
        setState(prev => ({ ...prev, error: `Playback failed: ${err?.message ?? String(err)}` }))
      })
    } else {
      // A deliberate pause always wins — including one made while a seek is
      // still settling. Without this, the resume-after-seek guard would undo
      // the user's pause a moment later.
      resumeAfterSeek.current = false
      video.pause()
    }
  }, [])

  /** Re-derive video.muted / audioEl.muted from the current track M/S state.
   *  External callers (e.g. the bleep logic) that bypass the system to force
   *  silence temporarily call this when they're done so the user's chosen
   *  audibility comes back. */
  const recomputeAudibility = useCallback(() => {
    applyAudibility(tracksRef.current, multiTrackEnabledRef.current, videoRef.current)
  }, [])

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }))
  }, [])

  // Surface decode failures. There was no error listener on the <video>
  // element at all — an unsupported codec (.wmv, HEVC without the codec
  // pack, MPEG-2) rendered a black frame with live-looking controls and
  // no message anywhere. Re-attached whenever the source changes so the
  // listener exists even if the element mounted after the hook.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onError = () => {
      // Clearing the src (closeVideo, file switch) fires a spurious
      // "src not supported" for the empty source — ignore those.
      if (!v.src) return
      const me = v.error
      const codecProblem = me?.code === MediaError.MEDIA_ERR_DECODE
        || me?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
      setState(prev => ({
        ...prev,
        isPlaying: false,
        error: codecProblem
          ? 'Can’t play this file: its codec isn’t supported by the built-in player. Convert it (H.264/MP4) in the Converter to view it here.'
          : `Video playback error${me?.message ? `: ${me.message}` : ''}`,
      }))
    }
    v.addEventListener('error', onError)
    return () => v.removeEventListener('error', onError)
  }, [state.videoUrl])

  const closeVideo = useCallback(async () => {
    loadSessionRef.current++
    resumeAfterSeek.current = false
    isSeeking.current = false
    pendingSeekTime.current = null
    void window.api.cancelExtractAudioTracks()
    releaseAudioElements()
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.src = ''
    }
    setState({
      videoInfo: null,
      tracks: [],
      multiTrackEnabled: false,
        isPlaying: false,
      currentTime: 0,
      duration: 0,
      videoUrl: null,
      filePath: null,
      error: null,
    })
  }, [releaseAudioElements])

  // In-progress OBS recordings ffprobe with duration 0, which left a dead
  // timeline and skip-to-0 buttons. Adopt the element's real duration once
  // its metadata (or a later duration revision) lands — only ever FILLS a
  // missing/zero duration, so authoritative probe values stay untouched.
  const handleDurationChange = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    const d = el.duration
    if (Number.isFinite(d) && d > 0) {
      setState(prev => prev.duration > 0 ? prev : { ...prev, duration: d })
    }
  }, [])

  return {
    videoRef,
    state,
    loadFile,
    handleDurationChange,
    enableMultiTrack,
    disableMultiTrack,
    playTrack,
    cancelExtraction,
    cancelTrackExtraction,
    setTrackMuted,
    setTrackSolo,
    setTrackVolume,
    setTrackColor,
    recomputeAudibility,
    seek,
    fastSeek,
    getSeekTarget,
    setPlaybackRate,
    togglePlay,
    clearError,
    closeVideo,
  }
}
