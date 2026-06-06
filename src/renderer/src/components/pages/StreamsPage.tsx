import { useState, useEffect, useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import ReactDOM from 'react-dom'
import { useAnimationConfig } from '../../hooks/useAnimationConfig'
import {
  Radio, ChevronRight, ChevronLeft, ChevronUp, ChevronDown, ChevronsDown, ChevronsUp, X,
  Film, Zap, Combine, CopyPlus, Cloud, CloudDownload, FolderOpen, Archive, Trash2, PencilLine, Plus,
  Image as ImageIcon, AlertTriangle, Loader2, ImageOff, Unlink2, ListFilter, GripHorizontal, Clapperboard, Square, CheckCheck, Check, Scissors, Tags, SquareDashedText, RefreshCw,
} from 'lucide-react'
import { Youtube as LucideYoutube, Twitch as LucideTwitch } from '../ui/BrandIcons'
import { Tooltip } from '../ui/Tooltip'
import { Button } from '../ui/Button'
import { CollapsibleLabel } from '../ui/CollapsibleLabel'
import { Checkbox } from '../ui/Checkbox'
import { TagComboBox } from '../ui/TagComboBox'
import { Modal } from '../ui/Modal'
import { useStore } from '../../hooks/useStore'
import { useThumbnailEditor } from '../../context/ThumbnailEditorContext'
import { useCloudOps } from '../../context/CloudOpsContext'
import { useConversionJobs } from '../../context/ConversionContext'
import { useRelayPrompt } from '../../context/RelayPromptContext'
import { PresetPickerModal, ThumbnailCarousel, VideoCountTooltip, BulkTagModal, SaveAsTemplateButton, Lightbox, PickerThumbImage } from '../streams/legacyStreamsShared'
import { pickColorForNewTag } from '../../constants/tagColors'
import { ManageTagsModal } from '../ui/ManageTagsModal'
import { TemplatesModal } from '../ui/TemplatesModal'
import { v4 as uuidv4 } from 'uuid'
import type { ConversionPreset, ConversionJob, LiveBroadcast } from '../../types'
import { BroadcastPicker, BroadcastLinkRef } from '../ui/BroadcastPicker'
import { Globe, Lock, EyeOff } from 'lucide-react'
import { useFieldSuggestion } from '../../hooks/useFieldSuggestion'
import { getTagColor, getTagTextureStyle } from '../../constants/tagColors'
import { ThumbImage, friendlyDate } from '../streams/ThumbImage'
import { toTwitchCompatibleTags, TWITCH_TAG_MAX_COUNT } from '../../lib/twitchTags'
import { YT_TAG_CHAR_LIMIT } from '../../lib/ytTagCount'
import type { StreamFolder, StreamMeta } from '../../types'

/** Canonical _meta.json key for a stream. Mirrors the helper in
 *  ThumbnailPage; replicated here to avoid cross-page coupling while the
 *  new page is being built. Will consolidate to a shared util once the old
 *  streams page is gone. */
function streamMetaKey(folderPath: string, date: string, streamsDir: string | undefined): string {
  const root = (streamsDir || '').replace(/\\/g, '/').replace(/\/$/, '')
  const fp = folderPath.replace(/\\/g, '/').replace(/\/$/, '')
  if (root && fp === root) return date
  if (root && fp.startsWith(root + '/')) return fp.slice(root.length + 1)
  return fp.split('/').pop() ?? fp
}

/** Tolerates the legacy single-string streamType from old meta files —
 *  same helper StreamsPage uses. Once the old page is gone we can centralise. */
function normalizeStreamTypes(v: string | string[] | undefined): string[] {
  if (!v) return []
  return Array.isArray(v) ? v : [v]
}

/** Today's date in local YYYY-MM-DD form. */
function todayStr(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/** `{key}` → fields[key], leaving unknown placeholders untouched. Mirrors
 *  the helper StreamsPage uses for title/description/tag templates. */
function applyMergeFields(template: string, fields: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => fields[key] ?? `{${key}}`)
}

/** Next-available episode number for (game, season) — counts streams strictly
 *  before `beforeDate` and returns count+1. Treats ytSeason `''` / undefined
 *  as '1' to match every other place that defaults the first season. The
 *  caller is expected to exclude the current folder from `allFolders`. */
function detectEpisodeNumber(allFolders: StreamFolder[], gameName: string, season: string, beforeDate?: string): number {
  if (!gameName) return 1
  const lower = gameName.toLowerCase()
  const s = season || '1'
  return allFolders.filter(f =>
    !f.isMissing &&
    ((f.meta?.games?.some(g => g.toLowerCase() === lower)) ||
     (f.detectedGames?.some(g => g.toLowerCase() === lower))) &&
    (f.meta?.ytSeason || '1') === s &&
    (!beforeDate || f.date < beforeDate)
  ).length + 1
}

/** Total streams in (game, season). Caller passes `folders` including the
 *  current folder — counts that one too. Falls back to 1 when no match
 *  (e.g. brand-new game with no streams yet) so `{total_episodes}` never
 *  renders as 0 in a template. */
function detectTotalEpisodes(allFolders: StreamFolder[], gameName: string, season: string): number {
  if (!gameName) return 1
  const lower = gameName.toLowerCase()
  const s = season || '1'
  const count = allFolders.filter(f =>
    !f.isMissing &&
    ((f.meta?.games?.some(g => g.toLowerCase() === lower)) ||
     (f.detectedGames?.some(g => g.toLowerCase() === lower))) &&
    (f.meta?.ytSeason || '1') === s
  ).length
  return count || 1
}

/** Multi-line link list for the `{season_links}` description merge field.
 *  Format: `Episode N: Title - https://youtu.be/<id>` per line, newest
 *  previous episode first. Eligibility: same first-game tag, same season,
 *  date strictly before the current stream, AND has `ytVideoId` (no link =
 *  nothing to share). Title resolution: ytCatchyTitle → ytTitle → YT API
 *  fetch (blocking, only for episodes missing both stored titles). */
async function computeSeasonLinks(
  allFolders: StreamFolder[],
  game: string,
  season: string,
  currentDate: string,
): Promise<string> {
  if (!game) return ''
  const lower = game.toLowerCase()
  const s = season || '1'
  const previous = allFolders.filter(f =>
    !f.isMissing &&
    ((f.meta?.games?.some(g => g.toLowerCase() === lower)) ||
     (f.detectedGames?.some(g => g.toLowerCase() === lower))) &&
    (f.meta?.ytSeason || '1') === s &&
    f.date < currentDate &&
    !!f.meta?.ytVideoId
  )
  if (previous.length === 0) return ''

  const chronological = [...previous].sort((a, b) => a.date.localeCompare(b.date))
  const positionByPath = new Map<string, number>()
  chronological.forEach((f, i) => positionByPath.set(f.folderPath, i + 1))

  const needsApi = previous.filter(f => !(f.meta?.ytCatchyTitle || f.meta?.ytTitle))
  const fetchedTitles = new Map<string, string>()
  if (needsApi.length > 0) {
    await Promise.all(needsApi.map(async f => {
      const id = f.meta?.ytVideoId
      if (!id) return
      try {
        const video = await window.api.youtubeGetVideoById(id)
        if (video?.snippet?.title) fetchedTitles.set(f.folderPath, video.snippet.title)
      } catch { /* missing title → falls through to placeholder */ }
    }))
  }

  const ordered = [...previous].sort((a, b) => b.date.localeCompare(a.date))
  return ordered.map(f => {
    const ep = f.meta?.ytEpisode || String(positionByPath.get(f.folderPath) ?? '?')
    const title = f.meta?.ytCatchyTitle || f.meta?.ytTitle || fetchedTitles.get(f.folderPath) || '(unknown)'
    const url = `https://youtu.be/${f.meta?.ytVideoId}`
    return `Episode ${ep}: ${title} - ${url}`
  }).join('\n')
}

/** A stream is "pending" (upcoming) when its date is in the future, OR it's
 *  today and no 'full' recording for today's date has been captured yet.
 *  Matches the same logic StreamsPage uses to tint upcoming rows teal. */
function isPendingStream(folder: StreamFolder, today: string): boolean {
  if (folder.isMissing || folder.meta?.archived) return false
  if (folder.date < today) return false
  if (folder.date > today) return true
  const map = folder.meta?.videoMap
  return !folder.videos.some(v => {
    const name = v.split(/[\\/]/).pop() ?? ''
    if (!name.startsWith(folder.date)) return false
    const key = name
    return map?.[key]?.category === 'full'
  })
}

// Action-button styling pulled from the existing ExpandedStreamPanel so the
// new sidebar matches the row's hover-revealed action panel design verbatim.
// Keeping these as local constants avoids cross-file coupling while we
// iterate on the new page; if the colors drift we'll consolidate later.
// `shrink-0` keeps the button from shrinking as a flex item of its
// section, and `min-w-max` forces its intrinsic width to its full
// max-content. Together these stop the inner CollapsibleLabel's
// `min-w-0` (needed for the 0fr↔1fr collapse animation) from
// propagating up through the inline-grid and letting Chromium
// resolve the button's content width to "just the icon" — without
// `min-w-max` the button was sizing to ~icon+gap and the label was
// rendering outside the button's box (label overflow, not actual
// overlap; visually identical to overlap when the bg-on-hover
// extended past the box).
const PANEL_ACTION_BUTTON_BASE = 'inline-flex shrink-0 min-w-max items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] text-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-200'
const PANEL_ACTION_BUTTON_GREEN = `${PANEL_ACTION_BUTTON_BASE} hover:text-green-400 hover:bg-green-500/10`
const PANEL_ACTION_BUTTON_BLUE = `${PANEL_ACTION_BUTTON_BASE} hover:text-blue-400 hover:bg-blue-500/10`
const PANEL_ACTION_BUTTON_RED = `${PANEL_ACTION_BUTTON_BASE} hover:text-red-400 hover:bg-red-500/10`
const PANEL_ACTION_BUTTON_YELLOW = `${PANEL_ACTION_BUTTON_BASE} hover:text-yellow-400 hover:bg-yellow-500/10`
const PANEL_ACTION_BUTTON_CYAN = `${PANEL_ACTION_BUTTON_BASE} hover:text-cyan-400 hover:bg-cyan-500/10`
const PANEL_ACTION_BUTTON_PINK = `${PANEL_ACTION_BUTTON_BASE} hover:text-pink-400 hover:bg-pink-500/10`

/**
 * Streams page — new architecture. Replaces the table-with-modal layout of
 * StreamsPage with a master-detail workspace: list in the main area, all
 * stream-item editing surfaces (metadata, actions, integrations) in a right
 * sidebar that populates when an item is selected.
 *
 * Phase 2 (current): sidebar contents — skip-episode nav at top, read-only
 * metadata display in the middle (scrollable), sticky bottom action area
 * with action-button row + push-button row. Actions are visually present
 * but stubbed (no-op + console log) — wiring lands in a later phase.
 *
 * Earlier: phase 1 — page shell + basic list + ID-based selection +
 * mount-always state persistence.
 */
export function StreamsPage({
  isVisible,
  onSendToPlayer,
  onSendToConverter,
  onSendToCombine,
}: {
  isVisible: boolean
  onSendToPlayer: (file: string) => void
  onSendToConverter: (file: string) => void
  onSendToCombine: (files: string[]) => void
}) {
  const { config, updateConfig } = useStore()
  const { openEditor: openThumbnailEditor } = useThumbnailEditor()
  const [folders, setFolders] = useState<StreamFolder[]>([])
  const [loading, setLoading] = useState(true)
  // ID-based selection so a refresh of `folders` (e.g. streams:changed) never
  // accidentally drops the user's current selection just because the
  // underlying array reshuffles. folderPath is unique per folder in both
  // folder-per-stream and dump-folder modes.
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null)
  // Stream-type color/texture assignments live in electron-store; we load
  // them once on mount. Currently read-only here — the swatch picker UX
  // for editing them stays on the old page until phase 4. The keys are
  // also used as the source-of-truth list of "known" stream types when
  // suggesting in the combobox.
  const [tagColors, setTagColors] = useState<Record<string, string>>({})
  const [tagTextures, setTagTextures] = useState<Record<string, string>>({})
  // Template lists for title/description/tag merge-field substitution. Used
  // by the InlineTemplateSelect dropdowns above each editable field in the
  // sidebar. When the user picks a template, its body is run through
  // applyMergeFields with the current stream's meta values and the result
  // overwrites the field. Loaded once on mount; refresh via the templates
  // page if the user edits them while the streams page is open.
  const [ytTitleTemplates, setYtTitleTemplates] = useState<Array<{ id: string; name: string; template: string }>>([])
  const [ytDescTemplates, setYtDescTemplates] = useState<Array<{ id: string; name: string; description: string }>>([])
  const [ytTagTemplates, setYtTagTemplates] = useState<Array<{ id: string; name: string; tags: string[] }>>([])
  const [twitchTagTemplates, setTwitchTagTemplates] = useState<Array<{ id: string; name: string; tags: string[] }>>([])
  // Integration connection state. Push buttons are disabled when offline so
  // we don't fire an IPC that's certain to fail with a confusing auth error.
  const [ytConnected, setYtConnected] = useState(false)
  // Broadcast picker data — loaded once when YT is connected. Upcoming
  // (scheduled) broadcasts are eager-loaded so the sidebar's picker is
  // instant. VODs (completed) load lazily on first dropdown open since
  // the list can be hundreds of items and we don't want to spend the
  // bandwidth on page mount.
  const [ytBroadcasts, setYtBroadcasts] = useState<LiveBroadcast[]>([])
  const [ytVods, setYtVods] = useState<LiveBroadcast[]>([])
  const [ytVodsLoaded, setYtVodsLoaded] = useState(false)
  const [ytBroadcastsLoading, setYtBroadcastsLoading] = useState(false)
  const [twConnected, setTwConnected] = useState(false)
  // Sidebar feedback banner — auto-dismisses 4 s after the last set.
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showBanner = useCallback((next: { type: 'success' | 'error'; message: string }) => {
    setBanner(next)
    if (bannerTimer.current) clearTimeout(bannerTimer.current)
    bannerTimer.current = setTimeout(() => setBanner(null), 4000)
  }, [])
  useEffect(() => () => { if (bannerTimer.current) clearTimeout(bannerTimer.current) }, [])
  // Reschedule modal target — when set, the modal is rendered. Captures the
  // folder by path (not reference) so the modal survives a folders refresh.
  const [rescheduleTargetPath, setRescheduleTargetPath] = useState<string | null>(null)
  const [deleteTargetPath, setDeleteTargetPath] = useState<string | null>(null)
  const [newStreamOpen, setNewStreamOpen] = useState(false)
  // When set, the New Stream modal opens in "New episode" mode with this
  // folder as the source. Cleared on close. The path-based key (not the
  // folder object) survives folder-list refreshes without going stale.
  const [newEpisodeSourcePath, setNewEpisodeSourcePath] = useState<string | null>(null)
  // Archive flow state — mirrors StreamsPage. `archiveTargetPaths`
  // is the list of folders waiting for a preset pick. Single-folder
  // archive from the sidebar populates a 1-element array; bulk archive
  // from select mode populates many. After the preset is picked,
  // `pendingArchiveDecision` holds the already-archived-files warning.
  const [archiveTargetPaths, setArchiveTargetPaths] = useState<string[]>([])
  const [pendingArchiveDecision, setPendingArchiveDecision] = useState<{
    preset: ConversionPreset
    selectedFolders: StreamFolder[]
    taggedFiles: string[]
    totalFiles: number
  } | null>(null)
  // List view controls: search query + sort mode. Sort defaults to newest
  // first since that's the most common workflow (today's stream at the top
  // for quick post-stream tasks).
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<'date-desc' | 'date-asc' | 'title-asc'>('date-desc')
  // Cache-busting key for thumbnail file:// URLs. Bumped when streams:changed
  // fires so renamed/swapped thumbnail files refetch instead of serving the
  // stale cached image.
  const [thumbsKey, setThumbsKey] = useState(() => Date.now())

  // ── Thumbnail resize (drag the handle on the right of any thumbnail cell)
  // The width is persisted to config.listThumbWidth on mouseup. While dragging,
  // a useLayoutEffect compensates for row-height jitter so the dragged thumb
  // doesn't drift away from the cursor as the row reflows.
  const MIN_THUMB_WIDTH = 85
  const MAX_THUMB_WIDTH = 170
  const [thumbWidth, setThumbWidth] = useState(() => config.listThumbWidth ?? MIN_THUMB_WIDTH)
  const dragThumbWidthRef = useRef(thumbWidth)
  useEffect(() => {
    if (typeof config.listThumbWidth !== 'number') return
    if (config.listThumbWidth === thumbWidth) return
    setThumbWidth(config.listThumbWidth)
    dragThumbWidthRef.current = config.listThumbWidth
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.listThumbWidth])
  const listScrollRef = useRef<HTMLDivElement>(null)
  // Auto-scroll the streams list so the currently-selected row stays in
  // view as the user navigates (sidebar prev/next episode buttons,
  // duplicate-to-new-episode, etc). `block: 'nearest'` is a no-op when
  // the row is already visible — it only nudges enough to bring an
  // off-screen row into the scroll container. The data-folder-path
  // marker on each <tr> is the lookup key.
  useEffect(() => {
    if (!selectedFolderPath) return
    const scrollEl = listScrollRef.current
    if (!scrollEl) return
    // Defer one frame so the row exists in the DOM after the selection
    // state change triggers its render.
    const id = requestAnimationFrame(() => {
      const row = scrollEl.querySelector<HTMLElement>(`tr[data-folder-path="${CSS.escape(selectedFolderPath)}"]`)
      row?.scrollIntoView({ block: 'nearest', behavior: anim.scrollBehavior })
    })
    return () => cancelAnimationFrame(id)
  }, [selectedFolderPath])
  const dragThumbElRef = useRef<HTMLElement | null>(null)
  const dragStartThumbTopRef = useRef<number>(0)
  useLayoutEffect(() => {
    const thumbEl = dragThumbElRef.current
    const scrollEl = listScrollRef.current
    if (!thumbEl || !scrollEl) return
    const drift = thumbEl.getBoundingClientRect().top - dragStartThumbTopRef.current
    if (Math.abs(drift) > 0.1) scrollEl.scrollTop += drift
  })
  const startThumbResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = dragThumbWidthRef.current
    const thumbEl = (e.currentTarget as HTMLElement).closest('td') as HTMLElement | null
    dragThumbElRef.current = thumbEl
    dragStartThumbTopRef.current = thumbEl?.getBoundingClientRect().top ?? 0
    const onMove = (me: MouseEvent) => {
      const newWidth = Math.round(Math.max(MIN_THUMB_WIDTH, Math.min(MAX_THUMB_WIDTH, startWidth + me.clientX - startX)))
      dragThumbWidthRef.current = newWidth
      setThumbWidth(newWidth)
    }
    const onUp = () => {
      dragThumbElRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      updateConfig({ listThumbWidth: dragThumbWidthRef.current })
      // Swallow the synthetic click that browsers fire after a drag that
      // ends outside the drag handle — prevents an unwanted row-toggle.
      let removed = false
      const detach = () => {
        if (removed) return
        removed = true
        window.removeEventListener('click', swallowClick, true)
      }
      const swallowClick = (ev: MouseEvent) => { ev.stopPropagation(); detach() }
      window.addEventListener('click', swallowClick, true)
      setTimeout(detach, 0)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [updateConfig])

  // ── Type / Games filter dropdowns ──────────────────────────────────────
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set())
  const [filterGames, setFilterGames] = useState<Set<string>>(new Set())
  const [openFilter, setOpenFilter] = useState<'type' | 'games' | null>(null)
  const [gameFilterSearch, setGameFilterSearch] = useState('')
  const typeFilterAnchorRef = useRef<HTMLDivElement>(null)
  const gameFilterAnchorRef = useRef<HTMLDivElement>(null)
  const [typeFilterMaxHeight, setTypeFilterMaxHeight] = useState(600)
  const [gameFilterMaxHeight, setGameFilterMaxHeight] = useState(600)
  const updateTypeFilterMaxHeight = useCallback(() => {
    if (typeFilterAnchorRef.current) {
      const rect = typeFilterAnchorRef.current.getBoundingClientRect()
      setTypeFilterMaxHeight(window.innerHeight - rect.bottom - 12)
    }
  }, [])
  const updateGameFilterMaxHeight = useCallback(() => {
    if (gameFilterAnchorRef.current) {
      const rect = gameFilterAnchorRef.current.getBoundingClientRect()
      setGameFilterMaxHeight(window.innerHeight - rect.bottom - 12)
    }
  }, [])
  const openTypeFilter = useCallback(() => {
    if (openFilter === 'type') { setOpenFilter(null); return }
    updateTypeFilterMaxHeight()
    setOpenFilter('type')
  }, [openFilter, updateTypeFilterMaxHeight])
  const openGameFilter = useCallback(() => {
    if (openFilter === 'games') { setOpenFilter(null); return }
    setGameFilterSearch('')
    updateGameFilterMaxHeight()
    setOpenFilter('games')
  }, [openFilter, updateGameFilterMaxHeight])
  useEffect(() => {
    if (openFilter !== 'type') return
    window.addEventListener('resize', updateTypeFilterMaxHeight)
    return () => window.removeEventListener('resize', updateTypeFilterMaxHeight)
  }, [openFilter, updateTypeFilterMaxHeight])
  useEffect(() => {
    if (openFilter !== 'games') return
    window.addEventListener('resize', updateGameFilterMaxHeight)
    return () => window.removeEventListener('resize', updateGameFilterMaxHeight)
  }, [openFilter, updateGameFilterMaxHeight])
  const toggleTypeFilter = (t: string) => setFilterTypes(prev => {
    const next = new Set(prev); next.has(t) ? next.delete(t) : next.add(t); return next
  })
  const toggleGameFilter = (g: string) => setFilterGames(prev => {
    const next = new Set(prev); next.has(g) ? next.delete(g) : next.add(g); return next
  })
  useEffect(() => {
    window.api.getStreamTypeTags().then(setTagColors)
    window.api.getStreamTypeTextures().then(setTagTextures)
    window.api.youtubeGetStatus().then(s => {
      setYtConnected(s.connected)
      // Eager-load upcoming/scheduled broadcasts so the sidebar's
      // BroadcastPicker has data ready the moment the user opens a
      // future-dated stream. VODs stay lazy — see loadAllVods.
      if (s.connected) {
        setYtBroadcastsLoading(true)
        window.api.youtubeGetBroadcasts()
          .then(setYtBroadcasts)
          .catch(err => console.warn('Failed to load YouTube broadcasts', err))
          .finally(() => setYtBroadcastsLoading(false))
      }
    }).catch(() => {})
    window.api.twitchGetStatus?.().then(s => setTwConnected(s.connected)).catch(() => {})
    window.api.getYTTitleTemplates().then(setYtTitleTemplates).catch(() => {})
    window.api.getYTDescriptionTemplates().then(setYtDescTemplates).catch(() => {})
    window.api.getYTTagTemplates().then(setYtTagTemplates).catch(() => {})
    window.api.getTwitchTagTemplates?.().then(setTwitchTagTemplates).catch(() => {})
  }, [])

  // Lazy-load all completed VODs on first open of a past-stream picker.
  // Idempotent — guarded by ytVodsLoaded so repeat opens are no-ops.
  const loadAllVods = useCallback(async () => {
    if (ytVodsLoaded || ytBroadcastsLoading) return
    setYtBroadcastsLoading(true)
    try {
      const items: LiveBroadcast[] = await window.api.youtubeGetCompletedBroadcasts()
      setYtVods(items)
      setYtVodsLoaded(true)
    } catch (err) {
      console.warn('Failed to load YouTube VODs', err)
    } finally {
      setYtBroadcastsLoading(false)
    }
  }, [ytVodsLoaded, ytBroadcastsLoading])

  // Per-video privacy + livestream-vs-VOD status for every linked YT video.
  // Refreshed whenever the set of linked ids changes. Drives the row's
  // status badge in the date column (privacy icon + Radio/Clapperboard
  // distinguishing live broadcasts from regular video uploads).
  const [ytVideoStatusMap, setYtVideoStatusMap] = useState<Record<string, { privacyStatus: string; isLivestream: boolean }>>({})
  // Stable string key — depending on `folders` directly would re-fire the
  // batch on every loadFolders refresh, even when the linked-id set is
  // unchanged. Costly on large libraries.
  const linkedYtIdsKey = useMemo(() => (
    folders.map(f => f.meta?.ytVideoId).filter(Boolean).sort().join(',')
  ), [folders])
  useEffect(() => {
    if (!ytConnected || !linkedYtIdsKey) return
    const ids = linkedYtIdsKey.split(',')
    window.api.youtubeGetVideoStatuses(ids).then(setYtVideoStatusMap).catch(() => {})
  }, [ytConnected, linkedYtIdsKey])

  // Live-now tracking for upcoming linked broadcasts. 60s poll for
  // baseline freshness; the relay-orchestrator push subscription below
  // flips it to live the moment SM transitions the broadcast (no wait
  // for the next tick).
  const [ytLiveMap, setYtLiveMap] = useState<Record<string, boolean>>({})
  const upcomingLinkedBroadcastKey = useMemo(() => {
    if (!ytConnected) return ''
    const today = todayStr()
    return folders
      .filter(f => isPendingStream(f, today) && !!f.meta?.ytVideoId)
      .map(f => f.meta!.ytVideoId!)
      .sort()
      .join(',')
  }, [ytConnected, folders])
  useEffect(() => {
    if (!upcomingLinkedBroadcastKey) { setYtLiveMap({}); return }
    const ids = upcomingLinkedBroadcastKey.split(',')
    const check = () => window.api.youtubeCheckBroadcastsAreLive(ids)
      .then(map => {
        const liveById: Record<string, boolean> = {}
        for (const id of ids) liveById[id] = !!map[id]?.isLive
        setYtLiveMap(prev => ({ ...prev, ...liveById }))
        // Same response carries privacyStatus — these IDs are all
        // liveBroadcasts so isLivestream is implicitly true. Folding it
        // into ytVideoStatusMap saves a round-trip via youtubeGetVideoStatuses.
        setYtVideoStatusMap(prev => {
          const next = { ...prev }
          for (const id of ids) {
            const p = map[id]?.privacyStatus
            if (p) next[id] = { privacyStatus: p, isLivestream: true }
          }
          return next
        })
      })
      .catch(() => {})
    check()
    const interval = setInterval(check, 60_000)
    return () => clearInterval(interval)
  }, [upcomingLinkedBroadcastKey])
  useEffect(() => {
    const off = window.api.onRelayLifecycle(ev => {
      const id = ev?.broadcastId
      if (!id) return
      if (ev.stage === 'live') {
        setYtLiveMap(prev => prev[id] ? prev : { ...prev, [id]: true })
      } else if (ev.stage === 'completing' || ev.stage === 'completed') {
        setYtLiveMap(prev => (id in prev) ? { ...prev, [id]: false } : prev)
      }
    })
    return off
  }, [])

  // Post-stream Twitch auto-update — fires when the relay reports a
  // broadcast just completed. Picks the next-upcoming stream item and
  // either silently pushes its title/game/tags to Twitch (mode='always'),
  // surfaces the PostStreamTwitchModal via RelayPromptContext
  // (mode='ask'), or skips (mode='never'). Lives on this page because
  // it's the natural owner of the streams data; runs even when the page
  // isn't visible since the listener is attached on mount.
  //
  // Refs keep the listener stable across folder/config changes so we
  // don't re-bind the IPC on every render.
  const { setSuggestion: setPostStreamTwitchSuggestion } = useRelayPrompt()
  const foldersRef = useRef(folders)
  const twConnectedRef = useRef(twConnected)
  const autoUpdateTwitchRef = useRef<'always' | 'ask' | 'never'>(config.autoUpdateTwitchAfterStream ?? 'ask')
  useEffect(() => { foldersRef.current = folders }, [folders])
  useEffect(() => { twConnectedRef.current = twConnected }, [twConnected])
  useEffect(() => { autoUpdateTwitchRef.current = config.autoUpdateTwitchAfterStream ?? 'ask' }, [config.autoUpdateTwitchAfterStream])
  useEffect(() => {
    const off = window.api.onRelayLifecycle(async ev => {
      // Stale prompt cleanup — once the next session starts (or errors)
      // the previous "next upcoming" suggestion is no longer relevant.
      if (ev.stage === 'binding' || ev.stage === 'going-live' || ev.stage === 'live' || ev.stage === 'no-broadcast' || ev.stage === 'error') {
        setPostStreamTwitchSuggestion(null)
        return
      }
      if (ev.stage !== 'completed') return
      if (!twConnectedRef.current) return
      const justCompletedId = ev.broadcastId
      const today = todayStr()
      const candidates = foldersRef.current
        .filter(f => f.meta?.ytVideoId !== justCompletedId)
        .filter(f => isPendingStream(f, today))
        .sort((a, b) => a.date.localeCompare(b.date))
      const next = candidates[0]
      if (!next?.meta) return
      const m = next.meta
      const syncTitle = m.syncTitle ?? true
      const syncGame = m.syncGame ?? true
      const title = (syncTitle ? m.ytTitle : m.twitchTitle) ?? m.ytTitle ?? m.twitchTitle ?? ''
      const game = (syncGame ? m.ytGameTitle : m.twitchGameName) ?? m.ytGameTitle ?? m.twitchGameName ?? ''
      // Twitch's PATCH /channels rejects an empty title — skip silently.
      if (!title.trim()) return
      const { compat: tags } = toTwitchCompatibleTags(m.twitchTags ?? [])
      const payload = { title, game: game || undefined, tags }
      const mode = autoUpdateTwitchRef.current
      if (mode === 'always') {
        try {
          await window.api.twitchUpdateChannel(payload.title, payload.game, payload.tags)
        } catch (e) {
          console.warn('[auto-update Twitch] push failed:', e)
        }
      } else if (mode === 'ask') {
        setPostStreamTwitchSuggestion({
          folderPath: next.folderPath,
          displayTitle: title,
          payload,
        })
      }
      // mode === 'never' — skip silently.
    })
    return off
  }, [setPostStreamTwitchSuggestion])

  // Same-day disambiguation index ("#2", "#3" badge when multiple
  // streams share a date). Sorted by folderName so the order is stable.
  const sameDayIndexMap = useMemo(() => {
    const result = new Map<string, number>()
    const byDate = new Map<string, StreamFolder[]>()
    for (const f of folders) {
      if (!byDate.has(f.date)) byDate.set(f.date, [])
      byDate.get(f.date)!.push(f)
    }
    for (const group of byDate.values()) {
      [...group]
        .sort((a, b) => a.folderName.localeCompare(b.folderName))
        .forEach((f, i) => result.set(f.folderPath, i + 1))
    }
    return result
  }, [folders])

  // The soonest-upcoming stream — used to swap its tooltip copy
  // ("Upcoming — stream hasn't happened yet" vs "Scheduled upcoming
  // stream"). Mirrors StreamsPage exactly.
  const nextUpcomingFolderPath = useMemo(() => {
    const today = todayStr()
    const upcoming = folders.filter(f => isPendingStream(f, today))
    upcoming.sort((a, b) => a.date.localeCompare(b.date))
    return upcoming[0]?.folderPath ?? null
  }, [folders])

  // Claude AI suggestions. Enabled only when an API key is configured;
  // when off, EditableTextField's aiFetcher prop receives `undefined`
  // and the field renders normally without the suggestion plumbing.
  // Fetchers are page-level (not per-folder) since they only need the
  // selected folder's snapshot at call time — useFieldSuggestion calls
  // them on-demand with the live prefix/suffix, so a stale closure on
  // the current folder is fine as long as it captures the meta at
  // request time.
  const claudeEnabled = !!config.claudeApiKey

  // Cross-link refs across every folder — surfaces "another item is
  // already linked to this broadcast" in the picker dropdown.
  const broadcastLinks = useMemo<BroadcastLinkRef[]>(() => {
    const refs: BroadcastLinkRef[] = []
    for (const f of folders) {
      const id = f.meta?.ytVideoId
      if (!id) continue
      const title = f.meta?.ytTitle?.trim() || f.meta?.twitchTitle?.trim()
      refs.push({ broadcastId: id, folderDate: f.date, folderTitle: title || undefined })
    }
    return refs
  }, [folders])

  // Sidebar collapsed preference lives in electron-store so it survives app
  // restarts. The displayed state is derived: a selection always forces the
  // sidebar open regardless of preference, so the preference only matters
  // when nothing is selected. To collapse while a stream is selected the
  // user has to deselect first (via row re-click or the sidebar's close X).
  const sidebarCollapsedPref = !!config.streamsNewSidebarCollapsed
  const sidebarCollapsed = sidebarCollapsedPref && !selectedFolderPath
  const toggleSidebar = useCallback(() => {
    if (selectedFolderPath) return // not collapsible while a stream is selected
    updateConfig({ streamsNewSidebarCollapsed: !sidebarCollapsedPref })
  }, [selectedFolderPath, sidebarCollapsedPref, updateConfig])

  const streamsDir = config.streamsDir
  const streamMode = config.streamMode || 'folder-per-stream'

  // True when streamsDir lives inside a CFAPI-aware cloud sync root
  // (Synology Drive Client, OneDrive, Dropbox). Offload + Pin-Local
  // buttons are gated on this — same convention StreamsPage uses.
  const [cloudSyncActive, setCloudSyncActive] = useState(false)
  useEffect(() => {
    window.api.cloudSyncIsActive().then(setCloudSyncActive).catch(() => setCloudSyncActive(false))
  }, [])
  const { enqueueOffload, enqueueHydrate } = useCloudOps()

  // Conversion-jobs context — used to detect when an archive is in
  // flight for a given folder so the action button can be disabled (and
  // visibly indicate "already archiving"). Same memo shape StreamsPage
  // uses; the keys are folder relativePath OR date, matching what the
  // `archiveMarkAsArchived` group-completion hook uses for routing.
  const { jobs: conversionJobs } = useConversionJobs()
  const archivingFolderKeys = useMemo(() => {
    const set = new Set<string>()
    for (const j of conversionJobs) {
      const hook = j.groupCompletionHook
      if (hook?.type !== 'archiveMarkAsArchived') continue
      if (j.status === 'done' || j.status === 'error' || j.status === 'cancelled') continue
      set.add(hook.metaKey ?? hook.date)
    }
    return set
  }, [conversionJobs])
  const isFolderArchiving = useCallback((f: StreamFolder) => (
    archivingFolderKeys.has(f.relativePath) || archivingFolderKeys.has(f.date)
  ), [archivingFolderKeys])

  // Row click selects, or deselects when clicking the already-selected row.
  // Deselect collapses the sidebar back to whatever the user's preference is
  // (rail if collapsed-pref, empty state if expanded-pref).
  const onRowClick = useCallback((folderPath: string) => {
    setSelectedFolderPath(cur => cur === folderPath ? null : folderPath)
  }, [])

  // Partial-merge meta update used by every inline editable field in the
  // sidebar. Always sources the latest folder via folderPath to avoid stale
  // closures — important since this gets called from autosave handlers that
  // may fire after the selected folder has been swapped out.
  //
  // After the disk write succeeds, optimistically merges the partial into
  // the local `folders` state. streams:updateMeta doesn't fire a
  // streams:changed event, so without this the UI would keep showing the
  // pre-edit value on re-selection (and on a refresh from another source
  // we'd already have the right data anyway — the merge is idempotent).
  const updateMeta = useCallback(async (folderPath: string, partial: Partial<StreamMeta>) => {
    const folder = folders.find(f => f.folderPath === folderPath)
    if (!folder) return
    const key = streamMetaKey(folder.folderPath, folder.date, streamsDir)
    await window.api.updateStreamMeta(folder.folderPath, partial, key)
    setFolders(prev => prev.map(f =>
      f.folderPath === folderPath
        ? { ...f, meta: { ...(f.meta ?? {} as StreamMeta), ...partial }, hasMeta: true }
        : f
    ))
  }, [folders, streamsDir])

  // ── Action handlers ──────────────────────────────────────────────────────
  // Simplified vs StreamsPage: no cloud-download confirmation, no multi-video
  // picker. Picks the first 'full' video (or first available) and sends it
  // straight to the target page. Adequate for typical folders; a polish phase
  // can layer the cloud/picker affordances in once we know which actually
  // matter for the new sidebar UX.
  const pickPrimaryVideo = (folder: StreamFolder): string | null => {
    if (folder.videos.length === 0) return null
    const map = folder.meta?.videoMap
    const firstFull = folder.videos.find(v => {
      const key = v.split(/[\\/]/).pop() ?? v
      return map?.[key]?.category === 'full'
    })
    return firstFull ?? folder.videos[0]
  }

  const handleSendToPlayer = useCallback((folder: StreamFolder) => {
    const file = pickPrimaryVideo(folder)
    if (file) onSendToPlayer(file)
  }, [onSendToPlayer])

  const handleSendToConverter = useCallback((folder: StreamFolder) => {
    const file = pickPrimaryVideo(folder)
    if (file) onSendToConverter(file)
  }, [onSendToConverter])

  const handleSendToCombine = useCallback((folder: StreamFolder) => {
    if (folder.videos.length > 0) onSendToCombine(folder.videos)
  }, [onSendToCombine])

  // Open-in-Explorer is mode-aware: in dump-mode the folder doesn't
  // exclusively belong to one stream, so we reveal the first video file
  // instead of the parent folder (matches StreamsPage behaviour).
  const isDumpMode = streamMode === 'dump-folder'
  const handleOpenFolder = useCallback((folder: StreamFolder) => {
    if (isDumpMode && folder.videos.length > 0) window.api.openInExplorer(folder.videos[0])
    else window.api.openInExplorer(folder.folderPath)
  }, [isDumpMode])

  // Offload / Pin-Local — gather every file in the folder (recursively up
  // to 6 levels, matching StreamsPage) and queue the operation on the
  // shared CloudOpsContext. Falls back to `folder.videos` if the file
  // walk fails so the user gets a partial result rather than a no-op.
  const collectFolderFiles = useCallback(async (f: StreamFolder): Promise<{ path: string; size: number }[]> => {
    try {
      const entries = await window.api.listFilesRecursive(f.folderPath, 6)
      return entries.filter(e => !e.isDirectory).map(e => ({ path: e.path, size: e.size }))
    } catch {
      return f.videos.map(v => ({ path: v, size: 0 }))
    }
  }, [])
  const handleOffload = useCallback(async (folder: StreamFolder) => {
    if (!cloudSyncActive) return
    const files = await collectFolderFiles(folder)
    if (files.length > 0) enqueueOffload(files)
  }, [cloudSyncActive, collectFolderFiles, enqueueOffload])
  const handlePinLocal = useCallback(async (folder: StreamFolder) => {
    if (!cloudSyncActive) return
    const files = await collectFolderFiles(folder)
    if (files.length > 0) enqueueHydrate(files)
  }, [cloudSyncActive, collectFolderFiles, enqueueHydrate])

  // ── Archive flow ────────────────────────────────────────────────────────
  // Single-folder archive: open the preset picker. On preset confirm,
  // pre-flight the candidate files against the encoded_by tag (already
  // archived) — if any hit, route to the warning modal so the user can
  // skip them. Otherwise queue jobs directly. Mirrors StreamsPage's
  // startArchive / executeArchive / handleArchiveDecision triple verbatim
  // so behavior is identical across the two pages.
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/$/, '')
  const fullVideos = (f: StreamFolder): string[] => {
    const map = f.meta?.videoMap
    if (!map) return []
    const root = norm(f.folderPath)
    return f.videos.filter(v => {
      const n = norm(v)
      const relKey = n.startsWith(root + '/') ? n.slice(root.length + 1) : n.split('/').pop() ?? n
      return map[relKey]?.category === 'full'
    })
  }

  const executeArchive = useCallback(async (
    preset: ConversionPreset,
    selectedFolders: StreamFolder[],
    skipFiles: Set<string>,
  ) => {
    if (!streamsDir) return
    // Bulk-check local vs cloud across every file, then reorder local-
    // first per folder, and folders-with-any-local first overall — same
    // ordering trick StreamsPage uses to keep the converter pipeline
    // responsive instead of front-loading the cloud waits.
    const sessionsRaw = selectedFolders.map(f => ({
      folderPath: f.folderPath,
      date: f.date,
      relativePath: f.relativePath,
      filePaths: fullVideos(f).filter(p => !skipFiles.has(p)),
    })).filter(s => s.filePaths.length > 0)
    const allFiles = sessionsRaw.flatMap(s => s.filePaths)
    if (allFiles.length === 0) return
    const allLocal = await window.api.checkLocalFiles(allFiles)
    let cursor = 0
    const enriched = sessionsRaw.map(s => {
      const flags = allLocal.slice(cursor, cursor + s.filePaths.length)
      cursor += s.filePaths.length
      const pairs = s.filePaths.map((p, i) => ({ p, isLocal: flags[i] }))
      pairs.sort((a, b) => Number(b.isLocal) - Number(a.isLocal))
      return { ...s, filePaths: pairs.map(x => x.p), anyLocal: flags.some(Boolean) }
    })
    enriched.sort((a, b) => Number(b.anyLocal) - Number(a.anyLocal))

    const ext = preset.outputExtension || 'mkv'
    const allJobs: ConversionJob[] = []
    for (const e of enriched) {
      if (e.filePaths.length === 0) continue
      const groupId = uuidv4()
      const groupLabel = `Archive · ${e.date}`
      for (const inputFile of e.filePaths) {
        const sep = inputFile.includes('\\') ? '\\' : '/'
        const dirSepIdx = Math.max(inputFile.lastIndexOf('\\'), inputFile.lastIndexOf('/'))
        const dir = inputFile.slice(0, dirSepIdx)
        const fileName = inputFile.slice(dirSepIdx + 1)
        const baseName = fileName.replace(/\.[^.]+$/, '')
        const tempFile = `${dir}${sep}${baseName}__arc_tmp.${ext}`
        allJobs.push({
          id: uuidv4(),
          inputFile,
          outputFile: tempFile,
          preset,
          status: 'queued',
          progress: 0,
          groupId,
          groupLabel,
          replaceInput: true,
          groupCompletionHook: { type: 'archiveMarkAsArchived', streamsDir, date: e.date, metaKey: e.relativePath },
        })
      }
    }
    if (allJobs.length === 0) return
    await window.api.addQueuedGroup(allJobs)
  }, [streamsDir])

  const startArchive = useCallback(async (preset: ConversionPreset, setAsDefault: boolean) => {
    if (setAsDefault) await updateConfig({ archivePresetId: preset.id })
    if (!streamsDir || archiveTargetPaths.length === 0) { setArchiveTargetPaths([]); return }
    const targets = folders.filter(f => archiveTargetPaths.includes(f.folderPath))
    setArchiveTargetPaths([])
    if (targets.length === 0) return
    const allCandidateFiles = targets.flatMap(f => fullVideos(f))
    if (allCandidateFiles.length === 0) return
    // Probe for `encoded_by` tag — files already archived would lose
    // quality on a re-encode.
    const tagged = await window.api.checkAlreadyArchived(allCandidateFiles)
    if (tagged.length > 0) {
      setPendingArchiveDecision({ preset, selectedFolders: targets, taggedFiles: tagged, totalFiles: allCandidateFiles.length })
      return
    }
    await executeArchive(preset, targets, new Set())
  }, [archiveTargetPaths, folders, streamsDir, updateConfig, executeArchive])

  const handleArchiveDecision = useCallback(async (decision: 'skip' | 'continue') => {
    if (!pendingArchiveDecision) return
    const { preset, selectedFolders, taggedFiles } = pendingArchiveDecision
    setPendingArchiveDecision(null)
    const skipFiles = decision === 'skip' ? new Set(taggedFiles) : new Set<string>()
    await executeArchive(preset, selectedFolders, skipFiles)
  }, [pendingArchiveDecision, executeArchive])

  const handleArchive = useCallback((folder: StreamFolder) => {
    setArchiveTargetPaths([folder.folderPath])
  }, [])

  const handleOpenThumbnails = useCallback((folder: StreamFolder) => {
    openThumbnailEditor({
      folderPath: folder.folderPath,
      date: folder.date,
      title: folder.meta?.ytTitle ?? folder.meta?.games?.join(', '),
      meta: folder.meta ?? undefined,
      totalEpisodes: (() => {
        const game = folder.meta?.games?.[0] ?? folder.detectedGames?.[0]
        if (!game) return 0
        const lower = game.toLowerCase()
        const season = folder.meta?.ytSeason ?? '1'
        return folders.filter(f =>
          f.meta?.games?.some(g => g.toLowerCase() === lower) &&
          (f.meta?.ytSeason ?? '1') === season
        ).length
      })(),
    })
  }, [folders, openThumbnailEditor])

  // Minimal push-to-YouTube. Tries the broadcast endpoint first (upcoming /
  // live), falls back to the video endpoint (completed VODs). Thumbnail
  // upload is best-effort and runs after the metadata commit so a thumbnail
  // failure doesn't roll back the title/description/tag push that already
  // succeeded. The old MetaModal has a much richer push pipeline (dirty
  // detection, broadcast picker integration, push-snapshot tracking) — those
  // will land alongside the inline broadcast picker in a later phase.
  const handlePushToYoutube = useCallback(async (folder: StreamFolder, customThumbPath?: string | null) => {
    const meta = folder.meta
    if (!meta?.ytVideoId) {
      showBanner({ type: 'error', message: 'No linked YouTube broadcast or video. Link one before pushing.' })
      return
    }
    const title = meta.ytTitle?.trim() ?? ''
    const description = meta.ytDescription ?? ''
    const tags = meta.ytTags ?? []
    // Thumbnail to upload: caller's explicit pick (from the picker
    // section in the sidebar) overrides the implicit "use the stream
    // item's preferred thumbnail" fallback. `null` from the caller
    // means "I have nothing valid to upload" — skip the thumbnail
    // step entirely instead of falling back, otherwise the picker's
    // unchecked-but-empty state would silently push the item thumb.
    const thumbToUpload = customThumbPath === undefined ? meta.preferredThumbnail : customThumbPath
    try {
      try {
        await window.api.youtubeUpdateBroadcast(meta.ytVideoId, { title, description }, tags)
      } catch {
        await window.api.youtubeUpdateVideo(meta.ytVideoId, title, description, tags)
      }
      if (thumbToUpload) {
        try { await window.api.youtubeUploadThumbnail(meta.ytVideoId, thumbToUpload) }
        catch (thumbErr: any) {
          showBanner({ type: 'error', message: `Pushed metadata, but thumbnail upload failed: ${thumbErr?.message ?? String(thumbErr)}` })
          return
        }
      }
      showBanner({ type: 'success', message: 'Pushed to YouTube.' })
    } catch (err: any) {
      showBanner({ type: 'error', message: `YouTube push failed: ${err?.message ?? String(err)}` })
    }
  }, [showBanner])

  // Push to Twitch. Honours syncTitle/syncGame: when sync is on (or
  // undefined), the YouTube title/game stand in for the Twitch fields. Tags
  // get sanitised through toTwitchCompatibleTags so anything that violates
  // Twitch's alphanumeric/≤25-char rule is silently dropped (matching the
  // sidebar's validation hint).
  const handlePushToTwitch = useCallback(async (folder: StreamFolder) => {
    const meta = folder.meta
    if (!meta) {
      showBanner({ type: 'error', message: 'No metadata to push.' })
      return
    }
    const syncTitle = meta.syncTitle !== false
    const syncGame = meta.syncGame !== false
    const effectiveTitle = syncTitle ? (meta.ytTitle ?? '') : (meta.twitchTitle ?? '')
    const effectiveGame = syncGame ? (meta.ytGameTitle ?? '') : (meta.twitchGameName ?? '')
    const { compat: twitchSendTags } = toTwitchCompatibleTags(meta.twitchTags ?? [])
    try {
      await window.api.twitchUpdateChannel(effectiveTitle, effectiveGame || undefined, twitchSendTags)
      showBanner({ type: 'success', message: 'Pushed to Twitch.' })
    } catch (err: any) {
      showBanner({ type: 'error', message: `Twitch push failed: ${err?.message ?? String(err)}` })
    }
  }, [showBanner])

  const loadFolders = useCallback(async () => {
    if (!streamsDir) return
    setLoading(true)
    try {
      const result = await window.api.listStreams(streamsDir, streamMode as any)
      setFolders(result)
    } catch (err) {
      console.error('Failed to load streams', err)
    }
    setLoading(false)
  }, [streamsDir, streamMode])

  useEffect(() => {
    if (!streamsDir) return
    loadFolders()
    const off = window.api.onStreamsChanged(() => {
      loadFolders()
      setThumbsKey(Date.now())
    })
    return off
  }, [streamsDir, loadFolders])

  // Trash a single thumbnail file + refresh. If the deleted file was
  // the preferred thumbnail, also clear meta.preferredThumbnail so the
  // row's primary thumb falls back to whatever's next in the list.
  const handleDeleteThumbnail = useCallback(async (folder: StreamFolder, filePath: string) => {
    try {
      await window.api.trashFile(filePath)
    } catch (err) {
      console.error('Failed to trash thumbnail', err)
      return
    }
    const basename = filePath.split(/[\\/]/).pop() ?? ''
    if (folder.meta?.preferredThumbnail === basename) {
      await updateMeta(folder.folderPath, { preferredThumbnail: '' })
    }
    // streams:changed isn't guaranteed to fire for a trash, so reload
    // explicitly. Bump thumbsKey too so any cached thumb URL in
    // surviving slots re-fetches.
    await loadFolders()
    setThumbsKey(Date.now())
  }, [updateMeta, loadFolders])

  const selectedFolder = selectedFolderPath
    ? folders.find(f => f.folderPath === selectedFolderPath) ?? null
    : null

  // Autocomplete option pools — built from existing folders so users can
  // re-pick games they've used before. Stream-types also seed from the
  // tagColors map so customised types appear even on streams where they
  // haven't been used yet.
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

  // Visible folders = base folders → text-search → type filter → games
  // filter → sort. Type/games filters mirror the old page's logic
  // (multi-select chips, all-must-match within a facet, missing rows always
  // shown so the user can see broken state).
  const visibleFolders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const matches = (f: StreamFolder) => {
      if (!q) return true
      const fields = [
        f.date,
        f.folderName,
        f.meta?.ytTitle ?? '',
        f.meta?.twitchTitle ?? '',
        f.meta?.comments ?? '',
        (f.meta?.games ?? []).join(' '),
        (f.detectedGames ?? []).join(' '),
        normalizeStreamTypes(f.meta?.streamType).join(' '),
      ].join(' ').toLowerCase()
      return fields.includes(q)
    }
    const list = folders.filter(f => {
      if (f.isMissing) return true
      if (!matches(f)) return false
      if (filterTypes.size > 0 && !Array.from(filterTypes).every(t => normalizeStreamTypes(f.meta?.streamType).includes(t))) return false
      if (filterGames.size > 0) {
        const fGames = f.meta?.games?.length ? f.meta.games : f.detectedGames
        if (!Array.from(filterGames).every(g => fGames.includes(g))) return false
      }
      return true
    })
    list.sort((a, b) => {
      if (sortMode === 'title-asc') {
        const at = (a.meta?.ytTitle?.trim() || a.meta?.games?.join(', ') || a.folderName).toLowerCase()
        const bt = (b.meta?.ytTitle?.trim() || b.meta?.games?.join(', ') || b.folderName).toLowerCase()
        return at.localeCompare(bt)
      }
      const cmp = a.date.localeCompare(b.date)
      const tied = cmp === 0 ? a.folderName.localeCompare(b.folderName) : cmp
      return sortMode === 'date-asc' ? tied : -tied
    })
    return list
  }, [folders, searchQuery, sortMode, filterTypes, filterGames])

  // ── Select mode (multi-select + bulk ops) ────────────────────────────
  // Entering select mode closes the sidebar (selection + bulk actions
  // don't need it open) and clears the row-selection state. Exiting
  // clears the multi-select set so re-entering starts fresh.
  const [selectMode, setSelectMode] = useState(false)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  // In dump-mode folders share a folderPath (the dump dir itself), so
  // the date is the unique row key. Folder-per-stream uses folderPath
  // directly. Same convention StreamsPage uses for `selectionKey`.
  const selectionKey = useCallback((f: StreamFolder) => isDumpMode ? f.date : f.folderPath, [isDumpMode])
  const toggleSelectMode = useCallback(() => {
    setSelectMode(m => {
      if (m) setSelectedPaths(new Set())
      else setSelectedFolderPath(null)
      return !m
    })
  }, [])
  const toggleSelected = useCallback((key: string) => {
    setSelectedPaths(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }, [])
  const selectAllVisible = useCallback(() => {
    setSelectedPaths(new Set(visibleFolders.map(selectionKey)))
  }, [visibleFolders, selectionKey])
  const clearSelection = useCallback(() => setSelectedPaths(new Set()), [])

  // ── Click-and-drag range selection ───────────────────────────────────
  // Same pattern as StreamsPage: mousedown on a row captures the start
  // index + the current selection snapshot; mouseenter on neighboring
  // rows extends the range and re-applies the diff to the snapshot.
  // A global mouseup ends the drag. `dragMoved` tells the row-click
  // handler to ignore the synthetic click that fires at drag-end so a
  // short drag doesn't accidentally toggle the start row again.
  const isDragging = useRef(false)
  const dragStartIndex = useRef<number | null>(null)
  const dragAction = useRef<'add' | 'remove'>('add')
  const preDragPaths = useRef<Set<string>>(new Set())
  const dragMoved = useRef(false)
  const startDrag = useCallback((index: number) => {
    const f = visibleFolders[index]
    if (!f) return
    const key = selectionKey(f)
    isDragging.current = true
    dragStartIndex.current = index
    dragAction.current = selectedPaths.has(key) ? 'remove' : 'add'
    preDragPaths.current = new Set(selectedPaths)
    dragMoved.current = false
  }, [visibleFolders, selectionKey, selectedPaths])
  const updateDrag = useCallback((index: number) => {
    if (!isDragging.current || dragStartIndex.current === null) return
    dragMoved.current = true
    const start = Math.min(dragStartIndex.current, index)
    const end = Math.max(dragStartIndex.current, index)
    setSelectedPaths(() => {
      const next = new Set(preDragPaths.current)
      for (let i = start; i <= end; i++) {
        const f = visibleFolders[i]
        if (!f) continue
        dragAction.current === 'add' ? next.add(selectionKey(f)) : next.delete(selectionKey(f))
      }
      return next
    })
  }, [visibleFolders, selectionKey])
  useEffect(() => {
    const handler = () => { isDragging.current = false }
    document.addEventListener('mouseup', handler)
    return () => document.removeEventListener('mouseup', handler)
  }, [])

  // Bulk handlers — fire the same flows as the per-folder versions but
  // sourced from selectedPaths. Each clears the selection after queuing
  // so the user isn't left looking at "still selected" rows.
  const selectedFolderList = useMemo(
    () => visibleFolders.filter(f => selectedPaths.has(selectionKey(f))),
    [visibleFolders, selectedPaths, selectionKey],
  )
  const clickBulkArchive = useCallback(() => {
    if (selectedFolderList.length === 0) return
    setArchiveTargetPaths(selectedFolderList.map(f => f.folderPath))
    setSelectedPaths(new Set())
  }, [selectedFolderList])
  const clickBulkOffload = useCallback(async () => {
    if (!cloudSyncActive || selectedFolderList.length === 0) return
    const allFiles: { path: string; size: number }[] = []
    for (const f of selectedFolderList) allFiles.push(...await collectFolderFiles(f))
    if (allFiles.length > 0) enqueueOffload(allFiles)
    setSelectedPaths(new Set())
  }, [cloudSyncActive, selectedFolderList, collectFolderFiles, enqueueOffload])
  const clickBulkPinLocal = useCallback(async () => {
    if (!cloudSyncActive || selectedFolderList.length === 0) return
    const allFiles: { path: string; size: number }[] = []
    for (const f of selectedFolderList) allFiles.push(...await collectFolderFiles(f))
    if (allFiles.length > 0) enqueueHydrate(allFiles)
    setSelectedPaths(new Set())
  }, [cloudSyncActive, selectedFolderList, collectFolderFiles, enqueueHydrate])
  // Disable bulk archive when the selection contains any folder that's
  // already archiving (would race with the in-flight job) or any folder
  // that's already been archived (nothing to do).
  const selectionContainsArchiving = useMemo(
    () => selectedFolderList.some(isFolderArchiving),
    [selectedFolderList, isFolderArchiving],
  )
  const selectionAllArchived = useMemo(
    () => selectedFolderList.length > 0 && selectedFolderList.every(f => f.meta?.archived),
    [selectedFolderList],
  )

  // Bulk Edit Tags modal. Mirrors StreamsPage exactly — add/remove mode
  // toggle, picks stream types + games (with the "remove" mode only
  // listing tags actually present on the selection so the user can't
  // try to remove a tag none of them has). Inline new-tag creation
  // also picks a color via pickColorForNewTag.
  const [showBulkTag, setShowBulkTag] = useState(false)
  const handleBulkEditTags = useCallback(async (
    mode: 'add' | 'remove',
    editStreamTypes: string[],
    editGames: string[],
    onProgress: (done: number) => void,
  ) => {
    const removingTypes = new Set(editStreamTypes)
    const removingGames = new Set(editGames)
    let done = 0
    for (const f of selectedFolderList) {
      const existingTypes = normalizeStreamTypes(f.meta?.streamType)
      const existingGames = f.meta?.games ?? []
      const nextTypes = mode === 'add'
        ? Array.from(new Set([...existingTypes, ...editStreamTypes]))
        : existingTypes.filter(t => !removingTypes.has(t))
      const nextGames = mode === 'add'
        ? Array.from(new Set([...existingGames, ...editGames]))
        : existingGames.filter(g => !removingGames.has(g))
      // updateMeta writes via streams:updateMeta which does a partial
      // merge — passing the full new arrays for both keys overwrites
      // them in place without disturbing other meta fields.
      await updateMeta(f.folderPath, { streamType: nextTypes, games: nextGames })
      onProgress(++done)
    }
    setShowBulkTag(false)
    setSelectedPaths(new Set())
  }, [selectedFolderList, updateMeta])
  // Inline-create a new stream type from the bulk modal — picks a color
  // via pickColorForNewTag and persists to electron-store via
  // setStreamTypeTags. Mirrors StreamsPage.
  const handleNewStreamType = useCallback((tag: string) => {
    setTagColors(prev => {
      const updated = { ...prev, [tag]: pickColorForNewTag(prev) }
      window.api.setStreamTypeTags(updated)
      return updated
    })
  }, [])

  // ── Save-as-template handlers ─────────────────────────────────────────
  // Each appends a new template to the appropriate list, persists via
  // electron-store, and returns the new id so the caller in SidebarDetail
  // can mark it as the active selection. Mirrors StreamsPage's
  // save*AsTemplate functions but takes the field value as an argument
  // (the sidebar holds the field state, not the page).
  const saveYtTitleTemplate = useCallback(async (name: string, value: string): Promise<string> => {
    const tpl = { id: crypto.randomUUID(), name, template: value }
    const next = [...ytTitleTemplates, tpl]
    setYtTitleTemplates(next)
    await window.api.setYTTitleTemplates(next)
    return tpl.id
  }, [ytTitleTemplates])
  const saveYtDescTemplate = useCallback(async (name: string, value: string): Promise<string> => {
    const tpl = { id: crypto.randomUUID(), name, description: value }
    const next = [...ytDescTemplates, tpl]
    setYtDescTemplates(next)
    await window.api.setYTDescriptionTemplates(next)
    return tpl.id
  }, [ytDescTemplates])
  const saveYtTagsTemplate = useCallback(async (name: string, tags: string[]): Promise<string> => {
    const tpl = { id: crypto.randomUUID(), name, tags }
    const next = [...ytTagTemplates, tpl]
    setYtTagTemplates(next)
    await window.api.setYTTagTemplates(next)
    return tpl.id
  }, [ytTagTemplates])
  // Twitch templates store only the compat subset so reapplying them
  // doesn't silently drop tags that wouldn't push anyway (Twitch's
  // alphanumeric ≤25-char rule).
  const saveTwitchTagsTemplate = useCallback(async (name: string, tags: string[]): Promise<string> => {
    const { compat } = toTwitchCompatibleTags(tags)
    const tpl = { id: crypto.randomUUID(), name, tags: compat }
    const next = [...twitchTagTemplates, tpl]
    setTwitchTagTemplates(next)
    await window.api.setTwitchTagTemplates(next)
    return tpl.id
  }, [twitchTagTemplates])

  // ── Templates & Manage Tags modals ────────────────────────────────────
  const [showTemplatesModal, setShowTemplatesModal] = useState(false)
  const [showManageTags, setShowManageTags] = useState(false)
  // Wrappers around the page-level setters so the ManageTagsModal can
  // mutate the maps and persist them in one go. Identical to the
  // saveTagColors/saveTagTextures helpers on StreamsPage.
  const saveTagColors = useCallback((updated: Record<string, string>) => {
    setTagColors(updated)
    window.api.setStreamTypeTags(updated)
  }, [])
  const saveTagTextures = useCallback((updated: Record<string, string>) => {
    setTagTextures(updated)
    window.api.setStreamTypeTextures(updated)
  }, [])

  // Viable options — chips that would still produce ≥1 result if added on
  // top of the current filter set. The old page greys-out non-viable chips
  // in the dropdown so users don't pick filter combinations that yield zero.
  const viableTypeOptions = useMemo(() => {
    return new Set(
      allStreamTypes.filter(t => {
        if (filterTypes.has(t)) return true
        const candidate = new Set([...filterTypes, t])
        return folders.some(f => {
          if (f.isMissing) return false
          if (!Array.from(candidate).every(c => normalizeStreamTypes(f.meta?.streamType).includes(c))) return false
          if (filterGames.size > 0) {
            const fGames = f.meta?.games?.length ? f.meta.games : f.detectedGames
            if (!Array.from(filterGames).every(g => fGames.includes(g))) return false
          }
          return true
        })
      })
    )
  }, [allStreamTypes, filterTypes, filterGames, folders])
  const viableGameOptions = useMemo(() => {
    return new Set(
      allGames.filter(g => {
        if (filterGames.has(g)) return true
        const candidate = new Set([...filterGames, g])
        return folders.some(f => {
          if (f.isMissing) return false
          if (filterTypes.size > 0 && !Array.from(filterTypes).every(t => normalizeStreamTypes(f.meta?.streamType).includes(t))) return false
          const fGames = f.meta?.games?.length ? f.meta.games : f.detectedGames
          return Array.from(candidate).every(c => fGames.includes(c))
        })
      })
    )
  }, [allGames, filterGames, filterTypes, folders])
  const searchedGameOptions = useMemo(() => {
    const q = gameFilterSearch.trim().toLowerCase()
    if (!q) return allGames
    return allGames.filter(g => g.toLowerCase().includes(q))
  }, [allGames, gameFilterSearch])

  // Series-episode navigation. Mirrors MetaModal's prev/next-in-series
  // logic: same game (case-insensitive), same season ('1' default), sorted
  // ascending by episode number so "prev" = lower episode, "next" = higher.
  // The display-side sibling lookup (e.g. SeriesEpisodesTooltip) uses
  // reverse-chronological order, but navigation uses episode order so the
  // semantics of prev/next match user expectation.
  const seriesNav = useMemo(() => {
    if (!selectedFolder) return { prev: null as StreamFolder | null, next: null as StreamFolder | null }
    const primaryGame = selectedFolder.meta?.games?.[0] ?? selectedFolder.detectedGames?.[0]
    if (!primaryGame) return { prev: null, next: null }
    // `|| '1'` (not `?? '1'`) so empty strings also collapse to the first
    // season — clearing the field via the input should still associate
    // with siblings that have season undefined OR ''.
    const season = selectedFolder.meta?.ytSeason || '1'
    const lowerGame = primaryGame.toLowerCase()
    const list = folders
      .filter(f =>
        !f.isMissing &&
        ((f.meta?.games?.some(g => g.toLowerCase() === lowerGame)) ||
         (f.detectedGames?.some(g => g.toLowerCase() === lowerGame))) &&
        (f.meta?.ytSeason || '1') === season
      )
      .sort((a, b) => {
        const epA = parseInt(a.meta?.ytEpisode ?? '', 10)
        const epB = parseInt(b.meta?.ytEpisode ?? '', 10)
        return (isNaN(epA) ? Infinity : epA) - (isNaN(epB) ? Infinity : epB)
      })
    const idx = list.findIndex(f => f.folderPath === selectedFolder.folderPath)
    return {
      prev: idx > 0 ? list[idx - 1] : null,
      next: idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null,
    }
  }, [folders, selectedFolder])

  // Width of the visible-when-selected portion of the list (the area
  // NOT covered by the sidebar overlay). Equals the sum of the always-
  // visible columns: thumbnail (user-resizable) + video count (44px) +
  // date (220px). The sidebar's left edge is anchored exactly to this
  // value so the date column's right edge aligns flush with the
  // overlay — keeps the selected-row indicator (border-r on the date
  // <td>) flush with the sidebar and prevents narrower columns past
  // date (Type, etc.) from peeking out between the two.
  //
  // The vertical scrollbar reservation that used to be added here
  // (`+ 8`) is no longer needed: in the overlay layout the list keeps
  // its full width and the scrollbar lives way to the right of the
  // sidebar's left edge, hidden under the overlay.
  const rowWidth = thumbWidth + 44 + 220;

  // Animation config — respects the user's "Disable animations" setting
  // (or OS prefers-reduced-motion) AND the dev-only "Slow animations (5x)"
  // multiplier. Shared by every CSS transition on this page (sidebar
  // slide, list resize, header reflow, detail fade), the fade-out
  // timer below, and the row autoscroll behavior. Tailwind's static
  // `duration-200` classes are dropped from those elements so the
  // dynamic value wins.
  const anim = useAnimationConfig()
  const animDurationMs = anim.duration(200)
  // Slight buffer past the slide so the renderedFolder clear lands AFTER
  // the opacity transition completes — protects against tearing down
  // content while it's still fading in slow-anim mode.
  const fadeOutHoldMs = anim.duration(230)

  // ─── Sidebar overlay layout ─────────────────────────────────────────
  // The streams list + sidebar are absolutely positioned siblings inside
  // a `relative overflow-hidden` container, rather than a CSS grid with
  // animated column tracks. The reason: when a row is selected, the
  // user wants the list to NOT visually resize — instead the sidebar
  // grows leftward and slides on top of the list's right portion. This
  // keeps container queries on the list constant across the open/close
  // animation, so the "hidden at narrow widths" columns don't pop
  // in/out the moment the animation starts. They're physically rendered
  // (and react normally to window resize via container queries) — they
  // just happen to be covered by the sidebar overlay when one is open.
  //
  // Widths are computed from a measured `containerWidth` so the
  // selected sidebar can exactly fill from `rowWidth` to the right
  // edge regardless of the page's actual horizontal space.
  //
  // - `normalSidebarWidth`: the sidebar's settled width when nothing is
  //   selected (288 expanded, 40 collapsed rail). Depends on the user
  //   pref ONLY — not on selection — so the list never reflows when
  //   the user opens or closes a stream.
  // - `selectedSidebarWidth`: the sidebar's settled width when something
  //   IS selected (fills from rowWidth to the right edge of the page).
  // - `listWidth`: the constant width of the list area, computed from
  //   the pref. Only changes when the user toggles the collapse rail.
  // - `currentSidebarWidth`: what's animating — `selectedSidebarWidth`
  //   when a stream is selected, `normalSidebarWidth` otherwise.
  // Callback ref + ResizeObserver: fires whenever the outer container
  // mounts (more reliable than `useLayoutEffect` with `[]` deps when the
  // page is conditionally rendered or remounted by the app shell). The
  // observer keeps `containerWidth` in sync with window-resize without
  // the layout-effect ordering subtleties.
  const containerElRef = useRef<HTMLDivElement | null>(null)
  const containerObsRef = useRef<ResizeObserver | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    if (containerObsRef.current) {
      containerObsRef.current.disconnect()
      containerObsRef.current = null
    }
    containerElRef.current = el
    if (!el) return
    setContainerWidth(el.offsetWidth)
    const obs = new ResizeObserver(() => {
      setContainerWidth(el.offsetWidth)
    })
    obs.observe(el)
    containerObsRef.current = obs
  }, [])

  const normalSidebarWidth = sidebarCollapsedPref ? 40 : 288
  // Structural widths use CSS calc() — they're correct on first paint
  // without depending on the JS-measured containerWidth. Transitions
  // between `calc(100% - Npx)` and `${M}px` interpolate (both are
  // <length-percentage>), so the open/close/collapse animations work.
  const listWidthCss = `calc(100% - ${normalSidebarWidth}px)`
  const currentSidebarWidthCss = selectedFolderPath
    ? `calc(100% - ${rowWidth}px)`
    : `${normalSidebarWidth}px`
  // The detail layer's width DOES need a pixel value — it must equal
  // the OUTER container's `100% - rowWidth`, but the layer lives inside
  // the aside where CSS `100%` refers to the aside (animating). 0 until
  // measured is fine because the detail layer is `opacity: 0` and
  // `pointer-events: none` until a selection happens; by the time the
  // user clicks a row, the layout effect has already populated
  // containerWidth from the ResizeObserver.
  const selectedSidebarWidthPx = Math.max(0, containerWidth - rowWidth)

  // Keep the most-recently-selected folder mounted in the sidebar through
  // the close fade-out. Without this, the SidebarDetail would unmount the
  // instant the user clicks X and there'd be nothing left to fade. The
  // fade timer is the source of truth for "now safe to drop the content";
  // matches the 200ms opacity transition with a small buffer.
  const [renderedFolder, setRenderedFolder] = useState<StreamFolder | null>(selectedFolder)
  const fadeTimerRef = useRef<number | null>(null)
  useEffect(() => {
    if (selectedFolder) {
      setRenderedFolder(selectedFolder)
      if (fadeTimerRef.current !== null) {
        clearTimeout(fadeTimerRef.current)
        fadeTimerRef.current = null
      }
      return
    }
    if (renderedFolder === null) return
    if (fadeTimerRef.current !== null) clearTimeout(fadeTimerRef.current)
    fadeTimerRef.current = window.setTimeout(() => {
      setRenderedFolder(null)
      fadeTimerRef.current = null
    }, fadeOutHoldMs)
    return () => {
      if (fadeTimerRef.current !== null) {
        clearTimeout(fadeTimerRef.current)
        fadeTimerRef.current = null
      }
    }
    // selectedFolder is the trigger; renderedFolder is intentionally read
    // not depended on so the timer only restarts when the SELECTION
    // changes, not when we clear renderedFolder ourselves. fadeOutHoldMs
    // is read live via closure capture each render — including it here
    // would reset the timer when slow-anim toggles mid-close, which is
    // never the intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFolder])

  // Detail layer fade-in is handled entirely in CSS via `@starting-style`
  // (see `.opacity-mount-from-0` in index.css). The element mounts with
  // its starting style at opacity 0; Chromium then applies the regular
  // `opacity: 1` from the inline style and the existing
  // `transition-opacity` plays the 0→1 fade. Doing this in CSS instead
  // of React state means no re-render fires mid-slide, so the heavy
  // SidebarDetail subtree never reconciles during the animation —
  // killing the halfway hitch the state-based approach produced. Close
  // direction is just an opacity change driven by inline style, which
  // CSS transitions handle as before.

  if (!streamsDir) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-400">
        <p className="text-sm">No streams directory configured. Set one in Settings to get started.</p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-hidden"
    >
      {/* Main area: stream list.
          Absolutely positioned at the left, width is `containerWidth -
          normalSidebarWidth`. Does NOT depend on whether anything is
          selected, so the list never visually resizes when the sidebar
          opens/closes — the sidebar simply slides over it. The width
          transition is for the collapse-rail toggle (no-selection
          case only). */}
      <div
        className="@container absolute top-0 left-0 bottom-0 flex flex-col overflow-hidden border-r border-white/5 transition-[width] ease-linear"
        style={{ width: listWidthCss, transitionDuration: `${animDurationMs}ms` }}
      >
        {/* Page header — when a stream is selected the sidebar overlays
            the right portion of the list, so the header shrinks to the
            visible width (`rowWidth`) instead of letting its controls
            hide under the overlay. Width transitions in lockstep with
            the sidebar animation so the search/sort/buttons reflow as
            the overlay slides in.

            Header buttons collapse to icon-only via `labelCollapsed`
            keyed on `selectedFolderPath`. The button's label transition
            fires at t=0 of the selection, matching the slide. Their
            container-query fallback (`@2xl:` on the OUTER list area)
            handles the window-resize case when nothing is selected,
            so the labels still hide naturally on narrow windows.
            (Putting @container on the header itself caused the labels
            to switch mid-slide once the header's animating width
            crossed the breakpoint — visibly late vs. the slide.) */}
        <div
          className="px-6 py-4 border-b border-white/5 shrink-0 flex flex-col gap-3 transition-[width] ease-linear"
          style={{
            width: selectedFolderPath ? `${rowWidth}px` : '100%',
            transitionDuration: `${animDurationMs}ms`,
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold flex items-center gap-2">
                <Radio size={18} className="text-purple-400" />
                Streams
                <Tooltip content="Reload">
                  <button
                    type="button"
                    onClick={() => loadFolders()}
                    disabled={loading}
                    className="p-1 rounded text-gray-400 hover:text-gray-300 hover:bg-white/5 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                  </button>
                </Tooltip>
              </h1>
              <p className="text-xs text-gray-400 mt-0.5">
                {loading
                  ? 'Loading…'
                  : selectMode
                    ? `${selectedPaths.size} selected`
                    : searchQuery
                      ? `${visibleFolders.length} of ${folders.length} match`
                      : `${folders.length} item${folders.length === 1 ? '' : 's'}`}
              </p>
            </div>
            {selectMode ? (
              // Bulk-action toolbar — replaces the New Stream button while
              // in select mode. Mirrors the StreamsPage toolbar order:
              // Select All / Edit Tags / Offload / Pin Local / Archive / Stop.
              <div className="flex items-center gap-1 flex-wrap">
                <Tooltip content="Select all visible streams" side="bottom">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<CheckCheck size={14} />}
                    onClick={selectAllVisible}
                    disabled={selectedPaths.size === visibleFolders.length}
                    collapsibleLabel="@2xl:grid-cols-[1fr] @2xl:ms-0"
                    labelCollapsed={selectedFolderPath ? true : undefined}
                  >
                    Select All
                  </Button>
                </Tooltip>
                <Tooltip content="Clear current selection" side="bottom">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Square size={14} />}
                    onClick={clearSelection}
                    disabled={selectedPaths.size === 0}
                    collapsibleLabel="@2xl:grid-cols-[1fr] @2xl:ms-0"
                    labelCollapsed={selectedFolderPath ? true : undefined}
                  >
                    Clear
                  </Button>
                </Tooltip>
                <Tooltip content="Add or remove stream-type / topic tags across the selection" side="bottom">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Tags size={14} />}
                    onClick={() => setShowBulkTag(true)}
                    disabled={selectedPaths.size === 0}
                    collapsibleLabel="@2xl:grid-cols-[1fr] @2xl:ms-0"
                    labelCollapsed={selectedFolderPath ? true : undefined}
                  >
                    Edit Tags
                  </Button>
                </Tooltip>
                {cloudSyncActive && (
                  <>
                    <Tooltip content={selectionContainsArchiving ? 'One or more selected streams are being archived' : 'Offload selected streams to cloud'} side="bottom">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Cloud size={14} />}
                        onClick={clickBulkOffload}
                        disabled={selectedPaths.size === 0 || selectionContainsArchiving}
                        collapsibleLabel="@2xl:grid-cols-[1fr] @2xl:ms-0"
                    labelCollapsed={selectedFolderPath ? true : undefined}
                      >
                        Offload
                      </Button>
                    </Tooltip>
                    <Tooltip content={selectionContainsArchiving ? 'One or more selected streams are being archived' : 'Pin selected streams local'} side="bottom">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<CloudDownload size={14} />}
                        onClick={clickBulkPinLocal}
                        disabled={selectedPaths.size === 0 || selectionContainsArchiving}
                        collapsibleLabel="@2xl:grid-cols-[1fr] @2xl:ms-0"
                    labelCollapsed={selectedFolderPath ? true : undefined}
                      >
                        Pin Local
                      </Button>
                    </Tooltip>
                  </>
                )}
                <Tooltip
                  content={
                    selectionContainsArchiving ? 'One or more selected streams are already being archived'
                      : selectionAllArchived ? 'All selected streams are already archived'
                      : 'Archive selected streams'
                  }
                  side="bottom"
                >
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Archive size={14} />}
                    onClick={clickBulkArchive}
                    disabled={selectedPaths.size === 0 || selectionContainsArchiving || selectionAllArchived}
                    collapsibleLabel="@2xl:grid-cols-[1fr] @2xl:ms-0"
                    labelCollapsed={selectedFolderPath ? true : undefined}
                  >
                    Archive
                  </Button>
                </Tooltip>
                <Tooltip content="Exit selection mode" side="bottom">
                  <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={toggleSelectMode} collapsibleLabel="@2xl:grid-cols-[1fr] @2xl:ms-0"
                    labelCollapsed={selectedFolderPath ? true : undefined}>
                    Stop
                  </Button>
                </Tooltip>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <Tooltip content="Manage title, description, and tag templates" side="bottom">
                  <Button variant="ghost" size="sm" icon={<SquareDashedText size={14} />} onClick={() => setShowTemplatesModal(true)} collapsibleLabel="@2xl:grid-cols-[1fr] @2xl:ms-0"
                    labelCollapsed={selectedFolderPath ? true : undefined}>
                    Templates
                  </Button>
                </Tooltip>
                <Tooltip content="Manage stream type tags" side="bottom">
                  <Button variant="ghost" size="sm" icon={<Tags size={14} />} onClick={() => setShowManageTags(true)} collapsibleLabel="@2xl:grid-cols-[1fr] @2xl:ms-0"
                    labelCollapsed={selectedFolderPath ? true : undefined}>
                    Manage Tags
                  </Button>
                </Tooltip>
                <Tooltip content="Select multiple streams for bulk actions" side="bottom">
                  <Button variant="ghost" size="sm" icon={<CheckCheck size={14} />} onClick={toggleSelectMode} collapsibleLabel="@2xl:grid-cols-[1fr] @2xl:ms-0"
                    labelCollapsed={selectedFolderPath ? true : undefined}>
                    Select
                  </Button>
                </Tooltip>
                <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setNewStreamOpen(true)} collapsibleLabel="@2xl:grid-cols-[1fr] @2xl:ms-0"
                    labelCollapsed={selectedFolderPath ? true : undefined}>
                  New stream
                </Button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search title, games, notes, date…"
                className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-md pl-3 pr-8 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-gray-500 hover:text-gray-300 hover:bg-white/5"
                  aria-label="Clear search"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <select
              value={sortMode}
              onChange={e => setSortMode(e.target.value as typeof sortMode)}
              className="bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500/40 [color-scheme:dark]"
              title="Sort"
            >
              <option value="date-desc">Newest first</option>
              <option value="date-asc">Oldest first</option>
              <option value="title-asc">Title A–Z</option>
            </select>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto" ref={listScrollRef}>
          {loading && folders.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-400 text-sm gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : visibleFolders.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
              {searchQuery || filterTypes.size > 0 || filterGames.size > 0
                ? 'No streams match the current filters.'
                : 'No stream items.'}
            </div>
          ) : (
            <table className="w-full text-sm border-collapse table-fixed">
              <thead className="sticky top-0 bg-navy-800/80 backdrop-blur-sm z-10 border-b border-white/50">
                <tr className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  {selectMode && <th className="pl-3 py-2 w-[36px]" />}
                  <th className="p-0" style={{ width: thumbWidth }}>Thumbnail</th>
                  <th className="p-1 w-[44px]" />
                  <th className="text-left p-1 w-[220px]">Date</th>
                  {/* Extra columns stay rendered regardless of selection — the
                      sidebar overlay covers them visually but they remain in
                      layout so opening/closing the sidebar doesn't trigger a
                      column-pop or stretch the visible columns. Container
                      queries on the list area still control which ones show
                      based on the page's actual width (window resize). */}
                  <>
                      <th className="text-left py-1 pl-3 pr-1 min-w-[120px] hidden @xl:table-cell">
                        <div ref={typeFilterAnchorRef} className="relative flex items-center gap-1">
                          <span>Type</span>
                          <Tooltip content="Filter by type" side="bottom">
                            <button
                              onClick={openTypeFilter}
                              className={`p-0.5 rounded transition-colors ${filterTypes.size > 0 ? 'text-purple-400' : 'text-gray-400 hover:text-gray-300'}`}
                            >
                              <ListFilter size={12} />
                            </button>
                          </Tooltip>
                          {openFilter === 'type' && (
                            <>
                              <div className="fixed inset-0 z-20" onClick={() => setOpenFilter(null)} />
                              <div className="absolute top-full left-0 mt-1 z-30 bg-navy-700 border border-white/10 rounded-lg shadow-xl overflow-hidden min-w-[160px] overflow-y-auto" style={{ maxHeight: typeFilterMaxHeight }}>
                                {allStreamTypes.length === 0 ? (
                                  <p className="px-3 py-2 text-xs text-gray-400">No types tagged yet</p>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => { setFilterTypes(new Set()); setOpenFilter(null) }}
                                      disabled={filterTypes.size === 0}
                                      className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs border-b border-white/5 transition-colors disabled:opacity-30 disabled:cursor-default text-purple-400 hover:text-purple-300 hover:bg-white/5 disabled:hover:bg-transparent disabled:hover:text-purple-400"
                                    >
                                      <X size={11} className="shrink-0" />
                                      Clear filters
                                    </button>
                                    {allStreamTypes.map(t => {
                                      const color = getTagColor(tagColors[t])
                                      const viable = viableTypeOptions.has(t)
                                      return (
                                        <button
                                          key={t}
                                          onClick={() => viable && toggleTypeFilter(t)}
                                          className={`flex items-center gap-2 w-full px-3 py-1 text-left text-xs capitalize transition-colors ${
                                            !viable && !filterTypes.has(t)
                                              ? 'opacity-30 cursor-default'
                                              : filterTypes.has(t)
                                                ? `${color.text} hover:bg-white/5`
                                                : 'text-gray-300 hover:bg-white/5'
                                          }`}
                                        >
                                          <span
                                            className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center ${filterTypes.has(t) ? `${color.highlight} border-transparent` : 'border-white/20'}`}
                                            style={filterTypes.has(t) ? getTagTextureStyle(tagTextures[t]) : undefined}
                                          >
                                            {filterTypes.has(t) && <span className={`text-[9px] leading-none ${color.text}`}>✓</span>}
                                          </span>
                                          {t}
                                        </button>
                                      )
                                    })}
                                  </>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </th>
                      <th className="text-left py-1 pl-3 pr-1 min-w-[120px] hidden @3xl:table-cell">
                        <div ref={gameFilterAnchorRef} className="relative flex items-center gap-1">
                          <span>Topics / Games</span>
                          <Tooltip content="Filter by topic or game" side="bottom">
                            <button
                              onClick={openGameFilter}
                              className={`p-0.5 rounded transition-colors ${filterGames.size > 0 ? 'text-blue-400' : 'text-gray-400 hover:text-gray-300'}`}
                            >
                              <ListFilter size={12} />
                            </button>
                          </Tooltip>
                          {openFilter === 'games' && (
                            <>
                              <div className="fixed inset-0 z-20" onClick={() => setOpenFilter(null)} />
                              <div className="absolute top-full left-0 mt-1 z-30 bg-navy-700 border border-white/10 rounded-lg shadow-xl overflow-hidden min-w-[160px] overflow-y-auto" style={{ maxHeight: gameFilterMaxHeight }}>
                                {allGames.length === 0 ? (
                                  <p className="px-3 py-2 text-xs text-gray-400">No games tagged yet</p>
                                ) : (
                                  <>
                                    <input
                                      autoFocus
                                      value={gameFilterSearch}
                                      onChange={e => setGameFilterSearch(e.target.value)}
                                      onKeyDown={e => { if (e.key === 'Escape') setOpenFilter(null) }}
                                      placeholder="Filter topics…"
                                      className="w-full bg-navy-900 border-b border-white/10 text-gray-200 text-xs px-3 py-2 focus:outline-none placeholder-gray-500 sticky top-0 font-normal"
                                    />
                                    <button
                                      onClick={() => { setFilterGames(new Set()); setOpenFilter(null) }}
                                      disabled={filterGames.size === 0}
                                      className="flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs border-b border-white/5 transition-colors disabled:opacity-30 disabled:cursor-default text-blue-400 hover:text-blue-300 hover:bg-white/5 disabled:hover:bg-transparent disabled:hover:text-blue-400"
                                    >
                                      <X size={11} className="shrink-0" />
                                      Clear filters
                                    </button>
                                    {searchedGameOptions.length === 0 ? (
                                      <p className="px-3 py-2 text-xs text-gray-400 italic font-normal">No matches</p>
                                    ) : searchedGameOptions.map(g => {
                                      const viable = viableGameOptions.has(g)
                                      return (
                                        <button
                                          key={g}
                                          onClick={() => viable && toggleGameFilter(g)}
                                          className={`flex items-center gap-2 w-full px-3 py-1 text-left text-xs transition-colors font-normal ${
                                            !viable && !filterGames.has(g)
                                              ? 'opacity-30 cursor-default'
                                              : filterGames.has(g)
                                                ? 'text-blue-300 hover:bg-white/5'
                                                : 'text-gray-300 hover:bg-white/5'
                                          }`}
                                        >
                                          <span className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center ${filterGames.has(g) ? 'bg-blue-500 border-blue-500' : 'border-white/20'}`}>
                                            {filterGames.has(g) && <span className="text-white text-[9px] leading-none">✓</span>}
                                          </span>
                                          {g}
                                        </button>
                                      )
                                    })}
                                  </>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </th>
                      <th className="text-left p-1 min-w-[100px] hidden @5xl:table-cell">Notes</th>
                      <th className="text-right p-1 min-w-[160px]">Actions</th>
                    </>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const today = todayStr()
                  return visibleFolders.map((f, i) => {
                    const ytId = f.meta?.ytVideoId
                    const status = ytId ? ytVideoStatusMap[ytId] : undefined
                    const key = selectionKey(f)
                    return (
                      <StreamListItem
                        key={f.folderPath}
                        folder={f}
                        selected={f.folderPath === selectedFolderPath}
                        animDurationMs={animDurationMs}
                        compact={false}
                        selectMode={selectMode}
                        multiSelected={selectedPaths.has(key)}
                        onToggleMultiSelect={() => toggleSelected(key)}
                        onDragStart={() => startDrag(i)}
                        onDragEnter={() => updateDrag(i)}
                        dragMovedRef={dragMoved}
                        cloudSyncActive={cloudSyncActive}
                        isPending={isPendingStream(f, today)}
                        isNextUpcoming={f.folderPath === nextUpcomingFolderPath}
                        isLive={!!(ytId && ytLiveMap[ytId])}
                        privacyStatus={status?.privacyStatus ?? null}
                        isLivestream={status?.isLivestream ?? null}
                        sameDayIndex={sameDayIndexMap.get(f.folderPath)}
                        thumbsKey={thumbsKey}
                        thumbWidth={thumbWidth}
                        tagColors={tagColors}
                        tagTextures={tagTextures}
                        onClick={() => onRowClick(f.folderPath)}
                        onSendToPlayer={() => handleSendToPlayer(f)}
                        onSendToConverter={() => handleSendToConverter(f)}
                        onOpenThumbnails={() => handleOpenThumbnails(f)}
                        onThumbResizeStart={startThumbResize}
                      />
                    )
                  })
                })()}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Sidebar overlay — absolutely positioned on the right, slides
          over the streams list as it grows. Composed of two layers:
            1. No-selection layer (always at `normalSidebarWidth`,
               opacity 1, anchored left). Shows the collapsed rail or
               the empty-state hint depending on the user's pref.
            2. Detail layer (at `selectedSidebarWidth`, opacity fades
               between 0 ↔ 1, anchored left, bg opaque so it covers
               layer 1 when visible). Rendered as long as
               `renderedFolder` is set, which lingers through the
               close fade-out so the user actually sees the detail
               content disappear instead of vanishing instantly.
          The aside itself only animates its `width` — content layers
          stay at their final widths so they don't reflow during the
          slide. */}
      <aside
        className="absolute top-0 right-0 bottom-0 z-30 overflow-hidden bg-navy-800 pe-2 transition-[width] ease-linear"
        style={{ width: currentSidebarWidthCss, transitionDuration: `${animDurationMs}ms` }}
      >
        {/* Edge toggle — only present when no stream is selected. The
            sidebar isn't collapsible while a stream is open (the user
            has to deselect first via the X). */}
        {!selectedFolderPath && (
          <Tooltip
            content={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            side="left"
            triggerClassName="group/edge absolute left-0 inset-y-0 w-2 z-20"
          >
            <button
              type="button"
              onClick={toggleSidebar}
              className="absolute inset-0 cursor-col-resize"
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            />
            <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-white/5 group-hover/edge:w-0.5 group-hover/edge:bg-purple-500 transition-all duration-150" />
          </Tooltip>
        )}

        {/* Layer 1: no-selection content. Anchored left, sized to the
            settled-small width. Stays at opacity 1 always — the detail
            layer above just covers it during the open animation. */}
        <div
          className="absolute top-0 left-0 bottom-0"
          style={{ width: normalSidebarWidth }}
        >
          {sidebarCollapsedPref ? (
            <button
              type="button"
              onClick={toggleSidebar}
              className="flex flex-col items-center justify-start pt-4 gap-2 h-full w-full text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
              aria-label="Expand sidebar"
              title="Expand sidebar"
            >
              <ChevronLeft size={16} />
              <span className="[writing-mode:vertical-rl] rotate-180 text-[10px] uppercase tracking-wider text-gray-500 mt-2">Details</span>
            </button>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-gray-500 px-6 text-center">
              Pick a stream from the list to view its details here.
            </div>
          )}
        </div>

        {/* Layer 2: detail content. Anchored left at the FINAL selected
            width so the content doesn't reflow as the sidebar grows —
            its right portion is simply clipped by the aside's
            `overflow-hidden` while the sidebar is mid-animation. Stays
            mounted (`renderedFolder`) through the close fade so the
            user sees the content fade out instead of pop. */}
        {renderedFolder && (
          <div
            className={`opacity-mount-from-0 absolute top-0 left-0 bottom-0 bg-navy-800 transition-opacity ease-linear ${selectedFolderPath ? '' : 'opacity-0'}`}
            style={{
              width: selectedSidebarWidthPx,
              // `opacity` is intentionally NOT set inline — inline styles
              // have higher specificity than the `@starting-style` rule
              // and would override its frame-0 opacity:0, killing the
              // fade-in. Opacity is class-driven: default (no class) = 1,
              // `opacity-0` for the close fade-out.
              pointerEvents: selectedFolderPath ? 'auto' : 'none',
              transitionDuration: `${animDurationMs}ms`,
            }}
          >
            <SidebarDetail
              folder={renderedFolder}
              folders={folders}
              prevEpisode={seriesNav.prev}
              nextEpisode={seriesNav.next}
              onPickEpisode={(f) => setSelectedFolderPath(f.folderPath)}
              onClose={() => setSelectedFolderPath(null)}
              onUpdateMeta={partial => updateMeta(renderedFolder.folderPath, partial)}
              cloudSyncActive={cloudSyncActive}
              allGames={allGames}
              allStreamTypes={allStreamTypes}
              tagColors={tagColors}
              tagTextures={tagTextures}
              onReschedule={() => setRescheduleTargetPath(renderedFolder.folderPath)}
              onNewEpisode={() => setNewEpisodeSourcePath(renderedFolder.folderPath)}
              onOffload={() => handleOffload(renderedFolder)}
              onPinLocal={() => handlePinLocal(renderedFolder)}
              onArchive={() => handleArchive(renderedFolder)}
              isArchiving={isFolderArchiving(renderedFolder)}
              thumbsKey={thumbsKey}
              onDeleteThumbnail={(filePath) => handleDeleteThumbnail(renderedFolder, filePath)}
              ytBroadcasts={ytBroadcasts}
              ytVods={ytVods}
              setYtVods={setYtVods}
              setYtBroadcasts={setYtBroadcasts}
              broadcastLinks={broadcastLinks}
              ytBroadcastsLoading={ytBroadcastsLoading}
              onLoadAllVods={loadAllVods}
              defaultBroadcastTime={config.defaultBroadcastTime || '19:00'}
              claudeEnabled={claudeEnabled}
              onSendToPlayer={() => handleSendToPlayer(renderedFolder)}
              onSendToConverter={() => handleSendToConverter(renderedFolder)}
              onSendToCombine={() => handleSendToCombine(renderedFolder)}
              onOpenFolder={() => handleOpenFolder(renderedFolder)}
              onOpenThumbnails={() => handleOpenThumbnails(renderedFolder)}
              onDelete={() => setDeleteTargetPath(renderedFolder.folderPath)}
              onPushToYoutube={(customThumb) => handlePushToYoutube(renderedFolder, customThumb)}
              onPushToTwitch={() => handlePushToTwitch(renderedFolder)}
              ytConnected={ytConnected}
              twConnected={twConnected}
              banner={banner}
              onDismissBanner={() => setBanner(null)}
              ytTitleTemplates={ytTitleTemplates}
              ytDescTemplates={ytDescTemplates}
              ytTagTemplates={ytTagTemplates}
              twitchTagTemplates={twitchTagTemplates}
              onSaveYtTitleTemplate={saveYtTitleTemplate}
              onSaveYtDescTemplate={saveYtDescTemplate}
              onSaveYtTagsTemplate={saveYtTagsTemplate}
              onSaveTwitchTagsTemplate={saveTwitchTagsTemplate}
            />
          </div>
        )}
      </aside>
      {/* Visibility flag is currently unused (page is unconditionally
          rendered via App's display:none wrapper) but threaded through so
          later phases can do mount-time work conditionally if needed. */}
      {!isVisible && null}

      {rescheduleTargetPath && (() => {
        const target = folders.find(f => f.folderPath === rescheduleTargetPath)
        if (!target) return null
        return (
          <RescheduleModal
            target={target}
            onClose={() => setRescheduleTargetPath(null)}
            onSuccess={(newFolderPath) => {
              setRescheduleTargetPath(null)
              setSelectedFolderPath(newFolderPath)
              void loadFolders()
            }}
          />
        )
      })()}

      {deleteTargetPath && (() => {
        const target = folders.find(f => f.folderPath === deleteTargetPath)
        if (!target) return null
        return (
          <DeleteModal
            target={target}
            isDumpMode={isDumpMode}
            onClose={() => setDeleteTargetPath(null)}
            onSuccess={() => {
              setDeleteTargetPath(null)
              setSelectedFolderPath(null)
              void loadFolders()
            }}
          />
        )
      })()}

      {archiveTargetPaths.length > 0 && (
        <PresetPickerModal
          onPick={(preset, setAsDefault) => startArchive(preset, setAsDefault)}
          onClose={() => setArchiveTargetPaths([])}
          isDumpMode={isDumpMode}
          defaultPresetId={config.archivePresetId}
          selectionCount={archiveTargetPaths.length}
        />
      )}

      {showBulkTag && (() => {
        // `presentX` lists only tags actually on the selected folders so
        // the "remove" mode doesn't offer tags none of them has. Computed
        // here at mount time since the modal re-renders on every state
        // change anyway and recomputing is cheap.
        const presentStreamTypes = Array.from(new Set(
          selectedFolderList.flatMap(f => normalizeStreamTypes(f.meta?.streamType))
        )).sort()
        const presentGames = Array.from(new Set(
          selectedFolderList.flatMap(f => f.meta?.games ?? [])
        )).sort()
        return (
          <BulkTagModal
            count={selectedPaths.size}
            allStreamTypes={allStreamTypes}
            allGames={allGames}
            presentStreamTypes={presentStreamTypes}
            presentGames={presentGames}
            tagColors={tagColors}
            onNewStreamType={handleNewStreamType}
            onApply={handleBulkEditTags}
            onClose={() => setShowBulkTag(false)}
          />
        )
      })()}

      {showManageTags && (
        <ManageTagsModal
          tags={allStreamTypes}
          tagColors={tagColors}
          tagTextures={tagTextures}
          games={allGames}
          folders={folders}
          onColorChange={(tag, colorKey) => {
            saveTagColors({ ...tagColors, [tag]: colorKey })
          }}
          onTextureChange={(tag, textureKey) => {
            saveTagTextures({ ...tagTextures, [tag]: textureKey })
          }}
          onAddTag={(name, colorKey, textureKey) => {
            saveTagColors({ ...tagColors, [name]: colorKey })
            saveTagTextures({ ...tagTextures, [name]: textureKey })
          }}
          // Delete a stream type — strips it from every folder's
          // streamType array, then removes it from both tag-attribute
          // maps and reloads. Mirrors StreamsPage's onDeleteTag exactly.
          onDeleteTag={tag => {
            const affected = folders.filter(f =>
              normalizeStreamTypes(f.meta?.streamType).includes(tag)
            )
            Promise.all(
              affected.map(f =>
                window.api.writeStreamMeta(f.folderPath, {
                  ...(f.meta ?? { date: f.date, streamType: [], games: [], comments: '' }),
                  streamType: normalizeStreamTypes(f.meta?.streamType).filter(t => t !== tag),
                }, f.relativePath)
              )
            ).then(() => {
              const updatedColors = { ...tagColors }
              delete updatedColors[tag]
              saveTagColors(updatedColors)
              const updatedTextures = { ...tagTextures }
              delete updatedTextures[tag]
              saveTagTextures(updatedTextures)
              void loadFolders()
            })
          }}
          // Merge several stream types into one — rewrite every folder
          // that has any of the dying tags so they end up with the
          // survivor instead, then drop the dying entries from the
          // color/texture maps.
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
                return window.api.writeStreamMeta(f.folderPath, {
                  ...(f.meta ?? { date: f.date, streamType: [], games: [], comments: '' }),
                  streamType: merged,
                }, f.relativePath)
              })
            ).then(() => {
              const updatedColors = { ...tagColors }
              const updatedTextures = { ...tagTextures }
              for (const d of dying) { delete updatedColors[d]; delete updatedTextures[d] }
              saveTagColors(updatedColors)
              saveTagTextures(updatedTextures)
              void loadFolders()
            })
          }}
          onDeleteGame={game => {
            const affected = folders.filter(f => f.meta?.games?.includes(game))
            Promise.all(
              affected.map(f =>
                window.api.writeStreamMeta(f.folderPath, {
                  ...(f.meta ?? { date: f.date, streamType: [], games: [], comments: '' }),
                  games: (f.meta?.games ?? []).filter(g => g !== game),
                }, f.relativePath)
              )
            ).then(() => loadFolders())
          }}
          onCombineGames={(dying, survivor) => {
            const allDying = new Set(dying)
            const affected = folders.filter(f =>
              (f.meta?.games ?? []).some(g => allDying.has(g))
            )
            Promise.all(
              affected.map(f => {
                const gs = f.meta?.games ?? []
                const merged = gs.includes(survivor)
                  ? gs.filter(g => !allDying.has(g))
                  : [survivor, ...gs.filter(g => !allDying.has(g))]
                return window.api.writeStreamMeta(f.folderPath, {
                  ...(f.meta ?? { date: f.date, streamType: [], games: [], comments: '' }),
                  games: merged,
                }, f.relativePath)
              })
            ).then(() => loadFolders())
          }}
          onClose={() => setShowManageTags(false)}
        />
      )}

      <TemplatesModal
        isOpen={showTemplatesModal}
        onClose={() => setShowTemplatesModal(false)}
        onSaved={() => {
          // After templates are saved, refresh the in-sidebar template
          // dropdowns so a freshly-created template is immediately
          // selectable without an app restart.
          window.api.getYTTitleTemplates().then(setYtTitleTemplates).catch(() => {})
          window.api.getYTDescriptionTemplates().then(setYtDescTemplates).catch(() => {})
          window.api.getYTTagTemplates().then(setYtTagTemplates).catch(() => {})
          window.api.getTwitchTagTemplates?.().then(setTwitchTagTemplates).catch(() => {})
        }}
      />

      {pendingArchiveDecision && (
        <Modal
          isOpen
          onClose={() => setPendingArchiveDecision(null)}
          title="Some files have already been archived"
          width="lg"
          footer={
            <>
              <Button variant="ghost" onClick={() => setPendingArchiveDecision(null)}>Cancel</Button>
              <Button variant="ghost" onClick={() => handleArchiveDecision('continue')}>Archive everything anyway</Button>
              <Button variant="primary" onClick={() => handleArchiveDecision('skip')}>Skip already-archived</Button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-300">
              <span className="text-yellow-300 font-medium">{pendingArchiveDecision.taggedFiles.length}</span>
              {' '}of <span className="text-gray-200">{pendingArchiveDecision.totalFiles}</span> selected file
              {pendingArchiveDecision.totalFiles === 1 ? '' : 's'} ha
              {pendingArchiveDecision.taggedFiles.length === 1 ? 's' : 've'}
              {' '}an "Archived Stream" tag in their container metadata, meaning they were encoded by a previous archive run. Re-encoding will lose quality without benefit.
            </p>
            <div className="border border-white/10 rounded-lg overflow-hidden bg-navy-900/40">
              <div className="px-3 py-2 border-b border-white/10 text-[10px] uppercase tracking-wide text-gray-400">
                Already archived
              </div>
              <div className="max-h-[40vh] overflow-y-auto divide-y divide-white/5">
                {pendingArchiveDecision.taggedFiles.map(p => {
                  const name = p.split(/[\\/]/).pop() ?? p
                  return (
                    <div key={p} className="px-3 py-1.5 text-xs text-gray-400 truncate" title={p}>{name}</div>
                  )
                })}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {(newStreamOpen || newEpisodeSourcePath) && (() => {
        const source = newEpisodeSourcePath
          ? folders.find(f => f.folderPath === newEpisodeSourcePath) ?? undefined
          : undefined
        return (
          <NewStreamModal
            existingDates={folders.map(f => f.date)}
            onClose={() => { setNewStreamOpen(false); setNewEpisodeSourcePath(null) }}
            onCreated={async (newFolderPath) => {
              setNewStreamOpen(false)
              setNewEpisodeSourcePath(null)
              await loadFolders()
              setSelectedFolderPath(newFolderPath)
            }}
            streamsDir={streamsDir!}
            streamMode={streamMode}
            source={source}
            folders={folders}
          />
        )
      })()}
    </div>
  )
}

// ── Stream list row ─────────────────────────────────────────────────────────

/**
 * StreamListItem — the row design for the streams list. Mirrors the
 * visible columns of the old page's StreamRow (thumbnail, video count,
 * date + status + title, type chips, game chips, notes, hover actions)
 * without the table layout (the new list is ul/li, not a table).
 *
 * The `compact` mode is what kicks in when the right sidebar has a stream
 * selected: tags, notes, and the hover-revealed action buttons are dropped
 * so the row fits the narrower list area without overflow. Title and
 * status indicators stay so the row is still scannable.
 *
 * Status badges (livestream / privacy / pending) require live broadcast
 * data — that lookup ships with the broadcast picker. For now the row
 * just shows the archived flag, a linked-to-YT button when a video id is
 * present, and an unlinked icon when it isn't.
 */
function StreamListItem({
  folder, selected, compact, selectMode, multiSelected, onToggleMultiSelect,
  onDragStart, onDragEnter, dragMovedRef,
  isPending, isNextUpcoming, isLive, privacyStatus, isLivestream,
  sameDayIndex, thumbsKey, thumbWidth, tagColors, tagTextures, cloudSyncActive,
  onClick, onSendToPlayer, onSendToConverter, onOpenThumbnails, onThumbResizeStart,
  animDurationMs,
}: {
  folder: StreamFolder
  selected: boolean
  /** Page-level sidebar transition duration. Drives the delay before
   *  the selected-row indicator appears on open (so it lands after the
   *  sidebar finishes sliding into place rather than racing it). */
  animDurationMs: number
  compact: boolean
  /** When true, rows render a checkbox in the first cell instead of
   *  reacting to a click as sidebar-open. Row click toggles selection. */
  selectMode: boolean
  /** True when this row's selection key is in the multi-select set. */
  multiSelected: boolean
  /** Fires on row click (or checkbox click) when in selectMode. */
  onToggleMultiSelect: () => void
  /** Mousedown on the row (selectMode only) starts a drag-select. */
  onDragStart: () => void
  /** Mouseenter on the row (selectMode only) extends the drag range. */
  onDragEnter: () => void
  /** When the drag-select moves to at least one other row, the click
   *  that fires at drag-end on the start row is suppressed via this
   *  ref so it doesn't toggle the start row off. */
  dragMovedRef: React.MutableRefObject<boolean>
  isPending: boolean
  /** True when this row is the soonest-upcoming pending stream — just
   *  swaps the unlinked-pending badge tooltip text. */
  isNextUpcoming: boolean
  /** True while the linked broadcast is actively live on YouTube right
   *  now (per the 60s poll + relay-orchestrator push). Flips the
   *  pending-linked badge from teal "scheduled" to green "live now". */
  isLive: boolean
  /** YT API privacy status of the linked video (null while loading or
   *  not linked). Drives the inline privacy icon. */
  privacyStatus: string | null
  /** True if the linked YT id represents a liveBroadcast (Radio icon)
   *  vs a regular video upload (Clapperboard). Null while loading. */
  isLivestream: boolean | null
  /** "#2", "#3" suffix when multiple streams share a date. */
  sameDayIndex?: number
  thumbsKey: number
  thumbWidth: number
  tagColors: Record<string, string>
  tagTextures: Record<string, string>
  /** Drives the cloud-status column in the rich count tooltip — when
   *  false the tooltip skips the Cloud/CloudCheck icon entirely. */
  cloudSyncActive: boolean
  onClick: () => void
  onSendToPlayer: () => void
  onSendToConverter: () => void
  onOpenThumbnails: () => void
  onThumbResizeStart: (e: React.MouseEvent) => void
}) {
  // Selected-row indicator timing — drives the purple bar on the date
  // cell. Lags behind `selected` on open (waits for the sidebar to
  // finish sliding so the indicator just pops into place rather than
  // racing the slide) but matches it instantly on close. The close
  // path runs in useLayoutEffect so the className updates before the
  // next paint and the user doesn't see a one-frame stale indicator.
  const [indicatorVisible, setIndicatorVisible] = useState(false)
  useLayoutEffect(() => {
    if (!selected) {
      setIndicatorVisible(false)
      return
    }
    const t = window.setTimeout(() => setIndicatorVisible(true), animDurationMs)
    return () => clearTimeout(t)
  }, [selected, animDurationMs])

  if (folder.isMissing) {
    const missingColSpan = compact ? 2 : 5
    return (
      <tr className="border-b border-red-900/30 bg-red-950/10">
        {selectMode && <td className="pl-3 align-middle w-[36px]" />}
        <td className="p-0 align-middle" style={{ width: thumbWidth }}>
          <div className="w-full bg-red-900/20 flex items-center justify-center" style={{ height: thumbWidth * 9 / 16 }}>
            <AlertTriangle size={14} className="text-red-700" />
          </div>
        </td>
        <td colSpan={missingColSpan} className="px-2 py-2 align-middle">
          <div className="flex items-center gap-3">
            <span className="text-sm font-mono text-red-400">{folder.folderName}</span>
            <span className="text-xs text-red-700 italic">Folder not found on disk</span>
          </div>
        </td>
      </tr>
    )
  }

  const { meta, hasMeta, detectedGames, date, thumbnails, thumbnailLocalFlags, videoCount } = folder
  const displayGames = meta?.games?.length ? meta.games : detectedGames
  const firstThumb = thumbnails[0]
  const firstThumbLocal = thumbnailLocalFlags?.[0] ?? true
  const extraCount = thumbnails.length - 1
  const hasSMThumbnail = thumbnails.some(t => /[_-]sm-thumbnail\./i.test(t))
  const title = meta?.ytTitle?.trim() || meta?.twitchTitle?.trim() || meta?.games?.join(', ') || folder.folderName

  // Title clamp — lines that fit within the thumbnail's height once you
  // subtract the date row above it. Mirrors the old page formula.
  const titleLines = Math.max(1, Math.floor(((thumbWidth * 9 / 16) - 20) / 15))

  const handleRowClick = (e: React.MouseEvent<HTMLTableRowElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('button, a, input, textarea, select, [role="button"], [data-no-row-toggle]')) return
    // After a real drag-select the browser fires a synthetic click on
    // the start row. Swallow that click so the start row's selection
    // isn't accidentally toggled back off.
    if (dragMovedRef.current) { dragMovedRef.current = false; return }
    // In select mode the row click toggles the multi-select set instead
    // of opening the sidebar — matches the StreamsPage convention so the
    // bulk-action flow doesn't require precise checkbox aim.
    if (selectMode) onToggleMultiSelect()
    else onClick()
  }

  return (
    <tr
      data-folder-path={folder.folderPath}
      onClick={handleRowClick}
      onMouseDown={selectMode ? (e) => { e.preventDefault(); onDragStart() } : undefined}
      onMouseEnter={selectMode ? onDragEnter : undefined}
      style={selectMode ? { userSelect: 'none' } : undefined}
      className={`group transition-colors cursor-pointer ${
        isPending
          ? 'border-b border-teal-900/30 bg-teal-900/15 hover:bg-teal-900/30'
          : 'border-b border-white/10 hover:bg-white/[0.03]'
      } ${selected ? (
        // Right-edge indicator lives on the date cell below (search for
        // `selected-row-indicator`) so it stays visible when the sidebar
        // overlay covers the row's actual right edge.
        `${isPending ? 'border-b border-teal-700/40 !bg-teal-700/30 hover:!bg-teal-700/40' : '!bg-purple-900/20'}`
      ) : ''} ${selectMode && multiSelected ? '!bg-purple-900/15' : ''}`}
    >
      {/* Checkbox column — only renders in select mode. The pl-3 keeps
          the checkbox off the row's left edge but tight enough that the
          thumbnail column doesn't drift right by too much. */}
      {selectMode && (
        <td
          className="pl-3 align-middle w-[36px]"
          onClick={e => { e.stopPropagation(); onToggleMultiSelect() }}
        >
          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
            multiSelected ? 'bg-purple-700 border-purple-700' : 'border-gray-600 hover:border-gray-400'
          }`}>
            {multiSelected && <Check size={10} className="text-white" strokeWidth={3} />}
          </div>
        </td>
      )}
      {/* Thumbnail — also hosts the right-edge drag handle that resizes
          every thumbnail column at once. The data-no-row-toggle marker on
          the handle keeps the click that fires when mouseup lands inside
          the handle (i.e. a short drag) from bubbling up to handleRowClick
          and toggling the selection. */}
      <td className="p-0 align-middle relative" style={{ width: thumbWidth }}>
        <div
          className={`relative overflow-hidden shrink-0`}
          style={{ width: thumbWidth, height: thumbWidth * 9 / 16 }}
        >
          {firstThumb ? (
            <>
              <ThumbImage
                path={firstThumb}
                thumbsKey={thumbsKey}
                isLocal={firstThumbLocal}
                className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                draggable={false}
                iconSize={12}
              />
              {extraCount > 0 && (
                <span className="absolute bottom-0.5 right-0.5 bg-black/70 text-white text-[10px] font-medium px-1 rounded leading-4 pointer-events-none">
                  +{extraCount}
                </span>
              )}
            </>
          ) : (
            <div className="w-full h-full bg-white/5 flex flex-col items-center justify-center gap-0.5">
              <ImageOff size={14} className="text-gray-400" />
              <span className="text-[9px] text-gray-400 leading-none">none</span>
            </div>
          )}
        </div>
        <div
          className="group/resize absolute top-0 right-0 w-2 h-full cursor-ew-resize z-10"
          data-no-row-toggle
          onMouseDown={onThumbResizeStart}
        >
          <div className="absolute top-0 right-0 w-px h-full bg-purple-500 opacity-0 group-hover/resize:opacity-100 transition-opacity" />
        </div>
      </td>

      {/* Video count — Film icon for full recordings, Scissors for
          clips/shorts (in blue). Wrapped in VideoCountTooltip so hover
          shows the per-file panel (filename · category badge · size ·
          duration · cloud status). Falls back to the plain videos array
          length when videoMap isn't populated yet. */}
      <td className="px-2 py-2 align-middle w-[44px]">
        <VideoCountTooltip videos={folder.videos} videoMap={folder.meta?.videoMap ?? undefined} folderPath={folder.folderPath} cloudSyncActive={cloudSyncActive}>
          {(() => {
            const vm = folder.meta?.videoMap
            const fullCount = vm ? Object.values(vm).filter(e => e.category === 'full').length : videoCount
            const shortClipCount = vm ? Object.values(vm).filter(e => e.category === 'short' || e.category === 'clip').length : 0
            return (
              <div className="flex flex-col items-center gap-0.5 cursor-default">
                <div className="flex items-center gap-1 text-xs font-mono text-gray-400">
                  <Film size={11} className="shrink-0" />
                  <span>{fullCount}</span>
                </div>
                {shortClipCount > 0 && (
                  <div className="flex items-center gap-1 text-xs font-mono text-blue-400">
                    <Scissors size={11} className="shrink-0" />
                    <span>{shortClipCount}</span>
                  </div>
                )}
              </div>
            )
          })()}
        </VideoCountTooltip>
      </td>

      {/* Date + status badges + title clamp.
          selected-row-indicator: the right-edge purple bar that marks
          the selected row lives HERE rather than on the <tr> so it
          sits inside the date column (always visible) instead of at
          the row's actual right edge (covered by the sidebar overlay
          when one is open). Uses an `::after` pseudo-element instead
          of `border-r-2` because `border-collapse:collapse` straddles
          the cell boundary with the border — half on each side — so a
          2px border-r ends up 1px to the LEFT of the cell's right edge
          and 1px PAST it, misaligning with the sidebar's left edge.
          A pseudo-element pinned to `right:0` sits flush. Visibility
          is gated on `indicatorVisible` (lags `selected` on open,
          instant on close) so the bar lands once the sidebar settles
          rather than racing the slide. */}
      <td className={`p-1 align-middle min-w-[220px] ${indicatorVisible ? 'relative after:content-[""] after:absolute after:inset-y-0 after:right-0 after:w-0.5 after:bg-purple-600' : ''}`}>
        <div className="flex items-center justify-between gap-1.5 w-full">
          <div className="inline-flex gap-1 mt-0.5">
            <Tooltip content={friendlyDate(date)} side="top">
              <span className="font-mono text-sm text-gray-200">{date}</span>
            </Tooltip>
            {sameDayIndex && sameDayIndex > 1 && (
              <span className="font-mono text-sm text-purple-400/70 font-semibold">#{sameDayIndex}</span>
            )}
          </div>
          <div className="inline-flex gap-1">
            {meta?.archived && (
              <Tooltip content="Archived">
                <span className="inline-flex items-center p-0.5 rounded bg-green-900/30 text-green-400 border border-green-400/40 shrink-0">
                  <Archive size={12} />
                </span>
              </Tooltip>
            )}
            {/* Pending stream — either an upcoming livestream badge
                (linked) or the unlinked teal Radio. Live broadcasts go
                green; scheduled stay teal. */}
            {isPending && (
              meta?.ytVideoId ? (() => {
                const privacyLabel = privacyStatus === 'public' ? 'Public' : privacyStatus === 'unlisted' ? 'Unlisted' : privacyStatus === 'private' ? 'Private' : null
                const liveLabel = isLive ? 'Live now' : 'Open in YouTube Studio'
                const tooltipText = privacyLabel ? `${liveLabel} · ${privacyLabel}` : liveLabel
                const PrivacyIcon = privacyStatus === 'unlisted' ? EyeOff : privacyStatus === 'private' ? Lock : privacyStatus === 'public' ? Globe : null
                return (
                  <Tooltip content={tooltipText}>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); window.api.openUrl(`https://studio.youtube.com/video/${meta.ytVideoId}/livestreaming`) }}
                      className={`inline-flex items-center gap-0.5 p-0.5 rounded border transition-colors shrink-0 ${
                        isLive
                          ? 'bg-green-900/30 text-green-400 border-green-400/40 hover:bg-green-900/50 hover:text-green-300'
                          : 'bg-teal-900/30 text-teal-400 border-teal-400/40 hover:bg-teal-900/50 hover:text-teal-300'
                      }`}
                    >
                      <Radio size={12} />
                      {PrivacyIcon && <PrivacyIcon size={12} />}
                    </button>
                  </Tooltip>
                )
              })() : (
                <Tooltip content={isNextUpcoming ? "Upcoming — stream hasn't happened yet" : 'Scheduled upcoming stream'}>
                  <span className="inline-flex items-center p-0.5 rounded bg-teal-900/30 text-teal-400 border border-teal-400/40 shrink-0">
                    <Radio size={12} />
                  </span>
                </Tooltip>
              )
            )}
            {/* Past stream — Radio for livestream replays, Clapperboard
                for regular video uploads. Both go red. */}
            {!isPending && meta?.ytVideoId && (() => {
              const privacyLabel = privacyStatus === 'public' ? 'Public' : privacyStatus === 'unlisted' ? 'Unlisted' : privacyStatus === 'private' ? 'Private' : null
              const PrivacyIcon = privacyStatus === 'unlisted' ? EyeOff : privacyStatus === 'private' ? Lock : privacyStatus === 'public' ? Globe : null
              const KindIcon = isLivestream ? Radio : Clapperboard
              const kindLabel = isLivestream ? 'Livestream' : 'Video'
              const tooltipText = privacyLabel ? `Edit on YouTube · ${kindLabel} · ${privacyLabel}` : `Edit on YouTube · ${kindLabel}`
              return (
                <Tooltip content={tooltipText}>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); window.api.openUrl(`https://studio.youtube.com/video/${meta.ytVideoId}`) }}
                    className="inline-flex items-center gap-0.5 p-0.5 rounded bg-red-900/30 text-red-400 border border-red-400/40 hover:bg-red-900/50 hover:text-red-300 transition-colors shrink-0"
                  >
                    <KindIcon size={12} />
                    {PrivacyIcon && <PrivacyIcon size={12} />}
                  </button>
                </Tooltip>
              )
            })()}
            {!meta?.ytVideoId && (
              <Tooltip content={isPending ? 'Not linked to a YouTube broadcast' : 'Not linked to a YouTube video'}>
                <span className="inline-flex items-center p-0.5 rounded bg-gray-700/30 text-gray-400 border border-gray-400/30 shrink-0">
                  <Unlink2 size={12} />
                </span>
              </Tooltip>
            )}
          </div>
        </div>
        {title && (
          <Tooltip content={title} side="bottom" triggerClassName="block">
            <div
              className="text-[10px] leading-normal text-gray-400 max-w-[204px] overflow-hidden"
              style={{ display: '-webkit-box', WebkitLineClamp: titleLines, WebkitBoxOrient: 'vertical' }}
            >
              {title}
            </div>
          </Tooltip>
        )}
      </td>

      {/* Columns hidden when sidebar is showing a selected stream (compact). */}
      {!compact && (
        <>
          <td className="px-2 py-2 align-middle hidden @xl:table-cell">
            {meta ? (
              <div className="flex flex-wrap gap-1">
                {normalizeStreamTypes(meta.streamType).map(t => {
                  const color = getTagColor(tagColors[t])
                  return (
                    <span key={t} className={`inline-block text-xs leading-tight px-2 py-0.5 rounded-full border ${color.chip}`} style={getTagTextureStyle(tagTextures[t])}>
                      {t}
                    </span>
                  )
                })}
              </div>
            ) : (
              <span className="text-xs text-gray-400">—</span>
            )}
          </td>

          <td className="px-2 py-2 align-middle max-w-[240px] hidden @3xl:table-cell">
            {displayGames.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {displayGames.map(g =>
                  meta?.games?.includes(g) ? (
                    <span key={g} className="text-[10px] leading-tight px-1.5 py-0.5 rounded-full bg-purple-900/20 text-purple-300 border border-purple-300/30">{g}</span>
                  ) : (
                    <Tooltip key={g} content="Detected from filename">
                      <span className="text-[10px] leading-tight px-1.5 py-0.5 rounded-full bg-white/5 text-gray-400 border border-gray-500/30 italic">{g}</span>
                    </Tooltip>
                  )
                )}
              </div>
            ) : (
              <span className="text-xs text-gray-400">—</span>
            )}
          </td>

          <td className="px-2 py-2 align-middle hidden @5xl:table-cell">
            {meta?.comments ? (
              <div
                className="text-[10px] leading-tight text-gray-400 overflow-hidden whitespace-pre-line"
                style={{ display: '-webkit-box', WebkitLineClamp: Math.max(2, Math.floor((thumbWidth * 9 / 16) / 12.5)), WebkitBoxOrient: 'vertical' }}
                title={meta.comments}
              >
                {meta.comments}
              </div>
            ) : (
              <span className="text-xs text-gray-400">—</span>
            )}
          </td>

          <td className="px-2 py-2 align-middle">
            <div className={`flex items-center justify-end transition-opacity ${selectMode ? 'opacity-0 pointer-events-none' : 'opacity-0 group-hover:opacity-100'}`}>
              {!hasMeta && (
                <span className="flex items-center gap-1 text-xs text-yellow-600 mr-1 shrink-0">
                  <AlertTriangle size={11} />
                  No meta
                </span>
              )}
              {videoCount > 0 && (
                <Tooltip content="Send to Player">
                  <Button variant="ghost" size="icon-sm" icon={<Film size={12} />} onClick={onSendToPlayer} />
                </Tooltip>
              )}
              {videoCount > 0 && (
                <Tooltip content="Send to Converter">
                  <Button variant="ghost" size="icon-sm" icon={<Zap size={12} />} onClick={onSendToConverter} />
                </Tooltip>
              )}
              <Tooltip content={hasSMThumbnail ? 'Edit Stream Manager Thumbnail' : 'Create Stream Manager Thumbnail'}>
                <Button variant="ghost" size="icon-sm" icon={<ImageIcon size={12} />} onClick={onOpenThumbnails} />
              </Tooltip>
            </div>
          </td>
        </>
      )}
    </tr>
  )
}

