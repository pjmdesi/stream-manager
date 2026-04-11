import React, { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react'
import ReactDOM from 'react-dom'
import {
  Plus, FolderOpen, AlertTriangle, PencilLine, FilePlus,
  RefreshCw, Radio, X, ChevronDown, ImageOff,
  ChevronLeft, ChevronRight, Expand, Archive, CheckSquare,
  Square, CheckCheck, Loader2, CheckCircle2, XCircle, Check,
  Film, Zap, Combine, Youtube, Twitch, ListFilter, Trash2, Tags
} from 'lucide-react'
import type { StreamFolder, StreamMeta, ConversionPreset, YTTitleTemplate, YTDescriptionTemplate, YTTagTemplate, LiveBroadcast } from '../../types'
import { useStore } from '../../hooks/useStore'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { TagComboBox } from '../ui/TagComboBox'
import { ManageTagsModal } from '../ui/ManageTagsModal'
import { Checkbox } from '../ui/Checkbox'
import { getTagColor, pickColorForNewTag } from '../../constants/tagColors'

// ─── Helpers ────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function friendlyDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
  return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })
}

function toFileUrl(absPath: string): string {
  return 'file:///' + absPath.replace(/\\/g, '/')
}

// Normalise legacy string streamType values from stored JSON to the new string[] format
function normalizeStreamTypes(v: string | string[] | undefined): string[] {
  if (!v) return []
  return Array.isArray(v) ? v : [v]
}

// ─── Video count tooltip ─────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function VideoCountTooltip({ videos, children }: { videos: string[]; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [durations, setDurations] = useState<Record<string, number | null>>({})
  const [offlineFiles, setOfflineFiles] = useState<Set<string>>(new Set())
  const anchorRef = useRef<HTMLDivElement>(null)
  const probedRef = useRef(false)

  const show = async () => {
    if (!anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + 6, left: rect.left })
    setVisible(true)
    if (!probedRef.current) {
      probedRef.current = true
      const localFlags = await window.api.checkLocalFiles(videos)
      videos.forEach(async (v, i) => {
        if (!localFlags[i]) {
          setOfflineFiles(prev => new Set([...prev, v]))
          return
        }
        try {
          const info = await window.api.probeFile(v)
          setDurations(prev => ({ ...prev, [v]: info.duration }))
        } catch {
          setDurations(prev => ({ ...prev, [v]: null }))
        }
      })
    }
  }

  if (videos.length === 0) return <>{children}</>

  return (
    <>
      <div ref={anchorRef} onMouseEnter={show} onMouseLeave={() => setVisible(false)}>
        {children}
      </div>
      {visible && ReactDOM.createPortal(
        <div
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
          className="bg-navy-700 border border-white/10 rounded-lg shadow-xl py-1.5 min-w-[220px] max-w-[380px]"
          onMouseEnter={() => setVisible(true)}
          onMouseLeave={() => setVisible(false)}
        >
          {videos.map(v => {
            const name = v.split(/[\\/]/).pop() ?? v
            const dur = durations[v]
            const isOffline = offlineFiles.has(v)
            return (
              <div key={v} className="flex items-center justify-between gap-4 px-3 py-1.5">
                <span className="text-xs text-gray-300 truncate" title={name}>{name}</span>
                <span className="text-xs font-mono shrink-0">
                  {isOffline
                    ? <span className="text-gray-600 italic">cloud</span>
                    : v in durations
                      ? (dur !== null ? <span className="text-gray-500">{formatDuration(dur)}</span> : <span className="text-gray-600">—</span>)
                      : <span className="text-gray-600">…</span>
                  }
                </span>
              </div>
            )
          })}
        </div>,
        document.body
      )}
    </>
  )
}

// ─── Lightbox ────────────────────────────────────────────────────────────────

interface LightboxProps {
  thumbnails: string[]
  index: number
  onClose: () => void
  onNavigate: (index: number) => void
}

