import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Radio, Film, Check, Loader2, AlertCircle, Globe, Link as LinkIcon, Lock, ExternalLink, CheckCircle, X } from 'lucide-react'
import type { YouTubeImportVideo } from '../../types'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Tooltip } from '../ui/Tooltip'
import { TruncatedText } from '../ui/TruncatedText'
import { useStore } from '../../hooks/useStore'

function fmtDuration(s?: number): string {
  if (!s || s <= 0) return ''
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

// Matches YouTube Studio / the streams list: Globe = public, Link = unlisted,
// Lock = private.
const PRIVACY: Record<string, { label: string; cls: string; Icon: typeof Globe }> = {
  public: { label: 'Public', cls: 'text-green-300 border-green-400/40', Icon: Globe },
  unlisted: { label: 'Unlisted', cls: 'text-amber-300 border-amber-400/40', Icon: LinkIcon },
  private: { label: 'Private', cls: 'text-gray-400 border-white/20', Icon: Lock },
}

const SELECT_CLS =
  'appearance-none bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg pl-2 pr-6 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500/50'

/**
 * Phase 1 of "Import from YouTube": a read-only picker listing the connected
 * channel's videos (metadata + thumbnail). Search / sort / filter + multi-select
 * with already-imported videos flagged and excluded from selection. The Import
 * action itself lands in the next phase — the button is disabled here.
 */
export function YouTubeImportModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [videos, setVideos] = useState<YouTubeImportVideo[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [sortDir, setSortDir] = useState<'newest' | 'oldest'>('newest')
  const [filterType, setFilterType] = useState<'all' | 'live' | 'video'>('all')
  const [filterPrivacy, setFilterPrivacy] = useState<'all' | 'public' | 'unlisted' | 'private'>('all')
  const [hideImported, setHideImported] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const lastClickedRef = useRef<string | null>(null)
  const { config } = useStore()
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null)
  const [summary, setSummary] = useState<{ title: string; ok: boolean }[] | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setVideos(null); setLoadError(null); setSelected(new Set()); lastClickedRef.current = null
    setImporting(false); setImportProgress(null); setSummary(null)
    let cancelled = false
    Promise.all([window.api.youtubeListChannelVideos(), window.api.streamsGetLinkedYouTubeIds()])
      .then(([vids, ids]) => { if (cancelled) return; setVideos(vids); setLinkedIds(new Set(ids)) })
      .catch(e => { if (!cancelled) setLoadError(e?.message ?? String(e)) })
    return () => { cancelled = true }
  }, [isOpen])

  const visible = useMemo(() => {
    if (!videos) return []
    const q = search.trim().toLowerCase()
    const list = videos.filter(v => {
      if (q && !v.title.toLowerCase().includes(q)) return false
      if (filterType === 'live' && !v.isLivestream) return false
      if (filterType === 'video' && v.isLivestream) return false
      if (filterPrivacy !== 'all' && v.privacyStatus !== filterPrivacy) return false
      if (hideImported && linkedIds.has(v.videoId)) return false
      return true
    })
    list.sort((a, b) => {
      const cmp = (a.publishedAt || '').localeCompare(b.publishedAt || '')
      return sortDir === 'newest' ? -cmp : cmp
    })
    return list
  }, [videos, search, filterType, filterPrivacy, hideImported, linkedIds, sortDir])

  const selectableIds = useMemo(
    () => visible.filter(v => !linkedIds.has(v.videoId)).map(v => v.videoId),
    [visible, linkedIds],
  )
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selected.has(id))

  const toggle = (videoId: string, shiftKey: boolean) => {
    if (linkedIds.has(videoId)) return
    setSelected(prev => {
      const next = new Set(prev)
      const anchor = lastClickedRef.current
      const order = visible.map(v => v.videoId)
      if (shiftKey && anchor && anchor !== videoId) {
        const a = order.indexOf(anchor), b = order.indexOf(videoId)
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a]
          for (let i = lo; i <= hi; i++) { const id = order[i]; if (!linkedIds.has(id)) next.add(id) }
        } else if (next.has(videoId)) { next.delete(videoId) } else { next.add(videoId) }
      } else if (next.has(videoId)) { next.delete(videoId) } else { next.add(videoId) }
      return next
    })
    lastClickedRef.current = videoId
  }

  const runImport = async () => {
    if (config.streamMode === 'dump-folder') return // import unsupported in dump mode
    const targets = (videos ?? []).filter(v => selected.has(v.videoId) && !linkedIds.has(v.videoId))
    if (targets.length === 0 || importing) return
    setImporting(true); setSummary(null); setImportProgress({ done: 0, total: targets.length })
    const mode = (config.streamMode as 'folder-per-stream' | 'dump-folder') || 'folder-per-stream'
    const results: { title: string; ok: boolean }[] = []
    for (let i = 0; i < targets.length; i++) {
      const v = targets[i]
      let ok = false
      try {
        const privacy = (['public', 'unlisted', 'private'] as const).find(p => p === v.privacyStatus)
        const meta = {
          date: v.date, streamType: [], games: [], comments: '',
          ytVideoId: v.videoId, ytImported: true,
          ytTitle: v.title, ytDescription: v.description, ytTags: v.tags,
          ytCategoryId: v.categoryId, ytPrivacyStatus: privacy,
          // Seed the sync snapshots to the pulled values so the stream reads as
          // in-sync (not "edited locally, needs push").
          ytLastPushedTitle: v.title, ytLastPushedDescription: v.description,
          ytLastPushedTags: v.tags, ytLastPushedCategoryId: v.categoryId,
          ytLastPushedPrivacy: privacy, ytLastPushedDate: v.date,
        }
        const folderPath = await window.api.createStreamFolder(config.streamsDir, v.date, meta, undefined, undefined, mode)
        if (v.thumbnailUrl) {
          const dl = await window.api.youtubeDownloadThumbnail(folderPath, v.thumbnailUrl)
          if (dl) await window.api.updateStreamMeta(folderPath, { preferredThumbnail: dl.filename, ytThumbnailPushedHash: dl.hash })
        }
        ok = true
      } catch {
        ok = false
      }
      results.push({ title: v.title || '(untitled)', ok })
      setImportProgress({ done: i + 1, total: targets.length })
    }
    setImporting(false)
    setSummary(results)
    setSelected(new Set())
    // Refresh so the just-imported videos now flag as imported.
    window.api.streamsGetLinkedYouTubeIds().then(ids => setLinkedIds(new Set(ids))).catch(() => {})
  }

  const importedCount = videos ? videos.filter(v => linkedIds.has(v.videoId)).length : 0
  const okCount = summary?.filter(r => r.ok).length ?? 0
  const failCount = (summary?.length ?? 0) - okCount

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Import from YouTube"
      width="2xl"
      footer={
        summary ? (
          <div className="flex justify-end w-full">
            <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
          </div>
        ) : (
          <div className="flex items-center gap-3 w-full">
            <span className="text-[11px] text-gray-400">Imports details + thumbnails only — not video files.</span>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={importing}>Cancel</Button>
              <Button
                variant="primary"
                size="sm"
                disabled={selected.size === 0 || importing}
                onClick={runImport}
                icon={importing ? <Loader2 size={13} className="animate-spin" /> : undefined}
              >
                {importing && importProgress
                  ? `Importing ${importProgress.done}/${importProgress.total}…`
                  : `Import${selected.size > 0 ? ` (${selected.size})` : ''}`}
              </Button>
            </div>
          </div>
        )
      }
    >
      {summary ? (
        <div className="flex flex-col items-center justify-center text-center gap-3 min-h-[420px] px-6">
          <CheckCircle size={36} className="text-green-400" />
          <p className="text-base font-semibold text-gray-100">
            Imported {okCount} stream item{okCount === 1 ? '' : 's'}
            {failCount > 0 && <span className="text-amber-300 font-normal"> · {failCount} failed</span>}
          </p>
          <div className="w-full max-w-md max-h-[220px] overflow-y-auto rounded-lg border border-white/5 divide-y divide-white/5 text-left">
            {summary.map((r, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5">
                {r.ok ? <Check size={12} className="text-green-400 shrink-0" /> : <X size={12} className="text-red-400 shrink-0" />}
                <span className="text-xs text-gray-300 truncate">{r.title}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-400">Open this again to import more.</p>
        </div>
      ) : (
      <div className="flex flex-col gap-3 min-h-[420px]">
        {/* Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search titles…"
              className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg pl-8 pr-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
            />
          </div>
          <select value={sortDir} onChange={e => setSortDir(e.target.value as any)} className={SELECT_CLS}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
          <select value={filterType} onChange={e => setFilterType(e.target.value as any)} className={SELECT_CLS}>
            <option value="all">All types</option>
            <option value="live">Livestreams</option>
            <option value="video">Videos</option>
          </select>
          <select value={filterPrivacy} onChange={e => setFilterPrivacy(e.target.value as any)} className={SELECT_CLS}>
            <option value="all">All privacy</option>
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
            <option value="private">Private</option>
          </select>
          {importedCount > 0 && (
            <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer">
              <input type="checkbox" checked={hideImported} onChange={e => setHideImported(e.target.checked)} className="accent-purple-600" />
              Hide imported
            </label>
          )}
        </div>

        {/* Selection bar */}
        <div className="flex items-center gap-2 text-[11px] text-gray-400">
          <span>{selected.size} selected</span>
          <span className="text-gray-600">·</span>
          <button
            onClick={() => setSelected(allSelected ? new Set() : new Set(selectableIds))}
            className="text-gray-300 hover:text-white transition-colors"
          >
            {allSelected ? 'Clear' : 'Select all'}
          </button>
          <span className="ml-auto">{visible.length} shown{importedCount > 0 ? ` · ${importedCount} already imported` : ''}</span>
        </div>

        {/* List */}
        <div className="flex-1 min-h-[300px] max-h-[46vh] overflow-y-auto rounded-lg border border-white/5 divide-y divide-white/5">
          {videos === null && !loadError && (
            <div className="h-[300px] flex items-center justify-center text-gray-400 text-sm gap-2">
              <Loader2 size={16} className="animate-spin" /> Loading your videos…
            </div>
          )}
          {loadError && (
            <div className="h-[300px] flex items-center justify-center text-red-400 text-sm gap-2 px-6 text-center">
              <AlertCircle size={16} className="shrink-0" /> {loadError}
            </div>
          )}
          {videos !== null && !loadError && visible.length === 0 && (
            <div className="h-[300px] flex items-center justify-center text-gray-400 text-sm">No videos match the filters.</div>
          )}
          {videos !== null && visible.map(v => {
            const imported = linkedIds.has(v.videoId)
            const isSelected = selected.has(v.videoId)
            const p = PRIVACY[v.privacyStatus]
            const isDraft = v.uploadStatus !== 'processed'
            return (
              <div
                key={v.videoId}
                onClick={imported ? undefined : (e) => toggle(v.videoId, e.shiftKey)}
                className={`flex items-center gap-3 px-3 py-2 select-none ${
                  imported ? 'opacity-50' : `cursor-pointer ${isSelected ? 'bg-purple-500/10' : 'hover:bg-white/5'}`
                }`}
              >
                <div className={`w-4 h-4 shrink-0 rounded border-2 flex items-center justify-center transition-colors ${
                  imported ? 'border-white/10' : isSelected ? 'bg-purple-700 border-purple-700' : 'border-gray-500'
                }`}>
                  {isSelected && !imported && <Check size={10} className="text-white" strokeWidth={3} />}
                </div>
                <div className="w-[88px] aspect-video shrink-0 rounded overflow-hidden bg-navy-900">
                  {v.thumbnailUrl && (
                    <img src={v.thumbnailUrl} loading="lazy" className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <TruncatedText text={v.title || '(untitled)'} className="text-xs text-gray-200 truncate" />
                  <div className="flex items-center gap-1.5 mt-1 text-[10px] text-gray-400 flex-wrap">
                    {v.isLivestream
                      ? <span className="inline-flex items-center gap-1 text-pink-300"><Radio size={10} /> Live</span>
                      : <span className="inline-flex items-center gap-1"><Film size={10} /> Video</span>}
                    <span className="text-gray-600">·</span>
                    <span className="tabular-nums">{v.date || '—'}</span>
                    {v.durationSeconds ? <><span className="text-gray-600">·</span><span className="tabular-nums">{fmtDuration(v.durationSeconds)}</span></> : null}
                    {p
                      ? <span className={`px-1.5 rounded border inline-flex items-center gap-1 ${p.cls}`}><p.Icon size={9} /> {p.label}</span>
                      : <span className="px-1.5 rounded border border-white/20 text-gray-400">{v.privacyStatus}</span>}
                    {imported && <span className="px-1.5 rounded border border-blue-400/40 text-blue-300">Imported</span>}
                    {v.isUpcoming
                      ? <span className="px-1.5 rounded border border-teal-400/40 text-teal-300">Upcoming</span>
                      : isDraft && <span className="px-1.5 rounded border border-amber-400/40 text-amber-300">Draft</span>}
                  </div>
                </div>
                <Tooltip content="Open in YouTube Studio" triggerClassName="shrink-0">
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); window.api.openUrl(`https://studio.youtube.com/video/${v.videoId}/edit`) }}
                  className="p-1.5 rounded text-gray-400 hover:text-gray-200 hover:bg-white/10 transition-colors"
                >
                  <ExternalLink size={13} />
                </button>
                </Tooltip>
              </div>
            )
          })}
        </div>
      </div>
      )}
    </Modal>
  )
}