// ── Sidebar detail ──────────────────────────────────────────────────────────

/** All sidebar content when an item is selected. Extracted so the empty
 *  state stays cleanly separated and the metadata + action layout can
 *  evolve independently. */
function SidebarDetail({
  folder, folders, prevEpisode, nextEpisode, onPickEpisode, onClose, onUpdateMeta, cloudSyncActive,
  allGames, allStreamTypes, tagColors, tagTextures, onReschedule, onNewEpisode, onOffload, onPinLocal, onArchive, isArchiving,
  thumbsKey, onDeleteThumbnail,
  ytBroadcasts, ytVods, setYtVods, setYtBroadcasts, broadcastLinks, ytBroadcastsLoading, onLoadAllVods, defaultBroadcastTime, claudeEnabled,
  onSendToPlayer, onSendToConverter, onSendToCombine, onOpenFolder, onOpenThumbnails, onDelete,
  onPushToYoutube, onPushToTwitch, ytConnected, twConnected, banner, onDismissBanner,
  ytTitleTemplates, ytDescTemplates, ytTagTemplates, twitchTagTemplates,
  onSaveYtTitleTemplate, onSaveYtDescTemplate, onSaveYtTagsTemplate, onSaveTwitchTagsTemplate,
}: {
  folder: StreamFolder
  folders: StreamFolder[]
  prevEpisode: StreamFolder | null
  nextEpisode: StreamFolder | null
  onPickEpisode: (f: StreamFolder) => void
  onClose: () => void
  onUpdateMeta: (partial: Partial<StreamMeta>) => Promise<void> | void
  cloudSyncActive: boolean
  allGames: string[]
  allStreamTypes: string[]
  tagColors: Record<string, string>
  tagTextures: Record<string, string>
  onReschedule: () => void
  onNewEpisode: () => void
  onOffload: () => void
  onPinLocal: () => void
  onArchive: () => void
  isArchiving: boolean
  /** Cache-busting key for ThumbImage so renamed/swapped thumbnail
   *  files re-fetch instead of serving the cached image. */
  thumbsKey: number
  /** Trash a single thumbnail file. Clears the preferred-thumbnail
   *  meta key if this was the preferred one, then reloads. */
  onDeleteThumbnail: (filePath: string) => Promise<void> | void
  // ── Broadcast picker plumbing ──
  ytBroadcasts: LiveBroadcast[]
  ytVods: LiveBroadcast[]
  /** Lets the picker section seed an unknown linked-VOD into the page-
   *  level VODs list once we fetch it for display, OR a freshly-pasted
   *  YouTube URL's resolved video. */
  setYtVods: React.Dispatch<React.SetStateAction<LiveBroadcast[]>>
  /** Lets the create-broadcast flow prepend a newly-scheduled broadcast
   *  to the upcoming list so the picker dropdown shows it immediately. */
  setYtBroadcasts: React.Dispatch<React.SetStateAction<LiveBroadcast[]>>
  broadcastLinks: BroadcastLinkRef[]
  ytBroadcastsLoading: boolean
  onLoadAllVods: () => void
  /** Default time-of-day (24h "HH:MM") pre-filled in the create-broadcast
   *  form. From config.defaultBroadcastTime. */
  defaultBroadcastTime: string
  /** True when a Claude API key is configured. Drives whether the
   *  title/description fields wire up Ctrl+Space AI suggestions. */
  claudeEnabled: boolean
  onSendToPlayer: () => void
  onSendToConverter: () => void
  onSendToCombine: () => void
  onOpenFolder: () => void
  onOpenThumbnails: () => void
  onDelete: () => void
  onPushToYoutube: (customThumbPath: string | null) => void
  onPushToTwitch: () => void
  ytConnected: boolean
  twConnected: boolean
  banner: { type: 'success' | 'error'; message: string } | null
  onDismissBanner: () => void
  ytTitleTemplates: Array<{ id: string; name: string; template: string }>
  ytDescTemplates: Array<{ id: string; name: string; description: string }>
  ytTagTemplates: Array<{ id: string; name: string; tags: string[] }>
  twitchTagTemplates: Array<{ id: string; name: string; tags: string[] }>
  /** Page-level save-as-template handlers. Each persists the new
   *  template and returns its id; the sidebar then marks that id as
   *  active so the user's brand-new template is immediately bound. */
  onSaveYtTitleTemplate: (name: string, value: string) => Promise<string>
  onSaveYtDescTemplate: (name: string, value: string) => Promise<string>
  onSaveYtTagsTemplate: (name: string, tags: string[]) => Promise<string>
  onSaveTwitchTagsTemplate: (name: string, tags: string[]) => Promise<string>
}) {
  const meta = folder.meta
  const title = meta?.ytTitle?.trim() || meta?.games?.join(', ') || folder.folderName
  const hasSMThumbnail = folder.thumbnails.some(t => /[_-]sm-thumbnail\./i.test(t))
  const videoCount = folder.videoCount

  // Title's template binding lives in meta (`ytTitleTemplateId`) so it
  // survives stream switches and app restarts. Description / tag template
  // selections stay ephemeral for now (the user only asked for title to
  // persist; can lift those later if it turns out to be useful).
  const titleTplId = meta?.ytTitleTemplateId ?? ''
  const [descTplId, setDescTplId] = useState('')
  const [tagsTplId, setTagsTplId] = useState('')
  const [twitchTagsTplId, setTwitchTagsTplId] = useState('')

  // Merge-field substitution values, derived from the current folder's
  // meta. Matches the StreamsPage names exactly so existing user templates
  // ({game}, {season}, {episode}, etc.) keep working as the page switches.
  // `{season_links}` is NOT in this map — it's resolved separately inside
  // applyDescTemplate at template-pick time since it's async (walks all
  // folders and can hit the YouTube API for missing titles).
  const mergeFields = useMemo<Record<string, string>>(() => {
    const primaryGame = meta?.ytGameTitle?.trim() || meta?.games?.[0] || folder.detectedGames?.[0] || ''
    return {
      game: meta?.ytGameTitle ?? meta?.games?.[0] ?? '',
      season: meta?.ytSeason ?? '1',
      episode: meta?.ytEpisode ?? '',
      tagline: meta?.ytCatchyTitle ?? '',
      title: meta?.ytCatchyTitle ?? '',
      total_episodes: String(detectTotalEpisodes(folders, primaryGame, meta?.ytSeason || '1')),
    }
  }, [folder.detectedGames, meta?.ytGameTitle, meta?.games, meta?.ytSeason, meta?.ytEpisode, meta?.ytCatchyTitle, folders])

  // Tracks the title string we most recently produced from a template. When
  // the user blurs the title field with a value that DOESN'T match this, we
  // know they hand-edited it and clear the template so further merge-field
  // edits don't clobber their custom title.
  //
  // A ref (not state) because reading it inside the title's onSave handler
  // should reflect the latest write — not whatever was captured when the
  // EditableTextField rendered.
  const lastAppliedTitleRef = useRef<string | null>(null)

  // Hoist onUpdateMeta into a ref so the re-apply effect below can call it
  // without re-running every time the parent re-renders (the parent passes
  // an inline arrow each time, so it isn't reference-stable).
  const onUpdateMetaRef = useRef(onUpdateMeta)
  useEffect(() => { onUpdateMetaRef.current = onUpdateMeta })

  // When a title template is selected and the merge-field inputs change,
  // re-render the template with the new values and push the result into the
  // title field. The check `next === current` is the loop-breaker — once
  // we've written the new title, mergeFields stays the same (no further
  // merge field edits), and meta.ytTitle now matches `next`, so the effect
  // is a no-op on the follow-up render.
  useEffect(() => {
    if (!titleTplId) { lastAppliedTitleRef.current = null; return }
    const tpl = ytTitleTemplates.find(t => t.id === titleTplId)
    if (!tpl) return
    const next = applyMergeFields(tpl.template, mergeFields)
    lastAppliedTitleRef.current = next
    if (next !== meta?.ytTitle) onUpdateMetaRef.current({ ytTitle: next })
  }, [titleTplId, mergeFields, ytTitleTemplates, meta?.ytTitle])

  // Reset the ephemeral (non-persisted) template selections when the
  // user switches streams. Title's selection isn't reset here — it lives
  // in meta and naturally tracks the new folder via the meta?.ytTitleTemplateId
  // read above. lastAppliedTitleRef is still cleared because it caches
  // the previous folder's templated output, which is meaningless for the
  // new one (the re-apply effect repopulates it on the next render).
  useEffect(() => {
    setDescTplId('')
    setTagsTplId('')
    setTwitchTagsTplId('')
    lastAppliedTitleRef.current = null
  }, [folder.folderPath])

  // Keys ({game}, {season}, …) the currently-selected title template
  // consumes. The merge-field rows (Game Title / Tagline / Season /
  // Episode) check this set to subtly highlight when they affect the
  // title output.
  const activeTitleMergeKeys = useMemo<Set<string>>(() => {
    if (!titleTplId) return new Set()
    const tpl = ytTitleTemplates.find(t => t.id === titleTplId)
    if (!tpl) return new Set()
    const keys = new Set<string>()
    for (const m of tpl.template.matchAll(/\{(\w+)\}/g)) keys.add(m[1])
    return keys
  }, [titleTplId, ytTitleTemplates])
  // 'tagline' and 'title' both alias to ytCatchyTitle, so either token in
  // the template should highlight the Tagline row.
  const taglineActive = activeTitleMergeKeys.has('tagline') || activeTitleMergeKeys.has('title')

  // ── Save-as-template — per-field "can save" + onSave wrappers ────────
  // Each field exposes the SaveAsTemplateButton when the current value
  // is non-empty AND doesn't match an existing template (exact compare
  // for text, case-folded sorted-set compare for tags). On save, the
  // page-level handler persists and returns the new id; we then mark
  // it as the active selection so the user's just-created template is
  // immediately bound to the field.
  const canSaveTitleTemplate = useMemo(() => {
    const v = (meta?.ytTitle ?? '').trim()
    return v.length > 0 && !ytTitleTemplates.some(t => t.template === meta?.ytTitle)
  }, [meta?.ytTitle, ytTitleTemplates])
  const canSaveDescTemplate = useMemo(() => {
    const v = (meta?.ytDescription ?? '').trim()
    return v.length > 0 && !ytDescTemplates.some(t => t.description === meta?.ytDescription)
  }, [meta?.ytDescription, ytDescTemplates])
  const canSaveTagsTemplate = useMemo(() => {
    const tags = meta?.ytTags ?? []
    if (tags.length === 0) return false
    const currentKey = [...tags].sort().join('|').toLowerCase()
    return !ytTagTemplates.some(t => [...t.tags].sort().join('|').toLowerCase() === currentKey)
  }, [meta?.ytTags, ytTagTemplates])
  const canSaveTwitchTagsTemplate = useMemo(() => {
    const { compat } = toTwitchCompatibleTags(meta?.twitchTags ?? [])
    if (compat.length === 0) return false
    const currentKey = [...compat].sort().join('|').toLowerCase()
    return !twitchTagTemplates.some(t => [...t.tags].sort().join('|').toLowerCase() === currentKey)
  }, [meta?.twitchTags, twitchTagTemplates])
  // Suggested template name for tag editors — defaults to the first
  // game so "Hollow Knight" with `[tag1, tag2]` defaults to a template
  // named "Hollow Knight". Only suggests when that name isn't already
  // taken (otherwise users would type over it anyway).
  const suggestedTagTemplateName = useMemo(() => {
    const game = (meta?.games ?? folder.detectedGames)[0]?.trim()
    if (!game) return undefined
    const exists = ytTagTemplates.some(t => t.name.toLowerCase() === game.toLowerCase())
    return exists ? undefined : game
  }, [meta?.games, folder.detectedGames, ytTagTemplates])
  const suggestedTwitchTagTemplateName = useMemo(() => {
    const game = (meta?.games ?? folder.detectedGames)[0]?.trim()
    if (!game) return undefined
    const exists = twitchTagTemplates.some(t => t.name.toLowerCase() === game.toLowerCase())
    return exists ? undefined : game
  }, [meta?.games, folder.detectedGames, twitchTagTemplates])
  // Wrappers that capture the current field value, persist, and select
  // the newly-saved template. For title, "select" means writing
  // ytTitleTemplateId to meta (persists across sessions). For the
  // others, the ephemeral selectedId in local state is updated.
  const handleSaveTitleTemplate = useCallback(async (name: string) => {
    const id = await onSaveYtTitleTemplate(name, meta?.ytTitle ?? '')
    onUpdateMeta({ ytTitleTemplateId: id })
  }, [onSaveYtTitleTemplate, meta?.ytTitle, onUpdateMeta])
  const handleSaveDescTemplate = useCallback(async (name: string) => {
    const id = await onSaveYtDescTemplate(name, meta?.ytDescription ?? '')
    setDescTplId(id)
  }, [onSaveYtDescTemplate, meta?.ytDescription])
  const handleSaveTagsTemplate = useCallback(async (name: string) => {
    const id = await onSaveYtTagsTemplate(name, meta?.ytTags ?? [])
    setTagsTplId(id)
  }, [onSaveYtTagsTemplate, meta?.ytTags])
  const handleSaveTwitchTagsTemplate = useCallback(async (name: string) => {
    const id = await onSaveTwitchTagsTemplate(name, meta?.twitchTags ?? [])
    setTwitchTagsTplId(id)
  }, [onSaveTwitchTagsTemplate, meta?.twitchTags])

  // Pick → write to meta. The re-apply effect (which depends on
  // meta.ytTitleTemplateId via the `titleTplId` derivation) then renders
  // the template against the live merge fields on the next pass.
  const applyTitleTemplate = (id: string) => { onUpdateMeta({ ytTitleTemplateId: id }) }
  const applyDescTemplate = async (id: string) => {
    setDescTplId(id)
    if (!id) return
    const tpl = ytDescTemplates.find(t => t.id === id)
    if (!tpl) return
    // {season_links} is resolved here (not in mergeFields) because it's
    // async — walks all folders for matching prior episodes and may need
    // a YT API call to backfill missing titles. Substituted into the
    // template body BEFORE applyMergeFields runs so the rest of the
    // tokens ({game}, {season}, etc.) layer in normally afterward.
    let body = tpl.description
    if (body.includes('{season_links}')) {
      const primaryGame = meta?.ytGameTitle?.trim() || meta?.games?.[0] || folder.detectedGames?.[0] || ''
      const links = await computeSeasonLinks(folders, primaryGame, meta?.ytSeason || '1', folder.date)
      body = body.replace(/\{season_links\}/g, links)
    }
    onUpdateMeta({ ytDescription: applyMergeFields(body, mergeFields) })
  }
  const applyTagsTemplate = (id: string) => {
    setTagsTplId(id)
    if (!id) return
    const tpl = ytTagTemplates.find(t => t.id === id)
    if (tpl) onUpdateMeta({ ytTags: tpl.tags })
  }
  const applyTwitchTagsTemplate = (id: string) => {
    setTwitchTagsTplId(id)
    if (!id) return
    const tpl = twitchTagTemplates.find(t => t.id === id)
    if (tpl) onUpdateMeta({ twitchTags: tpl.tags })
  }
  const handleTitleSave = (v: string) => {
    // Diverging from the last-templated value means the user hand-edited
    // the title; drop the template binding too so future merge-field
    // edits don't overwrite their custom string. Both writes go through
    // the same updateMeta partial so the disk write is atomic.
    const partial: Partial<StreamMeta> = { ytTitle: v }
    if (titleTplId && v !== lastAppliedTitleRef.current) partial.ytTitleTemplateId = ''
    onUpdateMeta(partial)
  }

  // Season change → normalize empty/<1 to '1' (so series association
  // doesn't break against folders whose ytSeason is undefined) AND
  // auto-recount the episode for the new season. Mirrors the old
  // metamodal behaviour where editing the season resets the episode
  // counter so the user doesn't end up with E5 of S2 when S2 is empty.
  const handleSeasonSave = (v: string) => {
    const parsed = parseInt(v, 10)
    const normalized = Number.isFinite(parsed) && parsed >= 1 ? String(parsed) : '1'
    const primaryGame = meta?.ytGameTitle?.trim() || meta?.games?.[0] || folder.detectedGames?.[0] || ''
    if (!primaryGame) {
      onUpdateMeta({ ytSeason: normalized })
      return
    }
    const otherFolders = folders.filter(f => f.folderPath !== folder.folderPath)
    const newEpisode = String(detectEpisodeNumber(otherFolders, primaryGame, normalized, folder.date))
    onUpdateMeta({ ytSeason: normalized, ytEpisode: newEpisode })
  }

  // ── AI suggestion fetchers ────────────────────────────────────────────
  // Each fetcher captures the current folder's meta as context so the
  // suggestion call gets stream type / games / current title etc. to
  // ground the prompt. Recomputed when meta changes so subsequent
  // Ctrl+Space requests use up-to-date context. Returns `undefined` (not
  // a noop) when Claude is disabled so EditableTextField knows to skip
  // the whole AI plumbing rather than wire a never-firing fetcher.
  const buildAiContext = useCallback(() => ({
    date: folder.date,
    streamTypes: normalizeStreamTypes(meta?.streamType),
    games: meta?.games?.length ? meta.games : folder.detectedGames,
    currentTitle: meta?.ytTitle || undefined,
    currentDescription: meta?.ytDescription || undefined,
  }), [folder.date, folder.detectedGames, meta?.streamType, meta?.games, meta?.ytTitle, meta?.ytDescription])
  const aiFetchTitle = useMemo(() => claudeEnabled
    ? (prefix: string, suffix: string) => window.api.claudeGenerate('title', { ...buildAiContext(), prefix, suffix })
    : undefined, [claudeEnabled, buildAiContext])
  const aiFetchDescription = useMemo(() => claudeEnabled
    ? (prefix: string, suffix: string) => window.api.claudeGenerate('description', { ...buildAiContext(), prefix, suffix })
    : undefined, [claudeEnabled, buildAiContext])
  // Tag fetchers — `prefix`/`suffix` here come from the chip editor's
  // add-tag input, not the chip list. Claude returns either a single tag
  // or a comma-separated batch; the editor's commit logic already splits
  // on commas so a single Tab + Enter accept can produce multiple chips.
  const aiFetchTags = useMemo(() => claudeEnabled
    ? (prefix: string, suffix: string) => window.api.claudeGenerate('tags', { ...buildAiContext(), prefix, suffix })
    : undefined, [claudeEnabled, buildAiContext])
  const aiFetchTwitchTags = useMemo(() => claudeEnabled
    ? (prefix: string, suffix: string) => window.api.claudeGenerate('twitch-tags', { ...buildAiContext(), prefix, suffix })
    : undefined, [claudeEnabled, buildAiContext])

  // ── Broadcast picker per-folder logic ─────────────────────────────────
  // Past streams use the VOD pool (lazy-loaded on dropdown open); upcoming
  // streams use the eager-loaded scheduled list. The split mirrors the
  // old metamodal: future-date folders are picking from broadcasts the
  // user is going to stream, past-date folders are picking from VODs the
  // user has already streamed.
  const isPastStream = folder.date < todayStr()
  const linkedId = meta?.ytVideoId ?? ''
  const broadcastPool = isPastStream ? ytVods : ytBroadcasts

  // If a stream is linked to a VOD we haven't loaded into ytVods yet
  // (common path: past stream, ytVods is empty until the user opens the
  // dropdown), fetch the single video so the picker can show its name
  // instead of just the bare id.
  useEffect(() => {
    if (!linkedId) return
    if (broadcastPool.some(b => b.id === linkedId)) return
    // Only fetch from the VODs pool — upcoming broadcasts have already
    // been bulk-loaded on page mount, so a miss there means the broadcast
    // doesn't exist anymore (deleted on YT), not that we need to fetch.
    if (!isPastStream) return
    let cancelled = false
    window.api.youtubeGetVideoById(linkedId).then(video => {
      if (cancelled || !video) return
      setYtVods(prev => prev.some(v => v.id === video.id) ? prev : [video, ...prev])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [linkedId, broadcastPool, isPastStream, setYtVods])

  const selectedBroadcast = useMemo(
    () => broadcastPool.find(b => b.id === linkedId) ?? null,
    [broadcastPool, linkedId],
  )

  // Other folders linked to the SAME broadcast — surfaces "shared link"
  // warnings in both the dropdown options AND a banner under the picker
  // when the linked broadcast also belongs to another stream item.
  const otherFolderLinks = useMemo<BroadcastLinkRef[]>(
    () => broadcastLinks.filter(l => l.folderDate !== folder.date),
    [broadcastLinks, folder.date],
  )
  const sharedLinks = useMemo<BroadcastLinkRef[]>(
    () => linkedId ? otherFolderLinks.filter(l => l.broadcastId === linkedId) : [],
    [otherFolderLinks, linkedId],
  )

  // Privacy state — optimistic; reverts on failure. The override lets us
  // show the user's just-clicked value immediately even before the API
  // round-trips. Reset whenever a different broadcast is selected.
  const [privacyOverride, setPrivacyOverride] = useState<'public' | 'unlisted' | 'private' | null>(null)
  const [savingPrivacy, setSavingPrivacy] = useState(false)
  const [privacyError, setPrivacyError] = useState<string | null>(null)
  useEffect(() => {
    setPrivacyOverride(null)
    setPrivacyError(null)
  }, [selectedBroadcast?.id])
  const currentPrivacy = (privacyOverride ?? selectedBroadcast?.status.privacyStatus) as
    | 'public' | 'unlisted' | 'private' | undefined
  const changePrivacy = useCallback(async (next: 'public' | 'unlisted' | 'private') => {
    if (!selectedBroadcast || currentPrivacy === next || savingPrivacy) return
    const prev = currentPrivacy
    setPrivacyOverride(next)
    setSavingPrivacy(true)
    setPrivacyError(null)
    try {
      await window.api.youtubeUpdateBroadcastStatus(selectedBroadcast.id, next)
    } catch (err: any) {
      setPrivacyOverride(prev ?? null)
      setPrivacyError(err?.message ?? String(err))
    } finally {
      setSavingPrivacy(false)
    }
  }, [selectedBroadcast, currentPrivacy, savingPrivacy])

  // ── Paste-URL fallback ──────────────────────────────────────────────
  // For VODs that don't appear in the picker (unlisted, from a sub-channel,
  // etc.) the user can paste any YouTube URL or bare 11-char ID and the
  // matching video is fetched + seeded into ytVods + selected. Same
  // parser as the old metamodal so every legal URL shape just works.
  // Full-screen image viewer. null = closed; number = index into
  // folder.thumbnails of the open image. Driven by clicking the active
  // image in the ThumbnailCarousel.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  // ── YouTube thumbnail picker ─────────────────────────────────────────
  // Mirrors the legacy MetaModal's picker: the YT push uploads whatever
  // is set as the stream item's preferred thumbnail by default; toggling
  // off the "use the stream item thumbnail" checkbox reveals a picker
  // grid of qualifying images (16:9 / 1:1 / 9:16, ≥720px, ≤2MB). Picker
  // state is intentionally LOCAL (not persisted to meta) — matching the
  // legacy modal, the choice is treated as "what to push right now",
  // not a stream-level setting.
  const [ytQualifyingThumbnails, setYtQualifyingThumbnails] = useState<{ bestFit: string[]; rest: string[] }>({ bestFit: [], rest: [] })
  const [ytShowAllThumbs, setYtShowAllThumbs] = useState(false)
  const [ytSelectedThumbnail, setYtSelectedThumbnail] = useState<string | null>(null)
  const [useStreamItemThumb, setUseStreamItemThumb] = useState(true)
  // Resolve the stream item's "main" thumbnail the same way the row
  // does: preferredThumbnail basename → matching path → first thumbnail.
  // What gets uploaded when the checkbox is on.
  const resolvedStreamItemThumb = useMemo<string | null>(() => {
    if (folder.thumbnails.length === 0) return null
    const preferredName = meta?.preferredThumbnail
    if (preferredName) {
      const match = folder.thumbnails.find(p => (p.split(/[\\/]/).pop() ?? '') === preferredName)
      if (match) return match
    }
    return folder.thumbnails[0]
  }, [folder.thumbnails, meta?.preferredThumbnail])
  const effectiveYtThumb = useStreamItemThumb ? resolvedStreamItemThumb : ytSelectedThumbnail
  // Fetch qualifying thumbnails when the folder's thumbnail list
  // changes (stream switch, delete, new image added). Reset all picker
  // state so the new folder starts fresh.
  useEffect(() => {
    setYtQualifyingThumbnails({ bestFit: [], rest: [] })
    setYtShowAllThumbs(false)
    setYtSelectedThumbnail(null)
    setUseStreamItemThumb(true)
    if (folder.thumbnails.length === 0) return
    let cancelled = false
    window.api.youtubeGetQualifyingThumbnails(folder.thumbnails).then(qualified => {
      if (cancelled) return
      setYtQualifyingThumbnails(qualified)
      setYtSelectedThumbnail(qualified.bestFit[0] ?? qualified.rest[0] ?? null)
      // If nothing fits the recommended aspect ratios, default to
      // showing the full list so the picker isn't suddenly empty.
      if (qualified.bestFit.length === 0) setYtShowAllThumbs(true)
    })
    return () => { cancelled = true }
  }, [folder.thumbnails])

  const [manualUrl, setManualUrl] = useState('')
  const [manualUrlLoading, setManualUrlLoading] = useState(false)
  const [manualUrlError, setManualUrlError] = useState('')
  const parseYouTubeVideoId = (input: string): string | null => {
    const s = input.trim()
    const watchMatch = s.match(/[?&]v=([a-zA-Z0-9_-]{11})/)
    if (watchMatch) return watchMatch[1]
    const studioMatch = s.match(/studio\.youtube\.com\/video\/([a-zA-Z0-9_-]{11})/)
    if (studioMatch) return studioMatch[1]
    const pathMatch = s.match(/(?:youtu\.be|youtube\.com\/(?:live|shorts))\/([a-zA-Z0-9_-]{11})/)
    if (pathMatch) return pathMatch[1]
    if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s
    return null
  }
  const handleManualUrlChange = async (value: string) => {
    setManualUrl(value)
    setManualUrlError('')
    if (!value.trim()) return
    const videoId = parseYouTubeVideoId(value)
    if (!videoId) { setManualUrlError('Could not find a video ID in that URL.'); return }
    setManualUrlLoading(true)
    try {
      const video = await window.api.youtubeGetVideoById(videoId)
      if (!video) { setManualUrlError('Video not found or not accessible.'); return }
      setYtVods(prev => prev.some(v => v.id === video.id) ? prev : [video, ...prev])
      onUpdateMeta({ ytVideoId: video.id })
      setManualUrl('')
    } catch (err: any) {
      setManualUrlError(err?.message ?? 'Failed to fetch video info.')
    } finally {
      setManualUrlLoading(false)
    }
  }

  // ── Create new broadcast inline ─────────────────────────────────────
  // For future-dated streams that aren't linked yet, schedules a brand-
  // new YouTube broadcast at the stream's date + chosen time. Defaults
  // to 7pm-or-whatever-config-says; clamps to now+5min if the user picks
  // an earlier time on a same-day stream (YouTube rejects past times).
  const [newBroadcastTime, setNewBroadcastTime] = useState(defaultBroadcastTime || '19:00')
  const [newBroadcastPrivacy, setNewBroadcastPrivacy] = useState<'public' | 'unlisted' | 'private'>('public')
  const [creatingBroadcast, setCreatingBroadcast] = useState(false)
  const [createError, setCreateError] = useState('')
  const streamDateInFuture = !isPastStream && (() => {
    const [y, m, d] = folder.date.split('-').map(n => parseInt(n, 10))
    if (!y || !m || !d) return false
    const eod = new Date(y, m - 1, d, 23, 59, 59, 999)
    return eod.getTime() > Date.now()
  })()
  const handleCreateBroadcast = async () => {
    setCreatingBroadcast(true)
    setCreateError('')
    try {
      const [hh, mm] = newBroadcastTime.split(':').map(n => parseInt(n, 10))
      const [y, mo, d] = folder.date.split('-').map(n => parseInt(n, 10))
      const target = new Date(y, mo - 1, d, hh, mm, 0, 0).getTime()
      const future = Date.now() + 5 * 60 * 1000
      const scheduledStartTime = new Date(Math.max(target, future)).toISOString()
      const created = await window.api.youtubeCreateBroadcast({
        title: meta?.ytTitle || 'Untitled stream',
        description: meta?.ytDescription || '',
        scheduledStartTime,
        privacyStatus: newBroadcastPrivacy,
      })
      setYtBroadcasts(prev => [created, ...prev])
      onUpdateMeta({ ytVideoId: created.id })
    } catch (err: any) {
      setCreateError(err?.message ?? 'Failed to create broadcast')
    } finally {
      setCreatingBroadcast(false)
    }
  }

  // ── Broadcast push-mismatch detection ───────────────────────────────
  // True when local meta differs from what's on the linked broadcast
  // (title / description / game / tags). Drives the Push to YouTube
  // button — disabled when there's nothing to push so the user can tell
  // at a glance whether YT is in sync with the sidebar. Trimming +
  // normalizing line endings + folding tags to a sorted lowercase set
  // matches the old metamodal's mismatch logic exactly, so a no-op edit
  // doesn't falsely flag as pending.
  const broadcastMismatch = useMemo(() => {
    if (!selectedBroadcast) return false
    const localTitle = (meta?.ytTitle ?? '').trim()
    if ((selectedBroadcast.snippet.title ?? '').trim() !== localTitle) return true
    const normDesc = (s: string | undefined) => (s ?? '').replace(/\r\n/g, '\n').trim()
    if (normDesc(selectedBroadcast.snippet.description) !== normDesc(meta?.ytDescription)) return true
    if (selectedBroadcast.snippet.gameTitle && selectedBroadcast.snippet.gameTitle !== (meta?.ytGameTitle ?? '')) return true
    const normTagSet = (tags: string[] | undefined) =>
      [...(tags ?? [])].map(t => t.trim().toLowerCase()).filter(Boolean).sort().join('|')
    const localTagSet = normTagSet(meta?.ytTags)
    const remoteTagSet = normTagSet(selectedBroadcast.snippet.tags)
    // Only flag tag mismatch when the remote actually has tags (some
    // broadcasts come back with tags=undefined even though we set them
    // — they hydrate from a separate videos.list call that may not have
    // run yet) OR the local list has tags the remote doesn't.
    if (remoteTagSet && remoteTagSet !== localTagSet) return true
    if (!remoteTagSet && localTagSet) return true
    return false
  }, [selectedBroadcast, meta?.ytTitle, meta?.ytDescription, meta?.ytGameTitle, meta?.ytTags])

  return (
    <div className="@container flex flex-col h-full overflow-hidden">
      {/* Header — top row: date (left) · episode nav (center) · close X
          (right). Bottom row: full title. The series label "S1 · E3" is
          surfaced as a metadata row below rather than here, since it's
          part of the metadata content and the header is for identity +
          navigation chrome. */}
      <div className="ps-4 pe-2 pt-3 pb-4 border-b border-white/5 shrink-0 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Tooltip content="Reschedule stream" side="bottom">
            <button
              type="button"
              onClick={onReschedule}
              className="text-xs text-gray-400 font-mono tabular-nums hover:text-purple-300 hover:bg-white/5 rounded px-1.5 py-0.5 -ml-1.5 transition-colors flex items-center gap-1"
            >
              <span>{folder.date}</span>
              <PencilLine size={9} className="opacity-50" />
            </button>
          </Tooltip>
          {(prevEpisode || nextEpisode) && (
            <div className="flex items-center gap-0.5">
              <Tooltip content={prevEpisode ? `Previous episode (E${prevEpisode.meta?.ytEpisode || '?'})` : 'No previous episode'} side="bottom">
                <button
                  type="button"
                  onClick={() => prevEpisode && onPickEpisode(prevEpisode)}
                  disabled={!prevEpisode}
                  className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-gray-400"
                >
                  <ChevronsDown size={13} />
                </button>
              </Tooltip>
              <Tooltip content={nextEpisode ? `Next episode (E${nextEpisode.meta?.ytEpisode || '?'})` : 'No next episode'} side="bottom">
                <button
                  type="button"
                  onClick={() => nextEpisode && onPickEpisode(nextEpisode)}
                  disabled={!nextEpisode}
                  className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-gray-400"
                >
                  <ChevronsUp size={13} />
                </button>
              </Tooltip>
            </div>
          )}
          <Tooltip content="Close" side="bottom" triggerClassName="ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </Tooltip>
        </div>
        <div className="text-base font-semibold text-gray-100 break-words leading-snug" title={title}>
          {title}
        </div>
      </div>

      {/* Scrollable metadata section. Phase 3a converts the three plain-
          text fields (YouTube title, description, notes) to editable
          inputs with autosave-on-blur. Other fields stay read-only-when-
          present for now; phases 3b/3c add tags, season/episode, twitch,
          and select-style fields (games, stream type). */}
      {/* pr-2 + scrollbar-gutter:stable inset the scrollbar away from the
          window's right edge so the window-resize cursor doesn't win over
          clicks meant for the scrollbar thumb (same fix as the streams
          list's outer wrapper on the old page). */}
      {/* Chromium quirk: padding-bottom on a flex+overflow scroll
          container is clipped from the scrollable area, so `pb-*` on
          this outer wrapper or the inner content div is invisible at
          the end of scroll. The breathing room above the footer is
          enforced via `pb-8` on the Notes section itself (last child).
          Top padding still works fine on the inner content div.

          The inner div is where the section grouping lives:
          gap-8 separates the five top-level sections (Thumbnails,
          Tags, YouTube, Twitch, Notes); each section uses gap-3
          internally so rows within a section keep their original
          breathing room. No labels per the user's preference — the
          extra vertical space alone signals the boundary. */}
      <div className="flex-1 overflow-y-auto px-5 flex text-xs [scrollbar-gutter:stable]">
        <div className="flex flex-col gap-8 w-full max-w-[80rem] mx-auto pt-4">
            {/* — Thumbnails — */}
            {folder.thumbnails.length > 0 && (
              <div className="flex flex-col gap-3">
                <MetaRow label="Thumbnails">
                  <ThumbnailCarousel
                    thumbnails={folder.thumbnails}
                    thumbsKey={thumbsKey}
                    preferredThumbnail={meta?.preferredThumbnail}
                    localFlags={folder.thumbnailLocalFlags}
                    onSetAsThumbnail={(filePath) => {
                      const basename = filePath.split(/[\\/]/).pop() ?? ''
                      onUpdateMeta({ preferredThumbnail: basename })
                    }}
                    onDeleteImage={onDeleteThumbnail}
                    onEditThumbnail={onOpenThumbnails}
                    onOpenLightbox={i => setLightboxIndex(i)}
                  />
                </MetaRow>
              </div>
            )}
            {/* — Tags (SM-level: topics/games + stream type) — */}
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <MetaRow label="Topics / Games">
                  <TagComboBox
                    values={meta?.games ?? []}
                    onChange={next => onUpdateMeta({ games: next })}
                    allOptions={allGames}
                    placeholder="Add topic or game…"
                    emptyLabel="No topics added"
                    compact
                  />
                </MetaRow>
                <MetaRow label="Stream type">
                  <TagComboBox
                    values={normalizeStreamTypes(meta?.streamType)}
                    onChange={next => onUpdateMeta({ streamType: next })}
                    allOptions={allStreamTypes}
                    placeholder="e.g. games, other…"
                    emptyLabel="No types"
                    tagColors={tagColors}
                    tagTextures={tagTextures}
                    compact
                  />
                </MetaRow>
              </div>
            </div>
            {/* — YouTube — */}
            <div className="flex flex-col gap-3">
            {/* Merge-field params on one row (matches the old metamodal):
                Game Title · Tagline · Season · Episode. Together these feed
                the YouTube title / description / tag templates below, so they
                sit above the title field rather than scattered through the
                metadata. Grid uses two flexible columns for Game + Tagline and
                two auto columns for the small Season + Episode steppers. */}
            <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-start">
              <MetaRow mergeHint="{game}" highlighted={activeTitleMergeKeys.has('game')}>
                <EditableTextField
                  value={meta?.ytGameTitle ?? ''}
                  placeholder="e.g. Hollow Knight"
                  onSave={v => onUpdateMeta({ ytGameTitle: v })}
                />
              </MetaRow>
              <MetaRow mergeHint="{tagline}" highlighted={taglineActive}>
                <EditableTextField
                  value={meta?.ytCatchyTitle ?? ''}
                  placeholder="catchy tagline…"
                  onSave={v => onUpdateMeta({ ytCatchyTitle: v })}
                />
              </MetaRow>
              <MetaRow mergeHint="{season}" highlighted={activeTitleMergeKeys.has('season')}>
                <NumberStepperField
                  value={meta?.ytSeason ?? ''}
                  placeholder="1"
                  onSave={handleSeasonSave}
                  className="w-16"
                />
              </MetaRow>
              <MetaRow mergeHint="{episode}" highlighted={activeTitleMergeKeys.has('episode')}>
                <NumberStepperField
                  value={meta?.ytEpisode ?? ''}
                  placeholder="—"
                  onSave={v => onUpdateMeta({ ytEpisode: v })}
                  className="w-16"
                />
              </MetaRow>
            </div>
            {/* YouTube title — pushed below the merge-field params since the
                title is normally derived from them via a template. The
                template selector reads "Assign template" (vs "Apply template"
                on description / tags) because picking one here BINDS the
                template to the stream — future merge-field edits keep
                re-rendering it until the user clears or hand-edits. */}
            <MetaRow
              label="YouTube title"
              attachRight
              right={
                <div className="flex items-center gap-2">
                  {canSaveTitleTemplate && <SaveAsTemplateButton onSave={handleSaveTitleTemplate} />}
                  <InlineTemplateSelect
                    items={ytTitleTemplates}
                    value={titleTplId}
                    onChange={applyTitleTemplate}
                    placeholder="Assign template"
                    tabbed
                    tabActive={!!titleTplId}
                  />
                </div>
              }
            >
              <EditableTextField
                value={meta?.ytTitle ?? ''}
                placeholder="Title for YouTube upload…"
                onSave={handleTitleSave}
                tabAttached
                tabActive={!!titleTplId}
                aiFetcher={aiFetchTitle}
              />
            </MetaRow>
            {/* YouTube thumbnail picker — sits between title and
                description because the upload goes alongside the YT
                push from the footer. Default checkbox: reuse whatever's
                set as the stream item's thumbnail (preferredThumbnail
                or first thumb). Unchecking reveals a grid of qualifying
                images (YouTube requires JPG/PNG/GIF/WebP, ≤2MB; the
                IPC further filters to common video aspect ratios at
                ≥720px on the longer side). Picker state is transient
                and resets on stream switch — picking a thumbnail is
                "which one to push now," not a persisted preference. */}
            {(() => {
              const totalQualifying = ytQualifyingThumbnails.bestFit.length + ytQualifyingThumbnails.rest.length
              const shown = ytShowAllThumbs
                ? [...ytQualifyingThumbnails.bestFit, ...ytQualifyingThumbnails.rest]
                : ytQualifyingThumbnails.bestFit
              const hiddenCount = ytQualifyingThumbnails.rest.length
              const resolvedName = resolvedStreamItemThumb?.split(/[\\/]/).pop() ?? ''
              return (
                <MetaRow label="YouTube thumbnail">
                  {folder.thumbnails.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">No images found in this stream folder.</p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <Checkbox
                        checked={useStreamItemThumb}
                        onChange={setUseStreamItemThumb}
                        size="sm"
                        label={
                          <div>
                            <div className="text-[11px] text-gray-200">Use the stream item thumbnail</div>
                            <div className="text-[10px] text-gray-400 font-mono truncate">{resolvedName || '(none)'}</div>
                          </div>
                        }
                      />
                      {!useStreamItemThumb && (
                        totalQualifying === 0 ? (
                          <p className="text-[11px] text-gray-400 italic">
                            No images meet YouTube's requirements (JPG/PNG/GIF/WebP, max 2 MB).
                          </p>
                        ) : (
                          <>
                            <div className="flex flex-wrap gap-1.5">
                              {shown.map(p => {
                                const isSelected = p === ytSelectedThumbnail
                                const name = p.split(/[\\/]/).pop() ?? ''
                                return (
                                  <Tooltip key={p} content={name}>
                                    <button
                                      type="button"
                                      onClick={() => setYtSelectedThumbnail(isSelected ? null : p)}
                                      className={`relative w-20 h-14 rounded overflow-hidden border-2 transition-all shrink-0 ${isSelected ? 'border-red-400 ring-1 ring-red-400/50' : 'border-white/10 hover:border-white/30'}`}
                                    >
                                      {/* OS shell thumbnail (a few-KB PNG
                                          Windows already cached) instead of
                                          decoding the full-res source — keeps
                                          large galleries snappy. */}
                                      <PickerThumbImage path={p} thumbsKey={thumbsKey} alt={name} />
                                      {isSelected && (
                                        <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center">
                                          <Check size={14} className="text-white drop-shadow" />
                                        </div>
                                      )}
                                    </button>
                                  </Tooltip>
                                )
                              })}
                            </div>
                            {hiddenCount > 0 && ytQualifyingThumbnails.bestFit.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setYtShowAllThumbs(v => !v)}
                                className="self-start text-[10px] text-gray-400 hover:text-gray-200 underline underline-offset-2 transition-colors"
                              >
                                {ytShowAllThumbs
                                  ? 'Show best fit only'
                                  : `Show all ${totalQualifying} images`}
                              </button>
                            )}
                          </>
                        )
                      )}
                      <p className="text-[10px] text-gray-400">Recommended: 1280×720 or larger. Uploads alongside the YouTube push from the footer.</p>
                    </div>
                  )}
                </MetaRow>
              )
            })()}
            <MetaRow
              label="YouTube description"
              attachRight
              right={
                <div className="flex items-center gap-2">
                  {canSaveDescTemplate && <SaveAsTemplateButton onSave={handleSaveDescTemplate} />}
                  <InlineTemplateSelect
                    items={ytDescTemplates}
                    value={descTplId}
                    onChange={applyDescTemplate}
                    placeholder="Apply template"
                    tabbed
                  />
                </div>
              }
            >
              {/* `key` forces a remount when the user switches streams so the
                  textarea's auto-grow state (and any manual-resize override)
                  resets to fit the new stream's content. Without this the
                  browser's inline `style.height` from a previous manual drag
                  would carry across stream items. */}
              <EditableTextField
                key={folder.folderPath}
                autoGrow
                multiline
                rows={4}
                value={meta?.ytDescription ?? ''}
                placeholder="Description for YouTube upload…"
                onSave={v => onUpdateMeta({ ytDescription: v })}
                tabAttached
                aiFetcher={aiFetchDescription}
              />
            </MetaRow>
            <MetaRow
              label="YouTube tags"
              attachRight
              right={
                <div className="flex items-center gap-2">
                  {canSaveTagsTemplate && <SaveAsTemplateButton onSave={handleSaveTagsTemplate} suggestedName={suggestedTagTemplateName} />}
                  <InlineTemplateSelect
                    items={ytTagTemplates}
                    value={tagsTplId}
                    onChange={applyTagsTemplate}
                    placeholder="Apply template"
                    tabbed
                  />
                </div>
              }
            >
              <div className="flex flex-col gap-1">
                <TagChipEditor
                  value={meta?.ytTags ?? []}
                  placeholder="Add tag…"
                  onChange={next => onUpdateMeta({ ytTags: next })}
                  tabAttached
                  aiFetcher={aiFetchTags}
                  footerRight={(() => {
                    const tags = meta?.ytTags ?? []
                    const chars = tags.reduce((n, t) => n + t.length + (/\s/.test(t) ? 2 : 0), 0) + Math.max(0, tags.length - 1)
                    const over = chars > YT_TAG_CHAR_LIMIT
                    const atMax = chars === YT_TAG_CHAR_LIMIT
                    const cls = over ? 'text-red-400' : atMax ? 'text-amber-400' : 'text-gray-400'
                    return (
                      <p className={`text-[10px] tabular-nums ${cls}`}>
                        {tags.length} tags · {chars} / {YT_TAG_CHAR_LIMIT} chars
                      </p>
                    )
                  })()}
                />
              </div>
            </MetaRow>
            </div>
            {/* — Twitch — */}
            <div className="flex flex-col gap-3">
            {/* Sync flag defaults to true (undefined → synced); when synced,
                the override input is hidden — only the checkbox stays —
                since the effective value is whatever was set on the YouTube
                side above. */}
            <div className="grid grid-cols-2 gap-2 items-start">
              <MetaRow label="Twitch title">
                <div className="flex flex-col gap-1.5">
                  <Checkbox
                    size="sm"
                    checked={meta?.syncTitle !== false}
                    onChange={v => onUpdateMeta({ syncTitle: v })}
                    label={<span className="text-[11px] text-gray-400">Same as YouTube title</span>}
                  />
                  {meta?.syncTitle === false && (
                    <EditableTextField
                      value={meta?.twitchTitle ?? ''}
                      placeholder="Title for Twitch broadcast…"
                      onSave={v => onUpdateMeta({ twitchTitle: v })}
                    />
                  )}
                </div>
              </MetaRow>
              <MetaRow label="Twitch category">
                <div className="flex flex-col gap-1.5">
                  <Checkbox
                    size="sm"
                    checked={meta?.syncGame !== false}
                    onChange={v => onUpdateMeta({ syncGame: v })}
                    label={<span className="text-[11px] text-gray-400">Same as YouTube game</span>}
                  />
                  {meta?.syncGame === false && (
                    <EditableTextField
                      value={meta?.twitchGameName ?? ''}
                      placeholder="Twitch category override…"
                      onSave={v => onUpdateMeta({ twitchGameName: v })}
                    />
                  )}
                </div>
              </MetaRow>
            </div>
            <MetaRow
              label="Twitch tags"
              attachRight
              right={
                <div className="flex items-center gap-2">
                  {canSaveTwitchTagsTemplate && <SaveAsTemplateButton onSave={handleSaveTwitchTagsTemplate} suggestedName={suggestedTwitchTagTemplateName} />}
                  <InlineTemplateSelect
                    items={twitchTagTemplates}
                    value={twitchTagsTplId}
                    onChange={applyTwitchTagsTemplate}
                    placeholder="Apply template"
                    tabbed
                  />
                </div>
              }
            >
              <div className="flex flex-col gap-1">
                <TagChipEditor
                  value={meta?.twitchTags ?? []}
                  placeholder="Add tag…"
                  onChange={next => onUpdateMeta({ twitchTags: next })}
                  tabAttached
                  aiFetcher={aiFetchTwitchTags}
                  footerRight={(() => {
                    const tags = meta?.twitchTags ?? []
                    const { compat, skipped } = toTwitchCompatibleTags(tags)
                    return (
                      <p className="text-[10px] tabular-nums text-gray-400 text-right">
                        {compat.length} / {TWITCH_TAG_MAX_COUNT} valid
                        {skipped.length > 0 && <span className="text-amber-400 ml-1">· {skipped.length} invalid (alphanumeric only, ≤25 chars)</span>}
                      </p>
                    )
                  })()}
                />
              </div>
            </MetaRow>
            </div>
            {/* — Notes —
                pb-8 lives on THIS section instead of the scroll wrapper.
                Chromium clips padding-bottom from a flex+overflow scroll
                container, so the only way to leave breathing room above
                the footer when scrolled all the way down is to put it on
                the last child. */}
            <div className="flex flex-col gap-3 pb-8">
              <MetaRow label="Notes">
                <EditableTextField
                  key={`notes-${folder.folderPath}`}
                  autoGrow
                  multiline
                  rows={3}
                  value={meta?.comments ?? ''}
                  placeholder="Free-form notes for this stream…"
                  onSave={v => onUpdateMeta({ comments: v })}
                />
              </MetaRow>
            </div>
        </div>
      </div>

      {/* Sticky bottom action area. Top → bottom:
            1. Broadcast picker (YouTube linkage + privacy controls)
            2. Push pills (YouTube + Twitch — the publishing climax of the sidebar)
            3. Row-level action buttons (Player/Converter/folder/Archive/Delete)
          Action row sits at the very bottom so destructive verbs
          (Delete, Archive) are last in the visual flow — and the
          broadcast-picker → push-pills publishing path reads
          top-to-bottom uninterrupted. */}
      <div className="shrink-0 border-t border-white/5 bg-navy-700 px-3 py-2 flex flex-col gap-2">
        {/* Broadcast picker — first item in the footer because picking
            a broadcast IS the prerequisite for the YouTube push pill
            directly below it. Only renders when YT is connected. */}
        {ytConnected && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wide text-gray-200 flex items-center gap-1.5">
                <LucideYoutube size={11} className="text-red-400/70" />
                {isPastStream ? 'Linked video' : 'Linked broadcast'}
              </span>
              {selectedBroadcast && (
                <button
                  type="button"
                  onClick={() => onUpdateMeta({ ytVideoId: '' })}
                  className="text-[10px] text-gray-400 hover:text-gray-200 transition-colors flex items-center gap-1"
                  title="Unlink from broadcast"
                >
                  <X size={11} /> Unlink
                </button>
              )}
            </div>
            <BroadcastPicker
              value={linkedId}
              onChange={id => onUpdateMeta({ ytVideoId: id })}
              broadcasts={broadcastPool}
              otherFolderLinks={otherFolderLinks}
              loading={ytBroadcastsLoading}
              placeholder={isPastStream ? 'Pick a YouTube video…' : 'Pick a scheduled broadcast…'}
              emptyLabel={isPastStream ? '— No VODs loaded yet —' : '— No upcoming broadcasts —'}
              showDateOnly={isPastStream}
              onOpen={isPastStream ? onLoadAllVods : undefined}
              dropUp
            />

            {/* Unlinked-state alternatives: paste URL + (future-dated
                streams only) inline create-broadcast. Both fall away
                once the user picks (or pastes/creates) a broadcast so
                the linked-state UI stays clean. */}
            {!linkedId && (
              <>
                <div className="flex flex-col gap-1">
                  <input
                    value={manualUrl}
                    onChange={e => handleManualUrlChange(e.target.value)}
                    placeholder="Or paste a URL or Video ID"
                    className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-red-500/40 placeholder-gray-500"
                  />
                  {manualUrlLoading && (
                    <p className="text-[10px] text-gray-400 flex items-center gap-1">
                      <Loader2 size={10} className="animate-spin shrink-0" />
                      Looking up video…
                    </p>
                  )}
                  {manualUrlError && (
                    <p className="text-[10px] text-red-400 flex items-center gap-1">
                      <AlertTriangle size={10} className="shrink-0" />
                      {manualUrlError}
                    </p>
                  )}
                </div>

                {streamDateInFuture && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] text-gray-400 uppercase tracking-wider">Or create a new scheduled broadcast</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-1">
                        <label className="text-[10px] text-gray-400 shrink-0">Time</label>
                        <input
                          type="time"
                          value={newBroadcastTime}
                          onChange={e => setNewBroadcastTime(e.target.value)}
                          disabled={creatingBroadcast}
                          // Asymmetric padding compensates for the native
                          // time-input chrome — pt-[5px] pb-1 lines up
                          // with neighboring controls.
                          className="bg-navy-900 border border-white/10 text-gray-200 text-xs rounded px-2 pt-[5px] pb-1 focus:outline-none focus:ring-2 focus:ring-red-500/40 disabled:opacity-50 [color-scheme:dark]"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <label className="text-[10px] text-gray-400 shrink-0">Privacy</label>
                        <div className="relative">
                          <select
                            value={newBroadcastPrivacy}
                            onChange={e => setNewBroadcastPrivacy(e.target.value as 'public' | 'unlisted' | 'private')}
                            disabled={creatingBroadcast}
                            className="appearance-none bg-navy-900 border border-white/10 text-gray-200 text-xs rounded pl-2 pr-6 py-1 focus:outline-none focus:ring-2 focus:ring-red-500/40 disabled:opacity-50"
                          >
                            <option value="public">Public</option>
                            <option value="unlisted">Unlisted</option>
                            <option value="private">Private</option>
                          </select>
                          <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        </div>
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={creatingBroadcast}
                        onClick={handleCreateBroadcast}
                      >
                        Create broadcast
                      </Button>
                    </div>
                    {createError && (
                      <p className="text-[10px] text-red-400 flex items-center gap-1">
                        <AlertTriangle size={10} className="shrink-0" />
                        {createError}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Privacy controls — only when a broadcast is linked and
                we have its status loaded. Optimistic UI; revert + error
                surfaced below if the API call fails. */}
            {selectedBroadcast && currentPrivacy && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {([
                  { value: 'public' as const,   label: 'Public',   Icon: Globe },
                  { value: 'unlisted' as const, label: 'Unlisted', Icon: EyeOff },
                  { value: 'private' as const,  label: 'Private',  Icon: Lock },
                ]).map(({ value, label, Icon }) => {
                  const active = currentPrivacy === value
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => changePrivacy(value)}
                      disabled={savingPrivacy && !active}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                        active
                          ? 'bg-purple-600/25 border-purple-500/40 text-purple-200'
                          : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-gray-200 disabled:opacity-40 disabled:hover:bg-white/5 disabled:hover:text-gray-400'
                      }`}
                    >
                      <Icon size={10} />
                      {label}
                    </button>
                  )
                })}
                {savingPrivacy && <Loader2 size={11} className="animate-spin text-gray-400 ml-0.5" />}
              </div>
            )}
            {privacyError && (
              <p className="text-[10px] text-red-400 flex items-center gap-1">
                <AlertTriangle size={10} className="shrink-0" />
                {privacyError}
              </p>
            )}

            {/* Shared-link warning — other stream items also pointing
                at this broadcast. Not a blocker, just a heads-up that
                a push from this item would overwrite their data on YT. */}
            {sharedLinks.length > 0 && (
              <p className="text-[10px] text-amber-300 flex items-start gap-1">
                <AlertTriangle size={10} className="shrink-0 mt-0.5" />
                <span>
                  {sharedLinks.length === 1 ? (
                    <>Also linked from <strong className="text-amber-200">{sharedLinks[0].folderDate}</strong>. Pushing from here will overwrite that item's YouTube data.</>
                  ) : (
                    <><strong className="text-amber-200">{sharedLinks.length} other items</strong> link to this broadcast — pushing will overwrite their YouTube data.</>
                  )}
                </span>
              </p>
            )}
          </div>
        )}

        {/* Push row — two pill buttons, one per platform. */}
        {banner && (
          <button
            type="button"
            onClick={onDismissBanner}
            className={`text-left text-[11px] rounded-md px-2.5 py-1.5 border transition-colors ${
              banner.type === 'success'
                ? 'bg-green-500/10 border-green-500/30 text-green-300 hover:bg-green-500/15'
                : 'bg-red-500/10 border-red-500/30 text-red-300 hover:bg-red-500/15'
            }`}
            title="Dismiss"
          >
            {banner.message}
          </button>
        )}
        <div className="flex items-center gap-1.5">
          <Tooltip content={
            !ytConnected ? 'YouTube not connected (Settings → Integrations)'
              : !meta?.ytVideoId ? 'No linked broadcast or video — link one first'
              : !selectedBroadcast ? 'Loading broadcast info…'
              : !broadcastMismatch ? 'Already in sync with YouTube'
              : 'Push title / description / tags to YouTube'
          }>
            <button
              type="button"
              onClick={() => onPushToYoutube(effectiveYtThumb)}
              disabled={!ytConnected || !meta?.ytVideoId || !selectedBroadcast || !broadcastMismatch}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 hover:border-red-500/40 text-red-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-500/10"
            >
              <LucideYoutube size={11} />
              Push to YouTube
            </button>
          </Tooltip>
          <Tooltip content={!twConnected ? 'Twitch not connected (Settings → Integrations)' : 'Push title/category/tags to Twitch channel'}>
            <button
              type="button"
              onClick={onPushToTwitch}
              disabled={!twConnected}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/25 hover:border-purple-500/40 text-purple-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-purple-500/10"
            >
              <LucideTwitch size={11} />
              Push to Twitch
            </button>
          </Tooltip>
        </div>

        {/* Row-level action buttons. Pinned to the bottom of the footer
            so destructive verbs (Archive, Delete) sit at the very end of
            the visual flow.

            Layout is three equal-width columns (`grid-cols-3`) spanning
            the footer, each group's buttons centered within its column:
              · Col 1 — Send-to: Player / Converter / Combine / Thumbnail
              · Col 2 — Stream ops: New episode / Offload / Pin local / Open folder
              · Col 3 — Lifecycle: Archive / Delete

            All three columns collapse to icon-only at the SAME
            container-query breakpoint (@5xl). Since the columns are
            equal width, mismatched thresholds would have one column
            reflowing while the others stay put — staggered and ugly.
            @5xl is dictated by Col 3 (the narrowest button group still
            fits its labels at that width); the wider groups stay
            consistent with it. `-ms-1.5` cancels the parent button's
            `gap-1.5` while collapsed so the icon-only state has no
            leftover whitespace.

            `divide-x divide-white/5` adds a subtle vertical hairline
            between columns — replaces the inline divider dots from the
            old flex-wrap layout.

            Sizing: flex with `flex-1` on each column. The default
            `min-width: auto` (= min-content) on flex items means cols
            1 and 2 won't shrink below their buttons' natural width.
            Col 3 has `min-w-0` overriding that, so it gives up space
            first when cols 1/2 need more than their 1/3 share. When
            everything fits at 1/3 each, the three columns sit equal. */}
        <div className="flex divide-x divide-white/5 border-t border-white/15 pt-2">
          <div className="flex-1 flex items-center justify-center gap-1 px-3">
            {videoCount > 0 && (
              <Tooltip content="Send to Player">
                <button onClick={onSendToPlayer} className={`${PANEL_ACTION_BUTTON_BASE} hover:text-purple-300 hover:bg-purple-500/10`}>
                  <Film size={13} />
                  <CollapsibleLabel expandClass="@5xl:grid-cols-[1fr] @5xl:ms-0" collapsedMarginStart="-ms-1.5">Player</CollapsibleLabel>
                </button>
              </Tooltip>
            )}
            {videoCount > 0 && (
              <Tooltip content="Send to Converter">
                <button onClick={onSendToConverter} className={`${PANEL_ACTION_BUTTON_BASE} hover:text-purple-300 hover:bg-purple-500/10`}>
                  <Zap size={13} />
                  <CollapsibleLabel expandClass="@5xl:grid-cols-[1fr] @5xl:ms-0" collapsedMarginStart="-ms-1.5">Converter</CollapsibleLabel>
                </button>
              </Tooltip>
            )}
            {videoCount > 1 && (
              <Tooltip content="Send to Combine">
                <button onClick={onSendToCombine} className={`${PANEL_ACTION_BUTTON_BASE} hover:text-purple-300 hover:bg-purple-500/10`}>
                  <Combine size={13} />
                  <CollapsibleLabel expandClass="@5xl:grid-cols-[1fr] @5xl:ms-0" collapsedMarginStart="-ms-1.5">Combine</CollapsibleLabel>
                </button>
              </Tooltip>
            )}
            <Tooltip content={hasSMThumbnail ? 'Edit Stream Manager Thumbnail' : 'Create Stream Manager Thumbnail'}>
              <button onClick={onOpenThumbnails} className={`${PANEL_ACTION_BUTTON_BASE} hover:text-purple-300 hover:bg-purple-500/10`}>
                <ImageIcon size={13} />
                <CollapsibleLabel expandClass="@5xl:grid-cols-[1fr] @5xl:ms-0" collapsedMarginStart="-ms-1.5">Thumbnail</CollapsibleLabel>
              </button>
            </Tooltip>
          </div>
          <div className="flex-1 flex items-center justify-center gap-1 px-3">
            <Tooltip content="New episode based on this stream">
              <button onClick={onNewEpisode} className={PANEL_ACTION_BUTTON_BLUE}>
                <CopyPlus size={13} />
                <CollapsibleLabel expandClass="@5xl:grid-cols-[1fr] @5xl:ms-0" collapsedMarginStart="-ms-1.5">New episode</CollapsibleLabel>
              </button>
            </Tooltip>
            {cloudSyncActive && videoCount > 0 && (
              <>
                <Tooltip content="Offload to cloud">
                  <button onClick={onOffload} className={PANEL_ACTION_BUTTON_PINK}>
                    <Cloud size={13} />
                    <CollapsibleLabel expandClass="@5xl:grid-cols-[1fr] @5xl:ms-0" collapsedMarginStart="-ms-1.5">Offload</CollapsibleLabel>
                  </button>
                </Tooltip>
                <Tooltip content="Pin local">
                  <button onClick={onPinLocal} className={PANEL_ACTION_BUTTON_CYAN}>
                    <CloudDownload size={13} />
                    <CollapsibleLabel expandClass="@5xl:grid-cols-[1fr] @5xl:ms-0" collapsedMarginStart="-ms-1.5">Pin local</CollapsibleLabel>
                  </button>
                </Tooltip>
              </>
            )}
            <Tooltip content="Open folder">
              <button onClick={onOpenFolder} className={PANEL_ACTION_BUTTON_YELLOW}>
                <FolderOpen size={13} />
                <CollapsibleLabel expandClass="@5xl:grid-cols-[1fr] @5xl:ms-0" collapsedMarginStart="-ms-1.5">Open folder</CollapsibleLabel>
              </button>
            </Tooltip>
          </div>
          <div className="flex-1 min-w-0 flex items-center justify-center gap-0.5">
            {videoCount > 0 && (
              <Tooltip content={isArchiving ? 'Already in the converter — archive in progress' : 'Archive'}>
                <button onClick={onArchive} disabled={isArchiving} className={PANEL_ACTION_BUTTON_GREEN}>
                  <Archive size={13} />
                  <CollapsibleLabel expandClass="@5xl:grid-cols-[1fr] @5xl:ms-0" collapsedMarginStart="-ms-1.5">Archive</CollapsibleLabel>
                </button>
              </Tooltip>
            )}
            <Tooltip content="Delete this stream and all its contents">
              <button onClick={onDelete} className={PANEL_ACTION_BUTTON_RED}>
                <Trash2 size={13} />
                <CollapsibleLabel expandClass="@5xl:grid-cols-[1fr] @5xl:ms-0" collapsedMarginStart="-ms-1.5">Delete</CollapsibleLabel>
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Full-screen image viewer. Opened by clicking the active image in
          the carousel above. Renders inside the sidebar so it overlays
          the streams page but stays inside the app's titlebar offset
          (Lightbox positions itself fixed inset-x-0 bottom-0 top-10). */}
      {lightboxIndex !== null && folder.thumbnails.length > 0 && (
        <Lightbox
          thumbnails={folder.thumbnails}
          localFlags={folder.thumbnailLocalFlags}
          index={Math.min(lightboxIndex, folder.thumbnails.length - 1)}
          thumbsKey={thumbsKey}
          preferredThumbnail={meta?.preferredThumbnail}
          onSetAsThumbnail={(filePath) => {
            const basename = filePath.split(/[\\/]/).pop() ?? ''
            onUpdateMeta({ preferredThumbnail: basename })
          }}
          onDeleteImage={async (filePath) => {
            await onDeleteThumbnail(filePath)
            // After delete, if the list will be empty, close the lightbox;
            // otherwise the index gets clamped on the next render via the
            // Math.min above.
            if (folder.thumbnails.length <= 1) setLightboxIndex(null)
          }}
          onEditThumbnail={() => {
            setLightboxIndex(null)
            onOpenThumbnails()
          }}
          onClose={() => setLightboxIndex(null)}
          onNavigate={(i) => setLightboxIndex(i)}
        />
      )}
    </div>
  )
}

/** Label-above-value metadata row. Stacking vertically means every input
 *  gets the sidebar's full width — important for fields like description /
 *  tag editors where horizontal room matters more than vertical compactness.
 *  The metadata area scrolls, so taller rows are cheap.
 *
 *  `mergeHint` (e.g. `{game}`) renders inline next to the label in mono /
 *  purple to mark which merge token populates / reads from this field when
 *  applying a template. `right` renders flush-right on the same line as
 *  the label — used for the template-picker dropdown. */
function MetaRow({ label, mergeHint, right, attachRight, highlighted, children }: { label?: string; mergeHint?: string; right?: React.ReactNode; attachRight?: boolean; highlighted?: boolean; children: React.ReactNode }) {
  // When `highlighted`, the merge hint brightens (text-purple-200) and the
  // weight steps up from font-light to the default font-normal. No
  // background pill / border / padding shift — the badge's footprint is
  // identical in both states, so toggling highlight never reflows the row.
  const hintCls = highlighted
    ? 'font-mono text-purple-200 normal-case tracking-normal'
    : 'font-mono font-light text-purple-400/70 normal-case tracking-normal'
  const labelCls = 'text-[10px] uppercase tracking-wide text-gray-400 flex items-center gap-1.5'

  // When `attachRight`, label + tab share one row (items-end so the tab's
  // bottom edge — and the label's baseline — both sit at the row's
  // bottom, which is exactly the input's top edge below). Gap between
  // header and children is 0 so the tab touches the input. The caller
  // is expected to also style the input with `tabAttached` so its
  // top-right corner doesn't fight the tab.
  if (attachRight && right) {
    return (
      <div className="flex flex-col">
        <div className="flex items-end justify-between gap-2 min-h-[16px]">
          <span className={labelCls}>
            {label}
            {mergeHint && <span className={hintCls}>{mergeHint}</span>}
          </span>
          {right}
        </div>
        <div className="text-gray-200">{children}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 min-h-[16px]">
        <span className={labelCls}>
          {label}
          {mergeHint && <span className={hintCls}>{mergeHint}</span>}
        </span>
        {right}
      </div>
      <div className="text-gray-200">{children}</div>
    </div>
  )
}

/** Inline text editor with autosave-on-blur and focus-aware external
 *  refresh. Behaviour:
 *  - The component owns a `local` working copy distinct from the `value`
 *    prop, so the user can type freely.
 *  - When `value` changes externally (e.g. a streams:changed refresh),
 *    `local` is updated to match ONLY if the field isn't currently focused.
 *    This guarantees an in-flight edit can't be silently clobbered by a
 *    background refresh (the "focus-aware refresh" pattern we agreed on).
 *  - On blur, if `local` differs from the last-saved `value`, onSave is
 *    awaited. On error, `local` reverts to `value` so the UI doesn't
 *    drift from disk.
 *  - Empty string blur calls onSave(''); the parent decides whether '' →
 *    delete the field or store an empty literal. */
function EditableTextField({
  value, onSave, placeholder, multiline, rows = 3, className, autoGrow, tabAttached, tabActive, aiFetcher,
}: {
  value: string
  onSave: (value: string) => Promise<void> | void
  placeholder?: string
  multiline?: boolean
  rows?: number
  className?: string
  /** When true with `multiline`, the textarea resizes itself to fit the
   *  content as the user types or as `value` changes from outside (e.g.
   *  template apply). Manually dragging the resize handle disables
   *  auto-grow for the rest of the component's lifetime — remount (via
   *  `key`) to reset. */
  autoGrow?: boolean
  /** When true, drops the top-right corner rounding so a tab can sit
   *  flush against it. */
  tabAttached?: boolean
  /** Lightens the input's border (focus state still wins) to indicate
   *  that an attached tab is in an "active" state — paired with the
   *  InlineTemplateSelect's `tabActive` flag. */
  tabActive?: boolean
  /** When set, Ctrl+Space inside the input fetches a Claude suggestion
   *  at the cursor position. The suggested text is inserted + selected;
   *  Tab accepts, Esc dismisses, typing replaces. A small hint line
   *  appears below the field so the keystroke is discoverable. Pass
   *  `undefined` to disable (no hint, no key handlers attached). */
  aiFetcher?: (prefix: string, suffix: string) => Promise<string | null>
}) {
  const [local, setLocal] = useState(value)
  const [saving, setSaving] = useState(false)

  // AI suggestion plumbing — declared first so its ref is the canonical
  // textarea/input ref that the auto-grow + focus-aware-refresh effects
  // below read from. Having a separate `useRef` and syncing it via a
  // layout effect caused a mount-order bug: the grow useLayoutEffect ran
  // before the sync effect, so on first mount it saw `null` and bailed
  // out — leaving the textarea at its initial `rows=4` height until a
  // window resize fired the ResizeObserver. Always-called per hooks
  // rule; when no fetcher is provided we use a noop that resolves null
  // so Ctrl+Space is a no-op and the hint line doesn't render.
  const noopFetcher = useCallback((_p: string, _s: string) => Promise.resolve(null), [])
  const sg = useFieldSuggestion(local, setLocal, aiFetcher ?? noopFetcher)
  const aiEnabled = !!aiFetcher
  const ref = sg.ref

  // Auto-grow control. Starts on per mount; a manual drag of the resize
  // handle (detected by ResizeObserver seeing a height we didn't write)
  // flips this to false for the rest of the instance's lifetime.
  const autoGrowEnabledRef = useRef(true)
  // The most recent height we set via auto-grow. The ResizeObserver
  // compares observed heights against this to tell our own writes apart
  // from the user dragging the handle.
  const expectedHeightRef = useRef<number>(0)

  useEffect(() => {
    if (document.activeElement !== ref.current) setLocal(value)
  }, [value])

  // Resize textarea to fit content. No-op if not multiline+autoGrow, or
  // once the user has manually dragged the handle.
  //
  // The `+ borderAdjust` matters because Tailwind defaults to
  // box-sizing:border-box — the height we set includes the border, but
  // `scrollHeight` doesn't. Without the compensation we'd be short by
  // 2×border-width and the browser would show a scrollbar over the last
  // line of content.
  const grow = useCallback(() => {
    if (!autoGrow || !multiline) return
    if (!autoGrowEnabledRef.current) return
    const ta = ref.current as HTMLTextAreaElement | null
    if (!ta) return
    ta.style.height = 'auto'
    const borderAdjust = ta.offsetHeight - ta.clientHeight
    ta.style.height = `${ta.scrollHeight + borderAdjust}px`
    expectedHeightRef.current = ta.offsetHeight
  }, [autoGrow, multiline])

  useLayoutEffect(() => { grow() }, [local, grow])

  // Re-grow whenever the textarea's *width* changes — covers the case
  // where the sidebar mounts during a width transition (e.g. user opens
  // a stream item with the sidebar collapsed). The initial useLayoutEffect
  // fires at the still-narrow width, so the calculated scrollHeight is
  // huge; the observer catches every subsequent intermediate width and
  // recomputes. Guard on width-only so writes from our own grow() (which
  // change height but not width) don't trigger a loop.
  useEffect(() => {
    if (!autoGrow || !multiline) return
    const ta = ref.current as HTMLTextAreaElement | null
    if (!ta) return
    let lastWidth = ta.offsetWidth
    const obs = new ResizeObserver(() => {
      if (ta.offsetWidth === lastWidth) return
      lastWidth = ta.offsetWidth
      grow()
    })
    obs.observe(ta)
    return () => obs.disconnect()
  }, [autoGrow, multiline, grow])

  // Drag-to-resize via the handle strip below the textarea. Replaces the
  // native bottom-right corner — strip spans the full bottom edge so
  // there's a much larger hit target. Flips auto-grow off the moment a
  // drag starts so subsequent content changes don't fight the user's
  // chosen height; remount via key resets it.
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    if (!multiline) return
    e.preventDefault()
    const ta = ref.current as HTMLTextAreaElement | null
    if (!ta) return
    autoGrowEnabledRef.current = false
    const startY = e.clientY
    const startHeight = ta.offsetHeight
    const onMove = (me: MouseEvent) => {
      const next = Math.max(40, startHeight + me.clientY - startY)
      ta.style.height = `${next}px`
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [multiline])

  const handleBlur = async () => {
    if (local === value) return
    setSaving(true)
    try { await onSave(local) }
    catch (err) {
      console.error('Autosave failed', err)
      setLocal(value)
    }
    finally { setSaving(false) }
  }

  const borderCls = tabActive ? 'border-white/[0.18]' : 'border-white/10'
  const cornerCls = tabAttached ? 'rounded rounded-tr-none' : 'rounded'
  const sharedCls = `w-full bg-navy-900/70 border ${borderCls} ${cornerCls} px-2 py-1 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500/50 focus:bg-navy-900 transition-colors ${saving ? 'opacity-60' : ''} ${className ?? ''}`

  // Type-cast aliases for the input vs textarea render branches. Both
  // resolve to the same `sg.ref` DOM node — useFieldSuggestion attaches
  // its own onKeyDown/onChange/onBlur which we merge with ours below.
  const inputRef = sg.ref as React.RefObject<HTMLInputElement>
  const textareaRef = sg.ref as React.RefObject<HTMLTextAreaElement>

  const mergedChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    // sg.props.onChange both clears any pending suggestion AND calls our
    // setLocal (passed as the hook's onChange). So no separate setLocal
    // call is needed when AI is enabled.
    sg.props.onChange(e as React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>)
  }
  const mergedBlur = async () => {
    sg.props.onBlur()       // dismiss any pending suggestion first
    await handleBlur()      // then autosave if dirty
  }
  const aiHint = aiEnabled && (sg.hint || true) ? (
    <p className="flex items-center gap-1 text-[10px] text-gray-400 mt-0.5 min-h-[14px]">
      {sg.hint === 'loading' && <><Loader2 size={9} className="animate-spin" />Generating…</>}
      {sg.hint === 'accept' && <>Tab to accept · Esc to dismiss</>}
      {!sg.hint && <span>Ctrl+Space for AI suggestion</span>}
    </p>
  ) : null

  return multiline ? (
    <div className="w-full flex flex-col">
      <textarea
        ref={textareaRef}
        value={local}
        onKeyDown={sg.props.onKeyDown}
        onChange={mergedChange}
        onBlur={mergedBlur}
        placeholder={placeholder}
        rows={rows}
        disabled={saving}
        // Native resize is disabled; the custom drag strip below provides
        // the equivalent (with a larger hit target along the full bottom
        // edge). The scrollbar-corner arbitrary selector keeps the
        // bottom-right tile from rendering as a bright Chromium square
        // when content overflows past a user-shrunk height.
        className={`${sharedCls} resize-none leading-snug [&::-webkit-scrollbar-corner]:bg-transparent z-10`}
      />
      <div
        onMouseDown={handleResizeStart}
        className="group cursor-ns-resize flex items-center justify-center h-1.75 rounded-b hover:bg-white/5 transition-colors pt-[2px] mt-[-2px]"
        title="Drag to resize"
      >
        <GripHorizontal size={10} className="text-gray-500 group-hover:text-gray-300" />
      </div>
      {aiHint}
    </div>
  ) : (
    <div className="w-full flex flex-col">
      <input
        ref={inputRef}
        type="text"
        value={local}
        onKeyDown={sg.props.onKeyDown}
        onChange={mergedChange}
        onBlur={mergedBlur}
        placeholder={placeholder}
        disabled={saving}
        className={sharedCls}
      />
      {aiHint}
    </div>
  )
}

/**
 * TagChipEditor — visible removable chips + a trailing input. Enter or comma
 * commits, Backspace on an empty input pops the last chip. Persists on every
 * mutation (no working-copy or blur-debounce); chip operations are discrete
 * enough that batching them just hides latency. Commits any pending input
 * text on blur so users can't lose a half-typed tag by clicking out.
 *
 * variant only swaps the chip color palette. Validation/limit hints are
 * rendered by the caller below the editor (kept out of this component since
 * YouTube and Twitch surface different numbers).
 */
function TagChipEditor({
  value,
  onChange,
  placeholder,
  tabAttached,
  aiFetcher,
  footerRight,
}: {
  value: string[]
  onChange: (next: string[]) => Promise<void> | void
  placeholder?: string
  /** Drops the top-right corner rounding so an InlineTemplateSelect tab
   *  can sit flush against it. Border color stays put — tag editors
   *  don't have an "active" template binding to highlight. */
  tabAttached?: boolean
  /** When set, Ctrl+Space inside the add-tag input asks Claude for a
   *  suggestion. The text is inserted + selected; Tab accepts it into the
   *  input, then Enter / comma commits it as one or more chips (the
   *  commit logic splits on commas so a multi-tag suggestion becomes
   *  multiple chips in a single round-trip). */
  aiFetcher?: (prefix: string, suffix: string) => Promise<string | null>
  /** Rendered flush-right on the same row as the AI hint (or alone in
   *  that row when no AI fetcher is wired). Caller supplies the char-
   *  count / valid-tag-count summary for the field. */
  footerRight?: React.ReactNode
}) {
  const [input, setInput] = useState('')

  // AI suggestion plumbing. Always called (hooks rule); the noop fetcher
  // makes Ctrl+Space a no-op when AI isn't configured.
  const noopFetcher = useCallback((_p: string, _s: string) => Promise.resolve(null), [])
  const sg = useFieldSuggestion(input, setInput, aiFetcher ?? noopFetcher)
  const aiEnabled = !!aiFetcher

  const commit = (raw: string) => {
    const fresh = raw.split(',').map(t => t.trim()).filter(Boolean)
    if (fresh.length === 0) { setInput(''); return }
    const seen = new Set(value.map(t => t.toLowerCase()))
    const additions = fresh.filter(t => {
      const k = t.toLowerCase()
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    if (additions.length > 0) onChange([...value, ...additions])
    setInput('')
  }

  const removeAt = (i: number) => {
    onChange(value.filter((_, idx) => idx !== i))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Let useFieldSuggestion handle Ctrl+Space, Tab (accept), Esc
    // (dismiss) first. If it consumed the key it called preventDefault,
    // so the chip commit logic below won't fire on that Tab.
    sg.props.onKeyDown(e)
    if (e.defaultPrevented) return
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit(input)
    } else if (e.key === 'Backspace' && input === '' && value.length > 0) {
      e.preventDefault()
      onChange(value.slice(0, -1))
    }
  }

  const handleBlur = () => {
    sg.props.onBlur()
    if (input.trim()) commit(input)
  }

  // Both YouTube + Twitch tag editors share the brighter purple chip
  // styling. The earlier gray-on-white/5 treatment for YouTube tags read
  // as disabled, so it's been unified.
  const chipCls = 'inline-flex items-center gap-1 text-[10px] text-purple-300/80 bg-purple-500/10 border border-purple-500/25 rounded px-1.5 py-0.5'

  return (
    <div className="flex flex-col">
      <div className={`flex flex-wrap gap-1 items-center min-h-[1.75rem] bg-navy-900/70 border border-white/10 px-1.5 py-1 focus-within:border-purple-500/50 focus-within:bg-navy-900 transition-colors ${tabAttached ? 'rounded rounded-tr-none' : 'rounded'}`}>
        {value.map((tag, i) => (
          <span key={`${tag}-${i}`} className={chipCls}>
            <span>{tag}</span>
            <button
              type="button"
              onClick={() => removeAt(i)}
              className="text-gray-500 hover:text-red-400 transition-colors leading-none"
              aria-label={`Remove ${tag}`}
            >
              <X size={9} />
            </button>
          </span>
        ))}
        <input
          ref={sg.ref as React.RefObject<HTMLInputElement>}
          type="text"
          value={input}
          onChange={sg.props.onChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={value.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[80px] bg-transparent text-[11px] text-gray-200 placeholder-gray-500 outline-none border-none p-0.5"
        />
      </div>
      {(aiEnabled || footerRight) && (
        <div className="flex items-center justify-between gap-2 mt-0.5 min-h-[14px]">
          {aiEnabled ? (
            <p className="flex items-center gap-1 text-[10px] text-gray-400">
              {sg.hint === 'loading' && <><Loader2 size={9} className="animate-spin" />Generating…</>}
              {sg.hint === 'accept' && <>Tab to accept · Esc to dismiss · then Enter to commit</>}
              {!sg.hint && <span>Ctrl+Space for AI suggestion</span>}
            </p>
          ) : <span />}
          {footerRight}
        </div>
      )}
    </div>
  )
}

/**
 * InlineTemplateSelect — small "Template…" dropdown rendered as a portal.
 * Same shape as the one in StreamsPage so future consolidation is mechanical.
 *
 * The portal positioning is fixed-coords + right-anchored so the menu hangs
 * from the bottom-right of the trigger, which keeps it inside the sidebar
 * for the typical placement above each editable field.
 */
function InlineTemplateSelect<T extends { id: string; name: string }>({
  items, value, onChange, placeholder = 'Template…', tabbed, tabActive,
}: {
  items: T[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  /** When true, the trigger renders as a tab attached to the top of an
   *  input below it: solid fill matching the input border color, top
   *  corners rounded, bottom flat. Set by MetaRow's `attachRight` mode. */
  tabbed?: boolean
  /** When `tabbed` + `tabActive`, the tab lightens (and the caller is
   *  expected to lighten the input border to match). Used for the YouTube
   *  title's persistent template binding — visually signals "active". */
  tabActive?: boolean
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const selected = items.find(t => t.id === value)
  const close = () => setOpen(false)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        anchorRef.current && !anchorRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) close()
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
        className={
          tabbed
            ? `flex items-center gap-1 text-[10px] transition-colors focus:outline-none px-2 pt-0.5 pb-px rounded-t ${
                tabActive
                  ? 'bg-white/[0.18] text-gray-200 hover:bg-white/[0.22]'
                  : 'bg-white/10 text-gray-400 hover:bg-white/15 hover:text-gray-200'
              }`
            : 'flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-200 transition-colors focus:outline-none'
        }
      >
        <span>{selected ? selected.name : placeholder}</span>
        <ChevronDown size={9} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && rect && ReactDOM.createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', top: rect.bottom + 4, right: window.innerWidth - rect.right, zIndex: 9999, minWidth: 160 }}
          className="bg-navy-700 border border-white/10 rounded-lg shadow-xl overflow-hidden max-h-72 overflow-y-auto"
          onMouseDown={e => e.preventDefault()}
        >
          {value && (
            <button
              className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:bg-white/5 transition-colors border-b border-white/5"
              onClick={() => { onChange(''); close() }}
            >
              — Clear —
            </button>
          )}
          {items.length === 0 && (
            <p className="px-3 py-2 text-xs text-gray-400 italic">No templates</p>
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

/**
 * NumberStepperField — text input with up/down stepper buttons stacked on
 * the right. Stores as string (the meta fields ytSeason/ytEpisode are
 * strings). Uses the same focus-aware working-copy pattern as
 * EditableTextField so a stepper click while mid-typing doesn't race with
 * the input's blur save.
 *
 * Empty input → first stepper click jumps to `min` (default 1), so the
 * arrows are always a useful no-state-needed entry point.
 */
function NumberStepperField({
  value, onSave, placeholder, min = 1, max, className,
}: {
  value: string
  onSave: (value: string) => Promise<void> | void
  placeholder?: string
  min?: number
  max?: number
  className?: string
}) {
  const [local, setLocal] = useState(value)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (document.activeElement !== inputRef.current) setLocal(value)
  }, [value])

  const commit = async (next: string) => {
    if (next === value) return
    setSaving(true)
    try { await onSave(next) }
    catch (err) {
      console.error('Stepper save failed', err)
      setLocal(value)
    }
    finally { setSaving(false) }
  }

  const step = (delta: number) => {
    const n = parseInt(local, 10)
    let next: number
    if (!Number.isFinite(n)) next = min
    else next = n + delta
    next = Math.max(min, next)
    if (max !== undefined) next = Math.min(max, next)
    const str = String(next)
    setLocal(str)
    void commit(str)
  }

  const handleBlur = () => {
    if (local === value) return
    void commit(local)
  }

  return (
    <div className={`flex items-stretch ${className ?? ''}`}>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={saving}
        className={`w-full bg-navy-900/70 border border-r-0 border-white/10 rounded-l px-2 py-1 text-xs text-gray-200 placeholder-gray-500 text-center focus:outline-none focus:border-purple-500/50 focus:bg-navy-900 transition-colors ${saving ? 'opacity-60' : ''}`}
      />
      <div className="flex flex-col">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => step(1)}
          className="flex-1 flex items-center justify-center w-4 bg-navy-900/70 border border-l-0 border-b-0 border-white/10 rounded-tr text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
          aria-label="Increment"
        >
          <ChevronUp size={10} strokeWidth={2.5} />
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => step(-1)}
          className="flex-1 flex items-center justify-center w-4 bg-navy-900/70 border border-l-0 border-white/10 rounded-br text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
          aria-label="Decrement"
        >
          <ChevronDown size={10} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  )
}

/**
 * RescheduleModal — minimal version of the StreamsPage reschedule modal.
 *
 * Scope for now: rename the local folder + meta key via the existing
 * `previewReschedule` / `rescheduleStream` IPCs, then notify the parent so
 * the selection and folders list can re-sync. The "also create a YouTube
 * broadcast" follow-up flow on the old page is deferred to phase 4 where
 * inline-integration affordances land for the sidebar as a whole.
 *
 * Preview auto-fetches whenever the date input changes, so the user can see
 * exactly what files will be renamed before clicking Confirm.
 */
function RescheduleModal({
  target,
  onClose,
  onSuccess,
}: {
  target: StreamFolder
  onClose: () => void
  onSuccess: (newFolderPath: string) => void
}) {
  const [newDate, setNewDate] = useState(target.date)
  const [preview, setPreview] = useState<{
    folderRename: { from: string; to: string } | null
    folderConflict: boolean
    filesToRename: Array<{ from: string; to: string; collision: boolean }>
    hasCollisions: boolean
  } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!newDate || newDate === target.date) { setPreview(null); return }
    setPreviewLoading(true)
    let cancelled = false
    window.api.previewReschedule(target.folderPath, target.date, newDate)
      .then(p => { if (!cancelled) setPreview(p) })
      .catch(() => { if (!cancelled) setPreview(null) })
      .finally(() => { if (!cancelled) setPreviewLoading(false) })
    return () => { cancelled = true }
  }, [newDate, target.folderPath, target.date])

  const sameDate = newDate === target.date
  const disabled = busy || sameDate || !preview || !!preview.folderConflict || !!preview.hasCollisions

  const confirm = async () => {
    if (disabled || !newDate) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.rescheduleStream(target.folderPath, target.date, newDate)
      onSuccess(result.newFolderPath)
    } catch (err: any) {
      const msg: string = err?.message ?? String(err)
      if (/EPERM|EBUSY/.test(msg) && /rename/.test(msg)) {
        setError("Couldn't rename the stream folder — your cloud sync client is probably holding it open while uploading. Wait for the sync to finish, or pause it briefly, then try again.")
      } else {
        setError(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      isOpen
      onClose={() => { if (!busy) onClose() }}
      title="Reschedule stream"
      width="2xl"
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" loading={busy} disabled={disabled} onClick={confirm}>
            Confirm reschedule
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-400">New date</label>
          <input
            type="date"
            value={newDate}
            onChange={e => setNewDate(e.target.value)}
            disabled={busy}
            className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/40 [color-scheme:dark]"
          />
        </div>

        {sameDate && (
          <p className="text-xs text-gray-400 italic">Choose a different date to reschedule.</p>
        )}

        {!sameDate && previewLoading && (
          <p className="text-xs text-gray-400 flex items-center gap-1.5">
            <Loader2 size={11} className="animate-spin shrink-0" />
            Checking…
          </p>
        )}

        {!sameDate && !previewLoading && preview && (
          preview.folderConflict ? (
            <p className="text-xs text-red-400 flex items-start gap-1.5">
              <AlertTriangle size={11} className="shrink-0 mt-0.5" />
              A stream folder already exists for {newDate}. Choose a different date.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-gray-400">
                The following will be renamed from <span className="font-mono text-gray-300">{target.date}</span> to <span className="font-mono text-gray-300">{newDate}</span>:
              </p>
              <ul className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
                {preview.folderRename && (
                  <li className="text-xs font-mono text-gray-400 bg-navy-900 rounded px-2 py-1">
                    📁 {preview.folderRename.from}/ → {preview.folderRename.to}/
                  </li>
                )}
                {preview.filesToRename.map(f => (
                  <li
                    key={f.from}
                    className={`text-xs font-mono px-2 py-0.5 ${f.collision ? 'text-red-400' : 'text-gray-400'}`}
                    title={f.collision ? 'Skipped: a file with that name already exists.' : undefined}
                  >
                    {f.collision && <AlertTriangle size={10} className="inline mr-1 mb-0.5" />}
                    {f.from} → {f.to}
                  </li>
                ))}
                {preview.filesToRename.length === 0 && (
                  <li className="text-xs text-gray-400 italic px-2 py-0.5">No files to rename inside folder.</li>
                )}
              </ul>
              {preview.hasCollisions && (
                <p className="text-xs text-red-400 flex items-start gap-1.5">
                  <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                  Some target filenames already exist. Resolve those conflicts before rescheduling.
                </p>
              )}
            </div>
          )
        )}

        {error && (
          <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 leading-relaxed">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Modal>
  )
}

/**
 * DeleteModal — confirmation + opt-in to also delete the linked YouTube
 * video. Simpler than the StreamsPage version (no TreeView for the folder —
 * just lists the files inside) since the sidebar workflow rarely needs the
 * deep tree affordance for confirmation.
 *
 * Order of operations matters: local delete first (recoverable from the
 * Recycle Bin), then the YT delete. Reversing that risks losing a VOD if
 * the local delete then errors.
 */
function DeleteModal({
  target,
  isDumpMode,
  onClose,
  onSuccess,
}: {
  target: StreamFolder
  isDumpMode: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const [alsoDeleteYt, setAlsoDeleteYt] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filesInFolder, setFilesInFolder] = useState<string[] | null>(null)
  const linkedVideoId = target.meta?.ytVideoId

  useEffect(() => {
    if (isDumpMode) {
      window.api.listFilesForDate(target.folderPath, target.date).then(setFilesInFolder).catch(() => setFilesInFolder([]))
    } else {
      // Walk the entire folder so the user sees thumbnails, project
      // files, exported clips, etc. — not just the source recordings.
      // Depth 6 matches the cloud-ops helper used elsewhere on this
      // page; recordings rarely nest deeper than that.
      window.api.listFilesRecursive(target.folderPath, 6)
        .then(entries => setFilesInFolder(
          entries.filter(e => !e.isDirectory).map(e => e.path)
        ))
        .catch(() => setFilesInFolder(target.videos))
    }
  }, [target.folderPath, target.date, isDumpMode, target.videos])

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      if (isDumpMode) {
        await window.api.deleteStreamFiles(target.folderPath, target.date)
      } else {
        await window.api.deleteStreamFolder(target.folderPath)
      }
    } catch (err: any) {
      setBusy(false)
      setError(`Local delete failed: ${err?.message ?? String(err)}`)
      return
    }
    if (alsoDeleteYt && linkedVideoId) {
      try {
        await window.api.youtubeDeleteVideo(linkedVideoId)
      } catch (err: any) {
        setBusy(false)
        setError(`Files moved to Recycle Bin, but deleting the YouTube video failed: ${err?.message ?? String(err)}`)
        // Still call success since the local part worked — parent refreshes
        // folders, but we leave the modal open so the YT error stays visible.
        return
      }
    }
    setBusy(false)
    onSuccess()
  }

  return (
    <Modal
      isOpen
      onClose={() => { if (!busy) onClose() }}
      title={isDumpMode ? 'Move files to Recycle Bin?' : 'Move folder to Recycle Bin?'}
      width="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            {error ? 'Close' : 'Cancel'}
          </Button>
          {!error && (
            <Button variant="primary" size="sm" loading={busy} onClick={confirm}>
              {alsoDeleteYt && linkedVideoId ? 'Move to Recycle Bin & Delete from YouTube' : 'Move to Recycle Bin'}
            </Button>
          )}
        </>
      }
    >
      <p className="text-sm text-gray-300 mb-3">The following will be moved to the Recycle Bin:</p>
      <div className="bg-white/5 rounded-lg px-3 py-2.5 mb-3 font-mono text-sm text-gray-200 max-h-64 overflow-y-auto">
        {!isDumpMode && (
          <div className="text-gray-300 mb-1">📁 {target.folderName}/</div>
        )}
        {filesInFolder === null ? (
          <span className="text-gray-400 italic text-xs">Loading…</span>
        ) : filesInFolder.length === 0 ? (
          <span className="text-gray-400 italic text-xs">{isDumpMode ? 'No files found for this date.' : '(empty)'}</span>
        ) : (
          filesInFolder.map(f => {
            // Show paths relative to the folder root so subfolders are
            // visible (e.g. "thumbnails/thumb.png" instead of just
            // "thumb.png"). For dump-mode paths that aren't under the
            // folder root, fall back to the basename.
            let display = f
            if (display.startsWith(target.folderPath)) {
              display = display.slice(target.folderPath.length).replace(/^[\\/]+/, '')
            } else if (!display.includes('/') && !display.includes('\\')) {
              // Already a bare name (e.g. listFilesForDate output)
            } else {
              display = display.split(/[\\/]/).pop() ?? display
            }
            // Normalize to forward slashes for readability.
            display = display.replace(/\\/g, '/')
            return (
              <div key={f} className="flex items-center gap-1.5 text-gray-400 py-px">
                <span className="shrink-0 text-gray-400">·</span>
                <span className="truncate" title={f}>{display}</span>
              </div>
            )
          })
        )}
      </div>
      <p className="text-xs text-gray-400 mb-3">This action can be undone from the Recycle Bin.</p>

      {linkedVideoId && (
        <div className="border-t border-white/10 pt-3 flex flex-col gap-2">
          <Checkbox
            checked={alsoDeleteYt}
            onChange={setAlsoDeleteYt}
            disabled={busy}
            size="sm"
            label={
              <div>
                <div className="text-sm font-medium text-gray-200">Also delete the linked YouTube video</div>
                <div className="text-xs text-gray-400 font-mono break-all">{linkedVideoId}</div>
              </div>
            }
          />
          {alsoDeleteYt && (
            <div className="flex items-start gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300 leading-relaxed">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>YouTube does not have a Recycle Bin — deleting the video here is <strong>permanent</strong> and cannot be undone, even from YouTube Studio.</span>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300 leading-relaxed">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </Modal>
  )
}

/**
 * NewStreamModal — date-first new-stream flow.
 *
 * Eager folder creation: the user picks a date, the folder is created
 * immediately (folder-per-stream mode) or the meta key is allocated
 * (dump-folder mode), and the sidebar opens on the new row so all the
 * editable fields are right there. This replaces the metamodal's
 * everything-at-once form; the user fills in title/games/etc. inline as
 * a normal selected stream.
 *
 * Date defaults to today's local date in YYYY-MM-DD form.
 */
function NewStreamModal({
  existingDates,
  onClose,
  onCreated,
  streamsDir,
  streamMode,
  source,
  folders,
}: {
  existingDates: string[]
  onClose: () => void
  onCreated: (newFolderPath: string) => Promise<void> | void
  streamsDir: string
  streamMode: 'folder-per-stream' | 'dump-folder'
  /** When set, the modal acts as "New episode": the new folder inherits
   *  the source's series-relevant meta (games, season, tags, sync flags,
   *  title-template binding) and the episode number auto-increments via
   *  detectEpisodeNumber. The source's folderPath also gets passed to
   *  createStreamFolder as `prevEpisodeFolderPath`, which triggers the
   *  IPC's thumbnail-file copy. */
  source?: StreamFolder
  /** Used only in New Episode mode to compute the next episode number. */
  folders?: StreamFolder[]
}) {
  const isNewEpisode = !!source
  const todayStr = (() => {
    const d = new Date()
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  })()
  const [date, setDate] = useState(todayStr)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dateExists = existingDates.includes(date)

  // Build the inherited meta when the source is set. Built fresh per
  // call so the computed ytEpisode reflects the date the user just
  // picked (the next-available number depends on how many siblings
  // already exist strictly before this date).
  const buildInheritedMeta = (): StreamMeta => {
    const base: StreamMeta = { date, streamType: [], games: [], comments: '' }
    if (!source) return base

    const m = source.meta ?? ({} as StreamMeta)
    const games = m.games?.length ? m.games : source.detectedGames
    const streamTypes = normalizeStreamTypes(m.streamType)
    const season = m.ytSeason || '1'
    const game = m.ytGameTitle?.trim() || games?.[0] || ''

    // Compute next episode using detectEpisodeNumber. Exclude the source
    // folder itself from the pool when needed — detectEpisodeNumber
    // already only counts strictly-before by date, so as long as the
    // new date is on/after the source's date this works correctly.
    const allFolders = folders ?? []
    const ytEpisode = game ? String(detectEpisodeNumber(allFolders, game, season, date)) : ''

    const meta: StreamMeta = {
      date,
      streamType: streamTypes,
      games: games ?? [],
      comments: '',  // notes start fresh per episode
      ytSeason: season,
      ytEpisode,
    }
    // Only attach optional fields when the source actually has them, so
    // we don't write a bunch of '' / undefined keys for nothing.
    if (m.ytGameTitle) meta.ytGameTitle = m.ytGameTitle
    if (m.ytTags?.length) meta.ytTags = m.ytTags
    if (m.ytTitleTemplateId) meta.ytTitleTemplateId = m.ytTitleTemplateId
    if (m.twitchTags?.length) meta.twitchTags = m.twitchTags
    if (m.syncTitle !== undefined) meta.syncTitle = m.syncTitle
    if (m.syncGame !== undefined) meta.syncGame = m.syncGame
    if (m.smThumbnail !== undefined) meta.smThumbnail = m.smThumbnail
    if (m.smThumbnailTemplate) meta.smThumbnailTemplate = m.smThumbnailTemplate
    return meta
  }

  const create = async () => {
    if (!date || busy) return
    setBusy(true)
    setError(null)
    try {
      const newFolderPath = await window.api.createStreamFolder(
        streamsDir,
        date,
        buildInheritedMeta(),
        undefined,
        source?.folderPath,
        streamMode,
      )
      await onCreated(newFolderPath)
    } catch (err: any) {
      setBusy(false)
      setError(err?.message ?? String(err))
    }
  }

  return (
    <Modal
      isOpen
      onClose={() => { if (!busy) onClose() }}
      title={isNewEpisode ? 'New episode' : 'New stream'}
      width="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" loading={busy} disabled={!date || dateExists} onClick={create}>
            Create
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {isNewEpisode && source ? (
          <p className="text-xs text-gray-400">
            Creating a new episode based on <span className="font-mono text-gray-300">{source.date}</span>
            {source.meta?.ytTitle?.trim() && <> — <span className="text-gray-300">{source.meta.ytTitle}</span></>}.
            Games, season, tags, and thumbnail files will be carried over.
          </p>
        ) : (
          <p className="text-xs text-gray-400">
            Pick the stream's date. You'll fill in the title, games, and any other details from the sidebar once it's open.
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-400">Date</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            disabled={busy}
            className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500/40 [color-scheme:dark]"
          />
        </div>
        {dateExists && (
          <p className="text-xs text-amber-400 flex items-start gap-1.5">
            <AlertTriangle size={11} className="shrink-0 mt-0.5" />
            A stream already exists for {date}. Open that one instead, or pick a different date.
          </p>
        )}
        {error && (
          <div className="flex items-start gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300 leading-relaxed">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Modal>
  )
}