function Lightbox({ thumbnails, index, onClose, onNavigate }: LightboxProps) {
  const total = thumbnails.length
  const src = toFileUrl(thumbnails[index])
  const filename = thumbnails[index].split(/[\\/]/).pop() ?? ''

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft')  onNavigate(Math.max(0, index - 1))
      if (e.key === 'ArrowRight') onNavigate(Math.min(total - 1, index + 1))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [index, total, onClose, onNavigate])

  return (
    <div
      className="fixed inset-x-0 bottom-0 top-10 z-50 flex flex-col items-center justify-center bg-black/92 select-none"
      onClick={onClose}
    >
      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors"
      >
        <X size={20} />
      </button>

      {/* Counter */}
      {total > 1 && (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 text-xs text-gray-400 font-mono bg-black/50 px-3 py-1 rounded-full">
          {index + 1} / {total}
        </div>
      )}

      {/* Prev arrow */}
      {index > 0 && (
        <button
          onClick={e => { e.stopPropagation(); onNavigate(index - 1) }}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors"
        >
          <ChevronLeft size={28} />
        </button>
      )}

      {/* Main image */}
      <div className="flex flex-col items-center" onClick={e => e.stopPropagation()}>
        <img
          key={src}
          src={src}
          alt={filename}
          className="max-h-[75vh] max-w-[85vw] object-contain rounded-lg shadow-2xl shadow-black"
          draggable={false}
        />
        <p className="mt-3 text-sm text-gray-400 font-mono">{filename}</p>
      </div>

      {/* Next arrow */}
      {index < total - 1 && (
        <button
          onClick={e => { e.stopPropagation(); onNavigate(index + 1) }}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors"
        >
          <ChevronRight size={28} />
        </button>
      )}

      {/* Filmstrip */}
      {total > 1 && (
        <div
          className="absolute bottom-5 flex gap-2 px-4 py-2 bg-black/60 rounded-xl"
          onClick={e => e.stopPropagation()}
        >
          {thumbnails.map((t, i) => (
            <button
              key={t}
              onClick={() => onNavigate(i)}
              className={`w-16 h-10 rounded overflow-hidden border-2 transition-all ${
                i === index
                  ? 'border-purple-500 opacity-100 scale-105'
                  : 'border-transparent opacity-40 hover:opacity-75'
              }`}
            >
              <img src={toFileUrl(t)} alt="" className="w-full h-full object-cover" draggable={false} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Thumbnail carousel ──────────────────────────────────────────────────────

function ThumbnailCarousel({ thumbnails }: { thumbnails: string[] }) {
  const [index, setIndex] = useState(0)
  const [translateX, setTranslateX] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRefs = useRef<(HTMLImageElement | null)[]>([])
  const single = thumbnails.length === 1

  const recenter = useCallback(() => {
    const el = imgRefs.current[index]
    const container = containerRef.current
    if (!el || !container) return
    const itemCenter = el.offsetLeft + el.offsetWidth / 2
    setTranslateX(container.clientWidth / 2 - itemCenter)
  }, [index])

  useLayoutEffect(() => { recenter() }, [recenter])

  const filename = thumbnails[index].split(/[\\/]/).pop() ?? ''

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative overflow-hidden" style={{ height: 200 }} ref={containerRef}>
        <div
          className="flex items-center gap-2 h-full transition-transform duration-200"
          style={{ transform: `translateX(${translateX}px)` }}
        >
          {thumbnails.map((t, i) => (
            <img
              key={t}
              ref={el => { imgRefs.current[i] = el }}
              src={toFileUrl(t)}
              alt={`Thumbnail ${i + 1}`}
              className={`h-full w-auto shrink-0 cursor-pointer transition-opacity duration-150 ${i === index ? 'opacity-100' : 'opacity-40 hover:opacity-70'}`}
              onClick={() => setIndex(i)}
              onLoad={recenter}
            />
          ))}
        </div>
        {!single && (
          <>
            <button
              onClick={() => setIndex(i => (i - 1 + thumbnails.length) % thumbnails.length)}
              className="absolute left-1 top-1/2 -translate-y-1/2 flex items-center justify-center w-7 h-7 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setIndex(i => (i + 1) % thumbnails.length)}
              className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center w-7 h-7 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </>
        )}
      </div>
      {!single && (
        <p className="text-xs text-gray-500 text-center truncate px-8">{filename}</p>
      )}
    </div>
  )
}

// ─── Metadata modal ─────────────────────────────────────────────────────────

interface MetaModalProps {
  mode: 'new' | 'edit' | 'add'
  initialMeta?: StreamMeta | null
  detectedGames?: string[]
  allGames?: string[]
  allStreamTypes?: string[]
  allFolders?: StreamFolder[]
  templates?: { name: string; path: string }[]
  defaultTemplateName?: string
  thumbnails?: string[]
  tagColors?: Record<string, string>
  onNewStreamType?: (tag: string) => void
  onSave: (meta: StreamMeta, date: string, thumbnailTemplatePath?: string, prevEpisodeFolderPath?: string) => Promise<void>
  onClose: () => void
}

function applyMergeFields(template: string, fields: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => fields[key] ?? `{${key}}`)
}

function detectEpisodeNumber(allFolders: StreamFolder[], gameName: string): number {
  if (!gameName) return 1
  const lower = gameName.toLowerCase()
  const matching = allFolders.filter(f =>
    f.meta?.games?.some(g => g.toLowerCase() === lower)
  )
  return matching.length + 1
}

const PREV_EPISODE_SENTINEL = '__copy_prev_episode__'

function getPrevEpisodeFolder(gamesList: string[], allFolders: StreamFolder[]): StreamFolder | null {
  const mainGame = gamesList[0]
  if (!mainGame) return null
  const episodeNum = detectEpisodeNumber(allFolders, mainGame)
  if (episodeNum <= 1) return null
  const gameLower = mainGame.toLowerCase()
  return allFolders
    .filter(f => f.meta?.games?.some(g => g.toLowerCase() === gameLower))
    .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
}

function MetaModal({ mode, initialMeta, detectedGames = [], allGames = [], allStreamTypes = [], allFolders = [], templates = [], defaultTemplateName = '', thumbnails = [], tagColors = {}, onNewStreamType, onSave, onClose }: MetaModalProps) {
  const defaultTemplate = templates.find(t => t.name === defaultTemplateName) ?? templates[0] ?? null

  const [date, setDate] = useState(initialMeta?.date ?? today())
  const [streamTypes, setStreamTypes] = useState<string[]>(
    normalizeStreamTypes(initialMeta?.streamType)
  )
  const [games, setGames] = useState<string[]>(
    initialMeta?.games?.length ? initialMeta.games : detectedGames
  )

  const prevEpisodeFolder = useMemo(
    () => mode === 'new' ? getPrevEpisodeFolder(games, allFolders) : null,
    [mode, games, allFolders]
  )
  // Only show the copy option if the previous folder actually has thumbnails
  const hasPrevThumbnails = (prevEpisodeFolder?.thumbnails.length ?? 0) > 0

  const [selectedTemplatePath, setSelectedTemplatePath] = useState<string>(() => {
    const initGames = initialMeta?.games?.length ? initialMeta.games : detectedGames
    const initPrevFolder = mode === 'new' ? getPrevEpisodeFolder(initGames, allFolders) : null
    const hasPrev = (initPrevFolder?.thumbnails.length ?? 0) > 0
    return hasPrev ? PREV_EPISODE_SENTINEL : (defaultTemplate?.path ?? '')
  })
  const [comments, setComments] = useState(initialMeta?.comments ?? '')
  const [archived, setArchived] = useState(initialMeta?.archived ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // ── YouTube state ──────────────────────────────────────────────────────────
  const [ytConnected, setYtConnected] = useState(false)
  const [ytTitleTemplates, setYtTitleTemplates] = useState<YTTitleTemplate[]>([])
  const [ytDescTemplates, setYtDescTemplates] = useState<YTDescriptionTemplate[]>([])
  const [ytTagTemplates, setYtTagTemplates] = useState<YTTagTemplate[]>([])
  const [ytBroadcasts, setYtBroadcasts] = useState<LiveBroadcast[]>([])
  const [ytBroadcastError, setYtBroadcastError] = useState('')
  const [ytSelectedBroadcastId, setYtSelectedBroadcastId] = useState('')
  const [ytSelectedTitleId, setYtSelectedTitleId] = useState('')
  const [ytSelectedDescId, setYtSelectedDescId] = useState('')
  const [ytSelectedTagId, setYtSelectedTagId] = useState('')
  const [ytTitle, setYtTitle] = useState(initialMeta?.ytTitle ?? '')
  const [ytDescription, setYtDescription] = useState(initialMeta?.ytDescription ?? '')
  const [ytGameTitle, setYtGameTitle] = useState(initialMeta?.ytGameTitle ?? '')
  const [ytTagsText, setYtTagsText] = useState(initialMeta?.ytTags?.join(', ') ?? '')
  const [ytEpisode, setYtEpisode] = useState('1')
  const [ytCatchyTitle, setYtCatchyTitle] = useState('')
  const [ytPush, setYtPush] = useState(false)

  // ── Twitch state ───────────────────────────────────────────────────────────
  const [twConnected, setTwConnected] = useState(false)
  const [twPush, setTwPush] = useState(false)
  const [syncTitle, setSyncTitle] = useState(initialMeta?.syncTitle ?? true)
  const [twitchTitle, setTwitchTitle] = useState(initialMeta?.twitchTitle ?? '')
  const [twitchGameName, setTwitchGameName] = useState(initialMeta?.twitchGameName ?? '')

  // Keep Twitch title in sync with YT title when syncTitle is on
  useEffect(() => {
    if (syncTitle) setTwitchTitle(ytTitle)
  }, [syncTitle, ytTitle])

  // Auto-fill twitchGameName from first game (same as ytGameTitle)
  useEffect(() => {
    if (games.length > 0) setTwitchGameName(games[0])
  }, [games])

  useEffect(() => {
    window.api.twitchGetStatus?.().then((s: { connected: boolean }) => {
      setTwConnected(s.connected)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    window.api.youtubeGetStatus().then((s: { connected: boolean }) => {
      console.log('[YT renderer] getStatus:', s)
      setYtConnected(s.connected)
      if (!s.connected) return
      Promise.allSettled([
        window.api.getYTTitleTemplates(),
        window.api.getYTDescriptionTemplates(),
        window.api.getYTTagTemplates(),
        window.api.youtubeGetBroadcasts(),
      ]).then(([titlesR, descsR, tagsR, broadcastsR]) => {
        if (titlesR.status === 'fulfilled') setYtTitleTemplates(titlesR.value)
        if (descsR.status === 'fulfilled') setYtDescTemplates(descsR.value)
        if (tagsR.status === 'fulfilled') setYtTagTemplates(tagsR.value)
        if (broadcastsR.status === 'fulfilled') {
          console.log('[YT renderer] broadcasts:', broadcastsR.value?.length ?? 0, broadcastsR.value?.map((b: any) => b.id))
          setYtBroadcasts(broadcastsR.value)
          if (broadcastsR.value.length > 0) setYtSelectedBroadcastId(broadcastsR.value[0].id)
        } else {
          console.error('[YT renderer] getBroadcasts failed:', broadcastsR.reason)
          setYtBroadcastError((broadcastsR.reason as any)?.message ?? 'Failed to load broadcasts')
        }
      })
    }).catch((e: any) => { console.error('[YT renderer] getStatus failed:', e) })
  }, [])

  // Auto-fill game title from first game
  useEffect(() => {
    if (games.length > 0) setYtGameTitle(games[0])
  }, [games])

  // Auto-detect episode
  useEffect(() => {
    if (games.length > 0) setYtEpisode(String(detectEpisodeNumber(allFolders, games[0])))
  }, [games, allFolders])

  // Apply title template when selection or merge fields change
  useEffect(() => {
    const tmpl = ytTitleTemplates.find(t => t.id === ytSelectedTitleId)
    if (!tmpl) return
    setYtTitle(applyMergeFields(tmpl.template, { game: ytGameTitle, episode: ytEpisode, title: ytCatchyTitle }))
  }, [ytSelectedTitleId, ytTitleTemplates, ytGameTitle, ytEpisode, ytCatchyTitle])

  // Apply description template
  useEffect(() => {
    const tmpl = ytDescTemplates.find(t => t.id === ytSelectedDescId)
    if (tmpl) setYtDescription(tmpl.description)
  }, [ytSelectedDescId, ytDescTemplates])

  // Apply tag template
  useEffect(() => {
    const tmpl = ytTagTemplates.find(t => t.id === ytSelectedTagId)
    if (tmpl) setYtTagsText(tmpl.tags.join(', '))
  }, [ytSelectedTagId, ytTagTemplates])

  const handleSave = async () => {
    if (!date) { setError('Date is required.'); return }
    setSaving(true)
    setError('')
    try {
      const tags = ytTagsText.split(',').map(t => t.trim()).filter(Boolean)
      const isPrevEpisode = selectedTemplatePath === PREV_EPISODE_SENTINEL
      const effectiveTwitchTitle = syncTitle ? ytTitle : twitchTitle
      await onSave(
        {
          date, streamType: streamTypes, games, comments,
          archived: mode === 'edit' ? archived : undefined,
          ytVideoId: (ytPush && ytConnected && ytSelectedBroadcastId) ? ytSelectedBroadcastId : undefined,
          ytTitle: ytTitle || undefined,
          ytDescription: ytDescription || undefined,
          ytGameTitle: ytGameTitle || undefined,
          ytTags: tags.length > 0 ? tags : undefined,
          twitchTitle: effectiveTwitchTitle || undefined,
          twitchGameName: twitchGameName || undefined,
          syncTitle,
        },
        date,
        mode === 'new' && !isPrevEpisode ? (selectedTemplatePath || undefined) : undefined,
        mode === 'new' && isPrevEpisode ? (prevEpisodeFolder?.folderPath ?? undefined) : undefined,
      )
      console.log('[YT renderer] save — ytPush:', ytPush, '| ytConnected:', ytConnected, '| broadcastId:', ytSelectedBroadcastId || '(empty)')
      if (ytPush && ytConnected && ytSelectedBroadcastId) {
        await window.api.youtubeUpdateBroadcast(
          ytSelectedBroadcastId,
          { title: ytTitle, description: ytDescription, gameTitle: ytGameTitle || undefined },
          tags
        )
      }
      if (twPush && twConnected) {
        await window.api.twitchUpdateChannel(effectiveTwitchTitle, twitchGameName || undefined)
      }
      onClose()
    } catch (e: any) {
      console.error('[YT debug] error during save:', e)
      setError(e.message)
      setSaving(false)
    }
  }

  const title = mode === 'new' ? 'New Stream' : mode === 'add' ? 'Add Metadata' : 'Edit Metadata'

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={title}
      width="2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={handleSave}>
            {mode === 'new' ? 'Create Stream' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {/* Thumbnail carousel */}
        {thumbnails.length > 0 && (
          <ThumbnailCarousel thumbnails={thumbnails} />
        )}

        {/* Date */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-300">Date</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            disabled={mode !== 'new'}
            className="w-full bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/50 disabled:opacity-50 [color-scheme:dark]"
          />
        </div>

        {/* Stream type */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-300">Stream Type</label>
          <TagComboBox
            values={streamTypes}
            onChange={setStreamTypes}
            allOptions={allStreamTypes}
            placeholder="e.g. games, just chatting…"
            emptyLabel="No types added"
            tagColors={tagColors}
            onNewTag={onNewStreamType}
          />
        </div>

        {/* Topics / Games */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-300">
            Topics / Games
            {detectedGames.length > 0 && !initialMeta && (
              <span className="ml-2 text-xs text-gray-500 font-normal">(auto-detected from files)</span>
            )}
          </label>
          <TagComboBox
            values={games}
            onChange={setGames}
            allOptions={allGames}
            placeholder="Type a topic or game and press Enter…"
            emptyLabel="No topics added"
            compact
          />
        </div>

        {/* Thumbnail template — new streams only */}
        {mode === 'new' && (templates.length > 0 || hasPrevThumbnails) && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-300">Thumbnail Template</label>
            <div className="relative">
              <select
                value={selectedTemplatePath}
                onChange={e => setSelectedTemplatePath(e.target.value)}
                className="w-full appearance-none bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              >
                <option value="">— None —</option>
                {hasPrevThumbnails && (
                  <option value={PREV_EPISODE_SENTINEL}>* Copy Previous Episode Thumbnail *</option>
                )}
                {templates.map(t => (
                  <option key={t.path} value={t.path}>{t.name}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            </div>
          </div>
        )}

        {/* Comments */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-300">Comments</label>
          <textarea
            value={comments}
            onChange={e => setComments(e.target.value)}
            rows={3}
            placeholder="Notes about this stream…"
            className="w-full bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 resize-none"
          />
        </div>

        {/* Archived — only in edit mode */}
        {mode === 'edit' && (
          <div className="flex flex-col gap-1.5">
            <Checkbox checked={archived} onChange={setArchived} label="Archived" color="green" />
            {archived && !initialMeta?.archived && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-950/50 border border-amber-600/30 text-xs text-amber-300/90">
                <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-400" />
                <span>This only marks the stream as archived. To compress and save storage space, use the <strong>Archive</strong> button on the streams page instead.</span>
              </div>
            )}
          </div>
        )}

        {/* ── YouTube ─────────────────────────────────────────────────────── */}
        {ytConnected && (
          <div className="flex flex-col gap-3 pt-1 border-t border-white/5">
            <Checkbox
              checked={ytPush}
              onChange={setYtPush}
              color="red"
              label={<span className="flex items-center gap-1.5 font-medium"><Youtube size={13} className="text-red-400" />Update YouTube live stream info</span>}
            />

            {ytPush && (
              <div className="flex flex-col gap-3 pl-6">
                {/* Broadcast picker */}
                {ytBroadcastError ? (
                  <p className="text-xs text-red-400 flex items-center gap-1.5">
                    <AlertTriangle size={12} className="shrink-0" />
                    {ytBroadcastError}
                  </p>
                ) : ytBroadcasts.length === 0 ? (
                  <p className="text-xs text-gray-500 italic">No upcoming or active broadcasts found.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-gray-400">Broadcast</label>
                    <div className="relative">
                      <select
                        value={ytSelectedBroadcastId}
                        onChange={e => setYtSelectedBroadcastId(e.target.value)}
                        className="w-full appearance-none bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-red-500/40"
                      >
                        {ytBroadcasts.map(b => (
                          <option key={b.id} value={b.id}>{b.snippet.title}</option>
                        ))}
                      </select>
                      <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                    </div>
                  </div>
                )}

                {/* Merge field inputs */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-gray-500"><span className="font-mono text-purple-400">{'{game}'}</span></label>
                    <input
                      value={ytGameTitle}
                      onChange={e => setYtGameTitle(e.target.value)}
                      className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500/40"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-gray-500"><span className="font-mono text-purple-400">{'{episode}'}</span></label>
                    <input
                      value={ytEpisode}
                      onChange={e => setYtEpisode(e.target.value)}
                      className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500/40"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-gray-500"><span className="font-mono text-purple-400">{'{title}'}</span></label>
                    <input
                      value={ytCatchyTitle}
                      onChange={e => setYtCatchyTitle(e.target.value)}
                      placeholder="catchy title…"
                      className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500/40 placeholder-gray-700"
                    />
                  </div>
                </div>

                {/* Editable title */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-gray-400">Title <span className="text-gray-600 font-normal">(editable)</span></label>
                    <InlineTemplateSelect items={ytTitleTemplates} value={ytSelectedTitleId} onChange={setYtSelectedTitleId} />
                  </div>
                  <input
                    value={ytTitle}
                    onChange={e => setYtTitle(e.target.value)}
                    maxLength={100}
                    className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500/40"
                  />
                  <p className="text-right text-xs text-gray-700">{ytTitle.length}/100</p>
                </div>

                {/* Editable description */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-gray-400">Description <span className="text-gray-600 font-normal">(editable)</span></label>
                    <InlineTemplateSelect items={ytDescTemplates} value={ytSelectedDescId} onChange={setYtSelectedDescId} />
                  </div>
                  <textarea
                    value={ytDescription}
                    onChange={e => setYtDescription(e.target.value)}
                    rows={6}
                    className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500/40 resize-y"
                  />
                </div>

                {/* Editable tags */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-gray-400">Tags <span className="text-gray-600 font-normal">(comma-separated, editable)</span></label>
                    <InlineTemplateSelect items={ytTagTemplates} value={ytSelectedTagId} onChange={setYtSelectedTagId} />
                  </div>
                  <textarea
                    value={ytTagsText}
                    onChange={e => setYtTagsText(e.target.value)}
                    rows={2}
                    className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500/40 resize-none"
                  />
                  <p className="text-right text-xs text-gray-700">{ytTagsText.split(',').map(t => t.trim()).filter(Boolean).length} tags</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Twitch ──────────────────────────────────────────────────────── */}
        {twConnected && (
          <div className="flex flex-col gap-3 pt-1 border-t border-white/5">
            <Checkbox
              checked={twPush}
              onChange={setTwPush}
              label={<span className="flex items-center gap-1.5 font-medium"><Twitch size={13} className="text-purple-400" />Update Twitch channel info</span>}
            />

            {twPush && (
              <div className="flex flex-col gap-3 pl-6">
                {/* Sync toggle */}
                <Checkbox checked={syncTitle} onChange={setSyncTitle} label="Sync title with YouTube" size="sm" />

                {/* Separate title when not synced */}
                {!syncTitle && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-gray-400">Twitch title</label>
                    <input
                      value={twitchTitle}
                      onChange={e => setTwitchTitle(e.target.value)}
                      maxLength={140}
                      className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
                    />
                    <p className="text-right text-xs text-gray-700">{twitchTitle.length}/140</p>
                  </div>
                )}

                {syncTitle && ytTitle && (
                  <p className="text-xs text-gray-600 italic">Using YouTube title: <span className="text-gray-500 not-italic">{ytTitle}</span></p>
                )}

                {/* Game / category */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-400">Category (game name)</label>
                  <input
                    value={twitchGameName}
                    onChange={e => setTwitchGameName(e.target.value)}
                    placeholder="e.g. Elden Ring"
                    className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/40 placeholder-gray-700"
                  />
                  <p className="text-xs text-gray-600">Searched against Twitch categories — closest match will be used.</p>
                </div>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </Modal>
  )
}

// ─── Preset picker modal ─────────────────────────────────────────────────────

interface PresetPickerProps {
  onPick: (preset: ConversionPreset, setAsDefault: boolean) => void
  onClose: () => void
}

function PresetPickerModal({ onPick, onClose }: PresetPickerProps) {
  const [presets, setPresets] = useState<ConversionPreset[]>([])
  const [selected, setSelected] = useState<string>('')
  const [setAsDefault, setSetAsDefault] = useState(true)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([window.api.getBuiltinPresets(), window.api.getImportedPresets()])
      .then(([builtin, imported]) => {
        const all = [...builtin, ...imported]
        setPresets(all)
        if (all.length > 0) setSelected(all[0].id)
        setLoading(false)
      })
  }, [])

  const confirm = () => {
    const preset = presets.find(p => p.id === selected)
    if (preset) onPick(preset, setAsDefault)
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Choose Archive Preset"
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={confirm} disabled={!selected || loading}>
            Archive
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-400">No default archive preset is set. Choose which converter preset to use for compression.</p>
        {loading ? (
          <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 size={14} className="animate-spin" /> Loading presets…</div>
        ) : presets.length === 0 ? (
          <p className="text-sm text-yellow-600">No presets found. Configure your presets directory in Settings first.</p>
        ) : (
          <div className="relative">
            <select
              value={selected}
              onChange={e => setSelected(e.target.value)}
              className="w-full appearance-none bg-navy-900 border border-white/10 text-gray-200 text-sm rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            >
              {presets.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          </div>
        )}
        <Checkbox checked={setAsDefault} onChange={setSetAsDefault} label="Save as default archive preset" />
      </div>
    </Modal>
  )
}

// ─── Archive progress modal ───────────────────────────────────────────────────

interface FolderArchiveStatus {
  folderPath: string
  folderName: string
  phase: 'queued' | 'converting' | 'replacing' | 'done' | 'error'
  percent: number
  currentFile: string
  fileIndex: number
  fileCount: number
  error?: string
}

interface ArchiveProgressModalProps {
  statuses: FolderArchiveStatus[]
  onCancel: () => void
  onClose: () => void
  done: boolean
}

function ArchiveProgressModal({ statuses, onCancel, onClose, done }: ArchiveProgressModalProps) {
  const total = statuses.length
  const doneCount = statuses.filter(s => s.phase === 'done').length
  const errorCount = statuses.filter(s => s.phase === 'error').length

  return (
    <Modal
      isOpen
      onClose={done ? onClose : () => {}}
      title={done ? 'Archive Complete' : 'Archiving Streams…'}
      width="md"
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>Close</Button>
        ) : (
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {!done && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 size={14} className="animate-spin text-purple-400" />
            Processing {doneCount + errorCount + 1} of {total}…
          </div>
        )}
        {done && (
          <div className="text-sm text-gray-400">
            {doneCount} archived{errorCount > 0 ? `, ${errorCount} failed` : ''}.
          </div>
        )}
        <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
          {statuses.map(s => (
            <div key={s.folderPath} className="flex flex-col gap-1 p-2 rounded-lg bg-white/5">
              <div className="flex items-center gap-2">
                {s.phase === 'done' && <CheckCircle2 size={14} className="text-green-400 shrink-0" />}
                {s.phase === 'error' && <XCircle size={14} className="text-red-400 shrink-0" />}
                {(s.phase === 'converting' || s.phase === 'replacing') && <Loader2 size={14} className="animate-spin text-purple-400 shrink-0" />}
                {s.phase === 'queued' && <Square size={14} className="text-gray-600 shrink-0" />}
                <span className="text-sm text-gray-200 font-mono">{s.folderName}</span>
                {s.phase !== 'queued' && s.fileCount > 0 && (
                  <span className="text-xs text-gray-600 ml-auto">
                    {s.fileIndex + 1}/{s.fileCount}
                  </span>
                )}
              </div>
              {s.phase === 'converting' && (
                <>
                  <div className="text-xs text-gray-500 truncate pl-5">{s.currentFile}</div>
                  <div className="pl-5">
                    <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500 rounded-full transition-all duration-300"
                        style={{ width: `${s.percent}%` }}
                      />
                    </div>
                  </div>
                </>
              )}
              {s.phase === 'replacing' && (
                <div className="text-xs text-gray-500 pl-5">Replacing original…</div>
              )}
              {s.phase === 'error' && s.error && (
                <div className="text-xs text-red-400 pl-5">{s.error}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

// ─── Inline template select ───────────────────────────────────────────────────

function InlineTemplateSelect<T extends { id: string; name: string }>({
  items,
  value,
  onChange,
  placeholder = 'Template…',
}: {
  items: T[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const selected = items.find(t => t.id === value)

  const close = () => setOpen(false)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const rect = anchorRef.current?.getBoundingClientRect()

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors focus:outline-none"
      >
        <span>{selected ? selected.name : placeholder}</span>
        <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && rect && ReactDOM.createPortal(
        <div
          style={{ position: 'fixed', top: rect.bottom + 4, right: window.innerWidth - rect.right, zIndex: 9999, minWidth: 160 }}
          className="bg-navy-700 border border-white/10 rounded-lg shadow-xl overflow-hidden"
          onMouseDown={e => e.preventDefault()}
        >
          {value && (
            <button
              className="w-full text-left px-3 py-2 text-xs text-gray-500 hover:bg-white/5 transition-colors border-b border-white/5"
              onClick={() => { onChange(''); close() }}
            >
              — Clear —
            </button>
          )}
          {items.length === 0 && (
            <p className="px-3 py-2 text-xs text-gray-600 italic">No templates</p>
          )}
          {items.map(t => (
            <button
              key={t.id}
              className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                t.id === value ? 'text-purple-300 bg-purple-600/20' : 'text-gray-300 hover:bg-white/5'
              }`}
              onClick={() => { onChange(t.id); close() }}
            >
              {t.name}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}

// ─── Bulk tag modal ───────────────────────────────────────────────────────────

function BulkTagModal({
  count,
  allStreamTypes,
  allGames,
  presentStreamTypes,
  presentGames,
  tagColors,
  onNewStreamType,
  onApply,
  onClose,
}: {
  count: number
  allStreamTypes: string[]
  allGames: string[]
  presentStreamTypes: string[]
  presentGames: string[]
  tagColors: Record<string, string>
  onNewStreamType: (tag: string) => void
  onApply: (mode: 'add' | 'remove', streamTypes: string[], games: string[], onProgress: (done: number) => void) => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<'add' | 'remove'>('add')
  const [streamTypes, setStreamTypes] = useState<string[]>([])
  const [games, setGames] = useState<string[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const switchMode = (next: 'add' | 'remove') => {
    setMode(next)
    setStreamTypes([])
    setGames([])
  }

  const canApply = (streamTypes.length > 0 || games.length > 0) && !progress
  const isRemoving = mode === 'remove'

  const handleApply = () => {
    setProgress({ done: 0, total: count })
    onApply(mode, streamTypes, games, (done) => setProgress({ done, total: count }))
  }

  const pct = progress ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <Modal
      isOpen
      onClose={progress ? () => {} : onClose}
      title={`Edit Tags — ${count} stream${count !== 1 ? 's' : ''}`}
      width="sm"
      footer={
        progress ? (
          <div className="flex flex-col gap-2 w-full">
            <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-purple-500 h-full rounded-full transition-all duration-150"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-gray-400 text-center">
              {progress.done} / {progress.total} streams updated…
            </p>
          </div>
        ) : (
          <div className="flex gap-2 justify-end w-full">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              icon={<Tags size={13} />}
              onClick={handleApply}
              disabled={!canApply}
            >
              {isRemoving ? 'Remove from' : 'Add to'} {count}
            </Button>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-5">
        {/* Mode toggle */}
        {!progress && (
          <div className="flex rounded-lg overflow-hidden border border-white/10 self-start">
            <button
              onClick={() => switchMode('add')}
              className={`px-4 py-1.5 text-xs font-medium transition-colors ${mode === 'add' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}`}
            >
              Add Tags
            </button>
            <button
              onClick={() => switchMode('remove')}
              className={`px-4 py-1.5 text-xs font-medium transition-colors border-l border-white/10 ${mode === 'remove' ? 'bg-red-700/70 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}`}
            >
              Remove Tags
            </button>
          </div>
        )}
        {!progress && (
          <p className="text-xs text-gray-500 -mt-2">
            {isRemoving
              ? <>Selected tags will be <span className="text-red-400">removed from</span> each stream's existing tags.</>
              : <>Selected tags will be <span className="text-gray-300">added to</span> each stream's existing tags.</>
            }
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Stream Types</label>
          <TagComboBox
            values={streamTypes}
            onChange={progress ? () => {} : setStreamTypes}
            allOptions={isRemoving ? presentStreamTypes : allStreamTypes}
            placeholder={isRemoving ? 'Select tags to remove…' : 'Type to search or add…'}
            emptyLabel="No stream types selected"
            tagColors={tagColors}
            onNewTag={isRemoving ? undefined : onNewStreamType}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Topics / Games</label>
          <TagComboBox
            values={games}
            onChange={progress ? () => {} : setGames}
            allOptions={isRemoving ? presentGames : allGames}
            placeholder={isRemoving ? 'Select topics to remove…' : 'Type to search or add…'}
            emptyLabel="No topics selected"
            compact
          />
        </div>
      </div>
    </Modal>
  )
}

// ─── Video picker modal ───────────────────────────────────────────────────────

function VideoPickerModal({
  files,
  action,
  onPick,
  onPickAll,
  onClose,
}: {
  files: string[]
  action: 'player' | 'converter' | 'combine'
  onPick: (file: string) => void
  onPickAll?: (files: string[]) => void
  onClose: () => void
}) {
  const isCombine = action === 'combine'
  const title = isCombine ? 'Send to Combine' : `Send to ${action === 'player' ? 'Player' : 'Converter'}`

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={title}
      width="sm"
      footer={
        <div className="flex gap-2 justify-end w-full">
          {isCombine && onPickAll && (
            <Button variant="primary" icon={<Combine size={13} />} onClick={() => { onPickAll(files); onClose() }}>
              Combine All
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-1">
        <p className="text-xs text-gray-500 mb-2">
          {isCombine ? 'Multiple video files found — combine all or pick one:' : 'Multiple video files found — choose one:'}
        </p>
        {files.map(f => {
          const name = f.split(/[\\/]/).pop() ?? f
          return (
            <button
              key={f}
              onClick={() => { onPick(f); onClose() }}
              className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-gray-200 hover:bg-purple-600/20 hover:text-purple-200 border border-transparent hover:border-purple-600/30 transition-colors font-mono truncate"
              title={f}
            >
              {name}
            </button>
          )
        })}
      </div>
    </Modal>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

type ModalState =
  | { mode: 'none' }
  | { mode: 'new' }
  | { mode: 'edit'; folder: StreamFolder }
  | { mode: 'add'; folder: StreamFolder }

interface TreeNode {
  name: string
  isDirectory: boolean
  children?: TreeNode[]
}

async function buildTree(dirPath: string): Promise<TreeNode[]> {
  try {
    const entries = await window.api.listFileNames(dirPath)
    const nodes = await Promise.all(
      entries.map(async (e): Promise<TreeNode> => {
        if (e.isDirectory) {
          return { name: e.name, isDirectory: true, children: await buildTree(`${dirPath}/${e.name}`) }
        }
        return { name: e.name, isDirectory: false }
      })
    )
    return nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  } catch {
    return []
  }
}

export function StreamsPage({
  onSendToPlayer,
  onSendToConverter,
  onSendToCombine,
}: {
  onSendToPlayer: (file: string) => void
  onSendToConverter: (file: string) => void
  onSendToCombine: (files: string[]) => void
}) {
  const { config, updateConfig, loading: configLoading } = useStore()
  const [folders, setFolders] = useState<StreamFolder[]>([])
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState<ModalState>({ mode: 'none' })
  const [showManageTags, setShowManageTags] = useState(false)
  const [tagColors, setTagColors] = useState<Record<string, string>>({})
  const [lightbox, setLightbox] = useState<{ thumbnails: string[]; index: number } | null>(null)

  // Startup warning: archive preset configured but missing
  const [archivePresetWarning, setArchivePresetWarning] = useState(false)

  // Orphan (missing folder) handling
  const [orphanConfirmOpen, setOrphanConfirmOpen] = useState(false)
  const [orphanDismissed, setOrphanDismissed] = useState(false)

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<StreamFolder | null>(null)
  const [deleteTree, setDeleteTree] = useState<TreeNode[]>([])
  const [deleteFileList, setDeleteFileList] = useState<string[]>([])

  useEffect(() => {
    if (!deleteTarget) { setDeleteTree([]); setDeleteFileList([]); return }
    if (isDumpMode) {
      window.api.listFilesForDate(deleteTarget.folderPath, deleteTarget.date).then(setDeleteFileList)
    } else {
      buildTree(deleteTarget.folderPath).then(setDeleteTree)
    }
  }, [deleteTarget])

  useEffect(() => {
    window.api.getStreamTypeTags().then(setTagColors)
  }, [])

  const saveTagColors = useCallback((updated: Record<string, string>) => {
    setTagColors(updated)
    window.api.setStreamTypeTags(updated)
  }, [])

  useEffect(() => {
    if (configLoading || !config.archivePresetId) return
    Promise.all([window.api.getBuiltinPresets(), window.api.getImportedPresets()])
      .then(([builtin, imported]) => {
        const all = [...builtin, ...imported]
        setArchivePresetWarning(!all.some((p: ConversionPreset) => p.id === config.archivePresetId))
      })
  }, [configLoading, config.archivePresetId])

  // Select mode
  const [selectMode, setSelectMode] = useState(false)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const lastClickedIndex = useRef<number | null>(null)
  const lastClickedAction = useRef<'add' | 'remove'>('add')
  const [showBulkTag, setShowBulkTag] = useState(false)

  // Drag-to-select
  const isDragging = useRef(false)
  const dragStartIndex = useRef<number | null>(null)
  const dragAction = useRef<'add' | 'remove'>('add')
  const preDragPaths = useRef<Set<string>>(new Set())
  const dragMoved = useRef(false)

  // Archive
  const [showPresetPicker, setShowPresetPicker] = useState(false)
  const [archiveStatuses, setArchiveStatuses] = useState<FolderArchiveStatus[] | null>(null)
  const [archiveDone, setArchiveDone] = useState(false)

  const [templates, setTemplates] = useState<{ name: string; path: string }[]>([])

  const streamsDir = config.streamsDir
  const streamMode = config.streamMode || 'folder-per-stream'
  const isDumpMode = streamMode === 'dump-folder'

  const loadFolders = useCallback(async (dir: string) => {
    if (!dir) return
    setLoading(true)
    try {
      const result = await window.api.listStreams(dir, streamMode as any)
      setFolders(result)
      const hasMissing = result.some(f => f.isMissing)
      if (hasMissing) {
        setOrphanDismissed(prev => {
          if (!prev) setOrphanConfirmOpen(true)
          return prev
        })
      } else {
        setOrphanDismissed(false)
        setOrphanConfirmOpen(false)
      }
    } catch (_) {}
    setLoading(false)
  }, [streamMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Only re-run when streamsDir or streamMode changes.
  useEffect(() => {
    if (!streamsDir) return
    loadFolders(streamsDir)
    window.api.listStreamTemplates(streamsDir).then(setTemplates)
    window.api.watchStreamsDir(streamsDir, streamMode as any)
    return () => { window.api.unwatchStreamsDir() }
  }, [streamsDir]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh when external changes are detected in the streams directory
  useEffect(() => {
    const unsub = window.api.onStreamsChanged(() => loadFolders(streamsDir))
    return unsub
  }, [streamsDir, loadFolders])

  // Archive progress listener
  useEffect(() => {
    const unsub = window.api.onArchiveProgress((data: any) => {
      setArchiveStatuses(prev => {
        if (!prev) return prev
        return prev.map(s => {
          if (s.folderPath !== data.folderPath) return s
          return {
            ...s,
            phase: data.phase,
            percent: data.percent,
            currentFile: data.fileName,
            fileIndex: data.fileIndex,
            fileCount: data.fileCount,
            error: data.error,
          }
        })
      })
    })
    return unsub
  }, [])

  const pickDir = async () => {
    const dir = await window.api.openDirectoryDialog()
    if (!dir) return
    await updateConfig({ streamsDir: dir })
    loadFolders(dir) // immediate load without waiting for effect
  }

  const [videoPicker, setVideoPicker] = useState<{ files: string[]; action: 'player' | 'converter' | 'combine' } | null>(null)

  const VIDEO_EXTS_RENDERER = new Set([
    '.mkv', '.mp4', '.mov', '.avi', '.ts', '.flv', '.webm',
    '.wmv', '.m4v', '.mpg', '.mpeg', '.m2ts', '.mts', '.vob',
    '.divx', '.3gp', '.ogv', '.asf', '.rmvb', '.f4v', '.hevc'
  ])

  const getVideosForFolder = async (folder: StreamFolder): Promise<string[]> => {
    if (isDumpMode) return folder.videos
    const allFiles = await window.api.listFiles(folder.folderPath)
    return allFiles
      .filter((f: any) => !f.isDirectory && VIDEO_EXTS_RENDERER.has(f.extension?.toLowerCase()))
      .map((f: any) => f.path)
  }

  const sendVideo = async (folder: StreamFolder, action: 'player' | 'converter') => {
    const videos = await getVideosForFolder(folder)
    if (videos.length === 0) return
    if (videos.length === 1) {
      action === 'player' ? onSendToPlayer(videos[0]) : onSendToConverter(videos[0])
    } else {
      setVideoPicker({ files: videos, action })
    }
  }

  const sendToCombine = async (folder: StreamFolder) => {
    const videos = await getVideosForFolder(folder)
    if (videos.length === 0) return
    if (videos.length === 1) {
      onSendToCombine(videos)
    } else {
      setVideoPicker({ files: videos, action: 'combine' })
    }
  }

  const stampArchiveFolder = async () => {
    const dir = await window.api.openDirectoryDialog()
    if (!dir) return
    const count = await window.api.stampArchived(dir, streamMode as any)
    if (count > 0) await loadFolders(streamsDir)
    // brief feedback via title attribute is enough; no modal needed
  }

  const toggleSelectMode = () => {
    setSelectMode(m => !m)
    setSelectedPaths(new Set())
    lastClickedIndex.current = null
  }

  const toggleSelected = (key: string, shiftKey: boolean, index: number) => {
    setSelectedPaths(prev => {
      const next = new Set(prev)
      if (shiftKey && lastClickedIndex.current !== null) {
        const start = Math.min(lastClickedIndex.current, index)
        const end = Math.max(lastClickedIndex.current, index)
        for (let i = start; i <= end; i++) {
          const f = filteredFolders[i]
          const k = f ? selectionKey(f) : undefined
          if (k) lastClickedAction.current === 'add' ? next.add(k) : next.delete(k)
        }
      } else {
        const wasSelected = next.has(key)
        wasSelected ? next.delete(key) : next.add(key)
        lastClickedAction.current = wasSelected ? 'remove' : 'add'
        lastClickedIndex.current = index
      }
      return next
    })
  }

  const selectionKey = (f: StreamFolder) => isDumpMode ? f.date : f.folderPath

  const selectAll = () => setSelectedPaths(new Set(filteredFolders.map(selectionKey)))
  const clearSelection = () => { setSelectedPaths(new Set()); lastClickedIndex.current = null }

  const startDrag = (index: number) => {
    const key = selectionKey(filteredFolders[index])
    isDragging.current = true
    dragStartIndex.current = index
    dragAction.current = selectedPaths.has(key) ? 'remove' : 'add'
    preDragPaths.current = new Set(selectedPaths)
    dragMoved.current = false
  }

  const updateDrag = (index: number) => {
    if (!isDragging.current || dragStartIndex.current === null) return
    dragMoved.current = true
    const start = Math.min(dragStartIndex.current, index)
    const end = Math.max(dragStartIndex.current, index)
    setSelectedPaths(() => {
      const next = new Set(preDragPaths.current)
      for (let i = start; i <= end; i++) {
        const f = filteredFolders[i]
        if (!f) continue
        dragAction.current === 'add' ? next.add(selectionKey(f)) : next.delete(selectionKey(f))
      }
      return next
    })
  }

  useEffect(() => {
    const handler = () => { isDragging.current = false }
    document.addEventListener('mouseup', handler)
    return () => document.removeEventListener('mouseup', handler)
  }, [])

  const startArchive = async (preset: ConversionPreset, setAsDefault: boolean) => {
    if (setAsDefault) await updateConfig({ archivePresetId: preset.id })
    setShowPresetPicker(false)

    const selectedFolders = folders.filter(f => selectedPaths.has(f.folderPath) || selectedPaths.has(f.date))

    const sessions = selectedFolders.map(f => isDumpMode
      ? { folderPath: f.folderPath, date: f.date, filePaths: f.videos }
      : { folderPath: f.folderPath, date: f.date }
    )

    const initialStatuses: FolderArchiveStatus[] = sessions.map(s => ({
      folderPath: s.folderPath,
      folderName: s.date,
      phase: 'queued',
      percent: 0,
      currentFile: '',
      fileIndex: 0,
      fileCount: 0,
    }))
    setArchiveStatuses(initialStatuses)
    setArchiveDone(false)

    await window.api.archiveFolders(sessions, preset)

    setArchiveDone(true)
    await loadFolders(streamsDir)
  }

  const clickArchive = async () => {
    if (selectedPaths.size === 0) return
    if (config.archivePresetId) {
      const [builtin, imported] = await Promise.all([window.api.getBuiltinPresets(), window.api.getImportedPresets()])
      const preset = [...builtin, ...imported].find((p: ConversionPreset) => p.id === config.archivePresetId)
      if (preset) { startArchive(preset, false); return }
    }
    setShowPresetPicker(true)
  }

  const handleBulkEditTags = async (
    mode: 'add' | 'remove',
    editStreamTypes: string[],
    editGames: string[],
    onProgress: (done: number) => void
  ) => {
    const selectedFolders = folders.filter(f => selectedPaths.has(selectionKey(f)))
    const removing = new Set(editStreamTypes)
    const removingGames = new Set(editGames)
    let done = 0
    for (const f of selectedFolders) {
      const existing = f.meta ?? { date: f.date, streamType: [], games: [], comments: '' }
      const merged: StreamMeta = mode === 'add'
        ? {
            ...existing,
            streamType: Array.from(new Set([...normalizeStreamTypes(existing.streamType), ...editStreamTypes])),
            games: Array.from(new Set([...(existing.games ?? []), ...editGames])),
          }
        : {
            ...existing,
            streamType: normalizeStreamTypes(existing.streamType).filter(t => !removing.has(t)),
            games: (existing.games ?? []).filter(g => !removingGames.has(g)),
          }
      await window.api.writeStreamMeta(f.folderPath, merged)
      onProgress(++done)
    }
    setShowBulkTag(false)
    await loadFolders(streamsDir)
  }

  const handleSave = useCallback(async (meta: StreamMeta, date: string, thumbnailTemplatePath?: string, prevEpisodeFolderPath?: string) => {
    if (modal.mode === 'new') {
      await window.api.createStreamFolder(streamsDir, date, meta, thumbnailTemplatePath, prevEpisodeFolderPath, streamMode as any)
    } else if (modal.mode === 'edit' || modal.mode === 'add') {
      await window.api.writeStreamMeta(modal.folder.folderPath, meta)
    }
    await loadFolders(streamsDir)
  }, [modal, streamsDir, loadFolders])

  const missingMetaCount = folders.filter(f => !f.hasMeta).length

  const allGames = useMemo(() => {
    const set = new Set<string>()
    folders.forEach(f => f.meta?.games?.forEach(g => set.add(g)))
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [folders])

  const allStreamTypes = useMemo(() => {
    const set = new Set<string>(Object.keys(tagColors))
    set.add('games')
    set.add('other')
    folders.forEach(f => normalizeStreamTypes(f.meta?.streamType).forEach(t => set.add(t)))
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [folders, tagColors])

  const [filterGames, setFilterGames] = useState<Set<string>>(new Set())
  const [filterType, setFilterType] = useState<string>('all')
  const [openFilter, setOpenFilter] = useState<'type' | 'games' | null>(null)

  const filteredFolders = useMemo(() => {
    return folders.filter(f => {
      if (f.isMissing) return true // always show missing items regardless of filters
      if (filterType !== 'all' && !normalizeStreamTypes(f.meta?.streamType).includes(filterType)) return false
      if (filterGames.size > 0) {
        const fGames = f.meta?.games?.length ? f.meta.games : f.detectedGames
        if (!Array.from(filterGames).every(g => fGames.includes(g))) return false
      }
      return true
    })
  }, [folders, filterGames, filterType])

  const toggleGameFilter = (game: string) => {
    setFilterGames(prev => {
      const next = new Set(prev)
      next.has(game) ? next.delete(game) : next.add(game)
      return next
    })
  }

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!streamsDir) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="p-4 rounded-full bg-white/5">
          <Radio size={36} className="text-gray-600" />
        </div>
        <div className="text-center">
          <p className="text-gray-300 font-medium">No streams directory set</p>
          <p className="text-sm text-gray-600 mt-1">Choose the folder where your stream session folders live.</p>
        </div>
        <Button variant="primary" icon={<FolderOpen size={14} />} onClick={pickDir}>
          Choose Directory
        </Button>
      </div>
    )
  }

  // ── Main view ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 shrink-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">Live Streams</h1>
            <button
              onClick={() => loadFolders(streamsDir)}
              disabled={loading}
              className="p-1 rounded text-gray-600 hover:text-gray-300 hover:bg-white/5 transition-colors"
              title="Reload"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
          <button
            className="text-xs text-gray-500 font-mono truncate mt-0.5 hover:text-gray-300 transition-colors text-left"
            title={streamsDir}
            onClick={() => window.api.openInExplorer(streamsDir)}
          >
            {streamsDir}
          </button>
        </div>
        {selectMode ? (
          <>
            <span className="text-xs text-gray-400">{selectedPaths.size} selected</span>
            <Button variant="ghost" size="sm" onClick={selectedPaths.size === filteredFolders.length ? clearSelection : selectAll}>
              {selectedPaths.size === filteredFolders.length ? 'Deselect All' : 'Select All'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Tags size={14} />}
              onClick={() => setShowBulkTag(true)}
              disabled={selectedPaths.size === 0}
            >
              Edit Tags {selectedPaths.size > 0 ? `(${selectedPaths.size})` : ''}
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Archive size={14} />}
              onClick={clickArchive}
              disabled={selectedPaths.size === 0}
            >
              Archive {selectedPaths.size > 0 ? `(${selectedPaths.size})` : ''}
            </Button>
            <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={toggleSelectMode}>
              Stop Selecting
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" icon={<FolderOpen size={14} />} onClick={pickDir}>
              Change
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Archive size={14} />}
              onClick={stampArchiveFolder}
              title="Stamp an existing archive folder — marks all YYYY-MM-DD subfolders as archived without converting"
            >
              Stamp Archive
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Tags size={14} />}
              onClick={() => setShowManageTags(true)}
            >
              Manage Tags
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<CheckSquare size={14} />}
              onClick={toggleSelectMode}
            >
              Select
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => setModal({ mode: 'new' })}
            >
              New Stream
            </Button>
          </>
        )}
      </div>

      {/* Summary bar */}
      {folders.length > 0 && (
        <div className="flex items-center gap-4 px-6 py-2 border-b border-white/5 bg-navy-800/50 shrink-0 text-xs text-gray-500">
          <span>
            {filteredFolders.length !== folders.length
              ? <>{filteredFolders.length} <span className="text-gray-600">/ {folders.length}</span> sessions</>
              : <>{folders.length} session{folders.length !== 1 ? 's' : ''}</>
            }
          </span>
          {missingMetaCount > 0 && (
            <span className="flex items-center gap-1 text-yellow-600">
              <AlertTriangle size={11} />
              {missingMetaCount} missing metadata
            </span>
          )}
        </div>
      )}

      {/* Missing folders warning banner (shown after user dismisses the confirm modal) */}
      {orphanDismissed && folders.some(f => f.isMissing) && (
        <div className="flex items-center gap-2 px-6 py-2 bg-red-900/20 border-b border-red-700/30 text-xs text-red-400 shrink-0">
          <AlertTriangle size={12} className="shrink-0" />
          <span>
            {folders.filter(f => f.isMissing).length} stream {folders.filter(f => f.isMissing).length === 1 ? 'session' : 'sessions'} {isDumpMode ? 'with no files detected' : 'could not be found on disk'}. Missing items are shown in red below.
          </span>
          <button onClick={() => setOrphanConfirmOpen(true)} className="ml-auto underline hover:text-red-300">
            Review
          </button>
        </div>
      )}

      {/* Archive preset warning */}
      {archivePresetWarning && (
        <div className="flex items-center gap-2 px-6 py-2 bg-yellow-900/20 border-b border-yellow-700/30 text-xs text-yellow-400 shrink-0">
          <AlertTriangle size={12} className="shrink-0" />
          <span>The configured archive preset could not be found. Check your <strong>Presets Directory</strong> in Settings.</span>
          <button onClick={() => setArchivePresetWarning(false)} className="ml-auto text-yellow-600 hover:text-yellow-300">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-hidden pr-2">
      <div className="h-full overflow-y-auto">
        {loading && folders.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-600 text-sm gap-2">
            <RefreshCw size={14} className="animate-spin" /> Loading…
          </div>
        ) : folders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-gray-600">
            <p className="text-sm">No stream folders found in this directory.</p>
            <Button variant="primary" size="sm" icon={<Plus size={12} />} onClick={() => setModal({ mode: 'new' })}>
              Create First Stream
            </Button>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-navy-900 z-10">
              <tr className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {selectMode && <th className="pl-4 py-2.5 w-[40px]" />}
                <th className="px-3 py-2.5 w-[88px]">Thumbnail</th>
                <th className="px-3 py-2.5 w-[56px]"></th>
                <th className="text-left px-4 py-2.5 w-[170px]">Date</th>
                {/* Type column with filter */}
                <th className="text-left px-4 py-2.5 w-[110px]">
                  <div className="relative flex items-center gap-1">
                    <span>Type</span>
                    <button
                      onClick={() => setOpenFilter(openFilter === 'type' ? null : 'type')}
                      className={`p-0.5 rounded transition-colors ${filterType !== 'all' ? 'text-purple-400' : 'text-gray-600 hover:text-gray-400'}`}
                      title="Filter by type"
                    >
                      <ListFilter size={12} />
                    </button>
                    {openFilter === 'type' && (
                      <>
                        <div className="fixed inset-0 z-20" onClick={() => setOpenFilter(null)} />
                        <div className="absolute top-full left-0 mt-1 z-30 bg-navy-700 border border-white/10 rounded-lg shadow-xl overflow-hidden min-w-[120px] max-h-60 overflow-y-auto">
                          {['all', ...allStreamTypes].map(t => {
                            const color = t !== 'all' ? getTagColor(tagColors[t]) : null
                            const isActive = filterType === t
                            return (
                              <button
                                key={t}
                                onClick={() => { setFilterType(t); setOpenFilter(null) }}
                                className={`flex items-center gap-2 w-full px-3 py-2 text-left text-xs capitalize hover:bg-white/5 transition-colors ${isActive ? (color?.text ?? 'text-purple-300') : 'text-gray-300'}`}
                              >
                                {color ? (
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${color.swatch} ${isActive ? 'opacity-100' : 'opacity-30'}`} />
                                ) : (
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'bg-purple-400' : ''}`} />
                                )}
                                {t}
                              </button>
                            )
                          })}
                        </div>
                      </>
                    )}
                  </div>
                </th>
                {/* Topics / Games column with filter */}
                <th className="text-left px-4 py-2.5">
                  <div className="relative flex items-center gap-1">
                    <span>Topics / Games</span>
                    <button
                      onClick={() => setOpenFilter(openFilter === 'games' ? null : 'games')}
                      className={`p-0.5 rounded transition-colors ${filterGames.size > 0 ? 'text-blue-400' : 'text-gray-600 hover:text-gray-400'}`}
                      title="Filter by topic or game"
                    >
                      <ListFilter size={12} />
                    </button>
                    {openFilter === 'games' && (
                      <>
                        <div className="fixed inset-0 z-20" onClick={() => setOpenFilter(null)} />
                        <div className="absolute top-full left-0 mt-1 z-30 bg-navy-700 border border-white/10 rounded-lg shadow-xl overflow-hidden min-w-[160px] max-h-60 overflow-y-auto">
                          {allGames.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-gray-600">No games tagged yet</p>
                          ) : (
                            <>
                              {allGames.map(g => (
                                <button
                                  key={g}
                                  onClick={() => toggleGameFilter(g)}
                                  className={`flex items-center gap-2 w-full px-3 py-2 text-left text-xs hover:bg-white/5 transition-colors ${filterGames.has(g) ? 'text-blue-300' : 'text-gray-300'}`}
                                >
                                  <span className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center ${filterGames.has(g) ? 'bg-blue-500 border-blue-500' : 'border-white/20'}`}>
                                    {filterGames.has(g) && <span className="text-white text-[9px] leading-none">✓</span>}
                                  </span>
                                  {g}
                                </button>
                              ))}
                              {filterGames.size > 0 && (
                                <button
                                  onClick={() => { setFilterGames(new Set()); setOpenFilter(null) }}
                                  className="w-full px-3 py-2 text-left text-xs text-gray-500 hover:text-gray-300 border-t border-white/5 hover:bg-white/5 transition-colors"
                                >
                                  Clear filter
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </th>
                <th className="text-left px-4 py-2.5 w-[200px]">Comments</th>
                <th className="px-4 py-2.5 w-[160px]"></th>
              </tr>
            </thead>
            <tbody>
              {filteredFolders.length === 0 ? (
                <tr><td colSpan={selectMode ? 8 : 7} className="text-center py-12 text-gray-600 text-sm">No sessions match the current filters.</td></tr>
              ) : filteredFolders.map((folder, i) => (
                <StreamRow
                  key={isDumpMode ? folder.date : folder.folderPath}
                  folder={folder}
                  zebra={i % 2 === 0}
                  selectMode={selectMode}
                  selected={selectedPaths.has(selectionKey(folder))}
                  tagColors={tagColors}
                  onToggleSelect={(shiftKey) => {
                    if (dragMoved.current) { dragMoved.current = false; return }
                    toggleSelected(selectionKey(folder), shiftKey, i)
                  }}
                  onDragStart={() => startDrag(i)}
                  onDragEnter={() => updateDrag(i)}
                  onEdit={() => setModal({ mode: 'edit', folder })}
                  onAdd={() => setModal({ mode: 'add', folder })}
                  onOpen={() => isDumpMode && folder.videos.length > 0
                    ? window.api.openInExplorer(folder.videos[0])
                    : window.api.openInExplorer(folder.folderPath)}
                  onDelete={() => setDeleteTarget(folder)}
                  onSendToPlayer={() => sendVideo(folder, 'player')}
                  onSendToConverter={() => sendVideo(folder, 'converter')}
                  onSendToCombine={() => sendToCombine(folder)}
                  onThumbClick={folder.thumbnails.length > 0
                    ? (i) => setLightbox({ thumbnails: folder.thumbnails, index: i })
                    : undefined}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
      </div>

      {/* Lightbox */}

      {lightbox && (
        <Lightbox
          thumbnails={lightbox.thumbnails}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onNavigate={(i) => setLightbox(prev => prev ? { ...prev, index: i } : null)}
        />
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <Modal
          isOpen
          onClose={() => setDeleteTarget(null)}
          title={isDumpMode ? 'Move files to Recycle Bin?' : 'Move folder to Recycle Bin?'}
          width="sm"
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button
                variant="primary"
                size="sm"
                onClick={async () => {
                  const target = deleteTarget
                  setDeleteTarget(null)
                  if (isDumpMode) {
                    await window.api.deleteStreamFiles(target.folderPath, target.date)
                  } else {
                    await window.api.deleteStreamFolder(target.folderPath)
                  }
                  await loadFolders(streamsDir)
                }}
              >
                Move to Recycle Bin
              </Button>
            </>
          }
        >
          <p className="text-sm text-gray-300 mb-3">
            The following will be moved to the Recycle Bin:
          </p>
          <div className="bg-white/5 rounded-lg px-3 py-2.5 mb-3 font-mono text-sm text-gray-200 max-h-64 overflow-y-auto">
            {isDumpMode ? (
              deleteFileList.length === 0
                ? <span className="text-gray-600 italic text-xs">No files found for this date.</span>
                : deleteFileList.map(f => (
                    <div key={f} className="flex items-center gap-1.5 text-gray-500 py-px">
                      <span className="shrink-0 text-gray-700">·</span>
                      <span className="truncate">{f.split(/[\\/]/).pop()}</span>
                    </div>
                  ))
            ) : (
              <TreeView nodes={deleteTree} depth={0} rootName={deleteTarget.folderName} />
            )}
          </div>
          <p className="text-xs text-gray-600">This action can be undone from the Recycle Bin.</p>
        </Modal>
      )}

      {/* Missing folders confirmation modal */}
      <Modal
        isOpen={orphanConfirmOpen}
        onClose={() => { setOrphanConfirmOpen(false); setOrphanDismissed(true) }}
        title={isDumpMode ? 'Stream sessions with no files' : 'Stream folders not found'}
        width="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => { setOrphanConfirmOpen(false); setOrphanDismissed(true) }}>
              Keep
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={async () => {
                const missing = folders.filter(f => f.isMissing)
                await window.api.removeStreamOrphans(streamsDir, missing.map(f => f.folderName))
                setOrphanConfirmOpen(false)
                setOrphanDismissed(false)
                await loadFolders(streamsDir)
              }}
            >
              Remove from records
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-300 mb-3">
          {isDumpMode
            ? 'The following stream sessions have metadata records but no files were detected on disk. They may have been deleted or moved outside of the app.'
            : 'The following stream folders could not be found on disk. They may have been deleted or moved outside of the app.'}
        </p>
        <ul className="space-y-1 mb-3">
          {folders.filter(f => f.isMissing).map(f => (
            <li key={f.folderName} className="flex items-center gap-2 text-sm text-red-400 font-mono">
              <AlertTriangle size={12} className="shrink-0 text-red-500" />
              {f.folderName}
            </li>
          ))}
        </ul>
        <p className="text-xs text-gray-500">
          <strong className="text-gray-400">Remove from records</strong> — deletes their metadata entries from the app.<br />
          <strong className="text-gray-400">Keep</strong> — retains the records and shows a warning in the list.
        </p>
      </Modal>

      {/* Meta modal */}
      {modal.mode !== 'none' && (
        <MetaModal
          mode={modal.mode}
          initialMeta={(modal.mode === 'edit' || modal.mode === 'add') ? modal.folder.meta : null}
          detectedGames={(modal.mode === 'edit' || modal.mode === 'add') ? modal.folder.detectedGames : []}
          thumbnails={(modal.mode === 'edit' || modal.mode === 'add') ? modal.folder.thumbnails : []}
          allGames={allGames}
          allStreamTypes={allStreamTypes}
          allFolders={folders}
          templates={templates}
          defaultTemplateName={config.defaultThumbnailTemplate}
          tagColors={tagColors}
          onNewStreamType={tag => {
            setTagColors(prev => {
              const updated = { ...prev, [tag]: pickColorForNewTag(prev) }
              window.api.setStreamTypeTags(updated)
              return updated
            })
          }}
          onSave={handleSave}
          onClose={() => setModal({ mode: 'none' })}
        />
      )}

      {/* Video picker */}
      {videoPicker && (
        <VideoPickerModal
          files={videoPicker.files}
          action={videoPicker.action}
          onPick={file => {
            if (videoPicker.action === 'player') onSendToPlayer(file)
            else if (videoPicker.action === 'converter') onSendToConverter(file)
            else onSendToCombine([file])
          }}
          onPickAll={videoPicker.action === 'combine' ? onSendToCombine : undefined}
          onClose={() => setVideoPicker(null)}
        />
      )}

      {/* Preset picker */}
      {showPresetPicker && (
        <PresetPickerModal
          onPick={(preset, setAsDefault) => startArchive(preset, setAsDefault)}
          onClose={() => setShowPresetPicker(false)}
        />
      )}

      {/* Archive progress */}
      {archiveStatuses && (
        <ArchiveProgressModal
          statuses={archiveStatuses}
          done={archiveDone}
          onCancel={() => window.api.cancelArchive()}
          onClose={() => {
            setArchiveStatuses(null)
            setArchiveDone(false)
            setSelectMode(false)
            setSelectedPaths(new Set())
          }}
        />
      )}

      {/* Manage Tags */}
      {showManageTags && (
        <ManageTagsModal
          tags={allStreamTypes}
          tagColors={tagColors}
          games={allGames}
          folders={folders}
          onColorChange={(tag, colorKey) => {
            saveTagColors({ ...tagColors, [tag]: colorKey })
          }}
          onAddTag={(name, colorKey) => {
            saveTagColors({ ...tagColors, [name]: colorKey })
          }}
          onDeleteTag={tag => {
            const affected = folders.filter(f =>
              normalizeStreamTypes(f.meta?.streamType).includes(tag)
            )
            Promise.all(
              affected.map(f =>
                window.api.writeStreamMeta(f.folderPath, {
                  ...f.meta!,
                  streamType: normalizeStreamTypes(f.meta?.streamType).filter(t => t !== tag),
                })
              )
            ).then(() => {
              const updated = { ...tagColors }
              delete updated[tag]
              saveTagColors(updated)
              loadFolders(streamsDir)
            })
          }}
          onCombineTags={(dying, survivor) => {
            const allDying = new Set(dying)
            const affected = folders.filter(f =>
              normalizeStreamTypes(f.meta?.streamType).some(t => allDying.has(t))
            )
            Promise.all(
              affected.map(f => {
                const types = normalizeStreamTypes(f.meta?.streamType)
                const merged = types.includes(survivor)
                  ? types.filter(t => !allDying.has(t))
                  : [survivor, ...types.filter(t => !allDying.has(t))]
                return window.api.writeStreamMeta(f.folderPath, { ...f.meta!, streamType: merged })
              })
            ).then(() => {
              const updated = { ...tagColors }
              for (const d of dying) delete updated[d]
              saveTagColors(updated)
              loadFolders(streamsDir)
            })
          }}
          onDeleteGame={game => {
            const affected = folders.filter(f => f.meta?.games?.includes(game))
            Promise.all(
              affected.map(f =>
                window.api.writeStreamMeta(f.folderPath, {
                  ...f.meta!,
                  games: (f.meta!.games ?? []).filter(g => g !== game),
                })
              )
            ).then(() => loadFolders(streamsDir))
          }}
          onCombineGames={(dying, survivor) => {
            const allDying = new Set(dying)
            const affected = folders.filter(f =>
              (f.meta?.games ?? []).some(g => allDying.has(g))
            )
            Promise.all(
              affected.map(f => {
                const gs = f.meta!.games ?? []
                const merged = gs.includes(survivor)
                  ? gs.filter(g => !allDying.has(g))
                  : [survivor, ...gs.filter(g => !allDying.has(g))]
                return window.api.writeStreamMeta(f.folderPath, { ...f.meta!, games: merged })
              })
            ).then(() => loadFolders(streamsDir))
          }}
          onClose={() => setShowManageTags(false)}
        />
      )}

      {/* Bulk tag */}
      {showBulkTag && (() => {
        const selectedFolders = folders.filter(f => selectedPaths.has(selectionKey(f)))
        const presentStreamTypes = Array.from(new Set(selectedFolders.flatMap(f => normalizeStreamTypes(f.meta?.streamType)))).sort()
        const presentGames = Array.from(new Set(selectedFolders.flatMap(f => f.meta?.games ?? []))).sort()
        return (
          <BulkTagModal
            count={selectedPaths.size}
            allStreamTypes={allStreamTypes}
            allGames={allGames}
            presentStreamTypes={presentStreamTypes}
            presentGames={presentGames}
            tagColors={tagColors}
            onNewStreamType={tag => {
              setTagColors(prev => {
                const updated = { ...prev, [tag]: pickColorForNewTag(prev) }
                window.api.setStreamTypeTags(updated)
                return updated
              })
            }}
            onApply={handleBulkEditTags}
            onClose={() => setShowBulkTag(false)}
          />
        )
      })()}
    </div>
  )
}

// ─── Folder tree view ────────────────────────────────────────────────────────

function TreeView({ nodes, depth, rootName }: { nodes: TreeNode[]; depth: number; rootName?: string }) {
  return (
    <div>
      {rootName !== undefined && (
        <div className="flex items-center gap-1.5 text-gray-300 mb-0.5">
          <FolderOpen size={12} className="shrink-0 text-gray-500" />
          <span>{rootName}/</span>
        </div>
      )}
      {nodes.length === 0 && depth === 0 && (
        <div style={{ paddingLeft: 20 }} className="text-gray-600 italic text-xs">Empty folder</div>
      )}
      {nodes.map(node => (
        <div key={node.name} style={{ paddingLeft: rootName !== undefined || depth > 0 ? 20 : 0 }}>
          {node.isDirectory ? (
            <TreeView nodes={node.children ?? []} depth={depth + 1} rootName={node.name} />
          ) : (
            <div className="flex items-center gap-1.5 text-gray-500 py-px">
              <span className="shrink-0 text-gray-700">·</span>
              <span className="truncate">{node.name}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Stream row ──────────────────────────────────────────────────────────────

interface StreamRowProps {
  folder: StreamFolder
  zebra: boolean
  selectMode: boolean
  selected: boolean
  tagColors: Record<string, string>
  onToggleSelect: (shiftKey: boolean) => void
  onDragStart: () => void
  onDragEnter: () => void
  onEdit: () => void
  onAdd: () => void
  onOpen: () => void
  onDelete: () => void
  onSendToPlayer: () => void
  onSendToConverter: () => void
  onSendToCombine: () => void
  onThumbClick?: (index: number) => void
}

function StreamRow({ folder, zebra, selectMode, selected, tagColors, onToggleSelect, onDragStart, onDragEnter, onEdit, onAdd, onOpen, onDelete, onSendToPlayer, onSendToConverter, onSendToCombine, onThumbClick }: StreamRowProps) {
  if (folder.isMissing) {
    return (
      <tr className={`border-b border-red-900/30 ${zebra ? 'bg-red-950/10' : ''}`}>
        {selectMode && <td className="pl-4 align-middle" />}
        <td className="px-3 py-2 align-middle w-[88px]">
          <div className="w-[72px] h-[40px] rounded bg-red-900/20 flex items-center justify-center">
            <AlertTriangle size={14} className="text-red-700" />
          </div>
        </td>
        <td colSpan={selectMode ? 6 : 5} className="px-3 py-3 align-middle">
          <div className="flex items-center gap-3">
            <span className="text-sm font-mono text-red-400">{folder.folderName}</span>
            <span className="text-xs text-red-700 italic">Folder not found on disk</span>
          </div>
        </td>
        <td className="px-4 py-3 align-middle w-[160px]" />
      </tr>
    )
  }

  const { meta, hasMeta, detectedGames, date, thumbnails, videoCount, videos } = folder
  const displayGames = meta?.games?.length ? meta.games : detectedGames
  const firstThumb = thumbnails[0]
  const extraCount = thumbnails.length - 1

  const todayStr = today()
  const isPending = date >= todayStr && !meta?.archived
    && !videos.some(v => {
      const base = v.split(/[\\/]/).pop() ?? ''
      return base.startsWith(date)
    })

  return (
    <tr
      className={`border-b border-white/5 group transition-colors hover:bg-white/[0.03] ${zebra ? 'bg-white/[0.02]' : ''} ${selected ? 'bg-purple-900/10' : ''}`}
      onClick={selectMode ? (e) => onToggleSelect(e.shiftKey) : undefined}
      onMouseDown={selectMode ? (e) => { e.preventDefault(); onDragStart() } : undefined}
      onMouseEnter={selectMode ? onDragEnter : undefined}
      style={selectMode ? { cursor: 'pointer', userSelect: 'none' } : undefined}
    >

      {/* Checkbox */}
      {selectMode && (
        <td className="pl-4 align-middle" onClick={e => { e.stopPropagation(); onToggleSelect(e.shiftKey) }}>
          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${selected ? 'bg-purple-500 border-purple-500' : 'border-gray-600 hover:border-gray-400'}`}>
            {selected && <CheckCheck size={10} className="text-white" />}
          </div>
        </td>
      )}

      {/* Thumbnail */}
      <td className="px-3 py-2 align-middle w-[88px]">
        <div
          className={`relative w-[72px] h-[40px] rounded overflow-hidden shrink-0 ${onThumbClick ? 'cursor-zoom-in' : ''}`}
          onClick={() => onThumbClick?.(0)}
        >
          {firstThumb ? (
            <>
              <img
                src={toFileUrl(firstThumb)}
                alt="thumbnail"
                className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                draggable={false}
              />
              {/* Hover overlay with expand icon */}
              {onThumbClick && (
                <div className="absolute inset-0 bg-black/0 hover:bg-black/35 transition-colors flex items-center justify-center">
                  <Expand size={14} className="text-white opacity-0 hover:opacity-100 transition-opacity drop-shadow" />
                </div>
              )}
              {extraCount > 0 && (
                <span className="absolute bottom-0.5 right-0.5 bg-black/70 text-white text-[10px] font-medium px-1 rounded leading-4 pointer-events-none">
                  +{extraCount}
                </span>
              )}
            </>
          ) : (
            <div className="w-full h-full bg-white/5 flex flex-col items-center justify-center gap-0.5">
              <ImageOff size={14} className="text-gray-700" />
              <span className="text-[9px] text-gray-700 leading-none">none</span>
            </div>
          )}
        </div>
      </td>

      {/* Video count */}
      <td className="px-3 py-3 align-middle w-[56px]">
        <VideoCountTooltip videos={videos}>
          <div className={`flex items-center gap-1 text-xs font-mono cursor-default ${videoCount > 0 ? 'text-gray-400' : 'text-gray-700'}`}>
            <Film size={11} className="shrink-0" />
            <span>{videoCount}</span>
          </div>
        </VideoCountTooltip>
      </td>

      {/* Date */}
      <td className="px-4 py-3 align-middle">
        <div className="flex items-center gap-1.5">
          {meta?.archived && (
            <span className="inline-flex items-center p-0.5 rounded bg-green-900/30 text-green-400 border border-green-800/30 shrink-0" title="Archived">
              <Archive size={10} />
            </span>
          )}
          {isPending && (
            <span className="inline-flex items-center p-0.5 rounded bg-yellow-900/30 text-yellow-400 border border-yellow-800/30 shrink-0" title="Pending — stream hasn't happened yet">
              <Radio size={10} />
            </span>
          )}
          <span className="font-mono text-sm text-gray-200">{date}</span>
        </div>
        <div className="text-xs text-gray-600 mt-0.5">{friendlyDate(date)}</div>
      </td>

      {/* Type */}
      <td className="px-4 py-3 align-middle">
        {meta ? (
          <div className="flex flex-wrap gap-1">
            {normalizeStreamTypes(meta.streamType).map(t => {
              const color = getTagColor(tagColors[t])
              return (
                <span key={t} className={`inline-block text-xs px-2 py-0.5 rounded-full border ${color.chip}`}>
                  {t}
                </span>
              )
            })}
          </div>
        ) : (
          <span className="text-xs text-gray-700">—</span>
        )}
      </td>

      {/* Games */}
      <td className="px-4 py-3 align-middle max-w-[240px]">
        {displayGames.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {displayGames.map(g => (
              <span
                key={g}
                className={`text-xs px-2 py-0.5 rounded-full ${
                  meta?.games?.includes(g)
                    ? 'bg-purple-900/20 text-purple-300 border border-purple-800/20'
                    : 'bg-white/5 text-gray-500 border border-white/10 italic'
                }`}
                title={!meta?.games?.includes(g) ? 'Detected from filename' : undefined}
              >
                {g}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-xs text-gray-700">—</span>
        )}
      </td>

      {/* Comments */}
      <td className="px-4 py-3 align-middle">
        {meta?.comments ? (
          <span className="text-xs text-gray-400 line-clamp-2">{meta.comments}</span>
        ) : (
          <span className="text-xs text-gray-700">—</span>
        )}
      </td>

      {/* Actions */}
      <td className="px-4 py-3 align-middle">
        <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
          {!hasMeta && (
            <span className="flex items-center gap-1 text-xs text-yellow-600 mr-1 shrink-0">
              <AlertTriangle size={11} />
              No meta
            </span>
          )}
          {videoCount > 0 && <Button variant="ghost" size="sm" icon={<Film size={12} />} onClick={onSendToPlayer} title="Send to Player" />}
          {videoCount > 0 && <Button variant="ghost" size="sm" icon={<Zap size={12} />} onClick={onSendToConverter} title="Send to Converter" />}
          {videoCount > 1 && (
            <Button variant="ghost" size="sm" icon={<Combine size={12} />} onClick={onSendToCombine} title="Send to Combine" />
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={hasMeta ? <PencilLine size={12} /> : <FilePlus size={12} />}
            onClick={hasMeta ? onEdit : onAdd}
          >
            {hasMeta ? 'Edit' : 'Add'}
          </Button>
          <Button variant="ghost" size="sm" icon={<FolderOpen size={12} />} onClick={onOpen} />
          <div className="w-px h-3.5 bg-white/10 mx-0.5" />
          <button
            onClick={onDelete}
            className="p-1.5 rounded text-gray-700 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Delete folder"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </td>
    </tr>
  )
}
