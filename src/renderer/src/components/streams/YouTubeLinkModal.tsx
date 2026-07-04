import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, AlertCircle, ArrowRight, Radio, Film, CheckCircle, Check, X } from 'lucide-react'
import type { YouTubeImportVideo, StreamFolder } from '../../types'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { TruncatedText } from '../ui/TruncatedText'
import { ThumbImage } from './ThumbImage'
import { useStore } from '../../hooks/useStore'

const SELECT_CLS =
  'appearance-none bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-2 py-1.5 max-w-[260px] truncate focus:outline-none focus:ring-2 focus:ring-purple-500/50'

/**
 * Bulk-link existing local stream folders to their YouTube videos (the
 * "folders-first" path). Auto-matches unlinked folders to unlinked videos by
 * date — each video used at most once — then lets the user adjust per row.
 * Linking writes ytVideoId; optionally pulls the full metadata (overwriting
 * local) and always pulls the thumbnail (set as the item thumbnail only when
 * the folder has none). Folder-per-stream only.
 */
export function YouTubeLinkModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { config } = useStore()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [folders, setFolders] = useState<StreamFolder[]>([])
  const [videos, setVideos] = useState<YouTubeImportVideo[]>([])
  const [matches, setMatches] = useState<Record<string, string | null>>({}) // folderPath → videoId | null
  const [pullMetadata, setPullMetadata] = useState(true)
  const [showUnmatched, setShowUnmatched] = useState(false)
  const [linking, setLinking] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [summary, setSummary] = useState<{ title: string; ok: boolean }[] | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true); setLoadError(null); setSummary(null); setProgress(null)
    const mode = (config.streamMode as 'folder-per-stream' | 'dump-folder') || 'folder-per-stream'
    try {
      const [allFolders, allVideos, linkedIds] = await Promise.all([
        window.api.listStreams(config.streamsDir, mode),
        window.api.youtubeListChannelVideos(),
        window.api.streamsGetLinkedYouTubeIds(),
      ])
      const linked = new Set(linkedIds)
      const unlinkedFolders = allFolders.filter(f => !f.meta?.ytVideoId && !f.isMissing)
      const unlinkedVideos = allVideos.filter(v => !linked.has(v.videoId))
      setFolders(unlinkedFolders)
      setVideos(unlinkedVideos)
      // Greedy auto-match by date; each video used at most once (oldest first).
      const byDate = new Map<string, YouTubeImportVideo[]>()
      for (const v of unlinkedVideos) { const a = byDate.get(v.date) ?? []; a.push(v); byDate.set(v.date, a) }
      const used = new Set<string>()
      const auto: Record<string, string | null> = {}
      for (const f of [...unlinkedFolders].sort((a, b) => a.date.localeCompare(b.date))) {
        const cand = (byDate.get(f.date) ?? []).find(v => !used.has(v.videoId))
        if (cand) { auto[f.folderPath] = cand.videoId; used.add(cand.videoId) } else auto[f.folderPath] = null
      }
      setMatches(auto)
    } catch (e: any) {
      setLoadError(e?.message ?? String(e))
    } finally {
      setLoading(false)
    }
  }, [config.streamsDir, config.streamMode])

  useEffect(() => { if (isOpen) { setLinking(false); void loadData() } }, [isOpen, loadData])

  const videoById = useMemo(() => new Map(videos.map(v => [v.videoId, v])), [videos])
  const usedVideoIds = useMemo(() => new Set(Object.values(matches).filter(Boolean) as string[]), [matches])
  const sortedFolders = useMemo(() => [...folders].sort((a, b) => b.date.localeCompare(a.date)), [folders])
  const matchedCount = useMemo(() => sortedFolders.filter(f => matches[f.folderPath]).length, [sortedFolders, matches])
  // "Matchable" = a video shares this folder's date (regardless of the current
  // selection) — stable so toggling a row's match doesn't make it vanish.
  const isMatchable = useCallback((f: StreamFolder) => videos.some(v => v.date === f.date), [videos])
  const visibleFolders = useMemo(
    () => (showUnmatched ? sortedFolders : sortedFolders.filter(isMatchable)),
    [showUnmatched, sortedFolders, isMatchable],
  )
  const okCount = summary?.filter(r => r.ok).length ?? 0
  const failCount = (summary?.length ?? 0) - okCount

  const setMatch = (folderPath: string, videoId: string | null) =>
    setMatches(prev => ({ ...prev, [folderPath]: videoId }))

  const runLink = async () => {
    if (linking || config.streamMode === 'dump-folder') return
    const pairs = sortedFolders
      .map(f => ({ f, videoId: matches[f.folderPath] }))
      .filter(p => p.videoId) as { f: StreamFolder; videoId: string }[]
    if (pairs.length === 0) return
    setLinking(true); setSummary(null); setProgress({ done: 0, total: pairs.length })
    const results: { title: string; ok: boolean }[] = []
    for (let i = 0; i < pairs.length; i++) {
      const { f, videoId } = pairs[i]
      const v = videoById.get(videoId)
      let ok = false
      try {
        if (!v) throw new Error('missing video')
        const privacy = (['public', 'unlisted', 'private'] as const).find(p => p === v.privacyStatus)
        const partial: Record<string, unknown> = { ytVideoId: v.videoId }
        if (pullMetadata) {
          Object.assign(partial, {
            ytTitle: v.title, ytDescription: v.description, ytTags: v.tags,
            ytCategoryId: v.categoryId, ytPrivacyStatus: privacy,
            ytLastPushedTitle: v.title, ytLastPushedDescription: v.description,
            ytLastPushedTags: v.tags, ytLastPushedCategoryId: v.categoryId,
            ytLastPushedPrivacy: privacy, ytLastPushedDate: v.date,
          })
        }
        // Thumbnail: keep the folder's existing one if it has any (pin + hash it
        // so the link reads in-sync); otherwise use YouTube's. Always pull
        // YouTube's file so it's available either way. The pushed-hash must match
        // whatever thumbnail the stream actually displays, or it flags mismatched.
        const preferredName = f.meta?.preferredThumbnail
        const existingThumb = preferredName
          ? (f.thumbnails.find(t => (t.split(/[\\/]/).pop() ?? '') === preferredName) ?? f.thumbnails[0])
          : f.thumbnails[0]
        let thumbHash: string | undefined
        if (existingThumb) {
          partial.preferredThumbnail = existingThumb.split(/[\\/]/).pop()
          thumbHash = (await window.api.thumbnailHashFile(existingThumb)) ?? undefined
        }
        if (v.thumbnailUrl) {
          const dl = await window.api.youtubeDownloadThumbnail(f.folderPath, v.thumbnailUrl)
          if (dl && !existingThumb) { partial.preferredThumbnail = dl.filename; thumbHash = dl.hash }
        }
        if (thumbHash) partial.ytThumbnailPushedHash = thumbHash
        await window.api.updateStreamMeta(f.folderPath, partial)
        ok = true
      } catch {
        ok = false
      }
      results.push({ title: v?.title || '(untitled)', ok })
      setProgress({ done: i + 1, total: pairs.length })
    }
    setLinking(false)
    setSummary(results)
    // No reload here — it would clear the summary. Reopening runs loadData fresh.
  }

  const folderTitle = (f: StreamFolder) =>
    (f.meta?.games?.length ? f.meta.games.join(', ') : '') || f.folderName

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Link existing streams to YouTube"
      width="2xl"
      footer={
        summary ? (
          <div className="flex justify-end w-full">
            <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
          </div>
        ) : (
          <div className="flex items-center gap-3 w-full">
            <span className="text-[11px] text-gray-400">{matchedCount} of {folders.length} matched</span>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={linking}>Cancel</Button>
              <Button
                variant="primary"
                size="sm"
                disabled={matchedCount === 0 || linking}
                onClick={runLink}
                icon={linking ? <Loader2 size={13} className="animate-spin" /> : undefined}
              >
                {linking && progress ? `Linking ${progress.done}/${progress.total}…` : `Link${matchedCount > 0 ? ` (${matchedCount})` : ''}`}
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
            Linked {okCount} stream{okCount === 1 ? '' : 's'}
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
          <p className="text-[11px] text-gray-400">Open this again to link more.</p>
        </div>
      ) : (
      <div className="flex flex-col gap-3 min-h-[420px]">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-gray-400 max-w-[44%]">
            Pairs your existing folders to videos by date. Folders with no same-date video link manually from the stream's sidebar.
          </p>
          <div className="flex items-center gap-3 shrink-0">
            <Checkbox
              size="sm"
              checked={showUnmatched}
              onChange={setShowUnmatched}
              label={<span className="text-[11px] text-gray-400">Show unmatched</span>}
            />
            <Checkbox
              size="sm"
              checked={pullMetadata}
              onChange={setPullMetadata}
              label={<span className="text-[11px] text-gray-400">Pull all metadata (overwrite local)</span>}
            />
          </div>
        </div>

        <div className="flex-1 min-h-[300px] max-h-[46vh] overflow-y-auto rounded-lg border border-white/5 divide-y divide-white/5">
          {loading && (
            <div className="h-[300px] flex items-center justify-center text-gray-400 text-sm gap-2">
              <Loader2 size={16} className="animate-spin" /> Loading streams &amp; videos…
            </div>
          )}
          {loadError && (
            <div className="h-[300px] flex items-center justify-center text-red-400 text-sm gap-2 px-6 text-center">
              <AlertCircle size={16} className="shrink-0" /> {loadError}
            </div>
          )}
          {!loading && !loadError && folders.length === 0 && (
            <div className="h-[300px] flex items-center justify-center text-gray-400 text-sm">All your streams are already linked.</div>
          )}
          {!loading && !loadError && folders.length > 0 && visibleFolders.length === 0 && (
            <div className="h-[300px] flex items-center justify-center text-center px-6 text-gray-400 text-sm">No folders match a video by date. Turn on "Show unmatched" to see all unlinked streams.</div>
          )}
          {!loading && visibleFolders.map(f => {
            const matchedId = matches[f.folderPath]
            const matched = matchedId ? videoById.get(matchedId) : null
            const candidates = videos.filter(v => v.date === f.date && (!usedVideoIds.has(v.videoId) || matchedId === v.videoId))
            const preferred = f.meta?.preferredThumbnail
            const smThumbPath = preferred
              ? (f.thumbnails.find(t => (t.split(/[\\/]/).pop() ?? '') === preferred) ?? f.thumbnails[0])
              : f.thumbnails[0]
            const smIdx = smThumbPath ? f.thumbnails.indexOf(smThumbPath) : -1
            const smLocal = smIdx >= 0 ? (f.thumbnailLocalFlags?.[smIdx] ?? true) : true
            return (
              <div key={f.relativePath} className="flex items-center gap-2.5 px-3 py-2">
                <div className="w-[56px] aspect-video shrink-0 rounded overflow-hidden bg-navy-900">
                  {smThumbPath && (
                    <ThumbImage path={smThumbPath} thumbsKey={0} isLocal={smLocal} hydrate={false} className="w-full h-full object-cover" placeholderClassName="w-full h-full" iconSize={13} />
                  )}
                </div>
                <div className="w-[26%] min-w-0">
                  <TruncatedText text={folderTitle(f)} className="text-xs text-gray-200 truncate" />
                  <p className="text-[10px] text-gray-400 tabular-nums mt-0.5">{f.date}</p>
                </div>
                <ArrowRight size={14} className="shrink-0 text-gray-500" />
                <div className="w-[56px] aspect-video shrink-0 rounded overflow-hidden bg-navy-900">
                  {matched?.thumbnailUrl && <img src={matched.thumbnailUrl} loading="lazy" className="w-full h-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  {!isMatchable(f) ? (
                    <span className="text-[11px] text-gray-400 italic">No video on this date</span>
                  ) : (
                    <select
                      value={matchedId ?? ''}
                      onChange={e => setMatch(f.folderPath, e.target.value || null)}
                      className={`${SELECT_CLS} flex-1`}
                    >
                      <option value="">Don't link</option>
                      {candidates.map(v => (
                        <option key={v.videoId} value={v.videoId}>{v.title || '(untitled)'}</option>
                      ))}
                    </select>
                  )}
                  {matched && (
                    matched.isLivestream
                      ? <Radio size={11} className="shrink-0 text-pink-300" />
                      : <Film size={11} className="shrink-0 text-gray-400" />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      )}
    </Modal>
  )
}
