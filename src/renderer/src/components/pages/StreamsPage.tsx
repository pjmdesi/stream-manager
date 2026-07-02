import { Fragment, memo, useState, useEffect, useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { useAdaptivePoll } from '../../hooks/useAdaptivePoll'
import ReactDOM from 'react-dom'
import { useAnimationConfig } from '../../hooks/useAnimationConfig'
import {
  Radio, ChevronRight, ChevronLeft, ChevronUp, ChevronDown, ChevronsDown, ChevronsUp, X,
  Film, Zap, Combine, CopyPlus, Cloud, CloudDownload, FolderOpen, Archive, Trash2, PencilLine, Plus,
  Image as ImageIcon, AlertTriangle, Loader2, ImageOff, Unlink2, List, ListFilter, GripHorizontal, Clapperboard, Square, CheckCheck, Check, ListChecks, Scissors, Tags, SquareDashedText, RefreshCw, Settings as SettingsIcon, ListRestart, Eye,
} from 'lucide-react'
import { Youtube as LucideYoutube, Twitch as LucideTwitch } from '../ui/BrandIcons'
import { Tooltip } from '../ui/Tooltip'
import { TruncatedText } from '../ui/TruncatedText'
import { Button } from '../ui/Button'
import { CollapsibleLabel } from '../ui/CollapsibleLabel'
import { Checkbox } from '../ui/Checkbox'
import { TagComboBox } from '../ui/TagComboBox'
import { TopicSelect } from '../ui/TopicSelect'
import { Modal } from '../ui/Modal'
import { useStore } from '../../hooks/useStore'
import { useThumbnailEditor } from '../../context/ThumbnailEditorContext'
import { useCloudOps } from '../../context/CloudOpsContext'
import { useConversionJobs } from '../../context/ConversionContext'
import { useOpenItems, blockReasonText, type OpenSource } from '../../context/OpenItemsContext'
import { useInUse } from '../../hooks/useInUse'
import { useRelayPrompt } from '../../context/RelayPromptContext'
import { PresetPickerModal, VideoCountTooltip, BulkTagModal, SaveAsTemplateButton, Lightbox, PickerThumbImage, DisplayTagChip, CloudDownloadModal, ClampedComment } from '../streams/legacyStreamsShared'
import { pickColorForNewTag } from '../../constants/tagColors'
import { ManageTagsModal } from '../ui/ManageTagsModal'
import { TemplatesModal } from '../ui/TemplatesModal'
import { TagChipEditor } from '../ui/TagChipEditor'
import { DatePicker, type DateMark } from '../ui/DatePicker'
import { TemplateBodyEditor, MergeFieldPicker } from '../ui/TemplateBodyEditor'
import { TwitchCategoryRenamePrompt } from '../ui/TwitchCategoryRenamePrompt'
import { v4 as uuidv4 } from 'uuid'
import type { ConversionPreset, ConversionJob, LiveBroadcast } from '../../types'
import { BroadcastPicker, BroadcastLinkRef } from '../ui/BroadcastPicker'
import { Globe, Lock, Link as LinkIcon, Link2 } from 'lucide-react'
import { useFieldSuggestion } from '../../hooks/useFieldSuggestion'
import { getTagColor, getTagTextureStyle } from '../../constants/tagColors'
import { ThumbImage, friendlyDate } from '../streams/ThumbImage'
import { SendToConverterModal } from '../streams/SendToConverterModal'
import { isAnyModalOpen, isTypingTarget } from '../../lib/shortcuts'
import { StreamFilesGrid, type FilesGridHandle } from '../streams/StreamFilesGrid'
import { toTwitchCompatibleTags, TWITCH_TAG_MAX_COUNT } from '../../lib/twitchTags'
import { YT_TAG_CHAR_LIMIT } from '../../lib/ytTagCount'
import { renderStreamTitle } from '../../lib/streamTitle'
import { computeBroadcastMismatch, classifyMismatch, buildPullUpdate, outOfSyncSignature, type OutOfSyncItem } from '../../lib/broadcastMismatch'
import { OutOfSyncPanel } from '../streams/OutOfSyncPanel'
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

/** The stream item's "main" thumbnail (what a YT push uploads): preferred
 *  thumbnail basename → matching path → first thumbnail. Mirrors the sidebar's
 *  resolvedStreamItemThumb. */
function resolveStreamThumb(folder: StreamFolder): string | null {
  if (folder.thumbnails.length === 0) return null
  const preferredName = folder.meta?.preferredThumbnail
  if (preferredName) {
    const match = folder.thumbnails.find(p => (p.split(/[\\/]/).pop() ?? '') === preferredName)
    if (match) return match
  }
  return folder.thumbnails[0]
}

/** Tolerates the legacy single-string streamType from old meta files —
 *  same helper StreamsPage uses. Once the old page is gone we can centralise. */
function normalizeStreamTypes(v: string | string[] | undefined): string[] {
  if (!v) return []
  return Array.isArray(v) ? v : [v]
}

/** Single source of truth for "is this stream explicitly NOT part of a
 *  series." Drives the sidebar UI (hide season/episode inputs, disable
 *  series-nav + New Episode controls), the merge-field substitutions
 *  (`{season}`, `{episode}`, `{total_episodes}` resolve to '' for
 *  standalone), and every series-math helper (filter the candidate
 *  pool). Legacy `undefined` is intentionally NOT standalone — keeps
 *  existing thumbnails / saved files working as series like they did
 *  before this flag existed. */
function isStandalone(meta: StreamMeta | null | undefined): boolean {
  return meta?.isSeries === false
}

/** Effective "primary" topic/game for a stream — drives both the Twitch
 *  category push and the `{game}` merge field in YouTube title templates.
 *  Single source of truth so the sidebar's "selected chip" indicator, the
 *  push handlers, and the in-sync comparisons all agree on which entry
 *  is active. Resolution:
 *    1. `meta.primaryGame` if set AND still present in `games[]`.
 *    2. `games[0]` otherwise.
 *    3. `''` when neither is available.
 *  Returning `''` (not undefined) so callers can do `?? ''` without an
 *  extra branch — the empty case is functionally equivalent to "no game
 *  to push" in every consumer.
 */
function resolvePrimaryGame(meta: StreamMeta | null | undefined): string {
  const games = meta?.games ?? []
  if (meta?.primaryGame && games.includes(meta.primaryGame)) return meta.primaryGame
  return games[0] ?? ''
}

/** Twitch category for a stream. In "Pick Topic / Game tag" mode it's the
 *  chosen tag (`twitchGameName` when it's still one of the stream's topic
 *  tags) else the primary topic; in override mode (`syncGame === false`)
 *  it's the free-text `twitchGameName`. The pick is independent of the
 *  title's `{topic}`, so switching the live Twitch category never moves the
 *  YouTube/Twitch title. A stale free-text `twitchGameName` left on a stream
 *  in pick mode is ignored (not a current tag) so the push matches the
 *  dropdown, which shows the primary in that case. */
function resolveTwitchGame(meta: StreamMeta | null | undefined): string {
  const tag = meta?.twitchGameName?.trim() ?? ''
  if (meta?.syncGame === false) return tag
  return tag && (meta?.games ?? []).includes(tag) ? tag : resolvePrimaryGame(meta)
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

/** Known YouTube-title merge fields. The set of keys the title template
 *  engine resolves at render time — also drives the preview detector
 *  in the sidebar (the preview only surfaces when one of these tokens
 *  appears verbatim in the title field). */
const YT_TITLE_MERGE_KEYS = ['topic', 'topics', 'season', 'episode', 'tagline', 'title', 'total_episodes'] as const
/** Legacy aliases still resolved + rendered as chips (so templates authored
 *  before the topic/game rename keep working) but no longer offered in the
 *  merge-field picker. `{topic}`/`{topics}` are the canonical replacements. */
const YT_TITLE_LEGACY_KEYS = ['game', 'games'] as const
/** Every key the title engine recognizes — canonical picker keys plus legacy
 *  aliases. Drives chip rendering + the preview detector, NOT the picker. */
const YT_TITLE_KNOWN_KEYS = [...YT_TITLE_MERGE_KEYS, ...YT_TITLE_LEGACY_KEYS] as const

/** Platform title length limits, counted against the *resolved* title
 *  (merge fields substituted). YouTube truncates video titles past 100
 *  chars; Twitch caps stream titles at 140. Drives the character
 *  counter under each title field. */
const YT_TITLE_CHAR_LIMIT = 100
const YT_DESCRIPTION_CHAR_LIMIT = 5000
const TWITCH_TITLE_CHAR_LIMIT = 140

/** Build the merge-field map for a single stream — same shape the
 *  sidebar's mergeFields useMemo produces, but available outside the
 *  React tree so push handlers can resolve title bodies before
 *  sending to YouTube / Twitch. */
function buildYtTitleMergeFields(
  meta: StreamMeta | null | undefined,
  folder: StreamFolder,
  folders: StreamFolder[],
): Record<string, string> {
  const m = meta
  // `{game}` resolves directly from the Topics / Games tag selection —
  // primary tag first, then falls back to games[0] or folder-detected
  // games. The standalone ytGameTitle input was retired; legacy meta
  // values stay on disk but no longer feed merge resolution so the
  // Topic/Game tag is the single source of truth.
  const primaryGame = resolvePrimaryGame(m) || m?.games?.[0] || folder.detectedGames?.[0] || ''
  // Series-specific keys collapse to '' on standalone streams so
  // templates that reference them render cleanly.
  const standalone = isStandalone(m)
  const allTopics = (m?.games ?? []).join(' ')
  return {
    // `topic`/`topics` are canonical; `game`/`games` stay as aliases so
    // templates authored before the rename keep resolving.
    topic: primaryGame,
    topics: allTopics,
    game: primaryGame,
    games: allTopics,
    season: standalone ? '' : (m?.ytSeason ?? '1'),
    episode: standalone ? '' : (m?.ytEpisode ?? ''),
    tagline: m?.ytCatchyTitle ?? '',
    title: m?.ytCatchyTitle ?? '',
    total_episodes: standalone ? '' : String(detectTotalEpisodes(folders, primaryGame, m?.ytSeason || '1')),
  }
}

/** Resolve `meta.ytTitle` (a raw template body) against the stream's
 *  current merge fields. Returns the final string that should be
 *  pushed to YouTube + displayed in the broadcast picker etc. */
function resolveYtTitle(
  meta: StreamMeta | null | undefined,
  folder: StreamFolder,
  folders: StreamFolder[],
): string {
  return applyMergeFields(meta?.ytTitle ?? '', buildYtTitleMergeFields(meta, folder, folders))
}

/** Resolve `meta.twitchTitle` (a raw template body) against the same
 *  merge fields the YT title uses. Only meaningful when the user has
 *  unchecked "Same as YouTube title"; otherwise the YT-resolved title
 *  is used for Twitch too. */
function resolveTwitchTitle(
  meta: StreamMeta | null | undefined,
  folder: StreamFolder,
  folders: StreamFolder[],
): string {
  return applyMergeFields(meta?.twitchTitle ?? '', buildYtTitleMergeFields(meta, folder, folders))
}

/** True when the given text contains at least one known YT title merge
 *  field token. Used by the sidebar to decide whether to show the
 *  rendered preview underneath the title field. */
function hasYtTitleMergeFields(text: string): boolean {
  return YT_TITLE_KNOWN_KEYS.some(k => text.includes(`{${k}}`))
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
    !isStandalone(f.meta) &&
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
    !isStandalone(f.meta) &&
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
    !isStandalone(f.meta) &&
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

/** Group folders by date into the marker map the DatePicker popup uses
 *  for its stream dots (one dot per stream, archived ones ringed). */
function buildDateMarks(folders: StreamFolder[] | undefined): Map<string, DateMark[]> {
  const map = new Map<string, DateMark[]>()
  if (!folders) return map
  for (const f of folders) {
    if (!f.date || f.isMissing) continue
    const arr = map.get(f.date) ?? []
    arr.push({ archived: !!f.meta?.archived })
    map.set(f.date, arr)
  }
  return map
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
  pendingSelect,
}: {
  isVisible: boolean
  onSendToPlayer: (file: string) => void
  onSendToConverter: (files: string[], stream?: { folderPath: string; label: string }) => void
  onSendToCombine: (files: string[]) => void
  /** When the token bumps, select/open this folder's detail sidebar — used to
   *  navigate back from the converter's "from stream" link. */
  pendingSelect?: { folderPath: string; token: number } | null
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
  // When set, the "pick which videos to send to the converter" modal is open
  // for this folder (shown only for folders with more than one video).
  const [sendConverterFolder, setSendConverterFolder] = useState<StreamFolder | null>(null)
  // External navigation: when App bumps pendingSelect's token (e.g. the
  // converter's "from stream" link), open that folder's detail sidebar.
  const lastSelectTokenRef = useRef(0)
  useEffect(() => {
    if (!pendingSelect || pendingSelect.token === lastSelectTokenRef.current) return
    lastSelectTokenRef.current = pendingSelect.token
    setSelectedFolderPath(pendingSelect.folderPath)
  }, [pendingSelect])
  // Stream-type color/texture assignments live in electron-store; we load
  // them once on mount. Currently read-only here — the swatch picker UX
  // for editing them stays on the old page until phase 4. The keys are
  // also used as the source-of-truth list of "known" stream types when
  // suggesting in the combobox.
  const [tagColors, setTagColors] = useState<Record<string, string>>({})
  const [tagTextures, setTagTextures] = useState<Record<string, string>>({})
  // Game tag → YT tag template id. Managed in ManageTagsModal's Topics
  // tab; consumed by SidebarDetail's auto-apply effect to seed ytTags
  // when a stream gains its first game and YT tags are still empty.
  const [gameTagsLinks, setGameTagsLinks] = useState<Record<string, string>>({})
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
  // Cached YouTube video categories list (region-defaulted to 'US').
  // Fetched once on YT connect — the list rarely changes and a session-
  // long cache avoids reloading per sidebar mount. Only `assignable`
  // entries are kept; the dropdown filters those automatically.
  const [ytCategories, setYtCategories] = useState<{ id: string; title: string; assignable: boolean }[]>([])
  // YouTube API quota state. Sticky in the main process until midnight
  // Pacific Time, mirrored here so the renderer can surface a banner +
  // pause auto-refresh / disable push/pull. Initial value fetched on
  // mount; subsequent changes pushed via `onYouTubeQuotaChanged`.
  const [ytQuota, setYtQuota] = useState<{ exceeded: boolean; resetsAt: string | null }>({ exceeded: false, resetsAt: null })
  useEffect(() => {
    window.api.youtubeGetQuotaState?.().then(setYtQuota).catch(() => {})
    const unsubscribe = window.api.onYouTubeQuotaChanged?.(setYtQuota)
    return () => { unsubscribe?.() }
  }, [])
  // Broadcast picker data — loaded once when YT is connected. Upcoming
  // (scheduled) broadcasts are eager-loaded so the sidebar's picker is
  // instant. VODs (completed) load lazily on first dropdown open since
  // the list can be hundreds of items and we don't want to spend the
  // bandwidth on page mount.
  const [ytBroadcasts, setYtBroadcasts] = useState<LiveBroadcast[]>([])
  const [ytVods, setYtVods] = useState<LiveBroadcast[]>([])
  const [ytVodsLoaded, setYtVodsLoaded] = useState(false)
  const [ytBroadcastsLoading, setYtBroadcastsLoading] = useState(false)
  // Out-of-sync panel: remote snapshot per linked video id + check state +
  // current thumbnail hash per folder (for the thumbnail-needs-push field).
  const [outOfSyncRemote, setOutOfSyncRemote] = useState<Record<string, LiveBroadcast>>({})
  const [thumbHashById, setThumbHashById] = useState<Record<string, string | null>>({})
  const [outOfSyncLoading, setOutOfSyncLoading] = useState(false)
  const [outOfSyncCheckedAt, setOutOfSyncCheckedAt] = useState<number | null>(null)
  const [twConnected, setTwConnected] = useState(false)
  // Cached Twitch channel snapshot — the title / category / tags
  // currently set on the channel. Compared against local stream meta
  // to determine whether the Push to Twitch button has anything to
  // push. Fetched once when Twitch becomes connected and refreshed
  // optimistically after a successful push (so the button immediately
  // reflects the new in-sync state without a roundtrip).
  const [twitchChannel, setTwitchChannel] = useState<{ title: string; gameName: string; tags: string[] } | null>(null)
  // Sidebar feedback banners — an ARRAY now, not a single slot, so a
  // YouTube success message and a Twitch success message from the same
  // "Push to all" can coexist (each platform's handler appends its own
  // banner; both stack vertically in the sidebar until each times out).
  // Banners are tagged with the `folderPath` they were emitted from so
  // a banner from a push that completes after the user switches streams
  // doesn't surface on the new stream — only banners matching the
  // currently-selected folder render.
  // `action`, when supplied, renders a small inline button next to the
  // message that opens an external URL via `window.api.openUrl`. Plain
  // banners auto-dismiss after 4 s; banners with an action stay up for
  // 10 s so the user has time to notice + click. Either kind can be
  // clicked anywhere to dismiss early.
  type BannerShape = {
    id: string
    folderPath: string
    type: 'success' | 'error'
    message: string
    action?: { url: string; label: string }
  }
  const [banners, setBanners] = useState<BannerShape[]>([])
  const showBanner = useCallback((entry: Omit<BannerShape, 'id'>) => {
    const id = `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setBanners(prev => [...prev, { ...entry, id }])
    const delay = entry.action ? 10000 : 4000
    // No need to track this timeout for clearing — the filter is a
    // no-op if the entry has already been removed (manual dismiss /
    // stream change). React doesn't warn for setState in a fired
    // setTimeout as long as the component is still mounted.
    setTimeout(() => {
      setBanners(prev => prev.filter(b => b.id !== id))
    }, delay)
  }, [])
  const dismissBanner = useCallback((id: string) => {
    setBanners(prev => prev.filter(b => b.id !== id))
  }, [])
  // Banners belong to the stream they were emitted from — switching
  // streams (or closing the sidebar) drops all banners so the new
  // selection doesn't read a leftover notice from the previous item.
  useEffect(() => { setBanners([]) }, [selectedFolderPath])
  // Reschedule modal target — when set, the modal is rendered. Captures the
  // folder by path (not reference) so the modal survives a folders refresh.
  const [rescheduleTargetPath, setRescheduleTargetPath] = useState<string | null>(null)
  // Captured at click time from the sidebar's date dot — drives the
  // RescheduleModal's pull-mode / conflict-mode behaviour. Cleared
  // when the modal closes so a subsequent normal reschedule reverts
  // to edit mode.
  const [rescheduleDateDirection, setRescheduleDateDirection] = useState<'local' | 'remote' | 'both' | 'unknown' | undefined>(undefined)
  const [deleteTargetPath, setDeleteTargetPath] = useState<string | null>(null)
  // After-push rename prompt state. Set when a Twitch push's canonical
  // game name differs from what we sent — surfaces the
  // TwitchCategoryRenamePrompt modal. Gated against
  // `config.twitchSkipCategoryRenamePrompt` at the prop callback level
  // so a suppressed prompt is never even staged here.
  const [categoryRenamePrompt, setCategoryRenamePrompt] = useState<{ sent: string; canonical: string } | null>(null)
  const [newStreamOpen, setNewStreamOpen] = useState(false)
  // Cloud-download prompt for send-to-player when the chosen video is a cloud
  // placeholder. `stage` flips confirm → downloading; the file is sent on once
  // the cloud-download-done event fires for its path (effect below).
  const [cloudDownload, setCloudDownload] = useState<{
    filePath: string
    fileName: string
    action: 'player' | 'converter' | 'combine'
    stage: 'confirm' | 'downloading'
  } | null>(null)
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
  const searchInputRef = useRef<HTMLInputElement>(null)
  // Imperative handle to the open stream's files grid, so the keyboard handler
  // can drive its select mode (Ctrl+Shift+A) / select-all (Ctrl+A) when the
  // detail sidebar is open. Null when no sidebar / the stream has no files.
  const filesGridRef = useRef<FilesGridHandle | null>(null)
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
    window.api.getGameTagsLinks().then(setGameTagsLinks)
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
        // Categories list is static enough that one fetch per session
        // is sufficient. Failure is non-fatal — the sidebar just shows
        // an empty dropdown and the push falls back to passthrough.
        window.api.youtubeGetCategories()
          .then(setYtCategories)
          .catch(err => console.warn('Failed to load YouTube categories', err))
      }
    }).catch(() => {})
    window.api.twitchGetStatus?.().then(s => {
      setTwConnected(s.connected)
      // Prime the channel-info cache so the Push to Twitch button
      // can compare against actual Twitch state on first sidebar
      // open. Errors are non-fatal — the button just stays enabled
      // (which is the same behavior we had before the in-sync check).
      if (s.connected) {
        window.api.twitchGetChannel?.()
          .then(info => { if (info) setTwitchChannel(info) })
          .catch(() => {})
      }
    }).catch(() => {})
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
  const [ytVideoStatusMap, setYtVideoStatusMap] = useState<Record<string, { privacyStatus: string; isLivestream: boolean; uploadStatus?: string }>>({})
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
    // Only track liveness for streams that could actually be starting soon —
    // today or tomorrow (covers a late-night / just-past-midnight start and
    // back-to-back schedules) — so we never poll YouTube for broadcasts days
    // out. A far-future stream starts getting checked once it enters the window.
    const t = new Date(`${today}T00:00:00`)
    t.setDate(t.getDate() + 1)
    const tomorrow = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
    return folders
      .filter(f => isPendingStream(f, today) && !!f.meta?.ytVideoId && (f.date === today || f.date === tomorrow))
      .map(f => f.meta!.ytVideoId!)
      .sort()
      .join(',')
  }, [ytConnected, folders])
  // Clear the live map when there's nothing imminent to track.
  useEffect(() => { if (!upcomingLinkedBroadcastKey) setYtLiveMap({}) }, [upcomingLinkedBroadcastKey])
  // Adaptive cadence so idle/background tracking doesn't burn quota: 60s while
  // visible + interacting, 15m visible-but-idle, 1h minimized/tray. Re-fires
  // immediately on return or when the tracked-id set changes.
  useAdaptivePoll(() => {
    if (!upcomingLinkedBroadcastKey) return
    const ids = upcomingLinkedBroadcastKey.split(',')
    window.api.youtubeCheckBroadcastsAreLive(ids)
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
            // Spread the existing entry so a known uploadStatus (from the
            // linked-ids fetch / processing poll) survives this refresh.
            if (p) next[id] = { ...next[id], privacyStatus: p, isLivestream: true }
          }
          return next
        })
      })
      .catch(() => {})
  }, {
    activeMs: 60_000,
    idleMs: 15 * 60_000,
    hiddenMs: 60 * 60_000,
    idleAfterMs: 15 * 60_000,
    enabled: !!upcomingLinkedBroadcastKey,
    resetKey: upcomingLinkedBroadcastKey,
  })

  // Processing tracker: a just-ended stream's VOD isn't editable in YouTube
  // Studio until upload processing finishes (often minutes, occasionally a
  // day-plus). Poll only the small set still 'uploaded' — an old, settled
  // video is never mid-processing, so this set is naturally just-ended streams
  // — at a slow 10-min cadence, and stop the moment it empties. Initial status
  // is already free from the fetches above; this only flips the row spinner off
  // once processing completes. Quota: ~1 unit per poll while something cooks,
  // zero otherwise.
  const processingYtIdsKey = useMemo(() => (
    Object.entries(ytVideoStatusMap)
      .filter(([, s]) => s.uploadStatus === 'uploaded')
      .map(([id]) => id)
      .sort()
      .join(',')
  ), [ytVideoStatusMap])
  useEffect(() => {
    if (!ytConnected || !processingYtIdsKey) return
    const ids = processingYtIdsKey.split(',')
    const poll = () => window.api.youtubeGetVideoStatuses(ids)
      .then(updates => setYtVideoStatusMap(prev => ({ ...prev, ...updates })))
      .catch(() => {})
    // No immediate poll — the current status is already fresh from the
    // linked-ids fetch; just re-check every 10 minutes.
    const interval = setInterval(poll, 10 * 60 * 1000)
    return () => clearInterval(interval)
  }, [ytConnected, processingYtIdsKey])
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
  // Pending auto Twitch-update timer (see the delay in the lifecycle effect
  // below). Held in a ref so a new session starting within the window can
  // cancel a now-stale push to the previous "next" broadcast.
  const twitchUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { foldersRef.current = folders }, [folders])
  useEffect(() => { twConnectedRef.current = twConnected }, [twConnected])
  useEffect(() => { autoUpdateTwitchRef.current = config.autoUpdateTwitchAfterStream ?? 'ask' }, [config.autoUpdateTwitchAfterStream])
  useEffect(() => {
    // Delay before the auto ('always' mode) post-stream Twitch update fires.
    // Gives Twitch time to officially close the just-ended session before we
    // set the next broadcast's title/category — otherwise 3rd-party services
    // attribute the new info to the previous broadcast. Tunable.
    const TWITCH_AUTO_UPDATE_DELAY_MS = 60_000
    const off = window.api.onRelayLifecycle(async ev => {
      // Stale prompt cleanup — once the next session starts (or errors)
      // the previous "next upcoming" suggestion is no longer relevant.
      if (ev.stage === 'binding' || ev.stage === 'going-live' || ev.stage === 'live' || ev.stage === 'no-broadcast' || ev.stage === 'error') {
        setPostStreamTwitchSuggestion(null)
        // A new session supersedes any pending delayed auto-update aimed at
        // the previous "next" broadcast — cancel it.
        if (twitchUpdateTimerRef.current) { clearTimeout(twitchUpdateTimerRef.current); twitchUpdateTimerRef.current = null }
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
      // Both title fields store raw template bodies now — resolve each
      // through merge fields before treating it as a Twitch-pushable
      // string. When sync is on, the YT-resolved title stands in.
      const ytResolved = resolveYtTitle(m, next, foldersRef.current)
      const twResolved = resolveTwitchTitle(m, next, foldersRef.current)
      const title = syncTitle ? ytResolved : twResolved
      const game = resolveTwitchGame(m)
      // Twitch's PATCH /channels rejects an empty title — skip silently.
      if (!title.trim()) return
      const { compat: tags } = toTwitchCompatibleTags(m.twitchTags ?? [])
      const payload = { title, game: game || undefined, tags }
      const mode = autoUpdateTwitchRef.current
      if (mode === 'always') {
        // Delay the push (see TWITCH_AUTO_UPDATE_DELAY_MS) so Twitch finishes
        // closing the just-ended session first. Replace any still-pending
        // timer so the latest completion wins. ('ask' mode is naturally
        // user-paced, so it fires the prompt immediately.)
        if (twitchUpdateTimerRef.current) clearTimeout(twitchUpdateTimerRef.current)
        twitchUpdateTimerRef.current = setTimeout(async () => {
          twitchUpdateTimerRef.current = null
          try {
            await window.api.twitchUpdateChannel(payload.title, payload.game, payload.tags)
          } catch (e) {
            console.warn('[auto-update Twitch] push failed:', e)
          }
        }, TWITCH_AUTO_UPDATE_DELAY_MS)
      } else if (mode === 'ask') {
        setPostStreamTwitchSuggestion({
          folderPath: next.folderPath,
          displayTitle: title,
          payload,
        })
      }
      // mode === 'never' — skip silently.
    })
    return () => {
      off()
      if (twitchUpdateTimerRef.current) { clearTimeout(twitchUpdateTimerRef.current); twitchUpdateTimerRef.current = null }
    }
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
      const title = renderStreamTitle(f, folders)
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
  // Combined in-use check (converter + open in player/thumbnail) for disabling
  // the stream's Delete button while anything inside it is in use.
  const { streamReason } = useInUse()
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
    // Update in-memory state FIRST so two concurrent calls land in the
    // order they were invoked, not the order their disk writes finish.
    // Otherwise a slower earlier write can stomp a faster later write:
    // e.g., the description field's autosave-on-blur starts its IPC,
    // then the user clicks Pull-from-YouTube which fires its own write;
    // if Pull's IPC resolves first the user sees the pulled values
    // briefly, then the slower blur write completes and reverts them.
    setFolders(prev => prev.map(f =>
      f.folderPath === folderPath
        ? { ...f, meta: { ...(f.meta ?? {} as StreamMeta), ...partial }, hasMeta: true }
        : f
    ))
    await window.api.updateStreamMeta(folder.folderPath, partial, key)
  }, [folders, streamsDir])

  // ── Action handlers ──────────────────────────────────────────────────────
  // Simplified vs StreamsPage: no cloud-download confirmation, no multi-video
  // picker. Picks the first 'full' video (or first available) and sends it
  // straight to the target page. Adequate for typical folders; a polish phase
  // can layer the cloud/picker affordances in once we know which actually
  // matter for the new sidebar UX.
  // Prefer a 'full' recording over exported clips/shorts so sending a stream
  // lands on the source recording; fall back to the first of the given list.
  const pickPrimaryFrom = (folder: StreamFolder, videos: string[]): string | null => {
    if (videos.length === 0) return null
    const map = folder.meta?.videoMap
    const firstFull = videos.find(v => map?.[v.split(/[\\/]/).pop() ?? v]?.category === 'full')
    return firstFull ?? videos[0]
  }
  const pickPrimaryVideo = (folder: StreamFolder): string | null =>
    pickPrimaryFrom(folder, folder.videos)

  // Folder whose hydration check is in flight, so its Send-to-Player button can
  // show a spinner. The checkLocalFiles call below can take a moment for a
  // folder with many offloaded files, and there'd otherwise be no feedback.
  const [sendingPlayerPath, setSendingPlayerPath] = useState<string | null>(null)
  const handleSendToPlayer = useCallback(async (folder: StreamFolder) => {
    if (folder.videos.length === 0) return
    // Only send a file that's actually present on disk. If the whole folder is
    // offloaded to the cloud, prompt to download the first video and hand it to
    // the player once it's local (handled by the cloud-download-done effect).
    setSendingPlayerPath(folder.folderPath)
    try {
      const localFlags = await window.api.checkLocalFiles(folder.videos)
      const localVideos = folder.videos.filter((_, i) => localFlags[i])
      if (localVideos.length === 0) {
        const filePath = folder.videos[0]
        setCloudDownload({ filePath, fileName: filePath.split(/[\\/]/).pop() ?? 'video file', action: 'player', stage: 'confirm' })
        return
      }
      const file = pickPrimaryFrom(folder, localVideos)
      if (file) onSendToPlayer(file)
    } finally {
      // Only clear if another send hasn't taken over in the meantime.
      setSendingPlayerPath(prev => (prev === folder.folderPath ? null : prev))
    }
  }, [onSendToPlayer])

  const handleSendToConverter = useCallback((folder: StreamFolder) => {
    // More than one video → let the user pick which file(s) to send. A single
    // video goes straight to the converter as before.
    if (folder.videos.length > 1) { setSendConverterFolder(folder); return }
    const file = pickPrimaryVideo(folder)
    if (file) onSendToConverter([file], { folderPath: folder.folderPath, label: renderStreamTitle(folder, folders) || folder.folderName })
  }, [onSendToConverter, folders])

  const handleSendToCombine = useCallback((folder: StreamFolder) => {
    if (folder.videos.length > 0) onSendToCombine(folder.videos)
  }, [onSendToCombine])

  // When a prompted cloud download finishes, route the now-local file to its
  // pending action and dismiss the modal. The pending download is read from a
  // ref (not the state updater) so the routing call — which navigates via a
  // parent setState — runs in this event callback rather than inside a render-
  // phase updater (which would warn "setState while rendering another
  // component").
  const cloudDownloadRef = useRef(cloudDownload)
  useEffect(() => { cloudDownloadRef.current = cloudDownload }, [cloudDownload])
  useEffect(() => {
    const unsub = window.api.onCloudDownloadDone((filePath: string) => {
      const pending = cloudDownloadRef.current
      if (!pending || pending.filePath !== filePath) return
      setCloudDownload(null)
      if (pending.action === 'player') onSendToPlayer(filePath)
      else if (pending.action === 'converter') onSendToConverter([filePath])
      else onSendToCombine([filePath])
    })
    return unsub
  }, [onSendToPlayer, onSendToConverter, onSendToCombine])

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

  const handleOpenThumbnails = useCallback((folder: StreamFolder, variantOrdinal?: number) => {
    openThumbnailEditor({
      folderPath: folder.folderPath,
      date: folder.date,
      title: renderStreamTitle(folder, folders),
      meta: folder.meta ?? undefined,
      totalEpisodes: (() => {
        if (isStandalone(folder.meta)) return 0
        const game = folder.meta?.games?.[0] ?? folder.detectedGames?.[0]
        if (!game) return 0
        const lower = game.toLowerCase()
        const season = folder.meta?.ytSeason ?? '1'
        return folders.filter(f =>
          !isStandalone(f.meta) &&
          f.meta?.games?.some(g => g.toLowerCase() === lower) &&
          (f.meta?.ytSeason ?? '1') === season
        ).length
      })(),
      variantOrdinal,
    })
  }, [folders, openThumbnailEditor])

  // Minimal push-to-YouTube. Tries the broadcast endpoint first (upcoming /
  // live), falls back to the video endpoint (completed VODs). Thumbnail
  // upload is best-effort and runs after the metadata commit so a thumbnail
  // failure doesn't roll back the title/description/tag push that already
  // succeeded. The old MetaModal has a much richer push pipeline (dirty
  // detection, broadcast picker integration, push-snapshot tracking) — those
  // will land alongside the inline broadcast picker in a later phase.
  const handlePushToYoutube = useCallback(async (
    folder: StreamFolder,
    customThumbPath?: string | null,
    newScheduledStartTime?: string,
  ) => {
    const meta = folder.meta
    if (!meta?.ytVideoId) {
      showBanner({ folderPath: folder.folderPath, type: 'error', message: 'No linked YouTube broadcast or video. Link one before pushing.' })
      return
    }
    // meta.ytTitle is the raw template BODY ("{game} [PART {episode}]")
    // — resolve to the final string before pushing so YouTube receives
    // the rendered title instead of the placeholder tokens.
    const title = resolveYtTitle(meta, folder, folders).trim()
    const description = meta.ytDescription ?? ''
    const tags = meta.ytTags ?? []
    // Effective category: user-set value takes priority; otherwise
    // pass through whatever YouTube already has. `undefined` (vs an
    // empty string) is the "don't touch" signal the IPC interprets to
    // preserve the existing value — we never want to clear a category.
    const categoryId = meta.ytCategoryId || undefined
    const privacy = meta.ytPrivacyStatus
    // Thumbnail to upload: caller's explicit pick (from the picker
    // section in the sidebar) overrides the implicit "use the stream
    // item's preferred thumbnail" fallback. `null` from the caller
    // means "I have nothing valid to upload" — skip the thumbnail
    // step entirely instead of falling back, otherwise the picker's
    // unchecked-but-empty state would silently push the item thumb.
    const thumbToUpload = customThumbPath === undefined ? meta.preferredThumbnail : customThumbPath
    try {
      const snippet: { title: string; description: string; scheduledStartTime?: string } = { title, description }
      if (newScheduledStartTime) snippet.scheduledStartTime = newScheduledStartTime
      try {
        await window.api.youtubeUpdateBroadcast(meta.ytVideoId, snippet, tags, categoryId)
      } catch {
        // VOD path — no scheduledStartTime to update on a past video; the
        // sidebar's mismatch check already gates the date diff on
        // !actualStartTime, so we won't reach here with a date change
        // intended. The videos.update endpoint is the right one for
        // past streams.
        await window.api.youtubeUpdateVideo(meta.ytVideoId, title, description, tags, categoryId)
      }
      // Privacy is a separate Status endpoint, not part of the snippet
      // update. Fire it after the snippet push so a snippet error
      // doesn't strand a privacy change without the rest of the fields
      // (and vice versa — if privacy fails the snippet has already
      // landed). Only call when the user has staged a value; falling
      // through avoids overwriting YouTube's default privacy on every
      // push.
      if (privacy) {
        try {
          await window.api.youtubeUpdateBroadcastStatus(meta.ytVideoId, privacy)
        } catch {
          // No liveBroadcast record — a regular video, or a re-upload that
          // replaced a deleted livestream — so the broadcast status endpoint
          // 404s "Live broadcast not found". Fall back to videos.update,
          // mirroring the snippet fallback above. (Without this the privacy
          // call throws and the thumbnail step below never runs.)
          await window.api.youtubeUpdateVideoStatus(meta.ytVideoId, privacy)
        }
      }
      if (thumbToUpload) {
        try { await window.api.youtubeUploadThumbnail(meta.ytVideoId, thumbToUpload) }
        catch (thumbErr: any) {
          showBanner({ folderPath: folder.folderPath, type: 'error', message: `Pushed metadata, but thumbnail upload failed: ${thumbErr?.message ?? String(thumbErr)}` })
          return
        }
        // Record the SHA-1 of the bytes we just pushed so the sidebar's
        // thumbnail-needs-push detection knows the file is now in sync.
        // If the hash IPC fails (file gone, race), skip silently — the
        // next compare will treat it as "needs push" again and the user
        // can re-trigger the push, no data lost.
        try {
          const newHash = await window.api.thumbnailHashFile(thumbToUpload)
          if (newHash) await updateMeta(folder.folderPath, { ytThumbnailPushedHash: newHash })
        } catch {}
      }
      // Refresh the local copy of this broadcast so the sidebar's
      // broadcastMismatch check re-evaluates against what's now on
      // YouTube — without this, a push of e.g. just a rescheduled date
      // succeeds remotely but the cached selectedBroadcast still has
      // the old scheduledStartTime, so the push button stays enabled
      // and looks like nothing happened.
      //
      // Try the /liveBroadcasts resource first — that's the only place
      // `scheduledStartTime` lives. `getVideoById` (which queries
      // /videos) doesn't carry that field and returns nothing useful
      // for an upcoming broadcast. Fall back to the video resource only
      // if the broadcast lookup yields nothing (e.g., the user manually
      // linked a video-id that was never a broadcast).
      try {
        const refreshed = (await window.api.youtubeGetBroadcastById(meta.ytVideoId))
          ?? (await window.api.youtubeGetVideoById(meta.ytVideoId))
        if (refreshed) {
          // YouTube's read-after-write can briefly return stale snippet
          // fields right after a successful update (notably tags + the
          // categoryId, but title/description aren't immune either).
          // Overlay everything we KNOW we just sent so the in-memory
          // cache reflects our intent immediately — without this, the
          // post-push mismatch check sometimes sees the stale value,
          // keeps the Push button enabled, and (worse) a follow-up
          // Pull would pull the stale data back over the user's
          // actual intent. categoryId is only overlaid when we sent
          // one — undefined means "preserve YouTube's existing
          // value," so the refreshed snippet's categoryId is correct.
          refreshed.snippet.title = title
          refreshed.snippet.description = description
          refreshed.snippet.tags = tags
          if (categoryId) refreshed.snippet.categoryId = categoryId
          if (privacy) refreshed.status.privacyStatus = privacy
          setYtBroadcasts(prev => prev.some(b => b.id === refreshed.id)
            ? prev.map(b => b.id === refreshed.id ? refreshed : b)
            : prev
          )
          setYtVods(prev => prev.some(v => v.id === refreshed.id)
            ? prev.map(v => v.id === refreshed.id ? refreshed : v)
            : prev
          )
          // Persist a "last sync" snapshot to meta so the direction-aware
          // mismatch dot can tell who edited what next time around: if
          // local diverges from this snapshot, the user edited in SM; if
          // remote diverges, they edited in Studio. Stored verbatim
          // (no normalization) — comparison applies the same trim /
          // whitespace / tag-sort logic as the local-vs-remote check.
          // categoryId is only snapshotted when we actually pushed one;
          // undefined means YouTube's value was preserved untouched, so
          // there's no "we sent this" point to record.
          const snapshot: Partial<StreamMeta> = {
            ytLastPushedTitle: title,
            ytLastPushedDescription: description,
            ytLastPushedTags: tags,
            // Date snapshot tracks the folder.date at push time so the
            // direction-aware mismatch can later distinguish "Studio
            // moved the broadcast" from "the user reschedule'd locally
            // but hasn't pushed yet."
            ytLastPushedDate: folder.date,
          }
          if (categoryId) snapshot.ytLastPushedCategoryId = categoryId
          if (privacy) snapshot.ytLastPushedPrivacy = privacy
          // Time snapshot: when newScheduledStartTime was actually
          // computed (meaning either date or time was sent), capture
          // the time portion we sent. Falls back to undefined when we
          // didn't push a schedule change — that preserves whatever
          // was already in the snapshot rather than clobbering it
          // with a derived value.
          if (newScheduledStartTime) {
            const sent = new Date(newScheduledStartTime)
            if (!isNaN(sent.getTime())) {
              snapshot.ytLastPushedScheduledTime = `${String(sent.getHours()).padStart(2, '0')}:${String(sent.getMinutes()).padStart(2, '0')}`
            }
          }
          await updateMeta(folder.folderPath, snapshot)
        }
      } catch {
        // Refresh failure is non-fatal — the push already succeeded.
        // The next stream reload (manual or via the reload button) will
        // pick up the new server state.
      }
      // Category-specific Studio reminders. Some YouTube categories
      // unlock additional Studio fields that aren't writable via the
      // public Data API — Gaming's "Game" picker, Education's extra
      // detail fields. When the user pushes one of these categories,
      // surface a tap-able reminder pointing at Studio's edit page
      // (works for upcoming, live, and completed broadcasts). Keyed on
      // category id so adding another is one entry, not another branch.
      const STUDIO_REMINDER_FRAGMENTS: Record<string, string> = {
        '20': 'the Game',                 // Gaming
        '27': 'the education details',    // Education
      }
      const reminderFragment = categoryId ? STUDIO_REMINDER_FRAGMENTS[categoryId] : undefined
      if (reminderFragment) {
        showBanner({
          folderPath: folder.folderPath,
          type: 'success',
          message: `Pushed to YouTube. Don't forget to set ${reminderFragment} in Studio.`,
          action: {
            url: `https://studio.youtube.com/video/${meta.ytVideoId}/edit`,
            label: 'Open in Studio',
          },
        })
      } else {
        showBanner({ folderPath: folder.folderPath, type: 'success', message: 'Pushed to YouTube.' })
      }
    } catch (err: any) {
      showBanner({ folderPath: folder.folderPath, type: 'error', message: `YouTube push failed: ${err?.message ?? String(err)}` })
    }
  }, [showBanner, setYtBroadcasts, setYtVods, updateMeta, folders])

  // ── Out-of-sync panel (sidebar empty state) ───────────────────────────────
  // Compares every linked stream's local meta against YouTube and surfaces the
  // drift. Reads are cheap (batched videos.list, 1 unit / 50 ids + the already-
  // loaded broadcasts pool), so we re-check whenever the empty state is shown.
  const refreshOutOfSync = useCallback(async () => {
    if (!ytConnected) { setOutOfSyncRemote({}); return }
    const linkedIds = Array.from(new Set(
      folders.map(f => f.meta?.ytVideoId).filter((id): id is string => !!id)
    ))
    if (linkedIds.length === 0) { setOutOfSyncRemote({}); setOutOfSyncCheckedAt(Date.now()); return }
    setOutOfSyncLoading(true)
    try {
      // Prefer the already-loaded pools (broadcasts carry scheduledStartTime);
      // batch-fetch the rest (past videos / regular uploads) by id.
      const poolById = new Map<string, LiveBroadcast>()
      for (const b of ytBroadcasts) poolById.set(b.id, b)
      for (const v of ytVods) poolById.set(v.id, v)
      const missing = linkedIds.filter(id => !poolById.has(id))
      const fetched = missing.length > 0 ? await window.api.youtubeGetVideosByIds(missing) : []
      const fetchedById = new Map(fetched.map(b => [b.id, b]))
      const map: Record<string, LiveBroadcast> = {}
      for (const id of linkedIds) {
        const b = poolById.get(id) ?? fetchedById.get(id)
        if (b) map[id] = b
      }
      // Hash each linked stream's thumbnail (batched) so the panel can flag
      // "thumbnail changed since last push" — local-only, always a push.
      const linkedFolders = folders.filter(f => f.meta?.ytVideoId && map[f.meta.ytVideoId])
      const thumbPaths = Array.from(new Set(
        linkedFolders.map(resolveStreamThumb).filter((p): p is string => !!p)
      ))
      const hashByPath = thumbPaths.length > 0 ? await window.api.thumbnailHashFiles(thumbPaths) : {}
      const byFolder: Record<string, string | null> = {}
      for (const f of linkedFolders) {
        const p = resolveStreamThumb(f)
        byFolder[f.folderPath] = p ? (hashByPath[p] ?? null) : null
      }
      setOutOfSyncRemote(map)
      setThumbHashById(byFolder)
      setOutOfSyncCheckedAt(Date.now())
    } catch (e) {
      console.warn('Out-of-sync check failed', e)
    } finally {
      setOutOfSyncLoading(false)
    }
  }, [ytConnected, folders, ytBroadcasts, ytVods])
  // Ref to the latest checker so the auto-trigger doesn't depend on `folders`
  // (which would re-fetch on every optimistic meta write during a bulk resolve).
  const refreshOutOfSyncRef = useRef(refreshOutOfSync)
  useEffect(() => { refreshOutOfSyncRef.current = refreshOutOfSync })

  // Auto-check when the empty state is shown (page visible, no selection) and
  // YT is connected; also re-runs once when the broadcasts/VOD pools finish
  // loading (length transitions), so upcoming-broadcast schedule mismatches
  // are picked up. NOT keyed on `folders` to avoid churn during resolves.
  useEffect(() => {
    if (!isVisible || selectedFolderPath || !ytConnected) return
    // Wait for the folder list to finish loading — running while `folders` is
    // still empty would hit the no-linked-ids path and prematurely mark the
    // panel "checked" (showing the green in-sync state) before the real check.
    if (loading) return
    refreshOutOfSyncRef.current()
  }, [isVisible, selectedFolderPath, ytConnected, loading, folders.length, ytBroadcasts.length, ytVods.length])

  const outOfSyncItems = useMemo<OutOfSyncItem[]>(() => {
    const out: OutOfSyncItem[] = []
    for (const f of folders) {
      const id = f.meta?.ytVideoId
      if (!id) continue
      const remote = outOfSyncRemote[id]
      if (!remote) continue
      const mismatch = computeBroadcastMismatch(f, folders, remote)
      // Thumbnail-needs-push (local-only): current thumbnail bytes differ from
      // what was last pushed (ytThumbnailPushedHash). Surfaces even when no
      // metadata differs.
      const curThumbHash = thumbHashById[f.folderPath]
      const thumbNeedsPush = !!resolveStreamThumb(f) && curThumbHash != null && curThumbHash !== f.meta?.ytThumbnailPushedHash
      if (thumbNeedsPush) mismatch.set('thumbnail', 'local')
      if (mismatch.size === 0) continue
      const kind = classifyMismatch(mismatch)
      if (kind === 'none') continue
      const signature = outOfSyncSignature(f, folders, remote, { current: curThumbHash ?? null, pushed: f.meta?.ytThumbnailPushedHash })
      const ignored = !!f.meta?.ignoreOutOfSyncSig && f.meta.ignoreOutOfSyncSig === signature
      out.push({ folder: f, mismatch, kind, signature, ignored })
    }
    return out
  }, [folders, outOfSyncRemote, thumbHashById])

  const outOfSyncItemsRef = useRef(outOfSyncItems)
  useEffect(() => { outOfSyncItemsRef.current = outOfSyncItems })

  // Keep the selected folder's thumbnail hash live in the out-of-sync map as its
  // thumbnail changes (set-as-thumbnail from the media grid, editor save,
  // delete), so the empty-state panel / row dot reflect it immediately rather
  // than waiting for the next full re-check.
  const selectedResolvedThumb = useMemo(() => {
    if (!selectedFolderPath) return null
    const f = folders.find(ff => ff.folderPath === selectedFolderPath)
    return f ? resolveStreamThumb(f) : null
  }, [selectedFolderPath, folders])
  useEffect(() => {
    if (!selectedFolderPath) return
    const key = selectedFolderPath
    if (!selectedResolvedThumb) {
      setThumbHashById(prev => (prev[key] == null ? prev : { ...prev, [key]: null }))
      return
    }
    let cancelled = false
    window.api.thumbnailHashFile(selectedResolvedThumb)
      .then(h => { if (!cancelled) setThumbHashById(prev => (prev[key] === h ? prev : { ...prev, [key]: h })) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selectedFolderPath, selectedResolvedThumb, thumbsKey])

  const handleBulkResolve = useCallback(async (kind: 'push' | 'pull', targets: StreamFolder[]) => {
    for (const f of targets) {
      try {
        if (kind === 'push') {
          // Upload the thumbnail only when it's part of this stream's
          // divergence (pass the resolved path); otherwise skip it (null) so we
          // don't burn 50 units re-uploading an unchanged thumbnail.
          const item = outOfSyncItemsRef.current.find(i => i.folder.folderPath === f.folderPath)
          const thumbPath = item?.mismatch.has('thumbnail') ? resolveStreamThumb(f) : null
          await handlePushToYoutube(f, thumbPath)
        } else {
          const id = f.meta?.ytVideoId
          const remote = id ? outOfSyncRemote[id] : undefined
          if (remote) await updateMeta(f.folderPath, buildPullUpdate(remote))
        }
      } catch (e) {
        console.warn('Bulk resolve failed for', f.folderPath, e)
      }
    }
    await refreshOutOfSyncRef.current()
  }, [handlePushToYoutube, updateMeta, outOfSyncRemote])

  // Ignore = snapshot the current divergence fingerprint into meta; the item
  // stays hidden only while that signature still matches (any local/remote
  // change re-surfaces it). Un-ignore clears it.
  const handleIgnoreOutOfSync = useCallback(async (targets: StreamFolder[]) => {
    for (const f of targets) {
      const item = outOfSyncItemsRef.current.find(i => i.folder.folderPath === f.folderPath)
      if (!item) continue
      await updateMeta(f.folderPath, { ignoreOutOfSyncSig: item.signature, ignoreOutOfSyncAt: Date.now() })
    }
    await refreshOutOfSyncRef.current()
  }, [updateMeta])
  const handleUnignoreOutOfSync = useCallback(async (targets: StreamFolder[]) => {
    for (const f of targets) {
      await updateMeta(f.folderPath, { ignoreOutOfSyncSig: undefined, ignoreOutOfSyncAt: undefined })
    }
    await refreshOutOfSyncRef.current()
  }, [updateMeta])

  // Push to Twitch. Honours syncTitle/syncGame: when sync is on (or
  // undefined), the YouTube title/game stand in for the Twitch fields. Tags
  // get sanitised through toTwitchCompatibleTags so anything that violates
  // Twitch's alphanumeric/≤25-char rule is silently dropped (matching the
  // sidebar's validation hint).
  const handlePushToTwitch = useCallback(async (folder: StreamFolder) => {
    const meta = folder.meta
    if (!meta) {
      showBanner({ folderPath: folder.folderPath, type: 'error', message: 'No metadata to push.' })
      throw new Error('No metadata to push.')
    }
    const syncTitle = meta.syncTitle !== false
    // Both title fields store raw template bodies — resolve through
    // merge fields so Twitch receives the rendered string. When sync
    // is on the YT-resolved title stands in; when off the dedicated
    // Twitch body is resolved instead.
    const effectiveTitle = syncTitle ? resolveYtTitle(meta, folder, folders) : resolveTwitchTitle(meta, folder, folders)
    const effectiveGame = resolveTwitchGame(meta)
    const { compat: twitchSendTags } = toTwitchCompatibleTags(meta.twitchTags ?? [])
    try {
      await window.api.twitchUpdateChannel(effectiveTitle, effectiveGame || undefined, twitchSendTags)
      showBanner({ folderPath: folder.folderPath, type: 'success', message: 'Pushed to Twitch.' })
    } catch (err: any) {
      showBanner({ folderPath: folder.folderPath, type: 'error', message: `Twitch push failed: ${err?.message ?? String(err)}` })
      // Re-throw so the sidebar's wrapper handler can skip the
      // post-push refetch + last-pushed snapshot. Without this the
      // snapshot would record values that never made it to Twitch,
      // causing the in-sync check to lie afterwards. The banner is
      // already on screen — callers don't need to surface it again.
      throw err
    }
  }, [showBanner, folders])

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
    // Start the main-process chokidar watcher on the streams root —
    // a single recursive watcher (depth 6 in folder-per-stream mode,
    // depth 0 in dump mode) is cheaper than per-folder watchers and
    // matches what the legacy page did. Without this, streams:changed
    // never fires for file-system events (only for explicit
    // webContents.send calls like thumbnail saves), so the per-row
    // video count, thumbnail list, etc. go stale until something else
    // (a reschedule, a thumbnail save, etc.) accidentally pushes the
    // event manually.
    void window.api.watchStreamsDir(streamsDir, streamMode as 'folder-per-stream' | 'dump-folder')
    // Debounced: streams:changed can arrive in a burst (a delete touches several
    // files, saves fire their own, etc.), and each reload is a full listStreams +
    // thumbnail classification plus a thumbsKey bump (the visible flash). Coalesce
    // them so one logical change is one reload. Deletes THIS page performed are
    // skipped entirely (selfDeleteUntilRef): the grid was already updated in
    // place, so the chokidar unlink echo and the refreshVideoMaps follow-up
    // event would only re-list + re-flash for state we already have.
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = window.api.onStreamsChanged(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (Date.now() < selfDeleteUntilRef.current) return
        loadFolders()
        setThumbsKey(Date.now())
      }, 400)
    })
    return () => {
      if (timer) clearTimeout(timer)
      off()
      void window.api.unwatchStreamsDir()
    }
  }, [streamsDir, streamMode, loadFolders])

  // Timestamp until which this page's streams:changed listener stands down.
  // Set whenever the page itself deletes files: the grid is updated
  // optimistically in place, so the filesystem echoes of our own delete (the
  // chokidar unlink + the refreshVideoMaps follow-up event) must not trigger
  // full reloads — each one is a listStreams + thumbnail classification and a
  // visible flash of every thumbnail on the page.
  const selfDeleteUntilRef = useRef(0)

  // SM-initiated file deletion (files grid single/bulk trash): remove the
  // paths from folder state in place — no reload, no flash. The next natural
  // listStreams (page events after the stand-down window) reconciles meta.
  const handleFilesDeleted = useCallback((paths: string[]) => {
    if (paths.length === 0) return
    selfDeleteUntilRef.current = Date.now() + 5000
    const gone = new Set(paths.map(p => p.replace(/\\/g, '/')))
    const has = (p: string): boolean => gone.has(p.replace(/\\/g, '/'))
    setFolders(prev => prev.map(f => {
      if (!f.videos.some(has) && !f.thumbnails.some(has)) return f
      const videos = f.videos.filter(p => !has(p))
      // Keep thumbnailLocalFlags index-aligned with thumbnails.
      const keptThumbs = f.thumbnails.map((p, i) => [p, i] as const).filter(([p]) => !has(p))
      // Prune the deleted files from videoMap too — the row's Film/Scissors
      // counts are category tallies over videoMap, not videos.length, so a
      // stale entry would keep the old counts until the next full reload.
      // videoMap keys are folder-relative forward-slash paths (basename for
      // top-level files), so compute each deleted path's key the same way.
      let meta = f.meta
      if (meta?.videoMap) {
        const dirNorm = f.folderPath.replace(/\\/g, '/').replace(/\/$/, '')
        const relKey = (absPath: string): string => {
          const p = absPath.replace(/\\/g, '/')
          return p.startsWith(dirNorm + '/') ? p.slice(dirNorm.length + 1) : p.split('/').pop() ?? p
        }
        const goneKeys = new Set([...gone].filter(p => p.startsWith(dirNorm + '/')).map(relKey))
        if (Object.keys(meta.videoMap).some(k => goneKeys.has(k))) {
          const videoMap = Object.fromEntries(Object.entries(meta.videoMap).filter(([k]) => !goneKeys.has(k)))
          meta = { ...meta, videoMap }
        }
      }
      return {
        ...f,
        meta,
        videos,
        videoCount: videos.length,
        thumbnails: keptThumbs.map(([p]) => p),
        thumbnailLocalFlags: f.thumbnailLocalFlags
          ? keptThumbs.map(([, i]) => f.thumbnailLocalFlags![i])
          : f.thumbnailLocalFlags,
      }
    }))
  }, [])

  // Trash a single thumbnail file + refresh. If the deleted file was
  // the preferred thumbnail, also clear meta.preferredThumbnail so the
  // row's primary thumb falls back to whatever's next in the list.
  const handleDeleteThumbnail = useCallback(async (folder: StreamFolder, filePath: string) => {
    // Stand the streams:changed listener down for our own delete's echoes
    // (chokidar unlink, the preferredThumbnail meta write's explicit event) —
    // the optimistic update below is the whole UI change; no reload needed.
    selfDeleteUntilRef.current = Date.now() + 5000
    // Optimistically drop the slot from state BEFORE trashing the file, so the
    // carousel removes it in one clean step. Otherwise the deleted path stays
    // in the rendered thumbnails for the duration of the async reload and the
    // <img> flashes as a broken link before disappearing.
    setFolders(prev => prev.map(f => {
      if (f.folderPath !== folder.folderPath) return f
      const idx = f.thumbnails.indexOf(filePath)
      if (idx === -1) return f
      return {
        ...f,
        thumbnails: f.thumbnails.filter((_, i) => i !== idx),
        thumbnailLocalFlags: f.thumbnailLocalFlags?.filter((_, i) => i !== idx),
      }
    }))
    try {
      await window.api.trashFile(filePath)
      // SM-generated thumbnails carry a companion `<name>.json` holding the
      // editable canvas data. Trashing the PNG alone would orphan the JSON
      // (an editor entry whose image is gone), so remove both together —
      // mirroring the thumbnail editor's own variant delete.
      if (/[_-]sm-thumbnail(?:-\d+)?\.png$/i.test(filePath)) {
        await window.api.trashFile(filePath.replace(/\.png$/i, '.json')).catch(() => {})
      }
    } catch (err) {
      console.error('Failed to trash thumbnail', err)
      await loadFolders()  // restore the optimistically-removed slot
      return
    }
    const basename = filePath.split(/[\\/]/).pop() ?? ''
    if (folder.meta?.preferredThumbnail === basename) {
      await updateMeta(folder.folderPath, { preferredThumbnail: '' })
    }
    // No reload: the optimistic removal above already reflects the delete, and
    // the listener stand-down swallows our own echoes. Surviving slots keep
    // their cached thumb URLs (their files didn't change).
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
    // Resolved display title per folder — used for both search and the
    // title sort so users match/order by what they see, not the raw
    // `{game} … {tagline}` template body stored in meta.
    const titleByPath = new Map(folders.map(f => [f.folderPath, renderStreamTitle(f, folders)]))
    const matches = (f: StreamFolder) => {
      if (!q) return true
      const fields = [
        f.date,
        f.folderName,
        titleByPath.get(f.folderPath) ?? '',
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
        const at = (titleByPath.get(a.folderPath) || a.folderName).toLowerCase()
        const bt = (titleByPath.get(b.folderPath) || b.folderName).toLowerCase()
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
  // Tag-based bulk select (select mode only): plain click on a row's type or
  // game chip adds every visible row carrying that tag; ctrl/cmd-click removes
  // them. Operates over visibleFolders so it honors the active filters/search.
  const selectByTag = useCallback((matches: (f: StreamFolder) => boolean, additive: boolean) => {
    setSelectedPaths(prev => {
      const next = new Set(prev)
      for (const f of visibleFolders) {
        if (!matches(f)) continue
        if (additive) next.add(selectionKey(f)); else next.delete(selectionKey(f))
      }
      return next
    })
  }, [visibleFolders, selectionKey])
  const handleTagSelect = useCallback((kind: 'type' | 'game', value: string, additive: boolean) => {
    const matches = kind === 'type'
      ? (f: StreamFolder) => normalizeStreamTypes(f.meta?.streamType).includes(value)
      : (f: StreamFolder) => (f.meta?.games ?? []).includes(value)
    selectByTag(matches, additive)
  }, [selectByTag])

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
  // Bulk send-to-converter — queue every video from each selected stream. No
  // file picker (unlike the single-stream flow): it's a bulk tool, so assume all
  // videos and let the user drop any unwanted ones from the converter queue.
  const clickBulkSendToConverter = useCallback(() => {
    const allVideos = selectedFolderList.flatMap(f => f.videos)
    if (allVideos.length === 0) return
    onSendToConverter(allVideos)
    setSelectedPaths(new Set())
  }, [selectedFolderList, onSendToConverter])
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
  // Upsert by name (case-insensitive). When a template with the same
  // name already exists, its tags are replaced and the existing id is
  // kept so any meta still bound to it picks up the new value.
  const saveYtTagsTemplate = useCallback(async (name: string, tags: string[]): Promise<string> => {
    const lower = name.toLowerCase()
    const existing = ytTagTemplates.find(t => t.name.toLowerCase() === lower)
    const tpl = existing
      ? { ...existing, name, tags }
      : { id: crypto.randomUUID(), name, tags }
    const next = existing
      ? ytTagTemplates.map(t => t.id === existing.id ? tpl : t)
      : [...ytTagTemplates, tpl]
    setYtTagTemplates(next)
    await window.api.setYTTagTemplates(next)
    return tpl.id
  }, [ytTagTemplates])
  // Twitch templates store only the compat subset so reapplying them
  // doesn't silently drop tags that wouldn't push anyway (Twitch's
  // alphanumeric ≤25-char rule).
  const saveTwitchTagsTemplate = useCallback(async (name: string, tags: string[]): Promise<string> => {
    const { compat } = toTwitchCompatibleTags(tags)
    const lower = name.toLowerCase()
    const existing = twitchTagTemplates.find(t => t.name.toLowerCase() === lower)
    const tpl = existing
      ? { ...existing, name, tags: compat }
      : { id: crypto.randomUUID(), name, tags: compat }
    const next = existing
      ? twitchTagTemplates.map(t => t.id === existing.id ? tpl : t)
      : [...twitchTagTemplates, tpl]
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
    const empty = { prev: null as StreamFolder | null, next: null as StreamFolder | null, siblings: [] as StreamFolder[] }
    if (!selectedFolder) return empty
    // Standalone streams have no siblings concept — short-circuit so the
    // sidebar header renders its empty state (no prev/next arrows, no
    // picker, New Episode button disabled).
    if (isStandalone(selectedFolder.meta)) return empty
    const primaryGame = selectedFolder.meta?.games?.[0] ?? selectedFolder.detectedGames?.[0]
    if (!primaryGame) return empty
    // `|| '1'` (not `?? '1'`) so empty strings also collapse to the first
    // season — clearing the field via the input should still associate
    // with siblings that have season undefined OR ''.
    const season = selectedFolder.meta?.ytSeason || '1'
    const lowerGame = primaryGame.toLowerCase()
    const list = folders
      .filter(f =>
        !f.isMissing &&
        !isStandalone(f.meta) &&
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
      // Full episode list (same game + season as the selected stream),
      // sorted by episode number. Surfaced to the sidebar so the
      // jump-to-episode picker can list siblings beyond the immediate
      // prev/next pair.
      siblings: list,
    }
  }, [folders, selectedFolder])

  // ── Streams-page keyboard shortcuts ────────────────────────────────────────
  // Active only while the streams page is visible and no modal is open. Esc is
  // special-cased so it still clears the focused search box; everything else
  // stands down while the user is typing in a field.
  useEffect(() => {
    if (!isVisible) return
    const onKey = (e: KeyboardEvent) => {
      if (isAnyModalOpen()) return
      const mod = e.ctrlKey || e.metaKey

      // Esc — works even with the search box focused (to clear it).
      if (e.key === 'Escape' && !mod) {
        if (document.activeElement === searchInputRef.current) {
          if (searchQuery) setSearchQuery('')
          searchInputRef.current?.blur()
          return
        }
        if (isTypingTarget(e.target)) return
        if (selectMode) { toggleSelectMode(); return }
        if (selectedFolderPath) { setSelectedFolderPath(null); return }
        return
      }

      // Everything below stands down while typing in a field.
      if (isTypingTarget(e.target)) return

      // / → focus the search box
      if (!mod && e.key === '/') { e.preventDefault(); searchInputRef.current?.focus(); searchInputRef.current?.select(); return }

      if (!mod) return
      const k = e.key.toLowerCase()

      // Ctrl+Shift+A → toggle multi-select. When the detail sidebar's files grid
      // is mounted it drives that grid's select mode instead of the stream rows.
      if (e.shiftKey && k === 'a') {
        e.preventDefault()
        if (filesGridRef.current) filesGridRef.current.toggleSelectMode()
        else toggleSelectMode()
        return
      }
      // Ctrl+A → select all / clear. The files grid takes priority when it's in
      // select mode; otherwise the stream rows (when in row select mode).
      if (!e.shiftKey && k === 'a') {
        const grid = filesGridRef.current
        if (grid && grid.isSelectMode()) { e.preventDefault(); grid.selectAllOrClear(); return }
        if (!selectMode) return
        e.preventDefault()
        if (visibleFolders.length > 0 && selectedPaths.size === visibleFolders.length) clearSelection()
        else selectAllVisible()
        return
      }
      // Ctrl+N → new stream
      if (!e.shiftKey && k === 'n') { e.preventDefault(); setNewStreamOpen(true); return }
      // Ctrl+Shift+N → new episode for the open stream
      if (e.shiftKey && k === 'n') {
        if (selectedFolderPath) { e.preventDefault(); setNewEpisodeSourcePath(selectedFolderPath) }
        return
      }
      // Ctrl+Shift+T → open the thumbnail editor for the open stream
      if (e.shiftKey && k === 't') {
        const f = folders.find(ff => ff.folderPath === selectedFolderPath)
        if (f) { e.preventDefault(); handleOpenThumbnails(f) }
        return
      }
      // Ctrl+↑/↓ → navigate stream items. With nothing selected (or the
      // selection filtered out of view), both arrows select the first item and
      // open the detail sidebar.
      if (!e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (visibleFolders.length === 0) return
        e.preventDefault()
        const idx = selectedFolderPath ? visibleFolders.findIndex(f => f.folderPath === selectedFolderPath) : -1
        if (idx === -1) { setSelectedFolderPath(visibleFolders[0].folderPath); return }
        const next = e.key === 'ArrowDown' ? Math.min(visibleFolders.length - 1, idx + 1) : Math.max(0, idx - 1)
        if (next !== idx) setSelectedFolderPath(visibleFolders[next].folderPath)
        return
      }
      // Ctrl+Shift+↑/↓ → navigate episodes within the series, in the list's
      // visual (sort-order) direction so up/down matches what's on screen
      // rather than episode-number order. Hops over non-sibling rows.
      if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        if (!selectedFolderPath) return
        const sibPaths = new Set(seriesNav.siblings.map(s => s.folderPath))
        const visibleSiblings = visibleFolders.filter(f => sibPaths.has(f.folderPath))
        const idx = visibleSiblings.findIndex(f => f.folderPath === selectedFolderPath)
        if (idx === -1) return
        const nextIdx = e.key === 'ArrowDown' ? idx + 1 : idx - 1
        if (nextIdx < 0 || nextIdx >= visibleSiblings.length) return
        e.preventDefault()
        setSelectedFolderPath(visibleSiblings[nextIdx].folderPath)
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, searchQuery, selectMode, selectedPaths, visibleFolders, selectedFolderPath, folders, seriesNav, toggleSelectMode, selectAllVisible, clearSelection, handleOpenThumbnails])

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
  // Widths are computed from a CSS variable that tracks the outer
  // container's measured width, so the selected sidebar can exactly
  // fill from `rowWidth` to the right edge regardless of the page's
  // actual horizontal space.
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
  // ResizeObserver pushes the measured container width into a CSS
  // variable (`--sm-container-width`) on the outer element rather than
  // React state. This was previously a `setState` which caused a full
  // StreamsPage re-render every time the observer fired — and the
  // observer fires repeatedly during any width-changing animation
  // (collapse/expand the app's nav rail, drag the window edge, etc.),
  // which would hitch the nav animation as ~10 re-renders piled up over
  // its 200ms duration. With a CSS variable the browser handles the
  // width recompute natively, no React reconciliation involved.
  const containerObsRef = useRef<ResizeObserver | null>(null)
  const writeContainerWidth = (el: HTMLElement) => {
    el.style.setProperty('--sm-container-width', `${el.offsetWidth}px`)
  }
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    if (containerObsRef.current) {
      containerObsRef.current.disconnect()
      containerObsRef.current = null
    }
    if (!el) return
    writeContainerWidth(el)
    const obs = new ResizeObserver(() => { writeContainerWidth(el) })
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
  // The detail layer's width MUST equal the OUTER container's
  // `100% - rowWidth`, but the layer lives inside the aside where CSS
  // `100%` would refer to the aside (which animates open/closed). So
  // we pull the outer width in via the CSS variable set above. Falls
  // back to 0px (Math.max(0, …) equivalent — `0px - Npx` clamps to 0
  // for `width` per CSS spec) for the first frame before the observer
  // has measured. That's fine since the detail layer is opacity:0 and
  // pointer-events:none until a selection happens.
  const selectedSidebarWidthCss = `calc(var(--sm-container-width, 0px) - ${rowWidth}px)`

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
          {ytQuota.exceeded && ytQuota.resetsAt && (() => {
            // Format the reset moment in the user's local timezone — a
            // friendly "9:00 AM tomorrow" beats raw ISO. The Date
            // constructor handles ISO → local conversion automatically;
            // `Intl.DateTimeFormat` gives consistent formatting across
            // locales without dragging in a date library.
            const resetDate = new Date(ytQuota.resetsAt)
            const now = new Date()
            const sameDay = resetDate.toDateString() === now.toDateString()
            const timeStr = resetDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
            const dayStr = sameDay ? 'today' : 'tomorrow'
            return (
              <div className="flex items-start gap-2 text-[11px] bg-amber-500/10 border border-amber-500/30 text-amber-200 rounded-md px-3 py-2">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-medium">YouTube API quota exceeded</div>
                  <div className="text-amber-200/80 mt-0.5">
                    SM can't communicate with YouTube right now. Push, pull, and broadcast refresh are paused. Quota refreshes at <span className="font-medium">{timeStr} {dayStr}</span> (midnight Pacific Time).
                  </div>
                </div>
              </div>
            )
          })()}
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold flex items-center gap-2">
                Streams
                <Tooltip content={ytConnected
                  ? (ytQuota.exceeded
                    ? 'Reload streams from disk (YouTube refresh skipped — quota exceeded)'
                    : 'Reload streams from disk + bulk-refresh YouTube broadcasts')
                  : 'Reload streams from disk'}>
                  <button
                    type="button"
                    onClick={async () => {
                      // Local refresh always. YouTube bulk-refresh only
                      // when connected AND quota isn't blown — the
                      // request would just 403 and waste a slot in the
                      // (also exceeded) per-IP budget on top of the
                      // already-exceeded user quota.
                      await loadFolders()
                      if (ytConnected && !ytQuota.exceeded) {
                        try {
                          const fresh = await window.api.youtubeGetBroadcasts()
                          setYtBroadcasts(fresh)
                        } catch { /* non-fatal — the per-stream auto-refresh and next launch will catch up */ }
                      }
                    }}
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
              // Bulk-action toolbar — replaces the New Stream button while in
              // select mode. Bulk actions first, then a divider-grouped
              // selection-management pair, then exit:
              // Edit Tags / Convert / Offload / Pin Local / Archive | Select All / Clear | Stop.
              <div className="flex items-center justify-end gap-1 flex-wrap">
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
                <Tooltip content="Send every video from the selected streams to the converter" side="bottom">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Zap size={14} />}
                    onClick={clickBulkSendToConverter}
                    disabled={selectedPaths.size === 0}
                    collapsibleLabel="@2xl:grid-cols-[1fr] @2xl:ms-0"
                    labelCollapsed={selectedFolderPath ? true : undefined}
                  >
                    Convert
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
                {/* Selection-management + exit, grouped in a non-wrapping
                    container so all three wrap to a second row together (still
                    divider-delimited) once the toolbar runs out of width — the
                    bulk actions stay on the first row until labels collapse. */}
                <div className="flex items-center gap-1">
                  <div className="w-px h-5 bg-white/10 mx-1 self-center" />
                  <Tooltip content="Select all visible streams" side="bottom" shortcut="Ctrl+A">
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
                  <div className="w-px h-5 bg-white/10 mx-1 self-center" />
                  <Tooltip content="Exit selection mode" side="bottom">
                    <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={toggleSelectMode} collapsibleLabel="@2xl:grid-cols-[1fr] @2xl:ms-0"
                      labelCollapsed={selectedFolderPath ? true : undefined}>
                      Stop
                    </Button>
                  </Tooltip>
                </div>
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
                <Tooltip content="Select multiple streams for bulk actions" side="bottom" shortcut="Ctrl+Shift+A">
                  <Button variant="ghost" size="sm" icon={<ListChecks size={14} />} onClick={toggleSelectMode} collapsibleLabel="@2xl:grid-cols-[1fr] @2xl:ms-0"
                    labelCollapsed={selectedFolderPath ? true : undefined}>
                    Select
                  </Button>
                </Tooltip>
                <Tooltip content="Create a new stream" side="bottom" shortcut="Ctrl+N">
                  <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setNewStreamOpen(true)} collapsibleLabel="@2xl:grid-cols-[1fr] @2xl:ms-0"
                      labelCollapsed={selectedFolderPath ? true : undefined}>
                    New stream
                  </Button>
                </Tooltip>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search title, games, notes…  /"
                className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg pl-3 pr-8 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
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
            <Tooltip content="Sort">
            <select
              value={sortMode}
              onChange={e => setSortMode(e.target.value as typeof sortMode)}
              className="bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500/40 [color-scheme:dark]"
            >
              <option value="date-desc">Newest first</option>
              <option value="date-asc">Oldest first</option>
              <option value="title-asc">Title A–Z</option>
            </select>
            </Tooltip>
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
                    const isLiveNow = !!(ytId && ytLiveMap[ytId])
                    // Show the "processing" spinner only once a stream could
                    // actually have a VOD cooking: not live right now, and
                    // dated today-or-earlier (a future-dated broadcast's
                    // placeholder video can read 'uploaded' without anything
                    // to process).
                    const isProcessing = status?.uploadStatus === 'uploaded' && !isLiveNow && f.date <= today
                    const key = selectionKey(f)
                    return (
                      <StreamListItem
                        key={f.folderPath}
                        folder={f}
                        folders={folders}
                        selected={f.folderPath === selectedFolderPath}
                        animDurationMs={animDurationMs}
                        compact={false}
                        selectMode={selectMode}
                        multiSelected={selectedPaths.has(key)}
                        selectKey={key}
                        index={i}
                        onToggleMultiSelect={toggleSelected}
                        onDragStart={startDrag}
                        onDragEnter={updateDrag}
                        dragMovedRef={dragMoved}
                        cloudSyncActive={cloudSyncActive}
                        isPending={isPendingStream(f, today)}
                        isToday={f.date === today}
                        isNextUpcoming={f.folderPath === nextUpcomingFolderPath}
                        isLive={isLiveNow}
                        privacyStatus={status?.privacyStatus ?? null}
                        isLivestream={status?.isLivestream ?? null}
                        isProcessing={isProcessing}
                        onTagSelect={handleTagSelect}
                        sameDayIndex={sameDayIndexMap.get(f.folderPath)}
                        thumbsKey={thumbsKey}
                        thumbWidth={thumbWidth}
                        tagColors={tagColors}
                        tagTextures={tagTextures}
                        isSendingToPlayer={sendingPlayerPath === f.folderPath}
                        onClick={onRowClick}
                        onSendToPlayer={handleSendToPlayer}
                        onSendToConverter={handleSendToConverter}
                        onOpenThumbnails={handleOpenThumbnails}
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
        {/* Always-on left border. Sits above the detail layer (which has
            no explicit z-index) so it stays visible when a stream is
            selected. When no selection, the edge toggle's own indicator
            (z-20) renders on top at the same position with the same
            color — visually identical — and replaces this with the
            purple hover state. */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-px bg-white/5 z-10" />

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
            layer above just covers it during the open animation. `isolate`
            keeps the out-of-sync panel's sticky `z-10` header contained to
            this layer so it can't paint above the detail layer (Layer 2). */}
        <div
          className="absolute top-0 left-0 bottom-0 isolate"
          style={{ width: normalSidebarWidth }}
        >
          {sidebarCollapsedPref ? (
            <Tooltip content="Expand sidebar" side="left" triggerClassName="block h-full w-full">
            <button
              type="button"
              onClick={toggleSidebar}
              className="flex flex-col items-center justify-start pt-4 gap-2 h-full w-full text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
              aria-label="Expand sidebar"
            >
              <ChevronLeft size={16} />
              <span className="[writing-mode:vertical-rl] rotate-180 text-[10px] font-semibold uppercase tracking-wider text-gray-500 mt-2">Calendar</span>
            </button>
            </Tooltip>
          ) : (
            <div className="h-full flex flex-col">
              {/* Fixed-height calendar widget pinned to the top; the out-of-sync
                  panel below fills the remaining height and scrolls. */}
              <div className="h-[345px] shrink-0">
                <SidebarMonthCalendar
                  folders={folders}
                  onSelectStream={(f) => setSelectedFolderPath(f.folderPath)}
                />
              </div>
              {ytConnected && folders.some(f => f.meta?.ytVideoId) && (
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <OutOfSyncPanel
                    items={outOfSyncItems}
                    folders={folders}
                    thumbsKey={thumbsKey}
                    loading={outOfSyncLoading}
                    checkedAt={outOfSyncCheckedAt}
                    quotaExceeded={ytQuota.exceeded}
                    onRefresh={refreshOutOfSync}
                    onOpenStream={(f) => setSelectedFolderPath(f.folderPath)}
                    onResolve={handleBulkResolve}
                    onIgnore={handleIgnoreOutOfSync}
                    onUnignore={handleUnignoreOutOfSync}
                  />
                </div>
              )}
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
              width: selectedSidebarWidthCss,
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
              seriesEpisodes={seriesNav.siblings}
              onPickEpisode={(f) => setSelectedFolderPath(f.folderPath)}
              onClose={() => setSelectedFolderPath(null)}
              onUpdateMeta={partial => updateMeta(renderedFolder.folderPath, partial)}
              cloudSyncActive={cloudSyncActive}
              allGames={allGames}
              allStreamTypes={allStreamTypes}
              tagColors={tagColors}
              tagTextures={tagTextures}
              onNewStreamType={handleNewStreamType}
              onReschedule={dir => {
                setRescheduleTargetPath(renderedFolder.folderPath)
                setRescheduleDateDirection(dir)
              }}
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
              onSendFileToPlayer={(path) => onSendToPlayer(path)}
              onSendFileToConverter={(path) => onSendToConverter([path], {
                folderPath: renderedFolder.folderPath,
                label: renderStreamTitle(renderedFolder, folders) || renderedFolder.folderName,
              })}
              onSendFilesToConverter={(paths) => onSendToConverter(paths, {
                folderPath: renderedFolder.folderPath,
                label: renderStreamTitle(renderedFolder, folders) || renderedFolder.folderName,
              })}
              filesGridRef={filesGridRef}
              onFilesDeleted={handleFilesDeleted}
              onOpenFolder={() => handleOpenFolder(renderedFolder)}
              onOpenThumbnails={(variantOrdinal) => handleOpenThumbnails(renderedFolder, variantOrdinal)}
              onDelete={() => setDeleteTargetPath(renderedFolder.folderPath)}
              deleteBlockReason={streamReason(renderedFolder.folderPath, isDumpMode ? [...renderedFolder.videos, ...renderedFolder.thumbnails] : undefined)}
              onPushToYoutube={(customThumb, newScheduledStartTime) => handlePushToYoutube(renderedFolder, customThumb, newScheduledStartTime)}
              onPushToTwitch={() => handlePushToTwitch(renderedFolder)}
              // The two callbacks above already return the promise from
              // their inner handler call (no explicit return because the
              // arrow expression is the promise itself). Loading state in
              // SidebarDetail awaits these to drive the spinner.
              ytConnected={ytConnected}
              ytCategories={ytCategories}
              ytQuota={ytQuota}
              twConnected={twConnected}
              twitchChannel={twitchChannel}
              setTwitchChannel={setTwitchChannel}
              banners={banners.filter(b => b.folderPath === renderedFolder.folderPath)}
              onDismissBanner={dismissBanner}
              onMissingYtCategory={() => showBanner({
                folderPath: renderedFolder.folderPath,
                type: 'error',
                message: 'Pick a YouTube category before pushing — YouTube requires one on every video.',
              })}
              onSuggestCategoryRename={(sent, canonical) => {
                if (config.twitchSkipCategoryRenamePrompt) return
                setCategoryRenamePrompt({ sent, canonical })
              }}
              ytTitleTemplates={ytTitleTemplates}
              ytDescTemplates={ytDescTemplates}
              ytTagTemplates={ytTagTemplates}
              twitchTagTemplates={twitchTagTemplates}
              onSaveYtTitleTemplate={saveYtTitleTemplate}
              onSaveYtDescTemplate={saveYtDescTemplate}
              onSaveYtTagsTemplate={saveYtTagsTemplate}
              onSaveTwitchTagsTemplate={saveTwitchTagsTemplate}
              gameTagsLinks={gameTagsLinks}
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
            folders={folders}
            ytConnected={ytConnected}
            twConnected={twConnected}
            ytBroadcasts={ytBroadcasts}
            dateDirection={rescheduleDateDirection}
            onUpdateMeta={(folderPath, partial) => updateMeta(folderPath, partial)}
            onClose={() => { setRescheduleTargetPath(null); setRescheduleDateDirection(undefined) }}
            onSuccess={async (newFolderPath) => {
              setRescheduleTargetPath(null)
              setRescheduleDateDirection(undefined)
              // Refresh the folder list BEFORE re-selecting the renamed folder.
              // The renderedFolder fade timer keys on the *resolved* folder, so
              // selecting the new path first (while folders still holds the old
              // one) leaves selectedFolder undefined for the whole rescan. If
              // that outran the fade-hold timer (a full rescan easily does),
              // renderedFolder cleared and the empty-state calendar flashed
              // through before the new details mounted. Reloading first keeps
              // the old folder resolved until the new one exists.
              await loadFolders()
              // Bump thumbsKey so every <ThumbImage> URL invalidates alongside
              // the folder refresh. Without this, the chokidar-driven
              // streams:changed listener is the only thing that bumps it, and
              // its awaitWriteFinish + debounce window (~1.8s) is long enough
              // for the user to see stale thumbnail URLs after a rename —
              // especially bad in back-to-back reschedules that swap dates
              // between streams, where the renderer can briefly serve cached
              // bytes for paths that no longer exist.
              setThumbsKey(Date.now())
              setSelectedFolderPath(newFolderPath)
            }}
            onPushYoutube={async (newScheduledStartTime, privacy) => {
              // Find the linked broadcast (might have already shifted
              // in ytBroadcasts since the modal opened — recheck).
              const broadcastId = target.meta?.ytVideoId
              if (!broadcastId) throw new Error('No linked broadcast')
              const bc = ytBroadcasts.find(b => b.id === broadcastId)
              if (!bc) throw new Error('Linked broadcast not in cache')
              // Snippet update first — preserves existing title /
              // description / tags so the user's in-progress edits
              // don't get published. Only scheduledStartTime changes.
              await window.api.youtubeUpdateBroadcast(
                broadcastId,
                {
                  title: bc.snippet.title,
                  description: bc.snippet.description,
                  scheduledStartTime: newScheduledStartTime,
                },
                bc.snippet.tags ?? [],
              )
              // Privacy change is a separate API call. Skipping it
              // when the value didn't change spares a redundant
              // request but is harmless either way.
              if (privacy !== bc.status?.privacyStatus) {
                await window.api.youtubeUpdateBroadcastStatus(broadcastId, privacy)
              }
              // Refresh the cached broadcast so the sidebar's
              // mismatch detection sees the new scheduledStartTime +
              // privacy without waiting for a reload.
              try {
                const refreshed = await window.api.youtubeGetBroadcastById(broadcastId)
                if (refreshed) {
                  setYtBroadcasts(prev => prev.map(b => b.id === refreshed.id ? refreshed : b))
                }
              } catch {
                // Refresh failure is non-fatal — the writes themselves
                // succeeded. Next manual reload will pick up server
                // state.
              }
            }}
            onPushTwitch={() => handlePushToTwitch(target)}
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

      {sendConverterFolder && (
        <SendToConverterModal
          isOpen={!!sendConverterFolder}
          folder={sendConverterFolder}
          onClose={() => setSendConverterFolder(null)}
          onSend={paths => {
            onSendToConverter(paths, {
              folderPath: sendConverterFolder.folderPath,
              label: renderStreamTitle(sendConverterFolder, folders) || sendConverterFolder.folderName,
            })
            setSendConverterFolder(null)
          }}
        />
      )}

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
            ).then(() => {
              if (game in gameTagsLinks) {
                const next = { ...gameTagsLinks }
                delete next[game]
                setGameTagsLinks(next)
                window.api.setGameTagsLinks(next)
              }
              void loadFolders()
            })
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
            ).then(() => {
              // If any dying game had a link, hand it to the survivor
              // (unless the survivor already has one). Then drop the
              // dying entries.
              const dyingWithLinks = dying.filter(d => gameTagsLinks[d])
              if (dyingWithLinks.length) {
                const next = { ...gameTagsLinks }
                if (!next[survivor] && dyingWithLinks[0]) {
                  next[survivor] = gameTagsLinks[dyingWithLinks[0]]
                }
                for (const d of dying) delete next[d]
                setGameTagsLinks(next)
                window.api.setGameTagsLinks(next)
              }
              void loadFolders()
            })
          }}
          // Global rename of a stream type. Rewrites every folder whose
          // streamType array contains the old name, replacing it
          // positionally so the user's preferred ordering is preserved.
          // Then re-keys the color + texture maps so the chip styling
          // moves with the renamed tag. Mirrors the delete/combine
          // bulk-write pattern above.
          onRenameTag={(oldName, newName) => {
            const affected = folders.filter(f =>
              normalizeStreamTypes(f.meta?.streamType).includes(oldName)
            )
            Promise.all(
              affected.map(f =>
                window.api.writeStreamMeta(f.folderPath, {
                  ...(f.meta ?? { date: f.date, streamType: [], games: [], comments: '' }),
                  streamType: normalizeStreamTypes(f.meta?.streamType)
                    .map(t => t === oldName ? newName : t),
                }, f.relativePath)
              )
            ).then(() => {
              if (oldName in tagColors) {
                const updatedColors = { ...tagColors, [newName]: tagColors[oldName] }
                delete updatedColors[oldName]
                saveTagColors(updatedColors)
              }
              if (oldName in tagTextures) {
                const updatedTextures = { ...tagTextures, [newName]: tagTextures[oldName] }
                delete updatedTextures[oldName]
                saveTagTextures(updatedTextures)
              }
              void loadFolders()
            })
          }}
          // Global rename of a topic/game tag. Mirrors the rename
          // performed by the after-push category-rename prompt — touches
          // games[] plus the YouTube + Twitch sync fields and the
          // twitchLastPushed snapshot, so a stream that's been pushed
          // doesn't trip the snapshot's staleness guard after the
          // rename. Strict (case-sensitive) equality so case-only
          // renames don't accidentally rope in unrelated tags.
          onRenameGame={(oldName, newName) => {
            const affected = folders.filter(f => {
              const m = f.meta
              if (!m) return false
              return (m.games ?? []).includes(oldName)
                || m.ytGameTitle === oldName
                || m.twitchGameName === oldName
                || m.twitchLastPushedGame === oldName
                || m.primaryGame === oldName
            })
            Promise.all(
              affected.map(f => {
                const m = f.meta
                if (!m) return Promise.resolve()
                const next: StreamMeta = { ...m }
                if (m.games?.includes(oldName)) {
                  next.games = m.games.map(g => g === oldName ? newName : g)
                }
                if (m.ytGameTitle === oldName) next.ytGameTitle = newName
                if (m.twitchGameName === oldName) next.twitchGameName = newName
                if (m.twitchLastPushedGame === oldName) next.twitchLastPushedGame = newName
                if (m.primaryGame === oldName) next.primaryGame = newName
                return window.api.writeStreamMeta(f.folderPath, next, f.relativePath)
              })
            ).then(() => {
              if (oldName in gameTagsLinks) {
                const next = { ...gameTagsLinks, [newName]: gameTagsLinks[oldName] }
                delete next[oldName]
                setGameTagsLinks(next)
                window.api.setGameTagsLinks(next)
              }
              void loadFolders()
            })
          }}
          gameTagsLinks={gameTagsLinks}
          tagTemplates={ytTagTemplates.map(t => ({ id: t.id, name: t.name }))}
          onSetGameTagLink={(game, templateId) => {
            const next = { ...gameTagsLinks }
            if (templateId) next[game] = templateId
            else delete next[game]
            setGameTagsLinks(next)
            window.api.setGameTagsLinks(next)
          }}
          onClose={() => setShowManageTags(false)}
        />
      )}

      <TwitchCategoryRenamePrompt
        isOpen={categoryRenamePrompt !== null}
        sent={categoryRenamePrompt?.sent ?? ''}
        canonical={categoryRenamePrompt?.canonical ?? ''}
        onKeep={() => setCategoryRenamePrompt(null)}
        onDontAskAgain={() => {
          // Persist the suppression + close. Don't perform the rename
          // — "don't ask again" only changes the prompt policy, the
          // current tag stays as the user typed it. They can re-enable
          // via Settings → Streams.
          void updateConfig({ twitchSkipCategoryRenamePrompt: true })
          setCategoryRenamePrompt(null)
        }}
        onConfirm={() => {
          if (!categoryRenamePrompt) return
          const { sent, canonical } = categoryRenamePrompt
          // Global rename: replace every case-insensitive match of the
          // old name with the canonical name across all game-related
          // meta fields on every folder, then re-key tagColors and
          // tagTextures so the chip styling moves with the tag. Mirrors
          // the bulk-write pattern used by onDeleteGame / onCombineGames
          // above. The reach across fields (games / ytGameTitle /
          // twitchGameName / twitchLastPushedGame) handles both
          // syncGame=true (rename traces back through games[]) and
          // syncGame=false (twitchGameName is the source of truth) so a
          // future push doesn't re-trigger the same prompt.
          const oldNorm = sent.trim().toLowerCase()
          const matches = (s: string | undefined) =>
            s !== undefined && s.trim().toLowerCase() === oldNorm
          const affected = folders.filter(f => {
            const m = f.meta
            if (!m) return false
            return (m.games ?? []).some(matches)
              || matches(m.ytGameTitle)
              || matches(m.twitchGameName)
              || matches(m.twitchLastPushedGame)
              || matches(m.primaryGame)
          })
          Promise.all(
            affected.map(f => {
              const m = f.meta
              if (!m) return Promise.resolve()
              const next: StreamMeta = { ...m }
              if (m.games?.some(matches)) {
                next.games = m.games.map(g => matches(g) ? canonical : g)
              }
              if (matches(m.ytGameTitle)) next.ytGameTitle = canonical
              if (matches(m.twitchGameName)) next.twitchGameName = canonical
              if (matches(m.twitchLastPushedGame)) next.twitchLastPushedGame = canonical
              if (matches(m.primaryGame)) next.primaryGame = canonical
              return window.api.writeStreamMeta(f.folderPath, next, f.relativePath)
            })
          ).then(() => {
            // Re-key the per-tag color + texture maps. Find the existing
            // key by case-insensitive match (the user could have typed
            // the tag with different capitalization than is stored).
            // Drop the old key, copy its value to the new key, persist.
            setTagColors(prev => {
              const key = Object.keys(prev).find(k => k.trim().toLowerCase() === oldNorm)
              if (!key) return prev
              const updated = { ...prev, [canonical]: prev[key] }
              delete updated[key]
              window.api.setStreamTypeTags(updated)
              return updated
            })
            setTagTextures(prev => {
              const key = Object.keys(prev).find(k => k.trim().toLowerCase() === oldNorm)
              if (!key) return prev
              const updated = { ...prev, [canonical]: prev[key] }
              delete updated[key]
              window.api.setStreamTypeTextures(updated)
              return updated
            })
            void loadFolders()
          })
          setCategoryRenamePrompt(null)
        }}
      />

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
        folders={folders}
        onBulkBindYtTags={async (binds) => {
          // Walk each affected folder, writing only the new ytTagsTemplateId
          // (tags are unchanged by definition — they already match the
          // template). Refresh the folder list when done so the sidebar
          // reflects the new bindings if the user has a stream open.
          await Promise.all(binds.map(({ folderPath, templateId }) => {
            const f = folders.find(x => x.folderPath === folderPath)
            const m = f?.meta
            if (!f || !m) return Promise.resolve()
            return window.api.writeStreamMeta(folderPath, { ...m, ytTagsTemplateId: templateId }, f.relativePath)
          }))
          await loadFolders()
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
                    <Tooltip key={p} content={p} maxWidth="max-w-md" triggerClassName="block min-w-0">
                      <div className="px-3 py-1.5 text-xs text-gray-400 truncate">{name}</div>
                    </Tooltip>
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
            ytTagTemplates={ytTagTemplates}
            twitchTagTemplates={twitchTagTemplates}
          />
        )
      })()}

      {cloudDownload && (
        <CloudDownloadModal
          fileName={cloudDownload.fileName}
          filePath={cloudDownload.filePath}
          stage={cloudDownload.stage}
          onConfirm={async () => {
            setCloudDownload(prev => prev ? { ...prev, stage: 'downloading' } : null)
            await window.api.startCloudDownload(cloudDownload.filePath)
          }}
          onCancel={async () => {
            if (cloudDownload.stage === 'downloading') {
              await window.api.cancelCloudDownload(cloudDownload.filePath)
            }
            setCloudDownload(null)
          }}
        />
      )}
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
const StreamListItem = memo(function StreamListItem({
  folder, folders, selected, compact, selectMode, multiSelected, selectKey, index, onToggleMultiSelect,
  onDragStart, onDragEnter, dragMovedRef,
  isPending, isToday, isNextUpcoming, isLive, privacyStatus, isLivestream, isProcessing,
  sameDayIndex, thumbsKey, thumbWidth, tagColors, tagTextures, cloudSyncActive,
  isSendingToPlayer, onClick, onSendToPlayer, onSendToConverter, onOpenThumbnails, onThumbResizeStart,
  animDurationMs, onTagSelect,
}: {
  folder: StreamFolder
  /** Full folder list — needed to render the title template ({total_episodes}
   *  counts siblings in the same game + season). */
  folders: StreamFolder[]
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
  /** This row's selection key (date in dump-mode, folderPath otherwise) —
   *  passed so the row can invoke the stable, shared selection handlers with
   *  its own identity, keeping them referentially stable for React.memo. */
  selectKey: string
  /** This row's index in the visible list — drives the drag-select range. */
  index: number
  /** Toggle this row's selection key in/out of the multi-select set. */
  onToggleMultiSelect: (key: string) => void
  /** Mousedown on the row (selectMode only) starts a drag-select at index. */
  onDragStart: (index: number) => void
  /** Mouseenter on the row (selectMode only) extends the drag range to index. */
  onDragEnter: (index: number) => void
  /** When the drag-select moves to at least one other row, the click
   *  that fires at drag-end on the start row is suppressed via this
   *  ref so it doesn't toggle the start row off. */
  dragMovedRef: React.MutableRefObject<boolean>
  isPending: boolean
  /** True when this pending stream's date is the current day. Today's
   *  upcoming streams render with a blue accent instead of the teal
   *  used for future-dated upcoming streams, so "happening today"
   *  stands out at a glance. */
  isToday: boolean
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
  /** True while YouTube is still processing the linked video (uploadStatus
   *  'uploaded') — a just-ended stream's VOD isn't editable in Studio yet.
   *  Swaps the badge's kind icon for a spinner. */
  isProcessing: boolean
  /** "#2", "#3" suffix when multiple streams share a date. */
  sameDayIndex?: number
  thumbsKey: number
  thumbWidth: number
  tagColors: Record<string, string>
  tagTextures: Record<string, string>
  /** Drives the cloud-status column in the rich count tooltip — when
   *  false the tooltip skips the Cloud/CloudCheck icon entirely. */
  cloudSyncActive: boolean
  /** True while this row's Send-to-Player hydration check is in flight —
   *  spins the button icon and pins the action row open. */
  isSendingToPlayer: boolean
  onClick: (folderPath: string) => void
  onSendToPlayer: (folder: StreamFolder) => void
  onSendToConverter: (folder: StreamFolder) => void
  onOpenThumbnails: (folder: StreamFolder) => void
  onThumbResizeStart: (e: React.MouseEvent) => void
  /** Select-mode tag shortcut — select (additive=true) or deselect every
   *  visible row carrying this type/game tag. */
  onTagSelect: (kind: 'type' | 'game', value: string, additive: boolean) => void
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
  // Show the stream's "main" (preferred) thumbnail — the one a YT push uploads —
  // not just the first on disk, so setting a different default updates the row.
  const preferredIdx = (() => {
    const pref = meta?.preferredThumbnail
    if (pref) {
      const i = thumbnails.findIndex(p => (p.split(/[\\/]/).pop() ?? '') === pref)
      if (i >= 0) return i
    }
    return 0
  })()
  const firstThumb = thumbnails[preferredIdx]
  const firstThumbLocal = thumbnailLocalFlags?.[preferredIdx] ?? true
  const extraCount = thumbnails.length - 1
  const hasSMThumbnail = thumbnails.some(t => /[_-]sm-thumbnail\./i.test(t))
  const title = renderStreamTitle(folder, folders)

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
    if (selectMode) onToggleMultiSelect(selectKey)
    else onClick(folder.folderPath)
  }

  return (
    <tr
      data-folder-path={folder.folderPath}
      onClick={handleRowClick}
      onMouseDown={selectMode ? (e) => { e.preventDefault(); onDragStart(index) } : undefined}
      onMouseEnter={selectMode ? () => onDragEnter(index) : undefined}
      style={selectMode ? { userSelect: 'none' } : undefined}
      className={`group transition-colors cursor-pointer ${
        isPending
          ? (isToday
              ? 'border-b border-blue-900/30 bg-blue-900/15 hover:bg-blue-900/30'
              : 'border-b border-teal-900/30 bg-teal-900/15 hover:bg-teal-900/30')
          : 'border-b border-white/10 hover:bg-white/[0.03]'
      } ${selected ? (
        // Right-edge indicator lives on the date cell below (search for
        // `selected-row-indicator`) so it stays visible when the sidebar
        // overlay covers the row's actual right edge.
        `${isPending
          ? (isToday
              ? 'border-b border-blue-700/40 !bg-blue-700/30 hover:!bg-blue-700/40'
              : 'border-b border-teal-700/40 !bg-teal-700/30 hover:!bg-teal-700/40')
          : '!bg-purple-900/20'}`
      ) : ''} ${selectMode && multiSelected ? (
        isPending
          ? (isToday
              ? '!bg-blue-600/30 hover:!bg-blue-600/40'
              : '!bg-teal-600/30 hover:!bg-teal-600/40')
          : '!bg-purple-600/30 hover:!bg-purple-600/40')
        : ''}`}
    >
      {/* Checkbox column — only renders in select mode. The pl-3 keeps
          the checkbox off the row's left edge but tight enough that the
          thumbnail column doesn't drift right by too much. */}
      {selectMode && (
        <td
          className="pl-3 align-middle w-[36px]"
          onClick={e => { e.stopPropagation(); onToggleMultiSelect(selectKey) }}
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
            {/* Pending stream — Live broadcasts go green; scheduled stay teal. */}
            {isPending && (
              meta?.ytVideoId && (() => {
                const privacyLabel = privacyStatus === 'public' ? 'Public' : privacyStatus === 'unlisted' ? 'Unlisted' : privacyStatus === 'private' ? 'Private' : null
                const liveLabel = isProcessing ? 'Processing on YouTube — not editable yet' : isLive ? 'Live now' : 'Open in YouTube Studio'
                const tooltipText = privacyLabel ? `${liveLabel} · ${privacyLabel}` : liveLabel
                const PrivacyIcon = privacyStatus === 'unlisted' ? LinkIcon : privacyStatus === 'private' ? Lock : privacyStatus === 'public' ? Globe : null
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
                      {isProcessing ? <Loader2 size={12} className="animate-spin" /> : <Radio size={12} />}
                      {PrivacyIcon && <PrivacyIcon size={12} />}
                    </button>
                  </Tooltip>
                )
              })()
            )}
            {/* Past stream — Radio for livestream replays, Clapperboard
                for regular video uploads. Both go red. */}
            {!isPending && meta?.ytVideoId && (() => {
              const privacyLabel = privacyStatus === 'public' ? 'Public' : privacyStatus === 'unlisted' ? 'Unlisted' : privacyStatus === 'private' ? 'Private' : null
              const PrivacyIcon = privacyStatus === 'unlisted' ? LinkIcon : privacyStatus === 'private' ? Lock : privacyStatus === 'public' ? Globe : null
              const KindIcon = isLivestream ? Radio : Clapperboard
              const kindLabel = isLivestream ? 'Livestream' : 'Video'
              const editLabel = isProcessing ? 'Processing on YouTube — not editable yet' : 'Edit on YouTube'
              const tooltipText = privacyLabel ? `${editLabel} · ${kindLabel} · ${privacyLabel}` : `${editLabel} · ${kindLabel}`
              return (
                <Tooltip content={tooltipText}>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); window.api.openUrl(`https://studio.youtube.com/video/${meta.ytVideoId}`) }}
                    className="inline-flex items-center gap-0.5 p-0.5 rounded bg-red-900/30 text-red-400 border border-red-400/40 hover:bg-red-900/50 hover:text-red-300 transition-colors shrink-0"
                  >
                    {isProcessing ? <Loader2 size={12} className="animate-spin" /> : <KindIcon size={12} />}
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
                    <DisplayTagChip
                      key={t}
                      text={t}
                      className={`inline-block text-xs leading-tight px-2 py-0.5 rounded-full border truncate max-w-full ${color.chip}`}
                      style={getTagTextureStyle(tagTextures[t])}
                      onClick={selectMode ? (e) => onTagSelect('type', t, !(e.ctrlKey || e.metaKey)) : undefined}
                      actionTooltip={selectMode ? `Select all "${t}" · Ctrl-click to deselect` : undefined}
                    />
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
                {displayGames.map(g => (
                  <DisplayTagChip
                    key={g}
                    text={g}
                    className="inline-block text-[10px] leading-tight px-1.5 py-0.5 rounded-full bg-purple-900/20 text-purple-300 border border-purple-300/30 truncate max-w-full"
                    onClick={selectMode ? (e) => onTagSelect('game', g, !(e.ctrlKey || e.metaKey)) : undefined}
                    actionTooltip={selectMode ? `Select all "${g}" · Ctrl-click to deselect` : undefined}
                  />
                ))}
              </div>
            ) : (
              <span className="text-xs text-gray-400">—</span>
            )}
          </td>

          <td className="px-2 py-2 align-middle hidden @5xl:table-cell">
            {meta?.comments ? (
              <ClampedComment text={meta.comments} maxLines={Math.max(2, Math.floor((thumbWidth * 9 / 16) / 12.5))} />
            ) : (
              <span className="text-xs text-gray-400">—</span>
            )}
          </td>

          <td className="px-2 py-2 align-middle">
            <div className={`flex items-center justify-end transition-opacity ${selectMode ? 'opacity-0 pointer-events-none' : isSendingToPlayer ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
              {!hasMeta && (
                <span className="flex items-center gap-1 text-xs text-yellow-600 mr-1 shrink-0">
                  <AlertTriangle size={11} />
                  No meta
                </span>
              )}
              {/* Force the Send-to-Player tooltip closed (and its hover handlers
                  off) while the check runs: the button going disabled fires a
                  spurious mouseenter on the wrapper, and the send navigates away
                  with the streams page left mounted — an open tooltip would get
                  stuck with no mouseleave to close it. */}
              {videoCount > 0 && (
                <Tooltip content="Send to Player" open={isSendingToPlayer ? false : undefined}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    icon={isSendingToPlayer ? <Loader2 size={12} className="animate-spin" /> : <Film size={12} />}
                    onClick={() => onSendToPlayer(folder)}
                    disabled={isSendingToPlayer}
                  />
                </Tooltip>
              )}
              {videoCount > 0 && (
                <Tooltip content="Send to Converter">
                  <Button variant="ghost" size="icon-sm" icon={<Zap size={12} />} onClick={() => onSendToConverter(folder)} />
                </Tooltip>
              )}
              <Tooltip content={hasSMThumbnail ? 'Edit Stream Manager Thumbnail' : 'Create Stream Manager Thumbnail'} shortcut="Ctrl+Shift+T">
                <Button variant="ghost" size="icon-sm" icon={<ImageIcon size={12} />} onClick={() => onOpenThumbnails(folder)} />
              </Tooltip>
            </div>
          </td>
        </>
      )}
    </tr>
  )
})

// ── Sidebar empty state: month calendar ─────────────────────────────────────

/** Month-view calendar shown in the sidebar when no stream is selected.
 *  Past streams render as gray dots under the day number; future streams
 *  as purple dots. Clicking a day with streams selects the first one. */
function SidebarMonthCalendar({
  folders,
  onSelectStream,
}: {
  folders: StreamFolder[]
  onSelectStream: (folder: StreamFolder) => void
}) {
  const today = todayStr()
  const now = useMemo(() => new Date(), [])
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth()) // 0-indexed

  // Month picker (opens on month-label click)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerYear, setPickerYear] = useState(now.getFullYear())
  const pickerRef = useRef<HTMLDivElement>(null)

  // User prefs for the calendar — first day of week, week-numbers
  // column, adjacent-month days. Stored alongside other per-user UI
  // prefs in the app config and edited via the gear popover at the
  // bottom of this widget.
  const { config, updateConfig } = useStore()
  const firstDayMondayBased = config.calendarFirstDayOfWeek === 'monday'
  const showWeekNumbers = !!config.calendarShowWeekNumbers
  const showAdjacent = config.calendarShowAdjacentMonthDays !== false
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)

  // Date → folders[] index (a date can host multiple streams)
  const byDate = useMemo(() => {
    const map = new Map<string, StreamFolder[]>()
    for (const f of folders) {
      if (!f.date) continue
      const arr = map.get(f.date) ?? []
      arr.push(f)
      map.set(f.date, arr)
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.folderName.localeCompare(b.folderName))
    }
    return map
  }, [folders])

  // Earliest stream date constrains how far back the picker can navigate.
  // Future direction is unbounded — users may have streams scheduled far
  // ahead, and an empty future month is still meaningful to plan into.
  const earliestDate = useMemo(() => {
    let min: string | null = null
    for (const f of folders) {
      if (!f.date) continue
      if (!min || f.date < min) min = f.date
    }
    return min
  }, [folders])
  const earliestY = earliestDate ? parseInt(earliestDate.slice(0, 4), 10) : null
  const earliestM = earliestDate ? parseInt(earliestDate.slice(5, 7), 10) - 1 : null

  // 6-week grid starting on the first-day-of-week column on/before the
  // 1st of the viewed month. `firstDayMondayBased` shifts the start
  // index: Sunday-first uses getDay() directly (0=Sun..6=Sat); Monday-
  // first remaps so Monday=0..Sunday=6 via `(getDay() + 6) % 7`.
  const cells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1)
    const startDow = firstDayMondayBased ? (first.getDay() + 6) % 7 : first.getDay()
    const out: Array<{
      iso: string
      day: number
      inMonth: boolean
      isToday: boolean
      streams: StreamFolder[]
    }> = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(viewYear, viewMonth, 1 - startDow + i)
      const yyyy = d.getFullYear()
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      const iso = `${yyyy}-${mm}-${dd}`
      out.push({
        iso,
        day: d.getDate(),
        inMonth: d.getMonth() === viewMonth,
        isToday: iso === today,
        streams: byDate.get(iso) ?? [],
      })
    }
    return out
  }, [viewYear, viewMonth, byDate, today, firstDayMondayBased])

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
  const isCurrentMonth = now.getFullYear() === viewYear && now.getMonth() === viewMonth

  const prevMonthDisabled =
    earliestY !== null && (viewYear < earliestY || (viewYear === earliestY && viewMonth <= earliestM!))

  const prevMonth = () => {
    if (prevMonthDisabled) return
    if (viewMonth === 0) {
      setViewYear(viewYear - 1)
      setViewMonth(11)
    } else {
      setViewMonth(viewMonth - 1)
    }
  }
  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewYear(viewYear + 1)
      setViewMonth(0)
    } else {
      setViewMonth(viewMonth + 1)
    }
  }
  const goToToday = () => {
    const n = new Date()
    setViewYear(n.getFullYear())
    setViewMonth(n.getMonth())
  }

  const openPicker = () => {
    setPickerYear(viewYear)
    setPickerOpen(true)
  }
  const pickMonth = (y: number, m: number) => {
    setViewYear(y)
    setViewMonth(m)
    setPickerOpen(false)
  }
  const isPickerMonthDisabled = (y: number, m: number) => {
    if (earliestY === null) return false
    if (y < earliestY) return true
    if (y === earliestY && m < earliestM!) return true
    return false
  }
  const prevPickerYearDisabled = earliestY !== null && pickerYear <= earliestY

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [pickerOpen])

  // Close settings popover on outside click
  useEffect(() => {
    if (!settingsOpen) return
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [settingsOpen])

  // Day-of-week header. Sunday-first is `['S','M','T','W','T','F','S']`;
  // Monday-first rotates by one (`['M','T','W','T','F','S','S']`).
  const DOW = firstDayMondayBased
    ? ['M', 'T', 'W', 'T', 'F', 'S', 'S']
    : ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  // ISO 8601 week number — the week that contains the year's first
  // Thursday is week 1. Used for the optional week-number column.
  const isoWeekNumber = (iso: string): number => {
    const d = new Date(iso + 'T00:00:00')
    // Shift to nearest Thursday so the year boundary is unambiguous.
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
    const week1 = new Date(d.getFullYear(), 0, 4)
    week1.setDate(week1.getDate() + 3 - ((week1.getDay() + 6) % 7))
    return 1 + Math.round((d.getTime() - week1.getTime()) / (7 * 24 * 60 * 60 * 1000))
  }

  return (
    <div className="flex h-full flex-col px-3 pt-3 pb-4">
      {/* Month header with nav. Relative so the picker dropdown can anchor
          below the label. */}
      <div className="relative flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={prevMonth}
          disabled={prevMonthDisabled}
          className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400"
          aria-label="Previous month"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          onClick={openPicker}
          className="text-xs font-medium text-gray-200 hover:text-white px-2 py-0.5 rounded hover:bg-white/5 transition-colors"
        >
          {monthLabel}
        </button>
        <button
          type="button"
          onClick={nextMonth}
          className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
          aria-label="Next month"
        >
          <ChevronRight size={14} />
        </button>

        {pickerOpen && (
          <div
            ref={pickerRef}
            className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-30 bg-navy-900 border border-white/10 rounded-lg shadow-lg p-2 w-56"
          >
            {/* Year nav */}
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={() => setPickerYear(pickerYear - 1)}
                disabled={prevPickerYearDisabled}
                className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-400"
                aria-label="Previous year"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs font-medium text-gray-200">{pickerYear}</span>
              <button
                type="button"
                onClick={() => setPickerYear(pickerYear + 1)}
                className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
                aria-label="Next year"
              >
                <ChevronRight size={14} />
              </button>
            </div>
            {/* Month grid */}
            <div className="grid grid-cols-3 gap-1">
              {MONTHS_SHORT.map((m, i) => {
                const disabled = isPickerMonthDisabled(pickerYear, i)
                const isSelected = pickerYear === viewYear && i === viewMonth
                return (
                  <button
                    key={m}
                    type="button"
                    disabled={disabled}
                    onClick={() => pickMonth(pickerYear, i)}
                    className={[
                      'py-1.5 rounded text-xs transition-colors',
                      disabled
                        ? 'text-gray-700 cursor-not-allowed'
                        : isSelected
                          ? 'bg-purple-600/30 text-purple-200 border border-purple-500/40'
                          : 'text-gray-300 hover:bg-white/5',
                    ].join(' ')}
                  >
                    {m}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Day-of-week header row. Grid template column count flips
          between 7 (week numbers off) and 8 (week numbers on); the
          leading column when on is an empty header above the wk# col
          so the rest of the day labels stay aligned with their cells. */}
      <div className={`grid ${showWeekNumbers ? 'grid-cols-[auto_repeat(7,minmax(0,1fr))]' : 'grid-cols-7'} gap-0.5 mb-1`}>
        {showWeekNumbers && (
          <div className="text-center text-[10px] uppercase tracking-wider text-gray-600 pr-1">wk</div>
        )}
        {DOW.map((d, i) => (
          <div
            key={i}
            className="text-center text-[10px] uppercase tracking-wider text-gray-500"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day grid — same column shape as the header, rendered week-by-
          week (7 cells per row) so each row can prefix a wk-number cell
          when enabled. `flex-1 min-h-0 auto-rows-fr` fills the calendar's
          fixed height with six equal rows; the cells fill their rows
          (h-full), so the calendar height is constant regardless of the
          wk# column. */}
      <div
        className={`grid ${showWeekNumbers ? 'grid-cols-[auto_repeat(7,minmax(0,1fr))]' : 'grid-cols-7'} gap-0.5 flex-1 min-h-0 auto-rows-fr`}
      >
        {Array.from({ length: 6 }, (_, weekIdx) => {
          const weekStart = weekIdx * 7
          const weekCells = cells.slice(weekStart, weekStart + 7)
          // Keep every row mounted so the calendar stays a fixed
          // 6-row height regardless of which prefs are on. A row with
          // no in-month days (when adjacent-month rendering is off)
          // still occupies a full grid row whose height is fixed by
          // the parent's `gridAutoRows` setting — the empty spacer
          // divs inside don't need their own sizing.
          const rowHasInMonth = weekCells.some(c => c.inMonth)
          // Week number derived from the first cell of the row. ISO
          // weeks always span Monday→Sunday regardless of the user's
          // first-day-of-week preference, so the number is consistent
          // even when the visible row starts on Sunday. Skip the
          // number only when the row would be visually blank (no
          // in-month days AND adjacent-day rendering is off) — when
          // adjacent days ARE rendered the row has visible content
          // so the week number belongs there too.
          const wkNum = showWeekNumbers && (rowHasInMonth || showAdjacent) ? isoWeekNumber(weekCells[0].iso) : null
          // Fragment needs a key, so use the long-form Fragment. The
          // file imports named hooks from react (no default `React`),
          // so referencing `React.Fragment` here would be undefined —
          // import Fragment by name instead.
          return (
            <Fragment key={weekIdx}>
              {showWeekNumbers && (
                <div className="flex items-center justify-end pr-1 text-[10px] tabular-nums text-gray-600">
                  {wkNum}
                </div>
              )}
              {weekCells.map((c) => {
          // Hide leading/trailing adjacent-month cells if the user
          // turned that off — keep the grid slot so columns stay
          // aligned with the day-of-week header.
          if (!c.inMonth && !showAdjacent) {
            // Empty spacer occupies the grid slot; the row's height comes
            // from the grid's `auto-rows-fr`, so blank and populated rows
            // share the same footprint.
            return <div key={c.iso} />
          }
          const has = c.streams.length > 0
          const isFuture = c.iso > today
          // Match the upcoming-stream badge color from the list rows
          // (bg-teal-900/30 + text-teal-400) so the two surfaces read as
          // the same status at a glance.
          const dotColor = isFuture ? 'bg-teal-400' : 'bg-gray-400'
          const dayNumberClass = c.isToday
            ? 'text-purple-300 font-semibold'
            : !c.inMonth
              ? 'text-gray-600'
              : has
                ? 'text-gray-200'
                : 'text-gray-400'

          const cell = (
            <button
              type="button"
              disabled={!has}
              onClick={() => has && onSelectStream(c.streams[0])}
              // Fill the grid row. The grid is `flex-1 auto-rows-fr` inside the
              // fixed-height calendar, so the six rows divide the available
              // height evenly — no container query needed (it was a source of a
              // Chromium paint glitch when the sibling out-of-sync panel
              // reflowed). Height stays constant since the calendar box is fixed.
              className={[
                'relative w-full h-full flex items-center justify-center rounded transition-colors',
                has ? 'cursor-pointer hover:bg-white/10' : 'cursor-default',
                c.isToday ? 'ring-1 ring-purple-500/50' : '',
              ].join(' ')}
            >
              <span className={`text-xs leading-none ${dayNumberClass}`}>{c.day}</span>
              {has && (
                // One dot per stream on this day. Cap at 4 to keep the
                // row fitting; the tooltip lists exact titles. Archived
                // streams get a 1px green ring (matching the archive
                // badge's icon color from the list rows). Ring is used
                // instead of border so the dot's layout size doesn't
                // change — unringed neighbors stay aligned.
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-0.5">
                  {c.streams.slice(0, 4).map((f) => {
                    const archived = !!f.meta?.archived
                    return (
                      <span
                        key={f.folderPath}
                        className={`w-1.5 h-1.5 rounded-full ${dotColor} ${archived ? 'ring-1 ring-green-400' : ''}`}
                      />
                    )
                  })}
                </span>
              )}
            </button>
          )

          if (!has) {
            return (
              <div key={c.iso} className="flex items-center justify-center">
                {cell}
              </div>
            )
          }

          // Single stream: read-only tooltip (just the title).
          // Multiple streams: interactive tooltip — each row is a button
          // that picks that stream, so the user can choose between
          // them rather than being locked into the default first-click.
          const multi = c.streams.length > 1
          const tooltipContent = multi ? (
            <div className="flex flex-col gap-0.5 -mx-2 -my-1.5 py-1">
              {c.streams.map((f) => {
                const title = renderStreamTitle(f, folders)
                return (
                  <button
                    key={f.folderPath}
                    type="button"
                    onClick={() => onSelectStream(f)}
                    className="text-left text-xs text-gray-100 hover:bg-white/10 rounded px-2 py-1 truncate max-w-[260px] transition-colors"
                  >
                    {title}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="text-xs text-gray-100 truncate max-w-[240px]">
              {renderStreamTitle(c.streams[0], folders)}
            </div>
          )

          return (
            <Tooltip key={c.iso} content={tooltipContent} side="top" interactive={multi}>
              {cell}
            </Tooltip>
          )
              })}
            </Fragment>
          )
        })}
      </div>

      {/* Footer: centered "Go to today" with the calendar-settings gear
          floated to the right edge. The gear is absolutely positioned
          so its width doesn't push the Button off-center. */}
      <div ref={settingsRef} className="relative mt-3 flex justify-center">
        <Button
          variant="secondary"
          size="sm"
          onClick={goToToday}
          disabled={isCurrentMonth}
        >
          Go to today
        </Button>
        <Tooltip content="Calendar settings" side="left" triggerClassName="absolute right-0 top-1/2 -translate-y-1/2 inline-flex">
          <button
            type="button"
            onClick={() => setSettingsOpen(v => !v)}
            className={`p-1.5 rounded transition-colors ${
              settingsOpen
                ? 'bg-white/10 text-gray-200'
                : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
            }`}
            aria-label="Calendar settings"
          >
            <SettingsIcon size={14} />
          </button>
        </Tooltip>
        {settingsOpen && (
          // Anchored to both edges of the footer (which is bounded by
          // the calendar widget's px-3 inset, same as the day grid),
          // so the popover's width naturally matches the calendar
          // content width regardless of the sidebar's overall width.
          <div className="absolute top-full left-0 right-0 mt-1.5 z-20 bg-navy-900 border border-white/10 rounded-lg shadow-lg p-2.5 flex flex-col gap-2.5">
            {/* First day of week — two-button segmented control */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400">First day of week</span>
              <div className="flex bg-navy-800 border border-white/5 rounded overflow-hidden">
                {(['sunday', 'monday'] as const).map(opt => {
                  const selected = (config.calendarFirstDayOfWeek || 'sunday') === opt
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => updateConfig({ calendarFirstDayOfWeek: opt })}
                      className={`flex-1 py-1 text-xs capitalize transition-colors ${
                        selected ? 'bg-purple-600/25 text-purple-200' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                      }`}
                    >
                      {opt}
                    </button>
                  )
                })}
              </div>
            </div>
            <Checkbox
              checked={showWeekNumbers}
              onChange={v => updateConfig({ calendarShowWeekNumbers: v })}
              label="Show week numbers"
            />
            <Checkbox
              checked={showAdjacent}
              onChange={v => updateConfig({ calendarShowAdjacentMonthDays: v })}
              label="Show days from adjacent months"
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sidebar detail ──────────────────────────────────────────────────────────

/** Meta fields excluded from the detail-sidebar undo/redo history. These are
 *  system snapshots / non-input actions rather than user field edits: push
 *  state, broadcast link, thumbnail selection, and the retired ytGameTitle
 *  auto-sync. A partial touching ANY of these is treated as a system/bulk
 *  write and isn't recorded — which also drops mixed writes like
 *  Pull-from-YouTube (it carries ytLastPushed* keys) out of the user's undo
 *  timeline, where reverting it would be surprising. */
const META_HISTORY_SKIP = new Set<string>([
  'ytVideoId', 'ytGameTitle', 'ytThumbnailPushedHash',
  'ytLastPushedTitle', 'ytLastPushedDescription', 'ytLastPushedTags',
  'ytLastPushedCategoryId', 'ytLastPushedDate', 'ytLastPushedScheduledTime',
  'ytLastPushedPrivacy', 'preferredThumbnail', 'smThumbnail', 'smThumbnailTemplate',
  'videoMap',
])

/** All sidebar content when an item is selected. Extracted so the empty
 *  state stays cleanly separated and the metadata + action layout can
 *  evolve independently. */
function SidebarDetail({
  folder, folders, prevEpisode, nextEpisode, seriesEpisodes, onPickEpisode, onClose, onUpdateMeta: onUpdateMetaRaw, cloudSyncActive,
  allGames, allStreamTypes, tagColors, tagTextures, onNewStreamType, onReschedule, onNewEpisode, onOffload, onPinLocal, onArchive, isArchiving,
  thumbsKey, onDeleteThumbnail,
  ytBroadcasts, ytVods, setYtVods, setYtBroadcasts, broadcastLinks, ytBroadcastsLoading, onLoadAllVods, defaultBroadcastTime, claudeEnabled,
  onSendToPlayer, onSendToConverter, onSendToCombine, onSendFileToPlayer, onSendFileToConverter, onSendFilesToConverter, filesGridRef, onFilesDeleted, onOpenFolder, onOpenThumbnails, onDelete, deleteBlockReason,
  onPushToYoutube, onPushToTwitch, ytConnected, ytCategories, ytQuota, twConnected, twitchChannel, setTwitchChannel, banners, onDismissBanner, onMissingYtCategory,
  onSuggestCategoryRename,
  ytTitleTemplates, ytDescTemplates, ytTagTemplates, twitchTagTemplates,
  onSaveYtTitleTemplate, onSaveYtDescTemplate, onSaveYtTagsTemplate, onSaveTwitchTagsTemplate,
  gameTagsLinks,
}: {
  folder: StreamFolder
  folders: StreamFolder[]
  prevEpisode: StreamFolder | null
  nextEpisode: StreamFolder | null
  /** Full sibling list (current stream + every other stream in the
   *  same game + season, sorted by episode number). Drives the
   *  jump-to-episode picker in the sidebar header. */
  seriesEpisodes: StreamFolder[]
  onPickEpisode: (f: StreamFolder) => void
  onClose: () => void
  onUpdateMeta: (partial: Partial<StreamMeta>) => Promise<void> | void
  cloudSyncActive: boolean
  allGames: string[]
  allStreamTypes: string[]
  tagColors: Record<string, string>
  tagTextures: Record<string, string>
  /** Called when a stream type that isn't in the global tagColors map
   *  is entered inline. Persists the new tag with an auto-picked color
   *  so it's available in the autocomplete pool and the Manage Tags
   *  surface — without this, inline-added types are invisible to those
   *  flows. */
  onNewStreamType: (tag: string) => void
  /** When the date dot is showing a direction at the moment of click,
   *  pass it through so the modal can switch into pull / conflict
   *  mode. Normal-edit case passes undefined. */
  onReschedule: (dateDirection?: 'local' | 'remote' | 'both' | 'unknown') => void
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
  /** Open / send one specific file — used by the files grid's per-file actions. */
  onSendFileToPlayer: (path: string) => void
  onSendFileToConverter: (path: string) => void
  onSendFilesToConverter: (paths: string[]) => void
  filesGridRef: React.Ref<FilesGridHandle>
  /** Grid files were trashed — parent drops them from folder state in place. */
  onFilesDeleted: (paths: string[]) => void
  onOpenFolder: () => void
  /** Open the thumbnail editor for the current stream. The optional
   *  variantOrdinal lets the carousel's per-image edit buttons open
   *  the specific alternative the user clicked from instead of
   *  always defaulting to the preferred one. */
  onOpenThumbnails: (variantOrdinal?: number) => void
  onDelete: () => void
  /** Why this stream can't be deleted right now (in use), or null. */
  deleteBlockReason: string | null
  onPushToYoutube: (customThumbPath: string | null, newScheduledStartTime?: string) => Promise<void> | void
  onPushToTwitch: () => Promise<void> | void
  ytConnected: boolean
  /** YouTube video categories list (session-cached at the page level
   *  and reused across sidebar opens). Drives the Category dropdown in
   *  the YouTube section and supplies the assignable filter so the user
   *  can't pick a category YouTube would reject. */
  ytCategories: { id: string; title: string; assignable: boolean }[]
  /** YouTube API quota state — drives the soft-block on push/pull and
   *  the auto-refresh pause. Page-level state shared so both the
   *  per-stream effects and the page-level bulk-refresh see the same
   *  truth. */
  ytQuota: { exceeded: boolean; resetsAt: string | null }
  twConnected: boolean
  /** Cached Twitch channel snapshot, fetched once on connect. The
   *  Push to Twitch button compares local meta against this to decide
   *  whether it has anything to push. Null means "not fetched yet" —
   *  treated as "might need push" so we don't lock the user out. */
  twitchChannel: { title: string; gameName: string; tags: string[] } | null
  /** Lets the push handler optimistically update the cache to the
   *  pushed values after a successful update, so the button
   *  immediately disables without a fetch roundtrip. */
  setTwitchChannel: React.Dispatch<React.SetStateAction<{ title: string; gameName: string; tags: string[] } | null>>
  /** Filtered (per-current-folder) banners. Page-level state is the
   *  full array tagged with `folderPath`; the parent filters before
   *  passing so banners emitted from a previous stream don't surface
   *  if a push completes after the user switched. */
  banners: { id: string; folderPath: string; type: 'success' | 'error'; message: string; action?: { url: string; label: string } }[]
  onDismissBanner: (id: string) => void
  /** Fires when the user clicks Push to YouTube but `meta.ytCategoryId`
   *  is empty. The sidebar handles the scroll-into-view + focus on its
   *  own ref; the page hook is for the user-facing banner (which lives
   *  at the page level so its folderPath tagging stays consistent). */
  onMissingYtCategory: () => void
  /** Page-level hook for surfacing the post-push category-rename prompt
   *  modal. The sidebar detects the local-vs-canonical divergence (it
   *  has both values in hand right after the refetch) but the modal is
   *  hosted at page level since the global rename touches every folder
   *  and re-keys tagColors/tagTextures — work the page already owns.
   *  The page also gates the call against the user's "don't ask again"
   *  setting before showing anything. */
  onSuggestCategoryRename: (sent: string, canonical: string) => void
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
  /** Game-tag → YT tag template id map. When the stream gains a primary
   *  game and YT tags are still empty, the linked template's tags are
   *  auto-seeded. Skip-silently semantics: never overwrites non-empty
   *  ytTags. */
  gameTagsLinks: Record<string, string>
}) {
  const meta = folder.meta

  // ── Undo/redo for the sidebar's editable fields ───────────────────────────
  // One linear history shared across every input in the detail sidebar (tags,
  // title, tagline, description, season/episode, category, sync toggles, …).
  // `recordedUpdateMeta` shadows the raw onUpdateMeta prop so every user edit
  // flows through here and snapshots the prior value; system/bulk writes are
  // skipped via META_HISTORY_SKIP, and the template auto-apply effects bypass
  // recording entirely by going through `onUpdateMetaRef` (wired to the raw
  // prop below). Keyboard-only: Ctrl+Z undo, Ctrl+Shift+Z / Ctrl+Y redo.
  const sidebarRootRef = useRef<HTMLDivElement>(null)
  const metaRef = useRef(meta)
  useEffect(() => { metaRef.current = meta })
  // The parent passes a fresh inline onUpdateMeta arrow each render; route
  // through a ref so the wrappers below stay reference-stable (which also
  // keeps every downstream callback that depends on `onUpdateMeta` stable).
  const onUpdateMetaRawRef = useRef(onUpdateMetaRaw)
  useEffect(() => { onUpdateMetaRawRef.current = onUpdateMetaRaw })
  const metaUndoRef = useRef<{ before: Partial<StreamMeta>; after: Partial<StreamMeta> }[]>([])
  const metaRedoRef = useRef<{ before: Partial<StreamMeta>; after: Partial<StreamMeta> }[]>([])
  // Fresh history per stream — undoing into another stream's edits would be
  // meaningless and the before-snapshots wouldn't match.
  useEffect(() => { metaUndoRef.current = []; metaRedoRef.current = [] }, [folder.folderPath])

  const recordedUpdateMeta = useCallback((partial: Partial<StreamMeta>) => {
    const keys = Object.keys(partial)
    if (keys.length > 0 && !keys.some(k => META_HISTORY_SKIP.has(k))) {
      const m = metaRef.current as unknown as Record<string, unknown> | undefined
      const before: Record<string, unknown> = {}
      for (const k of keys) before[k] = m?.[k]
      metaUndoRef.current.push({ before: before as Partial<StreamMeta>, after: { ...partial } })
      metaRedoRef.current = []
    }
    return onUpdateMetaRawRef.current(partial)
  }, [])
  const onUpdateMeta = recordedUpdateMeta

  const undoMeta = useCallback(() => {
    const entry = metaUndoRef.current.pop()
    if (!entry) return
    metaRedoRef.current.push(entry)
    onUpdateMetaRawRef.current(entry.before)
  }, [])
  const redoMeta = useCallback(() => {
    const entry = metaRedoRef.current.pop()
    if (!entry) return
    metaUndoRef.current.push(entry)
    onUpdateMetaRawRef.current(entry.after)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      const isUndo = k === 'z' && !e.shiftKey
      const isRedo = k === 'y' || (k === 'z' && e.shiftKey)
      if (!isUndo && !isRedo) return
      // Scope to the sidebar — only act when focus is inside it. This also
      // covers the streams page being hidden behind another page: hiding it
      // (display:none) blurs the focused field, so focus leaves the sidebar
      // and we don't hijack Ctrl+Z on the player/thumbnail pages.
      const root = sidebarRootRef.current
      if (!root || !root.contains(document.activeElement)) return
      // Defer to native text undo/redo while actively editing: a text input
      // with content, or any contenteditable (the title / description chip
      // editors). An *empty* tag input still routes here, so Ctrl+Z right
      // after committing a tag undoes that tag.
      const ae = document.activeElement as HTMLElement | null
      if (ae) {
        if (ae.isContentEditable) return
        if ((ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && (ae as HTMLInputElement).value !== '') return
      }
      e.preventDefault()
      if (isUndo) undoMeta()
      else redoMeta()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undoMeta, redoMeta])

  const title = renderStreamTitle(folder, folders)
  const hasSMThumbnail = folder.thumbnails.some(t => /[_-]sm-thumbnail\./i.test(t))
  const videoCount = folder.videoCount
  // Ref to the YT Category <select> so the soft-block on push (when
  // the user hasn't picked a category) can scroll it into view and
  // focus it, drawing attention to the missing field.
  const ytCategorySelectRef = useRef<HTMLSelectElement>(null)
  // Convenience destructure — used in the YT push/pull soft-blocks and
  // the auto-refresh skip.
  const quotaExceeded = ytQuota.exceeded

  // Jump-to-episode picker (sidebar header) — click-based dropdown
  // listing every sibling in the current series + season. Mirrors the
  // PlayerPage's stream picker UX (click List icon → portal-rendered
  // dropdown → click outside or pick row to close). Reset whenever the
  // selected stream changes so a click in one stream doesn't leave the
  // picker open in the next.
  const [episodePickerOpen, setEpisodePickerOpen] = useState(false)
  const episodePickerAnchorRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { setEpisodePickerOpen(false) }, [folder.folderPath])

  // Title's template binding lives in meta (`ytTitleTemplateId`) so it
  // survives stream switches and app restarts. Description / tag template
  // selections stay ephemeral for now (the user only asked for title to
  // persist; can lift those later if it turns out to be useful).
  const titleTplId = meta?.ytTitleTemplateId ?? ''
  const twitchTitleTplId = meta?.twitchTitleTemplateId ?? ''
  const tagsTplId = meta?.ytTagsTemplateId ?? ''
  const twitchTagsTplId = meta?.twitchTagsTemplateId ?? ''
  const [descTplId, setDescTplId] = useState('')

  // Auto-fill the {game} field (ytGameTitle) from the *selected* Topic/
  // Game tag (the one with the ring indicator in the chip row). Source
  // of truth is `resolvePrimaryGame`, which prefers `meta.primaryGame`
  // when it's still present in `games[]` and falls back to `games[0]`
  // otherwise — same value the Twitch push uses, so the YT title
  // template's {game} merge field and the Twitch category stay aligned.
  // The "already equal" guard prevents a no-op write churn when the
  // games array reference shifts due to an unrelated meta refresh.
  useEffect(() => {
    const primary = resolvePrimaryGame(meta)
    if (!primary) return
    if (meta?.ytGameTitle === primary) return
    onUpdateMeta({ ytGameTitle: primary })
  }, [meta?.games, meta?.primaryGame, meta?.ytGameTitle, onUpdateMeta])

  // Merge-field substitution values, derived from the current folder's
  // meta. Matches the StreamsPage names exactly so existing user templates
  // ({game}, {season}, {episode}, etc.) keep working as the page switches.
  // `{season_links}` is NOT in this map — it's resolved separately inside
  // applyDescTemplate at template-pick time since it's async (walks all
  // folders and can hit the YouTube API for missing titles).
  const mergeFields = useMemo<Record<string, string>>(
    () => buildYtTitleMergeFields(meta, folder, folders),
    [folder, meta, folders],
  )
  // Stable set + imperative-insert handle for the chip editor + picker
  // below. Set is stable per component instance (the key list is a
  // module-level constant), so a useMemo with empty deps is fine.
  const titleMergeKeySet = useMemo(
    () => new Set<string>(YT_TITLE_KNOWN_KEYS as readonly string[]),
    [],
  )
  // Series-specific keys collapse to '' on standalone streams (see
  // buildYtTitleMergeFields), so chips/picker entries for those keys
  // are flagged or hidden when the stream is standalone. `standalone`
  // is a plain boolean → stable dep across renders.
  const standalone = isStandalone(meta)
  const titleInapplicableKeySet = useMemo(
    () => standalone
      ? new Set<string>(['season', 'episode', 'total_episodes'])
      : new Set<string>(),
    [standalone],
  )
  const titlePickerKeys = useMemo(
    () => standalone
      ? YT_TITLE_MERGE_KEYS.filter(k => k !== 'season' && k !== 'episode' && k !== 'total_episodes')
      : YT_TITLE_MERGE_KEYS,
    [standalone],
  )
  const titleInsertRef = useRef<((text: string) => void) | null>(null)
  // Separate insert handle for the Twitch title's chip editor (shown
  // only when the user unchecks "Same as YouTube title"). Shares the
  // same merge-key + inapplicable sets as the YT title.
  const twitchTitleInsertRef = useRef<((text: string) => void) | null>(null)

  // Description chip editor: same merge keys as the title plus {season_links}
  // (the multi-line prior-episodes list, series-only).
  const descMergeKeySet = useMemo(
    () => new Set<string>([...YT_TITLE_KNOWN_KEYS, 'season_links']),
    [],
  )
  const descInapplicableKeySet = useMemo(
    () => standalone
      ? new Set<string>(['season', 'episode', 'total_episodes', 'season_links'])
      : new Set<string>(),
    [standalone],
  )
  const descPickerKeys = useMemo(
    () => standalone
      ? YT_TITLE_MERGE_KEYS.filter(k => k !== 'season' && k !== 'episode' && k !== 'total_episodes')
      : [...YT_TITLE_MERGE_KEYS, 'season_links'],
    [standalone],
  )
  const descInsertRef = useRef<((text: string) => void) | null>(null)
  // Edit ⇄ preview toggle for the description. Edit shows value-rendering
  // chips and is editable; preview shows the fully-resolved plain text,
  // read-only. Default to edit.
  const [descPreview, setDescPreview] = useState(false)
  // Manual drag-resize height for the description field, lifted here so it
  // persists across the edit⇄preview toggle (both elements apply it). `null`
  // = auto-grow. Reset when switching streams.
  const [descHeight, setDescHeight] = useState<number | null>(null)
  useEffect(() => { setDescHeight(null) }, [folder.folderPath])
  const descPreviewRef = useRef<HTMLDivElement>(null)

  // Hoist onUpdateMeta into a ref so other effects below can call it
  // without re-running every time the parent re-renders (the parent
  // passes an inline arrow each time, so it isn't reference-stable).
  // Wired to the RAW prop, not the recording wrapper: the template
  // auto-apply effects that use this ref shouldn't create undo entries.
  const onUpdateMetaRef = useRef(onUpdateMetaRaw)
  useEffect(() => { onUpdateMetaRef.current = onUpdateMetaRaw })

  // {season_links} is the one async merge field — resolve it once here (walks
  // siblings, can hit the YT API) and reuse it for both the chip display and
  // the baked output. Re-resolves on stream-open + this stream's series-field
  // edits; `folders` is read via closure (excluded from deps) so unrelated meta
  // writes don't trigger constant re-resolves.
  const [descSeasonLinks, setDescSeasonLinks] = useState('')
  useEffect(() => {
    if (isStandalone(meta)) { setDescSeasonLinks(''); return }
    let cancelled = false
    computeSeasonLinks(
      folders,
      meta?.ytGameTitle?.trim() || meta?.games?.[0] || folder.detectedGames?.[0] || '',
      meta?.ytSeason || '1',
      folder.date,
    ).then(links => { if (!cancelled) setDescSeasonLinks(links) }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta?.isSeries, meta?.ytGameTitle, meta?.games, meta?.ytSeason, folder.folderPath, folder.date])

  // Token → resolved-value map for the description chips: the sync title merge
  // fields plus the async-resolved {season_links}. Memoized so the chip editor
  // only rebuilds chips when a value actually changes.
  const descResolvedValues = useMemo(() => {
    const map = new Map<string, string>(Object.entries(mergeFields))
    map.set('season_links', descSeasonLinks)
    return map
  }, [mergeFields, descSeasonLinks])

  // Editable raw body + its baked output. Baking is synchronous: substitute the
  // pre-resolved {season_links}, then the sync merge fields. The baked value is
  // what's pushed + compared by the out-of-sync check (meta.ytDescription).
  const descBody = meta?.ytDescriptionTemplate ?? meta?.ytDescription ?? ''
  const descBaked = useMemo(
    () => applyMergeFields(descBody.replace(/\{season_links\}/g, descSeasonLinks), mergeFields),
    [descBody, descSeasonLinks, mergeFields],
  )
  // True when the body contains at least one known merge-field token (i.e. a
  // chip). Without any, the preview would be identical to the editor, so the
  // edit⇄preview toggle is hidden.
  const descHasChips = useMemo(() => {
    const re = /\{(\w+)\}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(descBody)) !== null) {
      if (descMergeKeySet.has(m[1])) return true
    }
    return false
  }, [descBody, descMergeKeySet])
  // Write the baked output to meta.ytDescription whenever it diverges — but only
  // once the stream has adopted the template model (ytDescriptionTemplate set).
  // Legacy streams keep their stored resolved text untouched until first edit.
  // `descBody` reads the template (not ytDescription) when present, so the write
  // can't feed back into descBaked — no loop.
  useEffect(() => {
    if (meta?.ytDescriptionTemplate === undefined) return
    if (descBaked !== (meta?.ytDescription ?? '')) onUpdateMetaRef.current({ ytDescription: descBaked })
  }, [descBaked, meta?.ytDescriptionTemplate, meta?.ytDescription])

  // One-shot series auto-detect on first game-add. Only fires for streams
  // explicitly marked `seriesAutoDetectPending: true` at creation (the
  // regular "New stream" path) — existing legacy streams (no flag) are
  // left alone. Once a game tag exists, we look across all other folders
  // for siblings of the same game that are already series (explicit
  // `isSeries: true` OR legacy with a non-empty `ytEpisode` field, which
  // is the strongest signal that the legacy stream was actually being
  // used as a series). Match → bump this stream to series; no match →
  // leave standalone. Either way, clear the pending flag so the effect
  // never re-fires.
  // Derive the season + next episode this stream should inherit if it belongs
  // to an existing series for `primaryGame`. Returns null when no qualifying
  // sibling exists (same game, and either explicitly a series or a legacy
  // stream that was used as one — has an episode number). Season comes from
  // the most-recently-dated sibling (the series being continued); episode is
  // the next number for that game+season strictly before this stream's date.
  const computeSeriesNumbers = useCallback((primaryGame: string): { ytSeason: string; ytEpisode: string } | null => {
    const lower = primaryGame.trim().toLowerCase()
    if (!lower) return null
    const siblings = folders.filter(f =>
      f.folderPath !== folder.folderPath &&
      !f.isMissing &&
      ((f.meta?.games?.some(g => g.toLowerCase() === lower)) ||
       (f.detectedGames?.some(g => g.toLowerCase() === lower))) &&
      (f.meta?.isSeries === true || (f.meta?.isSeries === undefined && !!f.meta?.ytEpisode))
    )
    if (siblings.length === 0) return null
    const latest = siblings.reduce((a, b) => (b.date > a.date ? b : a))
    const season = latest.meta?.ytSeason || '1'
    const others = folders.filter(f => f.folderPath !== folder.folderPath)
    const episode = String(detectEpisodeNumber(others, primaryGame, season, folder.date))
    return { ytSeason: season, ytEpisode: episode }
  }, [folders, folder.folderPath, folder.date])

  useEffect(() => {
    if (!meta?.seriesAutoDetectPending) return
    const primary = resolvePrimaryGame(meta) || meta?.games?.[0]
    if (!primary) return
    const nums = computeSeriesNumbers(primary)
    if (!nums) {
      onUpdateMetaRef.current({ isSeries: false, seriesAutoDetectPending: undefined })
      return
    }
    // Match → promote to series and fill season/episode (without clobbering
    // anything the user already typed). Clear the pending flag either way.
    const update: Partial<StreamMeta> = { isSeries: true, seriesAutoDetectPending: undefined }
    if (!meta?.ytSeason) update.ytSeason = nums.ytSeason
    if (!meta?.ytEpisode) update.ytEpisode = nums.ytEpisode
    onUpdateMetaRef.current(update)
  }, [meta?.seriesAutoDetectPending, meta?.games, meta?.ytSeason, meta?.ytEpisode, folder.folderPath, folders, computeSeriesNumbers])

  // Auto-apply a linked YT tags template when a stream gains its first
  // game tag. Fires when the *primary game* transitions from absent to
  // present and only when `meta.ytTags` is currently empty (skip-silently
  // semantics — manual edits never get clobbered). Tracked per-folder
  // via a ref so switching between streams doesn't re-fire it for
  // a stream that already had its primary at mount.
  const prevPrimaryGameRef = useRef<{ folderPath: string; primary: string } | null>(null)
  useEffect(() => {
    const primary = meta?.games?.[0] ?? ''
    const prev = prevPrimaryGameRef.current
    const prevPrimary = prev?.folderPath === folder.folderPath ? prev.primary : ''
    prevPrimaryGameRef.current = { folderPath: folder.folderPath, primary }
    if (!primary || prevPrimary) return
    if (meta?.ytTags?.length) return
    const linkedId = gameTagsLinks[primary]
    if (!linkedId) return
    const tpl = ytTagTemplates.find(t => t.id === linkedId)
    if (!tpl || !tpl.tags.length) return
    onUpdateMetaRef.current({ ytTags: [...tpl.tags], ytTagsTemplateId: linkedId })
  }, [folder.folderPath, meta?.games, meta?.ytTags, gameTagsLinks, ytTagTemplates])

  // Lazy refresh of bound tag templates. If the bound YT/Twitch tag
  // template has been edited since the last time this stream was
  // touched, sync the local tags to the template's current value. If
  // the template was deleted, clear the orphaned binding. User-edited
  // streams already cleared their binding on chip mutation, so this
  // effect only runs when meta still claims to be template-bound.
  useEffect(() => {
    const id = meta?.ytTagsTemplateId
    if (!id) return
    const tpl = ytTagTemplates.find(t => t.id === id)
    if (!tpl) { onUpdateMetaRef.current({ ytTagsTemplateId: '' }); return }
    const current = meta?.ytTags ?? []
    const same = current.length === tpl.tags.length && current.every((t, i) => t === tpl.tags[i])
    if (!same) onUpdateMetaRef.current({ ytTags: [...tpl.tags] })
  }, [folder.folderPath, meta?.ytTagsTemplateId, meta?.ytTags, ytTagTemplates])

  useEffect(() => {
    const id = meta?.twitchTagsTemplateId
    if (!id) return
    const tpl = twitchTagTemplates.find(t => t.id === id)
    if (!tpl) { onUpdateMetaRef.current({ twitchTagsTemplateId: '' }); return }
    const current = meta?.twitchTags ?? []
    const same = current.length === tpl.tags.length && current.every((t, i) => t === tpl.tags[i])
    if (!same) onUpdateMetaRef.current({ twitchTags: [...tpl.tags] })
  }, [folder.folderPath, meta?.twitchTagsTemplateId, meta?.twitchTags, twitchTagTemplates])

  // Reset the ephemeral (non-persisted) template selections when the
  // user switches streams. Title / tags / twitch-tags selections aren't
  // reset here — they live in meta and naturally track the new folder
  // via the meta?.ytTitleTemplateId / ytTagsTemplateId / twitchTagsTemplateId
  // reads above.
  useEffect(() => {
    setDescTplId('')
  }, [folder.folderPath])

  // Keys ({game}, {season}, …) the title field's current body uses.
  // Driven directly by `meta.ytTitle` (the raw template body) rather
  // than the bound template, so hand-editing a token in or out of the
  // title immediately flips the corresponding row's highlight —
  // matching what's actually rendered, regardless of whether a
  // template is assigned.
  const activeTitleMergeKeys = useMemo<Set<string>>(() => {
    const body = meta?.ytTitle ?? ''
    if (!body) return new Set()
    const keys = new Set<string>()
    for (const m of body.matchAll(/\{(\w+)\}/g)) keys.add(m[1])
    return keys
  }, [meta?.ytTitle])
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
  const canSaveTwitchTitleTemplate = useMemo(() => {
    const v = (meta?.twitchTitle ?? '').trim()
    return v.length > 0 && !ytTitleTemplates.some(t => t.template === meta?.twitchTitle)
  }, [meta?.twitchTitle, ytTitleTemplates])
  // Compare the raw template body (`descBody`, the editable source) against
  // saved templates so the Save-as-template affordance reflects the tokens the
  // user sees, not the baked output.
  const canSaveDescTemplate = useMemo(() => {
    const v = descBody.trim()
    return v.length > 0 && !ytDescTemplates.some(t => t.description === descBody)
  }, [descBody, ytDescTemplates])
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
  // Suggested template name for tag editors — defaults to the primary
  // game (so series like "Hollow Knight" with `[tag1, tag2]` default to
  // a template named "Hollow Knight"). When a template with that name
  // already exists, the SaveAsTemplateButton's overwrite-confirm step
  // catches it — the suggestion itself is no longer suppressed.
  const suggestedTagTemplateName = useMemo(() => {
    const primary = resolvePrimaryGame(meta) || (meta?.games ?? folder.detectedGames)[0]
    return primary?.trim() || undefined
  }, [meta, folder.detectedGames])
  const suggestedTwitchTagTemplateName = suggestedTagTemplateName
  // Suggest applying a YT tag template whose name matches the primary
  // game tag, when there's no better signal already driving the tags:
  //  - skip when the primary game has an explicit gameTagsLinks entry
  //    (the empty→present effect handles that case)
  //  - skip when the stream is already bound to *any* template (user
  //    has made an explicit choice)
  //  - skip when current ytTags already equal the matched template's
  //    tags (nothing to suggest)
  // Twitch deliberately omitted — channel tags are streamer-wide, not
  // per-game, so basing them on the primary game isn't useful.
  const suggestedYtTagsTemplate = useMemo(() => {
    if (meta?.ytTagsTemplateId) return null
    const primary = (resolvePrimaryGame(meta) || (meta?.games ?? folder.detectedGames)[0])?.trim()
    if (!primary) return null
    if (gameTagsLinks[primary]) return null
    const lower = primary.toLowerCase()
    const match = ytTagTemplates.find(t => t.name.toLowerCase() === lower)
    if (!match) return null
    const current = meta?.ytTags ?? []
    if (current.length === match.tags.length && current.every((t, i) => t === match.tags[i])) return null
    return match
  }, [meta, folder.detectedGames, gameTagsLinks, ytTagTemplates])
  // Detect when this stream's current ytTags exactly match an existing
  // template's tags (case-insensitive set equality) — surfaces a "Bind
  // to 'X' template" link so legacy streams whose tags were typed in
  // before templates existed can opt into the binding without losing
  // any data. Only when:
  //  - not already bound to anything
  //  - has at least one tag
  //  - at least one template's tags exactly match
  // Prefers the template whose name matches the primary game when
  // multiple templates match (deterministic + matches user intent in
  // the common case). Twitch deliberately omitted to match the
  // suggested-template scope.
  const matchingTagTemplate = useMemo(() => {
    if (meta?.ytTagsTemplateId) return null
    const current = meta?.ytTags ?? []
    if (current.length === 0) return null
    const currentKey = current.map(t => t.toLowerCase()).sort().join('|')
    const matches = ytTagTemplates.filter(t => {
      if (t.tags.length !== current.length) return false
      return t.tags.map(x => x.toLowerCase()).sort().join('|') === currentKey
    })
    if (matches.length === 0) return null
    const primary = (resolvePrimaryGame(meta) || (meta?.games ?? folder.detectedGames)[0])?.trim().toLowerCase()
    if (primary) {
      const named = matches.find(t => t.name.toLowerCase() === primary)
      if (named) return named
    }
    return matches[0]
  }, [meta, folder.detectedGames, ytTagTemplates])
  // Wrappers that capture the current field value, persist, and select
  // the newly-saved template. For title, "select" means writing
  // ytTitleTemplateId to meta (persists across sessions). For the
  // others, the ephemeral selectedId in local state is updated.
  const handleSaveTitleTemplate = useCallback(async (name: string) => {
    const id = await onSaveYtTitleTemplate(name, meta?.ytTitle ?? '')
    onUpdateMeta({ ytTitleTemplateId: id })
  }, [onSaveYtTitleTemplate, meta?.ytTitle, onUpdateMeta])
  // Twitch title saves into the SAME Titles template store as the YT
  // title — the group is shared. Binds the new template to the Twitch
  // title only.
  const handleSaveTwitchTitleTemplate = useCallback(async (name: string) => {
    const id = await onSaveYtTitleTemplate(name, meta?.twitchTitle ?? '')
    onUpdateMeta({ twitchTitleTemplateId: id })
  }, [onSaveYtTitleTemplate, meta?.twitchTitle, onUpdateMeta])
  const handleSaveDescTemplate = useCallback(async (name: string) => {
    // Save the raw template body (tokens intact) so the template is reusable,
    // not the baked output for this one stream.
    const id = await onSaveYtDescTemplate(name, meta?.ytDescriptionTemplate ?? meta?.ytDescription ?? '')
    setDescTplId(id)
  }, [onSaveYtDescTemplate, meta?.ytDescriptionTemplate, meta?.ytDescription])
  const handleSaveTagsTemplate = useCallback(async (name: string) => {
    const id = await onSaveYtTagsTemplate(name, meta?.ytTags ?? [])
    onUpdateMetaRef.current({ ytTagsTemplateId: id })
  }, [onSaveYtTagsTemplate, meta?.ytTags])
  const handleSaveTwitchTagsTemplate = useCallback(async (name: string) => {
    const id = await onSaveTwitchTagsTemplate(name, meta?.twitchTags ?? [])
    onUpdateMetaRef.current({ twitchTagsTemplateId: id })
  }, [onSaveTwitchTagsTemplate, meta?.twitchTags])

  // Pick → write the raw template body into ytTitle verbatim and
  // record the binding. The title field IS the template now; the
  // preview below the field renders mergeFields against this body on
  // every keystroke. Clearing (id === '') leaves the body intact so
  // the user can keep editing what's there as plain text.
  const applyTitleTemplate = (id: string) => {
    if (!id) { onUpdateMeta({ ytTitleTemplateId: '' }); return }
    const tpl = ytTitleTemplates.find(t => t.id === id)
    if (tpl) onUpdateMeta({ ytTitle: tpl.template, ytTitleTemplateId: id })
    else onUpdateMeta({ ytTitleTemplateId: id })
  }
  const applyTwitchTitleTemplate = (id: string) => {
    if (!id) { onUpdateMeta({ twitchTitleTemplateId: '' }); return }
    const tpl = ytTitleTemplates.find(t => t.id === id)
    if (tpl) onUpdateMeta({ twitchTitle: tpl.template, twitchTitleTemplateId: id })
    else onUpdateMeta({ twitchTitleTemplateId: id })
  }
  const applyDescTemplate = (id: string) => {
    setDescTplId(id)
    if (!id) return
    const tpl = ytDescTemplates.find(t => t.id === id)
    if (!tpl) return
    // Store the raw template body (with tokens) as the editable source + bake
    // it into the resolved `ytDescription` using the already-resolved
    // {season_links}. The bake effect keeps ytDescription in sync on later
    // edits (and re-bakes once season_links finishes resolving for a fresh
    // stream).
    const baked = applyMergeFields(tpl.description.replace(/\{season_links\}/g, descSeasonLinks), mergeFields)
    onUpdateMeta({ ytDescriptionTemplate: tpl.description, ytDescription: baked })
  }
  const applyTagsTemplate = (id: string) => {
    if (!id) { onUpdateMeta({ ytTagsTemplateId: '' }); return }
    const tpl = ytTagTemplates.find(t => t.id === id)
    if (tpl) onUpdateMeta({ ytTags: tpl.tags, ytTagsTemplateId: id })
    else onUpdateMeta({ ytTagsTemplateId: id })
  }
  const applyTwitchTagsTemplate = (id: string) => {
    if (!id) { onUpdateMeta({ twitchTagsTemplateId: '' }); return }
    const tpl = twitchTagTemplates.find(t => t.id === id)
    if (tpl) onUpdateMeta({ twitchTags: tpl.tags, twitchTagsTemplateId: id })
    else onUpdateMeta({ twitchTagsTemplateId: id })
  }
  const handleTwitchTitleSave = (v: string) => {
    // Mirror handleTitleSave: hand-editing away from the bound
    // template's body clears the binding.
    const partial: Partial<StreamMeta> = { twitchTitle: v }
    if (twitchTitleTplId) {
      const tpl = ytTitleTemplates.find(t => t.id === twitchTitleTplId)
      if (tpl && tpl.template !== v) partial.twitchTitleTemplateId = ''
    }
    onUpdateMeta(partial)
  }
  const handleTitleSave = (v: string) => {
    // The title field stores the raw template body. Diverging from the
    // bound template's body means the user hand-edited the template
    // for this stream — clear the binding so future template edits
    // don't surprise them with a remote overwrite via lazy-refresh.
    // Both writes go through one updateMeta call so the disk write is
    // atomic.
    const partial: Partial<StreamMeta> = { ytTitle: v }
    if (titleTplId) {
      const tpl = ytTitleTemplates.find(t => t.id === titleTplId)
      if (tpl && tpl.template !== v) partial.ytTitleTemplateId = ''
    }
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
  // Previous taglines in the same (game, season) — sent to the
  // tagline Claude prompt so suggestions don't repeat or closely
  // paraphrase taglines the user has already shipped in the series.
  // Standalone streams (no series concept) skip the season match and
  // just key off the primary game. Capped at 20 to keep the prompt
  // bounded for long-running series.
  const previousTaglines = useMemo<string[]>(() => {
    const primary = (resolvePrimaryGame(meta) || meta?.games?.[0] || folder.detectedGames?.[0] || '').trim().toLowerCase()
    if (!primary) return []
    const season = meta?.ytSeason || '1'
    const standalone = isStandalone(meta)
    const seen = new Set<string>()
    const out: string[] = []
    for (const f of folders) {
      if (f.folderPath === folder.folderPath) continue
      const fm = f.meta
      const tagline = fm?.ytCatchyTitle?.trim()
      if (!tagline) continue
      const fPrimary = (resolvePrimaryGame(fm) || fm?.games?.[0] || '').trim().toLowerCase()
      if (fPrimary !== primary) continue
      if (!standalone && (fm?.ytSeason || '1') !== season) continue
      const key = tagline.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(tagline)
      if (out.length >= 20) break
    }
    return out
  }, [folders, folder.folderPath, folder.detectedGames, meta])
  const buildAiContext = useCallback(() => ({
    date: folder.date,
    streamTypes: normalizeStreamTypes(meta?.streamType),
    games: meta?.games?.length ? meta.games : folder.detectedGames,
    currentTitle: meta?.ytTitle || undefined,
    currentDescription: meta?.ytDescription || undefined,
    currentYtTags: meta?.ytTags?.length ? meta.ytTags : undefined,
    currentTwitchTags: meta?.twitchTags?.length ? meta.twitchTags : undefined,
    previousTaglines: previousTaglines.length ? previousTaglines : undefined,
  }), [folder.date, folder.detectedGames, meta?.streamType, meta?.games, meta?.ytTitle, meta?.ytDescription, meta?.ytTags, meta?.twitchTags, previousTaglines])
  const aiFetchTitle = useMemo(() => claudeEnabled
    ? (prefix: string, suffix: string) => window.api.claudeGenerate('title', { ...buildAiContext(), prefix, suffix })
    : undefined, [claudeEnabled, buildAiContext])
  // Description fetcher — Ctrl+Space inside the TemplateBodyEditor asks Claude
  // for description text at the caret (full body when the field is empty,
  // mid-field insertion otherwise). `prefix`/`suffix` are the source text on
  // either side of the caret, supplied by the editor.
  const aiFetchDescription = useMemo(() => claudeEnabled
    ? (prefix: string, suffix: string) => window.api.claudeGenerate('description', { ...buildAiContext(), prefix, suffix })
    : undefined, [claudeEnabled, buildAiContext])
  // Tagline fetcher — Ctrl+Space inside the Tagline EditableTextField
  // asks Claude for a catchy 3–8 word phrase grounded in the topic,
  // description, and tags, and explicitly avoiding `previousTaglines`
  // already used in this (game, season) bucket.
  const aiFetchTagline = useMemo(() => claudeEnabled
    ? (prefix: string, suffix: string) => window.api.claudeGenerate('tagline', { ...buildAiContext(), prefix, suffix })
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

  // Defer non-critical on-open YouTube fetches past the sidebar slide so their
  // setYt* updates — which re-render the (unmemoized) streams list — don't land
  // mid-animation. 0 when animations are off, so it's a no-op delay then.
  const anim = useAnimationConfig()
  const deferMs = anim.duration(230)

  // If a stream is linked to a broadcast we haven't loaded into its pool yet,
  // fetch the single record so the picker can show its name (and the privacy /
  // time row can resolve) instead of leaving it "unlinked". Common path: a past
  // stream whose VOD isn't in ytVods until the user opens the dropdown.
  useEffect(() => {
    if (!linkedId) return
    if (broadcastPool.some(b => b.id === linkedId)) return
    let cancelled = false
    const timer = setTimeout(() => {
      // The linked broadcast isn't in its pool, so fetch it and add it. Past
      // streams pull from the VODs endpoint; future streams from the broadcasts
      // endpoint. We can't treat an upcoming-broadcast miss as "deleted on YT":
      // the bulk load that fills ytBroadcasts is small + unpaginated
      // (maxResults 50/10/5) and runs once at page mount, so a broadcast
      // scheduled after that — or simply beyond those caps on a busy channel —
      // is legitimately absent. Without this future branch such a stream shows
      // "unlinked" with the privacy dropdown stuck on "Loading…" until a restart
      // re-runs the bulk load, and the reschedule modal won't offer the YouTube
      // update since it keys off this same pool.
      const lookup = isPastStream
        ? window.api.youtubeGetVideoById(linkedId).then(video => {
            if (cancelled || !video) return
            setYtVods(prev => prev.some(v => v.id === video.id) ? prev : [video, ...prev])
          })
        : window.api.youtubeGetBroadcastById(linkedId).then(bc => {
            if (cancelled || !bc) return
            setYtBroadcasts(prev => prev.some(b => b.id === bc.id) ? prev : [bc, ...prev])
          })
      lookup.catch(() => {})
    }, deferMs)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [linkedId, broadcastPool, isPastStream, setYtVods, setYtBroadcasts, deferMs])

  // Auto-refresh the currently-open stream's linked broadcast — once
  // on mount (and whenever the stream changes), then every 5 minutes
  // while the sidebar stays open. Keeps the direction-aware mismatch
  // dots fresh against YouTube state so Studio edits the user makes
  // outside SM become visible within the interval window. Only this
  // one broadcast — no bulk poll — since the user is only looking at
  // one stream at a time. Failure is silent: the dot just stays stale
  // until the next interval / next stream open / the page refresh
  // button.
  useEffect(() => {
    if (!ytConnected || !linkedId) return
    // Don't keep firing requests we know will fail. The main process
    // short-circuits them anyway, but skipping here avoids the
    // error-throw round-trip and the console noise. The effect re-runs
    // when quota state changes (auto-clears at midnight PT), so the
    // interval naturally resumes after reset.
    if (quotaExceeded) return
    let cancelled = false
    const refresh = async () => {
      try {
        const fresh = (await window.api.youtubeGetBroadcastById(linkedId))
          ?? (await window.api.youtubeGetVideoById(linkedId))
        if (cancelled || !fresh) return
        // Upsert into whichever pool the broadcast belongs to. We don't
        // know live vs VOD at the call site, so try both — only one
        // will match an existing id, and the unmatched setter no-ops.
        // Identity-preserving when the fetched data is unchanged: returning
        // prev untouched skips the state update entirely. Without this, the
        // on-open refresh landed a new-array/new-object update right at the
        // sidebar slide's tail on EVERY open (a full page + SidebarDetail
        // re-render for byte-identical data) — a visible animation hitch.
        const upsertIfChanged = (prev: typeof ytBroadcasts): typeof ytBroadcasts => {
          const idx = prev.findIndex(item => item.id === fresh.id)
          if (idx === -1) return prev
          if (JSON.stringify(prev[idx]) === JSON.stringify(fresh)) return prev
          return prev.map(item => item.id === fresh.id ? fresh : item)
        }
        setYtBroadcasts(upsertIfChanged)
        setYtVods(upsertIfChanged)
      } catch {
        // Silent — next interval / open / manual refresh will retry.
      }
    }
    // Initial refresh deferred past the slide; the 5-min interval is unaffected.
    const initialTimer = setTimeout(refresh, deferMs)
    const interval = setInterval(refresh, 5 * 60 * 1000)
    return () => {
      cancelled = true
      clearTimeout(initialTimer)
      clearInterval(interval)
    }
  }, [ytConnected, linkedId, quotaExceeded, setYtBroadcasts, setYtVods, deferMs])

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

  // Transient "Copied!" state for the copy-broadcast-URL button.
  // Resets via timeout — see copyBroadcastUrl below.
  const [copiedUrl, setCopiedUrl] = useState(false)
  // Displayed privacy: staged local value first, falls back to YouTube's
  // current status (so existing streams without an explicit override
  // show the remote value as their starting point). Mirrors the same
  // staged-edit pattern as `displayedScheduledTime`.
  const displayedPrivacy = (meta?.ytPrivacyStatus ?? selectedBroadcast?.status?.privacyStatus) as
    | 'public' | 'unlisted' | 'private' | undefined
  // Upcoming-broadcast time picker. Only show the picker when we have a
  // future-dated broadcast (`scheduledStartTime` set + `actualStartTime`
  // absent — past / live broadcasts can't have their schedule edited
  // via the YT API). The displayed value falls back to the broadcast's
  // current scheduledStartTime when the user hasn't overridden it
  // locally, so the input shows YouTube's value as a starting point
  // rather than blank "None".
  const broadcastScheduledTimeHHMM = useMemo(() => {
    const iso = selectedBroadcast?.snippet.scheduledStartTime
    if (!iso) return ''
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }, [selectedBroadcast?.snippet.scheduledStartTime])
  const isUpcomingBroadcast = !!(
    selectedBroadcast?.snippet.scheduledStartTime &&
    !selectedBroadcast.snippet.actualStartTime
  )
  const displayedScheduledTime = meta?.scheduledTime ?? broadcastScheduledTimeHHMM

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

  // Thumbnail-change detection for the YT push button. SHA-1 the
  // currently-selected thumbnail's bytes; compare against
  // meta.ytThumbnailPushedHash (set after every successful push). A
  // hash difference → the thumbnail has changed since it was last
  // pushed (or was never pushed) → the button should offer to push
  // even when title/desc/tags are otherwise in sync. Hashing rather
  // than mtime is intentional: cloud-sync clients touch mtimes when
  // mirroring files, so an mtime check would flag every cloud-synced
  // thumbnail as "changed" even when the bytes are identical.
  // Re-runs on `thumbsKey` so the thumbnail-editor save flow refreshes
  // it: the editor writes a new PNG, the streams page bumps thumbsKey,
  // this effect fires, and the button updates without a manual reload.
  const [currentThumbnailHash, setCurrentThumbnailHash] = useState<string | null>(null)
  useEffect(() => {
    if (!effectiveYtThumb) { setCurrentThumbnailHash(null); return }
    let cancelled = false
    window.api.thumbnailHashFile(effectiveYtThumb)
      .then(h => { if (!cancelled) setCurrentThumbnailHash(h) })
      .catch(() => { if (!cancelled) setCurrentThumbnailHash(null) })
    return () => { cancelled = true }
  }, [effectiveYtThumb, thumbsKey])
  const thumbnailNeedsPush =
    !!effectiveYtThumb &&
    currentThumbnailHash !== null &&
    currentThumbnailHash !== meta?.ytThumbnailPushedHash

  // Per-button push-in-flight state. Drives the spinner icon and
  // disables the button while the network call is outstanding, so the
  // user knows the click registered (banner only appears AFTER the
  // request settles, which can be several seconds for a thumbnail
  // upload).
  const [ytPushing, setYtPushing] = useState(false)
  const [twPushing, setTwPushing] = useState(false)

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
      const title = renderStreamTitle(folder, folders) || 'Untitled stream'
      const description = meta?.ytDescription || ''
      const tags = meta?.ytTags ?? []
      const created = await window.api.youtubeCreateBroadcast({
        title,
        description,
        scheduledStartTime,
        privacyStatus: newBroadcastPrivacy,
      })

      // youtubeCreateBroadcast only sets title/description/scheduled
      // time/privacy. Tags and the thumbnail need a separate
      // updateBroadcast + uploadThumbnail pair, otherwise the new
      // broadcast is missing those until the user manually runs Push
      // to YouTube. Do the follow-up here so the broadcast is fully
      // configured in a single user action.
      let thumbnailPushedHash: string | undefined
      let followupWarning = ''
      try {
        if (tags.length > 0) {
          await window.api.youtubeUpdateBroadcast(created.id, { title, description }, tags)
        }
        if (effectiveYtThumb) {
          await window.api.youtubeUploadThumbnail(created.id, effectiveYtThumb)
          // Record the hash so the sidebar's thumbnail-needs-push
          // detection sees the new broadcast as already in sync.
          try {
            const hash = await window.api.thumbnailHashFile(effectiveYtThumb)
            if (hash) thumbnailPushedHash = hash
          } catch {}
        }
      } catch (err: any) {
        // The broadcast itself was created — only the follow-up push
        // failed. Surface the warning but keep the linkage so the
        // user can retry from the regular Push to YouTube button.
        followupWarning = `Broadcast created, but follow-up push failed: ${err?.message ?? String(err)}`
      }

      // Inject tags into the cached broadcast so the broadcastMismatch
      // detection treats it as in-sync without waiting for a reload.
      const enriched = tags.length > 0
        ? { ...created, snippet: { ...created.snippet, tags } }
        : created
      setYtBroadcasts(prev => [enriched, ...prev])
      const metaPatch: Partial<StreamMeta> = { ytVideoId: created.id }
      if (thumbnailPushedHash) metaPatch.ytThumbnailPushedHash = thumbnailPushedHash
      onUpdateMeta(metaPatch)
      if (followupWarning) setCreateError(followupWarning)
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
  // Extracts the LOCAL calendar date (YYYY-MM-DD) from a broadcast's
  // scheduledStartTime ISO string. We compare against `folder.date`
  // which is also a local YYYY-MM-DD string; doing the comparison in
  // UTC would misclassify any broadcast whose scheduled time straddles
  // midnight in the user's timezone.
  const localDateFromIso = useCallback((iso: string): string => {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])

  // Per-field mismatch map — each key is a field id, each value is the
  // direction of the divergence:
  //   'local'   → user changed it in SM (push to sync)
  //   'remote'  → user changed it in YouTube Studio (pull to sync)
  //   'both'    → both sides changed since last sync (conflict)
  //   'unknown' → no `ytLastPushed*` snapshot to compare against
  //               (legacy stream / never sync'd since this feature
  //               shipped) — we can't tell direction, render the
  //               neutral dot.
  // Drives the inline dot indicator on each MetaRow. The
  // `broadcastMismatch` boolean below derives from `.size > 0` and is
  // what the Push/Pull buttons gate on.
  // Per-field local↔YouTube divergence map (see lib/broadcastMismatch). Drives
  // the inline dot on each MetaRow; `broadcastMismatch` below derives from
  // `.size > 0` and gates the Push/Pull buttons. The same fn powers the
  // empty-state Out-of-sync panel so both agree on what "out of sync" means.
  const broadcastMismatches = useMemo(
    () => computeBroadcastMismatch(folder, folders, selectedBroadcast),
    [folder, folders, selectedBroadcast],
  )
  const broadcastMismatch = broadcastMismatches.size > 0

  return (
    <div ref={sidebarRootRef} className="@container flex flex-col h-full overflow-hidden">
      {/* Header — top row: date (left) · episode nav (center) · close X
          (right). Bottom row: full title. The series label "S1 · E3" is
          surfaced as a metadata row below rather than here, since it's
          part of the metadata content and the header is for identity +
          navigation chrome. */}
      <div className="ps-4 pe-2 pt-3 pb-4 border-b border-white/5 shrink-0 flex flex-col gap-2">
        <div className="relative flex items-center gap-2">
          <Tooltip content="Reschedule stream" side="bottom">
            <button
              type="button"
              onClick={() => onReschedule(broadcastMismatches.get('date'))}
              className="text-xs text-gray-400 font-mono tabular-nums hover:text-purple-300 hover:bg-white/5 rounded px-1.5 py-0.5 -ml-1.5 transition-colors flex items-center gap-1"
            >
              <span>{folder.date}</span>
              <PencilLine size={9} className="opacity-50" />
              {/* Direction-aware mismatch dot for the date — same
                  color/tooltip scheme as the MetaRow dots. Sits inside
                  the date button so a click on either still opens the
                  reschedule modal (which becomes the venue for the
                  pull-from-YouTube flow when the dot is 'remote'). */}
              {broadcastMismatches.get('date') && (() => {
                const dir = broadcastMismatches.get('date')!
                const cls = dir === 'local' ? 'bg-blue-400'
                  : dir === 'remote' ? 'bg-orange-400'
                  : dir === 'both' ? 'bg-gradient-to-br from-blue-400 to-orange-400'
                  : 'bg-gray-400'
                const pulseColor = dir === 'local' ? 'rgba(96, 165, 250, 0.7)'
                  : dir === 'remote' ? 'rgba(251, 146, 60, 0.7)'
                  : dir === 'both' ? 'rgba(168, 85, 247, 0.7)'
                  : 'rgba(156, 163, 175, 0.7)'
                return (
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full mismatch-dot-pulse ${cls} ml-0.5`}
                    style={{ ['--pulse-color' as any]: pulseColor }}
                  />
                )
              })()}
            </button>
          </Tooltip>
          {(prevEpisode || nextEpisode || isStandalone(meta)) && (
            <div className="flex items-center gap-0.5">
              {/* Jump-to-episode — only meaningful when there are
                  siblings beyond the immediate prev/next. With exactly
                  two episodes the chevrons already cover the navigation
                  and a picker would be redundant. Sits to the LEFT of
                  the chevrons to match PlayerPage's [List, Prev, Next]
                  ordering. Not rendered for standalone streams (no
                  siblings concept) — just the disabled chevrons remain
                  as a visible affordance. */}
              {seriesEpisodes.length > 2 && (
                <Tooltip content="Jump to episode…" side="bottom">
                  <button
                    ref={episodePickerAnchorRef}
                    type="button"
                    onClick={() => setEpisodePickerOpen(v => !v)}
                    className={`p-1 rounded transition-colors ${
                      episodePickerOpen
                        ? 'bg-white/10 text-gray-200'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                    }`}
                    aria-label="Jump to episode"
                  >
                    <List size={13} />
                  </button>
                </Tooltip>
              )}
              <Tooltip content={prevEpisode ? `Previous episode (E${prevEpisode.meta?.ytEpisode || '?'})` : 'No previous episode'} side="bottom" shortcut={prevEpisode ? 'Ctrl+Shift+↓' : undefined}>
                <button
                  type="button"
                  onClick={() => prevEpisode && onPickEpisode(prevEpisode)}
                  disabled={!prevEpisode}
                  className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-gray-400"
                >
                  <ChevronsDown size={13} />
                </button>
              </Tooltip>
              <Tooltip content={nextEpisode ? `Next episode (E${nextEpisode.meta?.ytEpisode || '?'})` : 'No next episode'} side="bottom" shortcut={nextEpisode ? 'Ctrl+Shift+↑' : undefined}>
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
          {/* Picker dropdown — portal-rendered so the sidebar's
              overflow-hidden + scrolling content can't clip it.
              Anchored to the List button's screen rect; flips to drop
              up if the button is in the bottom half of the viewport,
              and clamps height into the available space either way.
              Click outside or pick a row → close. */}
          {episodePickerOpen && episodePickerAnchorRef.current && ReactDOM.createPortal(
            (() => {
              const r = episodePickerAnchorRef.current.getBoundingClientRect()
              const dropUp = r.top > window.innerHeight / 2
              const positionStyle: React.CSSProperties = dropUp
                ? {
                    position: 'fixed',
                    bottom: window.innerHeight - r.top + 4,
                    right: Math.max(8, window.innerWidth - r.right),
                    zIndex: 61,
                    maxHeight: Math.max(160, r.top - 16),
                  }
                : {
                    position: 'fixed',
                    top: r.bottom + 4,
                    right: Math.max(8, window.innerWidth - r.right),
                    zIndex: 61,
                    maxHeight: Math.max(160, window.innerHeight - r.bottom - 16),
                  }
              return (
                <>
                  <div className="fixed inset-0 z-[60]" onClick={() => setEpisodePickerOpen(false)} />
                  <div
                    style={positionStyle}
                    className="bg-navy-700 border border-white/10 rounded-lg shadow-xl min-w-[240px] max-w-[320px] overflow-y-auto py-1"
                  >
                    {/* Reverse-chronological display order — newest
                        episode at top — even though seriesEpisodes is
                        sorted ascending by episode number for the
                        prev/next semantics elsewhere. `.slice()` copies
                        the array so the reverse() doesn't mutate the
                        memoized list. */}
                    {seriesEpisodes.slice().reverse().map(ep => {
                      const isCurrent = ep.folderPath === folder.folderPath
                      const epNum = ep.meta?.ytEpisode || '?'
                      const epTitle = renderStreamTitle(ep, folders)
                      return (
                        <button
                          key={ep.folderPath}
                          type="button"
                          onClick={() => {
                            if (isCurrent) return
                            onPickEpisode(ep)
                            setEpisodePickerOpen(false)
                          }}
                          disabled={isCurrent}
                          className={`flex items-baseline gap-2 w-full px-3 py-1 text-xs text-left transition-colors ${
                            isCurrent
                              ? 'bg-purple-900/25 text-purple-300 cursor-default'
                              : 'text-gray-300 hover:bg-white/5'
                          }`}
                        >
                          <span className={`tabular-nums shrink-0 w-6 text-right ${isCurrent ? 'text-purple-300' : 'text-gray-400'}`}>{epNum}:</span>
                          <span className={`tabular-nums shrink-0 ${isCurrent ? 'text-purple-300' : 'text-gray-400'}`}>{ep.date}</span>
                          <span className={`shrink-0 ${isCurrent ? 'text-purple-300' : 'text-gray-400'}`}>·</span>
                          <TruncatedText text={epTitle} className={`truncate ${isCurrent ? 'text-purple-300 font-medium' : 'text-gray-200'}`} />
                        </button>
                      )
                    })}
                  </div>
                </>
              )
            })(),
            document.body,
          )}
          {/* Archived flag — marks the stream archived (excludes it from the
              "pending" set). Absolutely centered in the header row, clear of the
              date/nav on the left and the close button on the right. */}
          <Checkbox
            checked={meta?.archived ?? false}
            onChange={(v) => onUpdateMeta({ archived: v })}
            label="Archived"
            color="green"
            size="sm"
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          />
          <Tooltip content="Close" side="bottom" triggerClassName="ml-auto">
            <Button
              variant="danger"
              size="sm"
              icon={<X size={14} />}
              onClick={onClose}
              aria-label="Close"
            />
          </Tooltip>
        </div>
        {/* Wraps rather than truncates, so the full title is always visible —
            no tooltip needed (the old native title= was redundant). */}
        <div className="text-base font-semibold text-gray-100 break-words leading-snug">
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
            {/* — Media — every file in the folder (videos + thumbnail images).
                Leads the sidebar so past streams open straight onto their
                recordings; absent only for an empty folder. */}
            {(folder.videos.length > 0 || folder.thumbnails.length > 0) && (
              <div className="flex flex-col gap-3">
                <MetaRow label="Media">
                  <StreamFilesGrid
                    folder={folder}
                    thumbsKey={thumbsKey}
                    preferredThumbnail={meta?.preferredThumbnail}
                    cloudSyncActive={cloudSyncActive}
                    onSendToPlayer={onSendFileToPlayer}
                    onSendToConverter={onSendFileToConverter}
                    onSendFilesToConverter={onSendFilesToConverter}
                    ref={filesGridRef}
                    onSetThumbnail={(filePath) => onUpdateMeta({ preferredThumbnail: filePath.split(/[\\/]/).pop() ?? '' })}
                    onDeleteThumbnail={onDeleteThumbnail}
                    onEditThumbnail={onOpenThumbnails}
                    onOpenLightbox={i => setLightboxIndex(i)}
                    onFilesDeleted={onFilesDeleted}
                  />
                </MetaRow>
              </div>
            )}
            {/* — Tags (SM-level: stream type + topics/games) — Order
                matches the streams list columns (Type, then Games) so
                the eye lands in the same place in both views. */}
            {/* Single SM-metadata row — five fields on one horizontal
                line above ~800px container width, wrapping the whole
                Series group (checkbox + Season + Episode) to a second
                line below that threshold. Container query (not media
                query) so the breakpoint tracks the sidebar's actual
                width, not the viewport's. `@container` here scopes
                child `@[800px]:` rules to this element.
                Stream Type + Topics/Games stay flex-grow with a 10rem
                basis so the two tag combos share remaining space; the
                Series group's `basis-full` forces a wrap below the
                breakpoint while `@[800px]:basis-auto` lets it inline
                above it. */}
            <div className="@container">
              <div className="flex gap-3 flex-wrap">
                <div className="flex-1 min-w-0 basis-40">
                  <MetaRow label="Stream type">
                    <TagComboBox
                      values={normalizeStreamTypes(meta?.streamType)}
                      onChange={next => onUpdateMeta({ streamType: next })}
                      allOptions={allStreamTypes}
                      placeholder="e.g. games, other…"
                      emptyLabel="No types"
                      tagColors={tagColors}
                      tagTextures={tagTextures}
                      onNewTag={onNewStreamType}
                      compact
                    />
                  </MetaRow>
                </div>
                <div className="flex-1 min-w-0 basis-40">
                  <MetaRow
                    label="Topics / Games"
                    mergeHint="{topic}"
                    highlighted={activeTitleMergeKeys.has('topic') || activeTitleMergeKeys.has('topics') || activeTitleMergeKeys.has('game') || activeTitleMergeKeys.has('games')}
                    mismatched={broadcastMismatches.get('gameTitle')}
                  >
                    <TagComboBox
                      values={meta?.games ?? []}
                      onChange={next => onUpdateMeta({ games: next })}
                      allOptions={allGames}
                      placeholder="Add topic or game…"
                      emptyLabel="No topics added"
                      compact
                      // Selection drives `meta.primaryGame` — the value
                      // used by both the YT title's {game} merge field and
                      // the Twitch category push. `resolvePrimaryGame`
                      // falls back to games[0] when no explicit primary
                      // exists, so the ring is always on *some* chip when
                      // the list is non-empty.
                      selectedValue={resolvePrimaryGame(meta)}
                      onSelectValue={v => onUpdateMeta({ primaryGame: v })}
                      reorderable
                    />
                  </MetaRow>
                </div>
                <div className="flex flex-col basis-full @[800px]:basis-auto">
                  <Checkbox
                    checked={meta?.isSeries !== false}
                    // Also clear the auto-detect pending flag — a manual
                    // toggle means the user owns the value going forward.
                    // Without this, clearing then re-adding games[] later
                    // could silently flip the user's choice. Enabling Series
                    // also fills season/episode from a matching existing
                    // series (same logic as the auto-detect), so turning it
                    // on by hand isn't left with empty placeholder fields.
                    onChange={v => {
                      if (!v) { onUpdateMeta({ isSeries: false, seriesAutoDetectPending: undefined }); return }
                      const primary = resolvePrimaryGame(meta) || meta?.games?.[0] || ''
                      const nums = primary ? computeSeriesNumbers(primary) : null
                      const update: Partial<StreamMeta> = { isSeries: true, seriesAutoDetectPending: undefined }
                      if (nums) {
                        if (!meta?.ytSeason) update.ytSeason = nums.ytSeason
                        if (!meta?.ytEpisode) update.ytEpisode = nums.ytEpisode
                      }
                      onUpdateMeta(update)
                    }}
                    label={<span className="text-[11px] text-gray-400">Series</span>}
                  />
                  {!isStandalone(meta) && (
                    <div className="flex items-center gap-3">
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
                  )}
                </div>
              </div>
            </div>
            {/* — YouTube — */}
            <div className="flex flex-col gap-3">
            {/* YouTube title — pushed below the merge-field params since the
                title is normally derived from them via a template. The
                template selector reads "Assign template" (vs "Apply template"
                on description / tags) because picking one here BINDS the
                template to the stream — future merge-field edits keep
                re-rendering it until the user clears or hand-edits. */}
            <MetaRow
              label="YouTube title"
              attachRight
              mismatched={broadcastMismatches.get('title')}
              right={
                <div className="flex items-center gap-2">
                  {canSaveTitleTemplate && <SaveAsTemplateButton onSave={handleSaveTitleTemplate} />}
                  <InlineTemplateSelect
                    items={ytTitleTemplates}
                    value={titleTplId}
                    onChange={applyTitleTemplate}
                    placeholder="Assign template"
                    icon={<Link2 size={11} />}
                    tabbed
                    tabActive={!!titleTplId}
                  />
                </div>
              }
            >
              <TemplateBodyEditor
                value={meta?.ytTitle ?? ''}
                placeholder="Title for YouTube upload…"
                onSave={handleTitleSave}
                tabAttached
                tabActive={!!titleTplId}
                knownKeys={titleMergeKeySet}
                inapplicableKeys={titleInapplicableKeySet}
                insertRef={titleInsertRef}
                aiFetcher={aiFetchTitle}
              />
              <MergeFieldPicker
                keys={titlePickerKeys}
                onInsert={k => titleInsertRef.current?.(`{${k}}`)}
              />
              {/* Preview + char counter. Preview only shows when the
                  body contains a merge-field token (a static title would
                  just echo itself). The counter always shows and counts
                  the *resolved* title — that's the string that publishes
                  + is what the limit applies to. */}
              {(() => {
                const rendered = applyMergeFields(meta?.ytTitle ?? '', mergeFields)
                return (
                  <>
                    {hasYtTitleMergeFields(meta?.ytTitle ?? '') && (
                      <p className="mt-2 text-xs text-gray-200 leading-snug flex items-baseline gap-1.5">
                        <span className="text-[10px] text-gray-500 uppercase tracking-wide shrink-0">Preview</span>
                        <span>{rendered || <span className="italic text-gray-500">(empty)</span>}</span>
                      </p>
                    )}
                    <TitleCharCounter count={rendered.length} limit={YT_TITLE_CHAR_LIMIT} />
                  </>
                )
              })()}
            </MetaRow>
            {/* Tagline — purely a title-driver, so it lives directly
                below the title field. Label + merge-hint badge format
                mirrors Topics / Games so the merge-fed fields read
                consistently. Highlighted when the bound template's
                body references {tagline} or {title} (both alias to
                ytCatchyTitle). */}
            <MetaRow
              label="Tagline"
              mergeHint="{tagline}"
              highlighted={taglineActive}
            >
              <EditableTextField
                value={meta?.ytCatchyTitle ?? ''}
                placeholder="catchy tagline…"
                onSave={v => onUpdateMeta({ ytCatchyTitle: v })}
                aiFetcher={aiFetchTagline}
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
                <MetaRow label="YouTube thumbnail" mismatched={!!selectedBroadcast && thumbnailNeedsPush ? 'local' : undefined}>
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
              mismatched={broadcastMismatches.get('description')}
              right={
                <div className="flex items-center gap-2">
                  {descHasChips && (
                    <Tooltip content={descPreview ? 'Back to editing' : 'Preview rendered text'} side="top">
                      <button
                        type="button"
                        onClick={() => setDescPreview(p => !p)}
                        className={`p-1 rounded transition-colors ${descPreview ? 'bg-white/10 text-gray-200' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}`}
                        aria-label={descPreview ? 'Back to editing' : 'Preview rendered text'}
                      >
                        {descPreview ? <PencilLine size={13} /> : <Eye size={13} />}
                      </button>
                    </Tooltip>
                  )}
                  {canSaveDescTemplate && <SaveAsTemplateButton onSave={handleSaveDescTemplate} />}
                  <InlineTemplateSelect
                    items={ytDescTemplates}
                    value={descTplId}
                    onChange={applyDescTemplate}
                    placeholder="Start with template"
                    labelOverride={descBody.trim() ? 'Overwrite with template' : 'Start with template'}
                    icon={<ListRestart size={11} />}
                    tabbed
                  />
                </div>
              }
            >
              {/* Edit mode: chip editor showing each merge field's resolved
                  value inline (so the body reads like the final description),
                  fully editable. Preview mode: the resolved plain text,
                  read-only. The editable source is the raw body
                  (`ytDescriptionTemplate`); a bake effect resolves it into
                  `meta.ytDescription` (what's pushed + compared). Legacy streams
                  fall back to the already-resolved `ytDescription`. `key`
                  remounts on stream switch so editor state resets. */}
              {descPreview && descHasChips ? (
                // Mirrors the editor's box exactly (same padding, text size,
                // line-height, min-height, border) + the same drag-resize strip
                // and shared `descHeight` so toggling edit⇄preview doesn't shift
                // the layout. A div (not <pre>) inherits the app sans font.
                <div className="w-full flex flex-col">
                  <div
                    ref={descPreviewRef}
                    className="relative z-10 w-full bg-navy-900/70 border border-white/10 rounded-lg rounded-tr-none px-2 py-1 text-xs text-gray-200 leading-relaxed whitespace-pre-wrap overflow-y-auto"
                    style={{ minHeight: 96, height: descHeight ?? undefined }}
                  >
                    {(meta?.ytDescription ?? '') || <span className="italic text-gray-500">Description for YouTube upload…</span>}
                  </div>
                  <div
                    onMouseDown={(e) => {
                      e.preventDefault()
                      const el = descPreviewRef.current
                      if (!el) return
                      const startY = e.clientY
                      const startHeight = el.offsetHeight
                      const onMove = (me: MouseEvent) => setDescHeight(Math.max(40, startHeight + me.clientY - startY))
                      const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
                      window.addEventListener('mousemove', onMove)
                      window.addEventListener('mouseup', onUp)
                    }}
                    onDoubleClick={() => setDescHeight(null)}
                    className="group relative z-0 cursor-ns-resize flex items-center justify-center h-4 rounded-b-lg hover:bg-white/5 transition-colors pt-[8px] mt-[-8px]"
                  >
                    <Tooltip content="Drag to resize · double-click to reset" side="bottom">
                      <GripHorizontal size={10} className="text-gray-500 group-hover:text-gray-300" />
                    </Tooltip>
                  </div>
                </div>
              ) : (
                <>
                  <TemplateBodyEditor
                    key={folder.folderPath}
                    value={descBody}
                    placeholder="Description for YouTube upload…"
                    onSave={v => onUpdateMeta({ ytDescriptionTemplate: v })}
                    multiline
                    minHeight={96}
                    height={descHeight}
                    onHeightChange={setDescHeight}
                    tabAttached
                    knownKeys={descMergeKeySet}
                    inapplicableKeys={descInapplicableKeySet}
                    resolvedValues={descResolvedValues}
                    insertRef={descInsertRef}
                    aiFetcher={aiFetchDescription}
                  />
                  <MergeFieldPicker keys={descPickerKeys} onInsert={k => descInsertRef.current?.(`{${k}}`)} />
                </>
              )}
              {/* Char counter on the resolved length (what actually publishes). */}
              {(() => {
                const rendered = meta?.ytDescription ?? ''
                const over = rendered.length > YT_DESCRIPTION_CHAR_LIMIT
                return (
                  <p className={`mt-1 text-[10px] text-right ${over ? 'text-red-400' : 'text-gray-500'}`}>
                    {rendered.length} / {YT_DESCRIPTION_CHAR_LIMIT}
                  </p>
                )
              })()}
            </MetaRow>
            <MetaRow
              label="YouTube tags"
              attachRight
              mismatched={broadcastMismatches.get('tags')}
              right={
                <div className="flex items-center gap-2">
                  {suggestedYtTagsTemplate && (
                    <UseSuggestedTagsButton
                      template={suggestedYtTagsTemplate}
                      existingCount={meta?.ytTags?.length ?? 0}
                      onApply={() => applyTagsTemplate(suggestedYtTagsTemplate.id)}
                    />
                  )}
                  {matchingTagTemplate && (
                    <Tooltip content={`Mark these tags as coming from the "${matchingTagTemplate.name}" template. Tags stay as-is; future edits to the template will sync into this stream.`} side="top">
                      <button
                        type="button"
                        onClick={() => onUpdateMeta({ ytTagsTemplateId: matchingTagTemplate.id })}
                        className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
                      >
                        Bind to &ldquo;{matchingTagTemplate.name}&rdquo;
                      </button>
                    </Tooltip>
                  )}
                  {canSaveTagsTemplate && (
                    <SaveAsTemplateButton
                      onSave={handleSaveTagsTemplate}
                      suggestedName={suggestedTagTemplateName}
                      existingNames={ytTagTemplates.map(t => t.name)}
                    />
                  )}
                  <InlineTemplateSelect
                    items={ytTagTemplates}
                    value={tagsTplId}
                    onChange={applyTagsTemplate}
                    placeholder="Assign template"
                    icon={<Link2 size={11} />}
                    tabbed
                    tabActive={!!tagsTplId}
                  />
                </div>
              }
            >
              <div className="flex flex-col gap-1">
                <TagChipEditor
                  value={meta?.ytTags ?? []}
                  placeholder="Add tag…"
                  onChange={next => onUpdateMeta(tagsTplId ? { ytTags: next, ytTagsTemplateId: '' } : { ytTags: next })}
                  sortOnBlur
                  tabAttached
                  tabActive={!!tagsTplId}
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
            {/* YouTube Category. Sits after Tags to mirror Studio's
                field order (Title → Description → Tags → Category).
                Effective value falls back to the broadcast's current
                categoryId so the dropdown shows something sensible
                even before the user explicitly picks one — the push
                handler honors the same fallback so we don't
                accidentally overwrite YouTube's auto-derived value
                with "unset." When the selected category is one that
                has a Studio sub-field the API can't set (currently
                just Gaming → "Game"), the push-success banner adds a
                reminder. */}
            <MetaRow label="YouTube category" mismatched={broadcastMismatches.get('categoryId')}>
              <div className="relative">
                <select
                  ref={ytCategorySelectRef}
                  value={meta?.ytCategoryId ?? ''}
                  onChange={e => onUpdateMeta({ ytCategoryId: e.target.value || undefined })}
                  className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500/40 [color-scheme:dark] disabled:opacity-40 disabled:cursor-not-allowed"
                  disabled={!ytConnected || ytCategories.length === 0}
                >
                  <option value="">— None —</option>
                  {ytCategories.filter(c => c.assignable).map(c => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
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
              {/* When the title override is shown, the field spans both
                  columns so the chip editor + merge-field picker have
                  room (matching the YouTube title's full-width layout);
                  the category then wraps to the next grid row. */}
              <div className={meta?.syncTitle === false ? 'col-span-2' : ''}>
                <MetaRow label="Twitch title">
                  <div className="flex flex-col gap-1.5">
                    <Checkbox
                      size="sm"
                      checked={meta?.syncTitle !== false}
                      onChange={v => onUpdateMeta({ syncTitle: v })}
                      label={<span className="text-[11px] text-gray-400">Same as YouTube title</span>}
                    />
                    {meta?.syncTitle === false && (
                      // No-gap column so the template tab sits flush on
                      // the editor's top-right corner (mirrors the YT
                      // title's MetaRow attachRight layout). Picker +
                      // preview space themselves via their own margins.
                      <div className="flex flex-col">
                        <div className="flex items-end justify-end gap-2 min-h-[16px]">
                          {canSaveTwitchTitleTemplate && <SaveAsTemplateButton onSave={handleSaveTwitchTitleTemplate} />}
                          <InlineTemplateSelect
                            items={ytTitleTemplates}
                            value={twitchTitleTplId}
                            onChange={applyTwitchTitleTemplate}
                            placeholder="Assign template"
                            icon={<Link2 size={11} />}
                            tabbed
                            tabActive={!!twitchTitleTplId}
                          />
                        </div>
                        <TemplateBodyEditor
                          value={meta?.twitchTitle ?? ''}
                          placeholder="Title for Twitch broadcast…"
                          onSave={handleTwitchTitleSave}
                          tabAttached
                          tabActive={!!twitchTitleTplId}
                          knownKeys={titleMergeKeySet}
                          inapplicableKeys={titleInapplicableKeySet}
                          insertRef={twitchTitleInsertRef}
                        />
                        <MergeFieldPicker
                          keys={titlePickerKeys}
                          onInsert={k => twitchTitleInsertRef.current?.(`{${k}}`)}
                        />
                        {(() => {
                          const rendered = applyMergeFields(meta?.twitchTitle ?? '', mergeFields)
                          return (
                            <>
                              {hasYtTitleMergeFields(meta?.twitchTitle ?? '') && (
                                <p className="mt-2 text-xs text-gray-200 leading-snug flex items-baseline gap-1.5">
                                  <span className="text-[10px] text-gray-500 uppercase tracking-wide shrink-0">Preview</span>
                                  <span>{rendered || <span className="italic text-gray-500">(empty)</span>}</span>
                                </p>
                              )}
                              <TitleCharCounter count={rendered.length} limit={TWITCH_TITLE_CHAR_LIMIT} />
                            </>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                </MetaRow>
              </div>
              <MetaRow label="Twitch category">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Checkbox
                      size="sm"
                      checked={meta?.syncGame !== false}
                      onChange={v => onUpdateMeta({ syncGame: v })}
                      label={<span className="text-[11px] text-gray-400">Pick Topic / Game tag</span>}
                    />
                    {/* When picking from tags and there's more than one, a dropdown
                        chooses which tag Twitch uses — pinned, independent of the
                        title's {topic}. One topic needs no picker (it's the default). */}
                    {meta?.syncGame !== false && (meta?.games?.length ?? 0) > 1 && (
                      <TopicSelect
                        topics={meta!.games}
                        value={resolveTwitchGame(meta)}
                        onChange={v => onUpdateMeta({ twitchGameName: v })}
                        aria-label="Twitch category topic"
                      />
                    )}
                  </div>
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
                  {canSaveTwitchTagsTemplate && (
                    <SaveAsTemplateButton
                      onSave={handleSaveTwitchTagsTemplate}
                      suggestedName={suggestedTwitchTagTemplateName}
                      existingNames={twitchTagTemplates.map(t => t.name)}
                    />
                  )}
                  <InlineTemplateSelect
                    items={twitchTagTemplates}
                    value={twitchTagsTplId}
                    onChange={applyTwitchTagsTemplate}
                    placeholder="Assign template"
                    icon={<Link2 size={11} />}
                    tabbed
                    tabActive={!!twitchTagsTplId}
                  />
                </div>
              }
            >
              <div className="flex flex-col gap-1">
                <TagChipEditor
                  value={meta?.twitchTags ?? []}
                  placeholder="Add tag…"
                  onChange={next => onUpdateMeta(twitchTagsTplId ? { twitchTags: next, twitchTagsTemplateId: '' } : { twitchTags: next })}
                  tabAttached
                  tabActive={!!twitchTagsTplId}
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
              <div className="flex items-center gap-2">
                {/* Pull info from YouTube — only when there's actually a
                    mismatch worth pulling. Title and description are
                    overwritten unconditionally (the user reaches for
                    this when they've edited in Studio and want SM in
                    sync); gameTitle and tags are skipped when remote
                    is empty so we don't clobber local values with a
                    "no value" YT default. Date isn't pulled — that
                    requires renaming the folder via the dedicated
                    reschedule flow, so the date click in the header is
                    the right path for it. */}
                {selectedBroadcast && broadcastMismatch && !quotaExceeded && (
                  <Tooltip content={isPastStream
                    ? 'Replace local title / description / game / tags / category with what is on YouTube right now'
                    : 'Replace local title / description / game / tags / category with what is on YouTube right now (does not pull date — use the date in the header to reschedule)'}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!selectedBroadcast) return
                        // Force any focused textarea/input to commit its
                        // autosave-on-blur BEFORE our pull writes meta,
                        // so the two updates land in a deterministic
                        // order (autosave first, pull second). Browser
                        // mousedown fires blur synchronously in most
                        // cases, but Tooltip + portal mounts have
                        // produced flaky timing where the blur event
                        // races our click handler.
                        const active = document.activeElement as HTMLElement | null
                        if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
                          active.blur()
                        }
                        // Build the pull patch via the shared helper (same one
                        // the empty-state bulk pull uses) — overwrites local
                        // title/description/game/tags/category/privacy with
                        // YouTube's values and snapshots them as ytLastPushed*
                        // so the direction dots read in-sync. Date is not pulled
                        // (folder rename belongs to the reschedule flow).
                        onUpdateMeta(buildPullUpdate(selectedBroadcast))
                      }}
                      className="text-[10px] text-gray-400 hover:text-gray-200 transition-colors flex items-center gap-1"
                    >
                      <RefreshCw size={11} /> Pull stream details from YouTube
                    </button>
                  </Tooltip>
                )}
                {selectedBroadcast && (
                  <Tooltip content="Unlink from broadcast">
                  <button
                    type="button"
                    onClick={() => onUpdateMeta({ ytVideoId: '' })}
                    className="text-[10px] text-gray-400 hover:text-gray-200 transition-colors flex items-center gap-1"
                  >
                    <X size={11} /> Unlink
                  </button>
                  </Tooltip>
                )}
              </div>
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
              // When linked but the broadcast pool can't see the id
              // (e.g. quota outage blocked the fetch on stream open),
              // render the trigger from local meta so the user sees
              // their cached title + time instead of "not linked".
              // selectedBroadcast — used elsewhere for mismatch dots —
              // stays null so we don't pretend everything is in sync.
              triggerFallback={!selectedBroadcast && linkedId ? {
                // Resolve the template body so the cached title shows
                // the rendered string (e.g. "Elden Ring [PART 5]") not
                // raw placeholders. Falls back to the snapshot (which
                // is already rendered) or the bare video id.
                title: applyMergeFields(meta?.ytTitle ?? '', mergeFields).trim()
                  || meta?.ytLastPushedTitle?.trim()
                  || `Video ${linkedId}`,
                scheduledIso: !isPastStream && meta?.scheduledTime
                  ? `${folder.date}T${meta.scheduledTime}:00`
                  : undefined,
              } : undefined}
              disableOpen={quotaExceeded}
              triggerHint={quotaExceeded
                ? 'Cached — refresh blocked while YouTube quota is exhausted'
                : undefined}
            />

            {/* Date mismatch warning — only for upcoming broadcasts.
                Reads the broadcast's scheduled date and compares against
                the stream item's date. Date pull isn't part of the
                "Pull from YouTube" button because changing the SM date
                renames the folder (handled by the dedicated reschedule
                modal). Push covers the other direction. */}
            {(() => {
              if (isPastStream) return null
              if (!selectedBroadcast?.snippet.scheduledStartTime) return null
              if (selectedBroadcast.snippet.actualStartTime) return null
              const remoteLocalDate = localDateFromIso(selectedBroadcast.snippet.scheduledStartTime)
              if (!remoteLocalDate || remoteLocalDate === folder.date) return null
              // Pretty-print the remote date as `Mon DD` to match the
              // header style without having to import a date library.
              const [ry, rm, rd] = remoteLocalDate.split('-').map(n => parseInt(n, 10))
              const remotePretty = new Date(ry, rm - 1, rd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
              return (
                <p className="flex items-start gap-1.5 text-[10px] text-amber-300 leading-snug">
                  <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                  <span>
                    YouTube has this scheduled for <strong className="text-amber-200">{remotePretty}</strong>. Click the date in the header to reschedule the stream item, or push to update YouTube.
                  </span>
                </p>
              )
            })()}

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
                    className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-red-500/40 placeholder-gray-500"
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
                    <BroadcastTimePrivacyRow
                      time={newBroadcastTime}
                      onTimeChange={setNewBroadcastTime}
                      privacy={newBroadcastPrivacy}
                      onPrivacyChange={setNewBroadcastPrivacy}
                      disabled={creatingBroadcast}
                      trailing={
                        <Button
                          variant="primary"
                          size="sm"
                          loading={creatingBroadcast}
                          onClick={handleCreateBroadcast}
                        >
                          Create broadcast
                        </Button>
                      }
                    />
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

            {/* Time + Privacy row for the linked state. Mirrors the
                unlinked Create-broadcast row so the only difference
                between the two states' editable controls is the
                trailing button (Copy URL here vs Create broadcast over
                there). Time is suppressed for past / live broadcasts —
                YouTube rejects schedule edits once a broadcast has
                started or finished. Edits stage in meta; the Push to
                YouTube button picks them up. */}
            {linkedId && (
              // Render as soon as the stream is linked (linkedId is local) and
              // disable until the broadcast/VOD detail resolves, so the field
              // reserves its space instead of popping in and shoving the
              // footer once the async lookup lands.
              <BroadcastTimePrivacyRow
                showTime={isUpcomingBroadcast}
                time={displayedScheduledTime}
                onTimeChange={v => onUpdateMeta({ scheduledTime: v || undefined })}
                timeMismatch={broadcastMismatches.get('scheduledTime')}
                privacy={displayedPrivacy ?? 'private'}
                onPrivacyChange={v => onUpdateMeta({ ytPrivacyStatus: v })}
                privacyMismatch={broadcastMismatches.get('privacy')}
                disabled={!selectedBroadcast}
                privacyLoading={!displayedPrivacy}
                trailing={
                  <Tooltip content={copiedUrl ? 'Copied!' : 'Copy broadcast URL'} side="bottom">
                    <button
                      type="button"
                      onClick={async () => {
                        if (!selectedBroadcast) return
                        try {
                          await navigator.clipboard.writeText(`https://youtu.be/${selectedBroadcast.id}`)
                          setCopiedUrl(true)
                          setTimeout(() => setCopiedUrl(false), 1500)
                        } catch { /* clipboard refused — ignore */ }
                      }}
                      className="p-1.5 rounded text-gray-400 hover:bg-white/10 hover:text-gray-200 transition-colors shrink-0"
                    >
                      {copiedUrl ? <Check size={14} className="text-green-400" /> : <Link2 size={14} />}
                    </button>
                  </Tooltip>
                }
              />
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
        {/* Banner stack — multiple entries can coexist (e.g. a YouTube
            success and a Twitch success from the same Push-to-all),
            each rendering as its own row. Each banner is a flex row
            (not a <button>) so the optional action link can sit
            alongside the message without nesting interactive elements
            inside a button. Clicking anywhere on the body dismisses
            that one banner; the action button stops propagation to
            open the URL without dismissing first. */}
        {banners.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {banners.map(banner => (
              <Tooltip key={banner.id} content="Dismiss" triggerClassName="block">
              <div
                onClick={() => onDismissBanner(banner.id)}
                className={`flex items-center gap-2 text-left text-[11px] rounded-md px-2.5 py-1.5 border transition-colors cursor-pointer ${
                  banner.type === 'success'
                    ? 'bg-green-500/10 border-green-500/30 text-green-300 hover:bg-green-500/15'
                    : 'bg-red-500/10 border-red-500/30 text-red-300 hover:bg-red-500/15'
                }`}
              >
                <span className="flex-1">{banner.message}</span>
                {banner.action && (
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); window.api.openUrl(banner.action!.url) }}
                    className="shrink-0 underline underline-offset-2 hover:no-underline"
                  >
                    {banner.action.label}
                  </button>
                )}
              </div>
              </Tooltip>
            ))}
          </div>
        )}
        {(() => {
          // Hoisted disabled flags + push handlers so they can be reused
          // by the platform buttons individually AND the "Push to all"
          // button that wraps them. Each handler owns its per-platform
          // loading state so the spinners stay accurate even when
          // triggered together by Push to all.
          const ytDisabled = ytPushing || !ytConnected || !meta?.ytVideoId || !selectedBroadcast
            || quotaExceeded
            || (!broadcastMismatch && !thumbnailNeedsPush)
          // Effective Twitch values for the in-sync comparison —
          // matches what handlePushToTwitch above would actually send.
          // syncTitle/syncGame default ON when undefined (meta from
          // older streams) so the YT title/game stand in for Twitch.
          const twSyncTitle = meta?.syncTitle !== false
          // Both title fields are raw template bodies now — resolve
          // through merge fields so the comparison matches what
          // handlePushToTwitch actually sends (and what Twitch stores).
          const twEffectiveTitle = twSyncTitle ? resolveYtTitle(meta, folder, folders) : resolveTwitchTitle(meta, folder, folders)
          // Source-of-truth alignment with handlePushToTwitch above.
          const twEffectiveGame = resolveTwitchGame(meta)
          const { compat: twEffectiveTags } = toTwitchCompatibleTags(meta?.twitchTags ?? [])
          // Comparison normalizers. Twitch canonicalizes a few fields:
          //   • Game name — user supplies a search term, the push
          //     resolves it to a game_id, and the channel-info API
          //     returns the platform-canonical name. Case + whitespace
          //     may differ from what's in the local meta, so compare
          //     case- and trim-insensitive.
          //   • Title — case is preserved as supplied, but trim
          //     defensively in case Twitch strips trailing whitespace.
          //   • Tags — order is arbitrary in the response, so sort,
          //     and case-fold for the same reason as game name.
          const twNormalize = (s: string) => s.trim().toLowerCase()
          const twTagKey = (arr: string[]) => arr.slice().map(twNormalize).sort().join(',')
          // Per-field sync checks against the live Twitch channel
          // snapshot. The empty-local short-circuits on game + tags
          // mirror the push handler's actual behavior:
          //   • Empty game is passed as `undefined` to the IPC and
          //     dropped from the request body, so Twitch's existing
          //     game is preserved untouched — comparing "" vs
          //     <preserved> would always mismatch even after a
          //     successful push (e.g. for streams with no YT broadcast
          //     linked where ytGameTitle was never filled in).
          //   • Empty tags arrays follow the same logic for safety.
          // Title is always pushed verbatim (even ""), so its
          // comparison stays strict.
          const titleInSync = twEffectiveTitle.trim() === twitchChannel?.title.trim()
          const gameInSync = !twEffectiveGame.trim()
            || twNormalize(twEffectiveGame) === twNormalize(twitchChannel?.gameName ?? '')
          const tagsInSync = twEffectiveTags.length === 0
            || twTagKey(twEffectiveTags) === twTagKey(twitchChannel?.tags ?? [])
          const matchesActualTwitch = twitchChannel !== null && titleInSync && gameInSync && tagsInSync
          // Fallback: match the snapshot of what we last pushed (stored
          // in meta on every successful push). Necessary because Twitch
          // fuzzy-matches game names via search → game_id, so a
          // "Black Flag" push can come back as canonical "IV Black
          // Flag" on the channel — the cache comparison fails strictly
          // even though the user just pushed and considers themselves
          // synced. The user's typed name stays untouched here; only
          // the in-sync verdict accommodates the canonicalization.
          // Gated on `twitchLastPushedTitle` being defined so a
          // never-pushed stream that happens to byte-match an empty
          // snapshot doesn't read as in-sync.
          //
          // Staleness guard: the snapshot is only authoritative as long
          // as Twitch's channel still reflects THIS stream's push.
          // Pushing a different stream overwrites the channel's title/
          // game/tags, but the inactive stream's snapshot stays put in
          // its own meta file — without the guard, every previously-
          // pushed stream would read as in-sync forever after, even
          // after their data has been displaced by a newer push. We
          // compare `twitchChannel.title` to the snapshot's title (the
          // cheapest signal: Twitch preserves title verbatim, so a
          // title mismatch is a definitive "Twitch state has moved on"
          // signal) and gate the whole snapshot match on it.
          const hasLastPushedSnapshot = meta?.twitchLastPushedTitle !== undefined
          const snapshotStillReflectsTwitch = twitchChannel !== null
            && twitchChannel.title.trim() === (meta?.twitchLastPushedTitle ?? '').trim()
          const matchesLastPushed = hasLastPushedSnapshot
            && snapshotStillReflectsTwitch
            && twEffectiveTitle.trim() === (meta?.twitchLastPushedTitle ?? '').trim()
            && twEffectiveGame.trim() === (meta?.twitchLastPushedGame ?? '').trim()
            && twTagKey(twEffectiveTags) === twTagKey(meta?.twitchLastPushedTags ?? [])
          const twitchInSync = matchesActualTwitch || matchesLastPushed
          // Twitch channel info is one global blob — pushing for a
          // past stream would overwrite whatever's currently set on
          // the channel (for the actual current / next stream) with
          // stale metadata from a stream that already aired. Mirrors
          // the legacy page's behavior which hid the Twitch push
          // option entirely for past streams. Also disable when local
          // meta already matches what's on Twitch (nothing to push).
          const twDisabled = twPushing || !twConnected || isPastStream || twitchInSync
          const handleYouTubePush = async () => {
            // Soft-block when the user hasn't picked a category. YouTube
            // requires one on every video; sending undefined preserves
            // YouTube's existing value, but that's only meaningful if
            // there IS an existing value to preserve, and the resulting
            // mismatch (local empty ≠ remote set) keeps the Push button
            // stuck. Easier UX is to require the field upfront — scroll
            // the dropdown into view and focus it so the user sees what
            // they need to fill in, and surface a banner explaining why
            // the push didn't proceed.
            if (!meta?.ytCategoryId) {
              ytCategorySelectRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
              ytCategorySelectRef.current?.focus()
              onMissingYtCategory()
              return
            }
            // Compute a new scheduledStartTime when EITHER the local
            // date or the local scheduled-time differs from what the
            // broadcast currently has. Only relevant for upcoming
            // broadcasts (past / live ones can't have their schedule
            // edited via the YT API anyway). The local time falls back
            // to the broadcast's existing time-of-day when the user
            // hasn't overridden it via the time picker, so a date-only
            // reschedule preserves the original hour exactly as before.
            let newScheduled: string | undefined
            if (
              selectedBroadcast?.snippet.scheduledStartTime &&
              !selectedBroadcast.snippet.actualStartTime
            ) {
              const existing = new Date(selectedBroadcast.snippet.scheduledStartTime)
              if (!isNaN(existing.getTime())) {
                const remoteLocalDate = `${existing.getFullYear()}-${String(existing.getMonth() + 1).padStart(2, '0')}-${String(existing.getDate()).padStart(2, '0')}`
                const remoteLocalTime = `${String(existing.getHours()).padStart(2, '0')}:${String(existing.getMinutes()).padStart(2, '0')}`
                const wantedDate = folder.date
                const wantedTime = meta?.scheduledTime ?? remoteLocalTime
                if (remoteLocalDate !== wantedDate || remoteLocalTime !== wantedTime) {
                  const [y, mo, d] = wantedDate.split('-').map(n => parseInt(n, 10))
                  const [h, mi] = wantedTime.split(':').map(n => parseInt(n, 10))
                  const next = new Date(
                    y, mo - 1, d,
                    h, mi, existing.getSeconds(), existing.getMilliseconds(),
                  )
                  newScheduled = next.toISOString()
                }
              }
            }
            setYtPushing(true)
            try { await onPushToYoutube(effectiveYtThumb, newScheduled) }
            finally { setYtPushing(false) }
          }
          const handleTwitchPush = async () => {
            setTwPushing(true)
            try {
              // `onPushToTwitch` (parent's handlePushToTwitch) now
              // rethrows on failure — so this `await` either resolves
              // (push succeeded, banner shown) or throws (banner
              // already shown by the parent). On throw we skip both
              // the refetch and the last-pushed snapshot so we don't
              // record values that never actually made it to Twitch.
              await onPushToTwitch()
              // Refetch Twitch's canonical state — but don't blindly trust it.
              // Twitch's read side lags the PATCH we just made (read-after-
              // write), so an immediate GET often still reports the PRE-push
              // title (or returns null), which fails the in-sync guard
              // (snapshotStillReflectsTwitch) below and leaves the Push button
              // enabled even though the push succeeded. The PATCH resolved and
              // Twitch preserves the title verbatim, so seed the cache from what
              // we authoritatively sent, and only adopt the refetch's canonical
              // game/tags once it has caught up (its title matches what we
              // pushed — the fuzzy game-name canonicalization case).
              const refreshed = await window.api.twitchGetChannel?.()
              const refetchCaughtUp = !!refreshed && refreshed.title.trim() === twEffectiveTitle.trim()
              setTwitchChannel({
                title: twEffectiveTitle,
                gameName: refetchCaughtUp ? refreshed!.gameName : twEffectiveGame,
                tags: refetchCaughtUp ? refreshed!.tags : twEffectiveTags,
              })
              // Persist what we just pushed into meta so the in-sync
              // check stays valid across page reloads even when
              // Twitch's canonical state byte-differs from local
              // (the fuzzy-game-match case: user enters "Assassin's
              // Creed Black Flag", Twitch stores "Assassin's Creed
              // IV Black Flag"). The cache comparison would fail
              // strictly; the last-pushed comparison succeeds because
              // local still matches what we sent. Stored alongside
              // (not replacing) the user's typed values so we don't
              // overwrite their preferred naming.
              await onUpdateMeta({
                twitchLastPushedTitle: twEffectiveTitle,
                twitchLastPushedGame: twEffectiveGame,
                twitchLastPushedTags: twEffectiveTags,
              })
              // After-push fuzzy-match detection. Twitch resolves the
              // pushed game name through a search → game_id round-trip,
              // so the canonical name stored on the channel can byte-
              // differ from what we sent (e.g. "Black Flag" → "Assassin's
              // Creed IV Black Flag"). When that happens with both sides
              // non-empty, offer the user the chance to rename their
              // local tag globally to match. The page-level handler
              // gates this against the don't-ask-again preference.
              // Only when the refetch reflects THIS push — a stale read would
              // compare the new local game against Twitch's previous game and
              // could suggest a bogus rename back to the old name.
              const sent = twEffectiveGame.trim()
              const canonical = (refreshed?.gameName ?? '').trim()
              if (refetchCaughtUp && sent && canonical && twNormalize(sent) !== twNormalize(canonical)) {
                onSuggestCategoryRename(sent, canonical)
              }
            }
            catch { /* push failed; parent already surfaced the error */ }
            finally { setTwPushing(false) }
          }
          const handlePushAll = async () => {
            // Parallel — they hit independent APIs and we don't want
            // a YouTube failure to stop the Twitch push (or vice
            // versa). Each handler owns its own loading + error
            // state, so allSettled here is purely a "wait for both"
            // signal.
            const tasks: Promise<unknown>[] = []
            if (!ytDisabled) tasks.push(handleYouTubePush())
            if (!twDisabled) tasks.push(handleTwitchPush())
            await Promise.allSettled(tasks)
          }
          const allDisabled = ytDisabled && twDisabled
          return (
            // Outer @container so the inner layout can switch between
            // row (wide) and column (narrow) via container queries.
            // The trio sizes to content (no `w-full`), so when the
            // sidebar is wider than the trio's natural width there's
            // empty space to the right; when narrower, items wrap.
            <div className="@container">
              {/*
                Layered design (z-stack, bottom → top):
                  1. Frame layer — `frameBg` (white/10 or white/5)
                     on both halves. Each half rounds only the OUTSIDE
                     corners of the trio. The two halves share the
                     same color and meet flush — no divider — so they
                     read as one connected pill.
                  2. Sidebar-bg overlay — `bg-navy-800` inset 1px on
                     the wrapper half only, with corners matching the
                     frame's rounded sides. It hides the frame layer
                     inside the wrapper so the interior reads as the
                     sidebar's own bg, with a 1px frame ring visible
                     around the perimeter.
                  3. Buttons — the YT + Twitch platform buttons sit
                     above the overlay; the Push-to-all label sits on
                     top of the frame layer.

                Wrap behavior: at <280px the inner flex switches to
                column, and each half's rounded corners swap from
                left/right to top/bottom via explicit per-corner
                classes (avoids the `rounded-t-none` + `rounded-l-lg`
                top-left precedence conflict that left the corner
                un-rounded in row mode).
              */}
              {/* `group` lets the wrapper sibling react to the
                  Push-to-all button's state via `group-has-[…]:`
                  modifiers (CSS `:has()`). `peer-*` doesn't work here
                  because the button is wrapped in a Tooltip's own
                  div, so the button isn't actually a DOM-sibling of
                  the wrapper. With `:has()` on a common ancestor we
                  can target the button by its `.push-all-btn` class
                  no matter how deeply it's nested. */}
              <div className="group flex flex-col @[280px]:flex-row items-stretch w-fit">
                {/* WRAPPER half — frame layer + sidebar-bg overlay +
                    platform buttons. The frame's bg mirrors the
                    Push-to-all button's state via `group-has-[…]:`
                    modifiers reaching down through the Tooltip
                    wrapper to the actual button. The hover and
                    focus selectors include `:not(:disabled)` so
                    pointer / keyboard interactions on a disabled
                    button don't visually "activate" the wrapper —
                    `:hover` still fires on disabled elements in
                    modern browsers, which would otherwise let the
                    hover bg win over the disabled bg. */}
                <div className="relative bg-purple-800 group-has-[.push-all-btn:hover:not(:disabled)]:bg-purple-700 group-has-[.push-all-btn:focus-visible:not(:disabled)]:bg-purple-700 group-has-[.push-all-btn:disabled]:bg-purple-800/50 transition-colors rounded-tl-lg rounded-tr-lg @[280px]:rounded-tr-none @[280px]:rounded-bl-lg">
                  {/* Layer 2: sidebar-bg overlay, 1px inset, all four
                      corners rounded — gives the inner "transparent"
                      area its soft pill shape regardless of which
                      sides of the frame are rounded. */}
                  <div className="absolute inset-px bg-navy-800 rounded-[7px]" />
                  {/* Layer 3: platform buttons. `p-[5px]` (1px more
                      than the previous `p-1`) gives the buttons a
                      touch more breathing room inside the wrapper —
                      makes the trio 2px taller overall. */}
                  <div className="relative z-10 flex items-center gap-1.5 p-[5px]">
                    <Tooltip content={
                      !ytConnected ? 'YouTube not connected (Settings → Integrations)'
                        : !meta?.ytVideoId ? 'No linked broadcast or video — link one first'
                        : !selectedBroadcast ? 'Loading broadcast info…'
                        : quotaExceeded ? 'YouTube API quota exceeded — try again after midnight Pacific Time'
                        : !broadcastMismatch && !thumbnailNeedsPush ? 'Already in sync with YouTube'
                        : !broadcastMismatch && thumbnailNeedsPush ? 'Push updated thumbnail to YouTube'
                        : 'Push title / description / tags to YouTube'
                    }>
                      <button
                        type="button"
                        onClick={handleYouTubePush}
                        disabled={ytDisabled}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 hover:border-red-500/40 text-red-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-500/10"
                      >
                        {ytPushing ? <Loader2 size={11} className="animate-spin" /> : <LucideYoutube size={11} />}
                        Push to YouTube
                      </button>
                    </Tooltip>
                    <Tooltip content={
                      !twConnected ? 'Twitch not connected (Settings → Integrations)'
                        : isPastStream ? 'Past stream — Twitch only reflects the channel’s current state'
                        : twitchInSync ? 'Twitch channel info already matches this stream'
                        : 'Push title/category/tags to Twitch channel'
                    }>
                      <button
                        type="button"
                        onClick={handleTwitchPush}
                        disabled={twDisabled}
                        // Twitch brand purple (#9146FF — `twitch-500` in
                        // the tailwind config) for the border + text,
                        // transparent bg with a subtle on-hover wash.
                        // Distinct from the YouTube button's red-on-tint
                        // treatment because the app's `purple-*` scale
                        // was rethemed to a cool gray, so the literal
                        // brand purple has to come from `twitch-*`.
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-transparent hover:bg-twitch-500/10 border border-twitch-500/50 hover:border-twitch-500 text-twitch-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                      >
                        {twPushing ? <Loader2 size={11} className="animate-spin" /> : <LucideTwitch size={11} />}
                        Push to Twitch
                      </button>
                    </Tooltip>
                  </div>
                </div>

                {/* PUSH TO ALL — `.push-all-btn` class is the hook
                    that the wrapper's `group-has-[…]:` modifiers
                    above use to mirror this button's state. Styled
                    like the primary Button (purple-800 → purple-700
                    on hover, soft purple-900 shadow). */}
                <Tooltip content={
                  allDisabled ? 'Nothing to push on any connected platform'
                    : 'Push to every connected platform with pending changes. Skips platforms that are already in sync or not connected.'
                }>
                  <button
                    type="button"
                    onClick={handlePushAll}
                    disabled={allDisabled}
                    className="push-all-btn flex items-center justify-center px-3 py-1.5 rounded-bl-lg rounded-br-lg @[280px]:rounded-bl-none @[280px]:rounded-tr-lg text-xs font-medium bg-purple-800 hover:bg-purple-700 text-white shadow-lg shadow-purple-900/30 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-1 focus:ring-offset-navy-800 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-purple-800 whitespace-nowrap"
                  >
                    Push to all
                  </button>
                </Tooltip>
              </div>
            </div>
          )
        })()}

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
            <Tooltip content={hasSMThumbnail ? 'Edit Stream Manager Thumbnail' : 'Create Stream Manager Thumbnail'} shortcut="Ctrl+Shift+T">
              <button onClick={() => onOpenThumbnails()} className={`${PANEL_ACTION_BUTTON_BASE} hover:text-purple-300 hover:bg-purple-500/10`}>
                <ImageIcon size={13} />
                <CollapsibleLabel expandClass="@5xl:grid-cols-[1fr] @5xl:ms-0" collapsedMarginStart="-ms-1.5">Thumbnails</CollapsibleLabel>
              </button>
            </Tooltip>
          </div>
          <div className="flex-1 flex items-center justify-center gap-1 px-3">
            <Tooltip content={isStandalone(meta) ? 'Standalone streams don’t have episodes — enable Series above to use this' : 'New episode based on this stream'} shortcut={isStandalone(meta) ? undefined : 'Ctrl+Shift+N'}>
              <button
                onClick={onNewEpisode}
                disabled={isStandalone(meta)}
                className={PANEL_ACTION_BUTTON_BLUE}
              >
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
            <Tooltip content={deleteBlockReason ? "Can't delete: files are currently in use" : 'Delete this stream and all its contents'}>
              <button onClick={onDelete} disabled={!!deleteBlockReason} className={`${PANEL_ACTION_BUTTON_RED} disabled:opacity-40 disabled:cursor-not-allowed`}>
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
function MetaRow({ label, mergeHint, right, attachRight, highlighted, mismatched, children }: { label?: string; mergeHint?: string; right?: React.ReactNode; attachRight?: boolean; highlighted?: boolean; mismatched?: 'local' | 'remote' | 'both' | 'unknown' | undefined; children: React.ReactNode }) {
  // When `highlighted`, the merge hint brightens (text-purple-200) and the
  // weight steps up from font-light to the default font-normal. No
  // background pill / border / padding shift — the badge's footprint is
  // identical in both states, so toggling highlight never reflows the row.
  const hintCls = highlighted
    ? 'font-mono text-purple-200 normal-case tracking-normal'
    : 'font-mono font-light text-purple-400/70 normal-case tracking-normal'
  const labelCls = 'text-[10px] uppercase tracking-wide text-gray-400 flex items-center gap-1.5'

  // Direction-aware mismatch dot. Color encodes who is "ahead" of the
  // last sync; tooltip explains the practical action:
  //   local  → blue,   "you edited in SM — push to update YouTube"
  //   remote → orange, "YouTube has a newer value — pull to sync"
  //   both   → striped (two-color), "both sides edited — conflict"
  //   unknown→ neutral gray, no direction info available
  // The Push/Pull buttons still operate at the whole-stream level (the
  // dots are diagnostic, not actionable per-field) — but the colors
  // surface direction without forcing the user to remember whether
  // they touched that field.
  const dotConfig: Record<NonNullable<typeof mismatched>, { cls: string; pulseColor: string; tip: string }> = {
    local:   { cls: 'bg-blue-400',     pulseColor: 'rgba(96, 165, 250, 0.7)',  tip: 'You changed this in SM since last sync — push to update YouTube.' },
    remote:  { cls: 'bg-orange-400',   pulseColor: 'rgba(251, 146, 60, 0.7)',  tip: 'YouTube has a newer value than what SM last sync’d — pull to update SM, or push to overwrite YouTube with your local value.' },
    both:    { cls: 'bg-gradient-to-br from-blue-400 to-orange-400', pulseColor: 'rgba(168, 85, 247, 0.7)', tip: 'Both SM and YouTube have changed since the last sync — pulling will overwrite your local edits; pushing will overwrite YouTube’s.' },
    unknown: { cls: 'bg-gray-400',     pulseColor: 'rgba(156, 163, 175, 0.7)', tip: 'Doesn’t match YouTube. Direction unknown — this stream hasn’t been sync’d since the per-field tracker was added.' },
  }
  const mismatchDot = mismatched ? (
    <Tooltip content={dotConfig[mismatched].tip} side="top">
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full mismatch-dot-pulse ${dotConfig[mismatched].cls}`}
        style={{ ['--pulse-color' as any]: dotConfig[mismatched].pulseColor }}
      />
    </Tooltip>
  ) : null

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
            {mismatchDot}
          </span>
          {right}
        </div>
        <div className="text-gray-200">{children}</div>
      </div>
    )
  }

  // Same shape as the attachRight branch — label sits at the bottom of
  // its 16px row via items-end, with zero gap to the input below so
  // every MetaRow matches the YouTube Title field's spacing exactly.
  return (
    <div className="flex flex-col">
      <div className="flex items-end justify-between gap-2 min-h-[16px]">
        <span className={labelCls}>
          {label}
          {mergeHint && <span className={hintCls}>{mergeHint}</span>}
          {mismatchDot}
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

  // Double-click the resize handle to undo a manual drag: re-enable
  // auto-grow and snap the textarea back to its content-fit height
  // (no scrollbar). The mousedown handlers above fire first and
  // disable auto-grow as part of the dblclick sequence — this handler
  // runs after them and wins.
  const handleResizeReset = useCallback(() => {
    if (!multiline) return
    autoGrowEnabledRef.current = true
    grow()
  }, [multiline, grow])

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
  const cornerCls = tabAttached ? 'rounded-lg rounded-tr-none' : 'rounded-lg'
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
    <p className="flex items-center gap-1 text-[10px] text-gray-400 mt-0.5 min-h-[14px] min-w-0">
      {sg.hint === 'loading' && <><Loader2 size={9} className="animate-spin" />Generating…</>}
      {sg.hint === 'accept' && <>Tab to accept · Esc to dismiss</>}
      {sg.hint === 'error' && (
        <span className="flex items-center gap-1 text-red-400 min-w-0">
          <AlertTriangle size={9} className="shrink-0" /><TruncatedText text={sg.error ?? ''} className="truncate" />
        </span>
      )}
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
        className={`${sharedCls} relative z-10 resize-none leading-snug [&::-webkit-scrollbar-corner]:bg-transparent`}
      />
      <div
        onMouseDown={handleResizeStart}
        onDoubleClick={handleResizeReset}
        className="group relative z-0 cursor-ns-resize flex items-center justify-center h-4 rounded-b-lg hover:bg-white/5 transition-colors pt-[8px] mt-[-8px]"
      >
        <Tooltip content="Drag to resize · double-click to reset" side="bottom">
          <GripHorizontal size={10} className="text-gray-500 group-hover:text-gray-300" />
        </Tooltip>
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
 * TitleCharCounter — "N / LIMIT chars" line under a title field. Counts
 * the *resolved* title (merge fields substituted) since that's what
 * actually publishes. Color tiers match the tag-field counter: over
 * the limit is red, exactly at the limit is amber, otherwise gray.
 */
function TitleCharCounter({ count, limit }: { count: number; limit: number }) {
  const over = count > limit
  const atMax = count === limit
  const cls = over ? 'text-red-400' : atMax ? 'text-amber-400' : 'text-gray-400'
  return (
    <p className={`mt-1 text-[10px] tabular-nums ${cls}`}>
      {count} / {limit} chars
    </p>
  )
}

/**
 * UseSuggestedTagsButton — inline "Use 'X' tags" link surfaced next to
 * the YT tags field when a tag template's name matches the stream's
 * primary game. Clicking applies the template; when the field already
 * has chips the first click arms an overwrite confirm and the second
 * confirms (mirrors SaveAsTemplateButton's overwrite UX).
 */
function UseSuggestedTagsButton({
  template, existingCount, onApply,
}: {
  template: { id: string; name: string }
  existingCount: number
  onApply: () => void
}) {
  const [armed, setArmed] = useState(false)
  // Disarm when the template suggestion changes (stream switch, primary
  // game change, etc.) so a half-armed state doesn't carry over.
  useEffect(() => { setArmed(false) }, [template.id])

  const needsConfirm = existingCount > 0
  const handleClick = () => {
    if (needsConfirm && !armed) { setArmed(true); return }
    onApply()
    setArmed(false)
  }

  return (
    <Tooltip content={
      armed
        ? `Click again to overwrite ${existingCount} tag${existingCount === 1 ? '' : 's'}`
        : `Apply the "${template.name}" tag template to this stream`
    }>
    <button
      type="button"
      onClick={handleClick}
      className={`text-xs transition-colors ${
        armed ? 'text-amber-400 hover:text-amber-300' : 'text-gray-400 hover:text-gray-200'
      }`}
    >
      {armed
        ? `Overwrite ${existingCount} tag${existingCount === 1 ? '' : 's'}?`
        : `Use "${template.name}" tags`}
    </button>
    </Tooltip>
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
  items, value, onChange, placeholder = 'Template…', tabbed, tabActive, icon, labelOverride,
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
  /** Small icon rendered on the left of the trigger to signal the
   *  dropdown's behavior — a bind icon for "assign" (bound) selectors, a
   *  restart icon for "apply" (one-time) selectors. */
  icon?: React.ReactNode
  /** Forces the trigger label regardless of selection. Used by apply-mode
   *  selectors (description) which never stay bound, so showing a picked
   *  template name would be misleading — they show "Start with…" /
   *  "Overwrite with…" instead. Also hides the Clear row. */
  labelOverride?: string
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
        {icon && <span className="shrink-0 opacity-80">{icon}</span>}
        <span>{labelOverride ?? (selected ? selected.name : placeholder)}</span>
        <ChevronDown size={9} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && rect && ReactDOM.createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', top: rect.bottom + 4, right: window.innerWidth - rect.right, zIndex: 9999, minWidth: 160, width: 'max-content', maxWidth: 320 }}
          className="bg-navy-700 border border-white/10 rounded-lg shadow-xl overflow-hidden max-h-72 overflow-y-auto"
          onMouseDown={e => e.preventDefault()}
        >
          {value && !labelOverride && (
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

  // Arrow Up/Down nudge the value. Shift gives a 10× step — matches
  // the shared NumberInput primitive's keyboard behavior so every
  // number-ish field in the app responds the same way. The input is
  // type="text" (the underlying meta fields ytSeason/ytEpisode are
  // strings, and the empty state matters), so native number-spinner
  // keys don't apply — we handle it manually.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      step(e.shiftKey ? 10 : 1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      step(e.shiftKey ? -10 : -1)
    }
  }

  return (
    <div className={`flex items-stretch ${className ?? ''}`}>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={local}
        onChange={e => setLocal(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={placeholder}
        // Intentionally NOT disabling the input while saving — the
        // browser blurs a focused input the moment `disabled` flips
        // true, which kicks the user out of the field on every arrow-
        // key press (each press triggers a commit). The opacity-60
        // class still signals saving state; any keystrokes the user
        // makes during the in-flight save just update local state and
        // commit on the next blur, so concurrent edits aren't lost.
        className={`w-full bg-navy-900/70 border border-r-0 border-white/10 rounded-l-lg px-2 py-1 text-xs text-gray-200 placeholder-gray-500 text-center focus:outline-none focus:border-purple-500/50 focus:bg-navy-900 transition-colors ${saving ? 'opacity-60' : ''}`}
      />
      <div className="flex flex-col">
        <Tooltip content="Increment (Shift = ×10)" side="right" triggerClassName="flex-1 flex min-h-0">
        <button
          type="button"
          tabIndex={-1}
          onClick={e => step(e.shiftKey ? 10 : 1)}
          className="flex-1 flex items-center justify-center w-4 bg-navy-900/70 border border-l-0 border-b-0 border-white/10 rounded-tr-lg text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
          aria-label="Increment"
        >
          <ChevronUp size={10} strokeWidth={2.5} />
        </button>
        </Tooltip>
        <Tooltip content="Decrement (Shift = ×10)" side="right" triggerClassName="flex-1 flex min-h-0">
        <button
          type="button"
          tabIndex={-1}
          onClick={e => step(e.shiftKey ? -10 : -1)}
          className="flex-1 flex items-center justify-center w-4 bg-navy-900/70 border border-l-0 border-white/10 rounded-br-lg text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
          aria-label="Decrement"
        >
          <ChevronDown size={10} strokeWidth={2.5} />
        </button>
        </Tooltip>
      </div>
    </div>
  )
}

/**
 * PrivacyDropdown — custom dropdown for YouTube broadcast privacy
 * (Public / Unlisted / Private). Replaces the native `<select>`
 * because native options don't support per-option icons cross-browser.
 * Icon set matches YouTube Studio (Globe / Link / Lock). Height is
 * aligned with the neighbouring `Button` variant=primary size=sm
 * (py-1.5 on the trigger) so the create-broadcast row's controls
 * read as a single visual band.
 */
type PrivacyValue = 'public' | 'unlisted' | 'private'
const PRIVACY_OPTIONS: Array<{ value: PrivacyValue; label: string; Icon: typeof Globe }> = [
  { value: 'public',   label: 'Public',   Icon: Globe },
  { value: 'unlisted', label: 'Unlisted', Icon: LinkIcon },
  { value: 'private',  label: 'Private',  Icon: Lock },
]
/**
 * BroadcastTimePrivacyRow — shared row layout for the inline broadcast
 * picker section. Used in both the unlinked state (alongside a Create
 * broadcast button) and the linked state (alongside a Copy URL button).
 * Each field gets a stacked label-above-input shape that mirrors
 * MetaRow's chrome (uppercase tracking + direction-aware dot inline
 * with the label), keeping this row visually consistent with the rest
 * of the sidebar.
 *
 * `showTime` is false for past / live broadcasts where YouTube doesn't
 * accept schedule edits — only the privacy column renders in that case.
 */
function BroadcastTimePrivacyRow({
  time, onTimeChange, timeMismatch, showTime = true,
  privacy, onPrivacyChange, privacyMismatch,
  disabled, privacyLoading,
  trailing,
}: {
  time: string
  onTimeChange: (v: string) => void
  timeMismatch?: 'local' | 'remote' | 'both' | 'unknown'
  showTime?: boolean
  privacy: PrivacyValue
  onPrivacyChange: (v: PrivacyValue) => void
  privacyMismatch?: 'local' | 'remote' | 'both' | 'unknown'
  disabled?: boolean
  /** True while the real privacy value is still resolving — shows a
   *  "Loading…" placeholder instead of a possibly-wrong fallback value. */
  privacyLoading?: boolean
  trailing?: React.ReactNode
}) {
  // Same dot palette + tooltip copy as MetaRow. Kept inline here rather
  // than imported from MetaRow because MetaRow's render shape (label +
  // single child below) doesn't fit two side-by-side fields.
  const dotConfig: Record<'local' | 'remote' | 'both' | 'unknown', { cls: string; pulseColor: string; tip: string }> = {
    local:   { cls: 'bg-blue-400',     pulseColor: 'rgba(96, 165, 250, 0.7)',  tip: 'You changed this in SM since last sync — push to update YouTube.' },
    remote:  { cls: 'bg-orange-400',   pulseColor: 'rgba(251, 146, 60, 0.7)',  tip: 'YouTube has a newer value than what SM last sync’d — pull to update SM, or push to overwrite YouTube with your local value.' },
    both:    { cls: 'bg-gradient-to-br from-blue-400 to-orange-400', pulseColor: 'rgba(168, 85, 247, 0.7)', tip: 'Both SM and YouTube have changed since the last sync — pulling will overwrite your local edits; pushing will overwrite YouTube’s.' },
    unknown: { cls: 'bg-gray-400',     pulseColor: 'rgba(156, 163, 175, 0.7)', tip: 'Doesn’t match YouTube. Direction unknown — this stream hasn’t been sync’d since the per-field tracker was added.' },
  }
  const renderDot = (dir?: 'local' | 'remote' | 'both' | 'unknown') => dir
    ? (
      <Tooltip content={dotConfig[dir].tip} side="top">
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full mismatch-dot-pulse ${dotConfig[dir].cls}`}
          style={{ ['--pulse-color' as any]: dotConfig[dir].pulseColor }}
        />
      </Tooltip>
    )
    : null
  const labelCls = 'text-[10px] uppercase tracking-wide text-gray-400 flex items-center gap-1.5'
  return (
    <div className="flex items-end gap-2 flex-wrap">
      {/* Each field stacks label-then-input with no gap and uses
          items-end on the label row so the label baseline sits exactly
          at the input's top edge — matches MetaRow's tight spacing
          (the YouTube Title pattern) every other field uses. */}
      {showTime && (
        <div className="flex flex-col">
          <span className={`${labelCls} min-h-[16px] items-end`}>Broadcast time {renderDot(timeMismatch)}</span>
          <input
            type="time"
            value={time}
            onChange={e => onTimeChange(e.target.value)}
            disabled={disabled}
            // Asymmetric padding compensates for native time-input chrome
            // so the input height lines up with the PrivacyDropdown next to
            // it (pt-[5px] pb-1 → both rest on the same baseline).
            className="bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-2 pt-[5px] pb-1 focus:outline-none focus:ring-2 focus:ring-red-500/40 disabled:opacity-50 [color-scheme:dark]"
          />
        </div>
      )}
      <div className="flex flex-col">
        <span className={`${labelCls} min-h-[16px] items-end`}>Privacy {renderDot(privacyMismatch)}</span>
        <PrivacyDropdown
          value={privacy}
          onChange={onPrivacyChange}
          disabled={disabled}
          loading={privacyLoading}
        />
      </div>
      {trailing}
    </div>
  )
}

function PrivacyDropdown({
  value, onChange, disabled, loading,
}: {
  value: PrivacyValue
  onChange: (next: PrivacyValue) => void
  disabled?: boolean
  loading?: boolean
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const current = PRIVACY_OPTIONS.find(o => o.value === value) ?? PRIVACY_OPTIONS[0]

  // Close on outside click. The container ref scopes the check so
  // clicking inside the menu still selects a value.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const CurrentIcon = current.Icon
  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        disabled={disabled}
        className="flex items-center gap-1.5 bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg pl-2 pr-1.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-red-500/40 disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 size={11} className="shrink-0 text-gray-400 animate-spin" />
            <span className="text-gray-400">Loading…</span>
          </>
        ) : (
          <>
            <CurrentIcon size={11} className="shrink-0 text-gray-400" />
            <span>{current.label}</span>
          </>
        )}
        <ChevronDown size={10} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-20 min-w-full bg-navy-800 border border-white/10 rounded-lg shadow-lg overflow-hidden">
          {PRIVACY_OPTIONS.map(opt => {
            const OptIcon = opt.Icon
            const active = opt.value === value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false) }}
                className={`flex items-center gap-1.5 w-full px-2 py-1.5 text-xs text-left transition-colors ${
                  active ? 'bg-white/10 text-gray-100' : 'text-gray-300 hover:bg-white/5'
                }`}
              >
                <OptIcon size={11} className="shrink-0 text-gray-400" />
                <span>{opt.label}</span>
              </button>
            )
          })}
        </div>
      )}
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
  folders,
  ytConnected,
  twConnected,
  ytBroadcasts,
  dateDirection,
  onClose,
  onSuccess,
  onPushYoutube,
  onPushTwitch,
  onUpdateMeta,
}: {
  target: StreamFolder
  folders: StreamFolder[]
  ytConnected: boolean
  twConnected: boolean
  ytBroadcasts: LiveBroadcast[]
  /** Direction of the date mismatch when opened from a date dot that
   *  was already showing. `'remote'` opens the modal in "pull mode":
   *  inputs prefilled from YouTube, disabled, single-step rename only
   *  (no platform push step — we're matching YouTube, nothing to send
   *  back to it). `'both'` opens with the same prefill but inputs
   *  editable + a conflict banner; user can either accept YouTube's
   *  values (no push) or edit and push their own to override. `'local'`
   *  / `'unknown'` / `undefined` is the normal edit flow as before. */
  dateDirection?: 'local' | 'remote' | 'both' | 'unknown'
  onClose: () => void
  onSuccess: (newFolderPath: string) => void
  /** Push the linked YT broadcast's scheduled time + privacy. Title /
   *  description / tags / thumbnail are intentionally untouched so the
   *  user can keep iterating on those without an accidental publish. */
  onPushYoutube: (
    newScheduledStartTime: string,
    privacy: 'public' | 'unlisted' | 'private',
  ) => Promise<void>
  /** Push title / game / tags to the Twitch channel — used when the
   *  rescheduled stream becomes the new "next upcoming". */
  onPushTwitch: () => Promise<void>
  /** Used by pull mode to write the matching sync snapshot to meta
   *  after the folder rename succeeds — without this, the date dot
   *  would immediately re-appear because `ytLastPushedDate` is still
   *  stale from before the pull. */
  onUpdateMeta?: (folderPath: string, partial: Partial<StreamMeta>) => Promise<void> | void
}) {
  // YouTube-derived date string from the linked broadcast (local
  // calendar, YYYY-MM-DD). Used as the prefill source in pull + conflict
  // modes. Computed eagerly so the initial useState below can seed
  // newDate without a follow-up effect (which would flash the
  // target.date for one render before correcting).
  const ytDateForPull = useMemo(() => {
    const id = target.meta?.ytVideoId
    if (!id) return ''
    const b = ytBroadcasts.find(x => x.id === id)
    const iso = b?.snippet.scheduledStartTime
    if (!iso) return ''
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [target.meta?.ytVideoId, ytBroadcasts])
  const pullMode = dateDirection === 'remote'
  const conflictMode = dateDirection === 'both'
  // YouTube-derived time string (HH:MM) for the pull-mode snapshot
  // write. Mirrors `ytDateForPull`'s extraction logic.
  const ytTimeForPull = useMemo(() => {
    const id = target.meta?.ytVideoId
    if (!id) return ''
    const b = ytBroadcasts.find(x => x.id === id)
    const iso = b?.snippet.scheduledStartTime
    if (!iso) return ''
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }, [target.meta?.ytVideoId, ytBroadcasts])
  const [step, setStep] = useState<'date' | 'platforms'>('date')
  // In pull / conflict modes we seed newDate from YouTube's value so
  // the modal opens already showing the "match YouTube" state — the
  // user just needs to confirm. Falls back to target.date when the
  // YouTube prefill is empty (shouldn't happen for legitimate pull
  // mode but defensively guards against missing broadcast data).
  const [newDate, setNewDate] = useState(
    (pullMode || conflictMode) && ytDateForPull ? ytDateForPull : target.date
  )
  const [preview, setPreview] = useState<{
    folderRename: { from: string; to: string } | null
    folderConflict: boolean
    filesToRename: Array<{ from: string; to: string; collision: boolean }>
    hasCollisions: boolean
  } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Stream dots for the DatePicker popup, grouped by date from folders.
  const dateMarks = useMemo(() => buildDateMarks(folders), [folders])
  // Saved across the step transition: step 1's IPC returns the new
  // folder path; step 2 hands it off to onSuccess once the user
  // confirms or skips the platform pushes.
  const [newFolderPath, setNewFolderPath] = useState<string | null>(null)
  // Step 2 state
  const [pushYoutube, setPushYoutube] = useState(true)
  const [pushTwitch, setPushTwitch] = useState(true)
  const [pushTime, setPushTime] = useState('19:00')
  const [pushPrivacy, setPushPrivacy] = useState<'public' | 'unlisted' | 'private'>('public')
  const [pushing, setPushing] = useState(false)
  const [pushError, setPushError] = useState<string | null>(null)

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

  // Linked YouTube broadcast for the target stream, if any. Used to
  // gate the YouTube checkbox and to seed the time/privacy inputs.
  const linkedBroadcast = useMemo(() => {
    const id = target.meta?.ytVideoId
    if (!id) return null
    return ytBroadcasts.find(b => b.id === id) ?? null
  }, [target.meta?.ytVideoId, ytBroadcasts])

  // Initialize time + privacy from the linked broadcast whenever it
  // changes (e.g. switching streams in the sidebar without closing).
  // Only resets when the underlying broadcast id changes, so a user
  // edit to either field isn't clobbered by an unrelated re-render.
  useEffect(() => {
    if (!linkedBroadcast) return
    const iso = linkedBroadcast.snippet.scheduledStartTime
    if (iso) {
      const d = new Date(iso)
      if (!isNaN(d.getTime())) {
        setPushTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
      }
    }
    const p = linkedBroadcast.status?.privacyStatus
    if (p === 'public' || p === 'unlisted' || p === 'private') setPushPrivacy(p)
  }, [linkedBroadcast?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const today = todayStr()
  const newDateIsFuture = !!newDate && newDate >= today
  const canShowYouTube = ytConnected
    && !!linkedBroadcast
    && (linkedBroadcast.status?.lifeCycleStatus === 'ready' || linkedBroadcast.status?.lifeCycleStatus === 'created')
    && newDateIsFuture
  // "Was target the next upcoming stream BEFORE this reschedule?"
  // True iff target's existing date is today/future AND every other
  // future-dated stream is at-or-after target. Ties count target as
  // first (matches the user's preference: SM can't disambiguate
  // same-date streams so it assumes the rescheduled one is next).
  const wasNextUpcoming = !!newDate && target.date >= today && folders.every(f =>
    f.folderPath === target.folderPath || f.date < today || f.date >= target.date
  )
  // "Will target be next upcoming AFTER the reschedule?"
  const willBeNextUpcoming = newDateIsFuture && folders.every(f =>
    f.folderPath === target.folderPath || f.date < today || f.date >= newDate
  )
  const canShowTwitch = twConnected && willBeNextUpcoming && !wasNextUpcoming
  // In pull mode the user is matching YouTube — there's nothing to
  // push back, so skip the platforms step entirely. Twitch's "this is
  // the new next upcoming" push could in theory still apply, but the
  // user opened this flow specifically to sync TO YouTube, not push
  // OUT; bundling Twitch into a "pull" UX would be confusing.
  const showStep2 = !pullMode && (canShowYouTube || canShowTwitch)

  const sameDate = newDate === target.date
  // Pull mode is allowed to confirm even when `sameDate` would
  // normally block (it shouldn't be sameDate if remote diverged, but
  // defensively allow it — the snapshot write still resolves the dot).
  const stepOneDisabled = busy
    || (!pullMode && sameDate)
    || (!sameDate && (!preview || !!preview.folderConflict || !!preview.hasCollisions))

  const confirm = async () => {
    if (stepOneDisabled || !newDate) return
    setBusy(true)
    setError(null)
    try {
      // sameDate skips the rename entirely (only happens in pull mode
      // with a degenerate state) — we still write the snapshot so the
      // dot disappears.
      const finalPath = sameDate
        ? target.folderPath
        : (await window.api.rescheduleStream(target.folderPath, target.date, newDate)).newFolderPath
      if (pullMode && onUpdateMeta) {
        // Snapshot writes so the date + time dots both clear after
        // the pull completes. scheduledTime cleared so the local
        // override doesn't immediately re-flag a mismatch against
        // what we just pulled.
        await onUpdateMeta(finalPath, {
          scheduledTime: undefined,
          ytLastPushedDate: newDate,
          ...(ytTimeForPull ? { ytLastPushedScheduledTime: ytTimeForPull } : {}),
        })
      }
      if (showStep2) {
        setNewFolderPath(finalPath)
        setStep('platforms')
      } else {
        onSuccess(finalPath)
      }
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

  const confirmPushes = async () => {
    if (!newFolderPath || pushing) return
    const wantYT = pushYoutube && canShowYouTube && !!linkedBroadcast
    const wantTW = pushTwitch && canShowTwitch
    if (!wantYT && !wantTW) return
    setPushing(true)
    setPushError(null)
    const errors: string[] = []
    if (wantYT && linkedBroadcast) {
      try {
        const [hh, mm] = pushTime.split(':').map(n => parseInt(n, 10))
        const [y, mo, d] = newDate.split('-').map(n => parseInt(n, 10))
        // Build the new ISO from the user-edited time at the new date.
        // The seconds default to 0; YouTube doesn't need sub-minute
        // precision for scheduledStartTime.
        const newScheduled = new Date(y, mo - 1, d, hh, mm, 0).toISOString()
        await onPushYoutube(newScheduled, pushPrivacy)
      } catch (err: any) {
        errors.push(`YouTube: ${err?.message ?? String(err)}`)
      }
    }
    if (wantTW) {
      try { await onPushTwitch() }
      catch (err: any) { errors.push(`Twitch: ${err?.message ?? String(err)}`) }
    }
    setPushing(false)
    if (errors.length > 0) {
      setPushError(errors.join(' · '))
    } else {
      onSuccess(newFolderPath)
    }
  }

  // Skip = treat as "done" without pushing. The reschedule itself was
  // already committed in step 1.
  const skipPushes = () => {
    if (newFolderPath) onSuccess(newFolderPath)
  }

  const stepTwoDisabled = pushing || (!pushYoutube && !pushTwitch)

  return (
    <Modal
      isOpen
      onClose={() => {
        if (busy || pushing) return
        if (step === 'platforms' && newFolderPath) {
          // Modal-close mid-step-2 is a skip — the reschedule is
          // committed, we just don't push anywhere.
          onSuccess(newFolderPath)
        } else {
          onClose()
        }
      }}
      title={step === 'date' ? 'Reschedule stream' : 'Push to connected platforms?'}
      width="2xl"
      footer={
        step === 'date' ? (
          <>
            <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="sm" loading={busy} disabled={stepOneDisabled} onClick={confirm}>
              Confirm reschedule
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" disabled={pushing} onClick={skipPushes}>Skip</Button>
            <Button variant="primary" size="sm" loading={pushing} disabled={stepTwoDisabled} onClick={confirmPushes}>
              Confirm pushes
            </Button>
          </>
        )
      }
    >
      {step === 'date' ? (
        <div className="flex flex-col gap-4">
          {/* Pull-mode banner. YouTube already has this date; SM is
              catching up locally. Inputs below are disabled because
              the values are dictated by YouTube — the user is just
              confirming that they want to apply the rename. */}
          {pullMode && (
            <div className="flex items-start gap-2 text-[11px] bg-orange-500/10 border border-orange-500/30 text-orange-200 rounded-md px-2.5 py-1.5">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>
                YouTube has a different scheduled date than this stream item. Pulling renames the local folder + files to match — no push to YouTube needed.
              </span>
            </div>
          )}
          {/* Conflict-mode banner. Both sides moved since last sync.
              The prefilled value is YouTube's, but the input is
              editable so the user can override + push back. */}
          {conflictMode && (
            <div className="flex items-start gap-2 text-[11px] bg-yellow-500/10 border border-yellow-500/30 text-yellow-200 rounded-md px-2.5 py-1.5">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>
                Both this stream item and YouTube have been rescheduled since the last sync. The date below is YouTube's value — keep it to pull, or edit + push to override YouTube with your local date.
              </span>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-400">New date</label>
            <DatePicker
              value={newDate}
              onChange={setNewDate}
              disabled={busy || pullMode}
              markedDates={dateMarks}
              className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500/40 [color-scheme:dark] disabled:opacity-60"
            />
          </div>

          {sameDate && !pullMode && (
            <p className="text-xs text-gray-400 italic">Choose a different date to reschedule.</p>
          )}

          {!sameDate && previewLoading && (
            <p className="text-xs text-gray-400 flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin shrink-0" />
              Checking…
            </p>
          )}

          {/* Informational notice when the new date already has another
              stream. Reschedule can still proceed — the folder gets a
              numeric suffix from nextFolderName — but surfacing it as
              an amber callout (mirroring the NewStreamModal pattern)
              so the user isn't surprised by the `-2` in the rename
              list below. */}
          {!sameDate && !previewLoading && preview && !preview.folderConflict
            && preview.folderRename && preview.folderRename.to !== newDate && (
            <p className="text-xs text-amber-400 flex items-start gap-1.5">
              <AlertTriangle size={11} className="shrink-0 mt-0.5" />
              A stream already exists for {newDate}. This stream will be placed alongside it as <span className="font-mono text-amber-300">{preview.folderRename.to}</span>.
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
                    >
                      {f.collision ? (
                        <Tooltip content="Skipped: a file with that name already exists." triggerClassName="block">
                          <span className="block">
                            <AlertTriangle size={10} className="inline mr-1 mb-0.5" />
                            {f.from} → {f.to}
                          </span>
                        </Tooltip>
                      ) : (
                        <>{f.from} → {f.to}</>
                      )}
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
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-gray-400">
            The stream has been rescheduled to <span className="font-mono text-gray-300">{newDate}</span>. Want to push the update to your connected platforms?
          </p>

          {canShowYouTube && linkedBroadcast && (
            <div className="flex flex-col gap-2 p-3 rounded-lg border border-white/10 bg-navy-900/50">
              <Checkbox
                checked={pushYoutube}
                onChange={setPushYoutube}
                label="Update YouTube broadcast"
              />
              <p className="text-[10px] text-gray-400 pl-6 leading-snug">
                Only the scheduled time and privacy will be sent. Title, description, tags, and thumbnail will be left unchanged — keep iterating on those without an accidental publish.
              </p>
              {pushYoutube && (
                <div className="flex items-center gap-3 pl-6 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] text-gray-400 shrink-0">Time</label>
                    <input
                      type="time"
                      value={pushTime}
                      onChange={e => setPushTime(e.target.value)}
                      disabled={pushing}
                      className="bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-2 pt-[5px] pb-1 focus:outline-none focus:ring-2 focus:ring-red-500/40 disabled:opacity-50 [color-scheme:dark]"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] text-gray-400 shrink-0">Privacy</label>
                    <PrivacyDropdown value={pushPrivacy} onChange={setPushPrivacy} disabled={pushing} />
                  </div>
                </div>
              )}
            </div>
          )}

          {canShowTwitch && (
            <div className="flex flex-col gap-2 p-3 rounded-lg border border-white/10 bg-navy-900/50">
              <Checkbox
                checked={pushTwitch}
                onChange={setPushTwitch}
                label="Update Twitch channel"
              />
              <p className="text-[10px] text-gray-400 pl-6 leading-snug">
                This stream will be next up after the reschedule. Twitch will be set to this stream's title, game, and tags so the channel info matches when you go live.
              </p>
            </div>
          )}

          {pushError && (
            <div className="flex items-start gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 leading-relaxed">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>{pushError}</span>
            </div>
          )}
        </div>
      )}
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
  const [blockReason, setBlockReason] = useState<string | null>(null)
  const { openReason, folderOpenReason } = useOpenItems()
  const linkedVideoId = target.meta?.ytVideoId

  // Why this stream can't be deleted right now: any of its files is open in the
  // player / thumbnail editor, or held by a converter job. Dump mode checks the
  // specific date's files (its folder is shared with other streams); folder mode
  // checks the whole folder. Open-items is sync + authoritative; the converter
  // check is an async IPC. Returns the reason text, or null when deletable.
  const computeBlockReason = useCallback(async (): Promise<string | null> => {
    const openSrc: OpenSource | null = isDumpMode
      ? (filesInFolder ? (filesInFolder.map(openReason).find(Boolean) ?? null) : null)
      : folderOpenReason(target.folderPath)
    if (openSrc) return blockReasonText(openSrc)
    try {
      const used = isDumpMode
        ? (filesInFolder ? (await Promise.all(filesInFolder.map(p => window.api.isPathInUseByConverter(p)))).some(Boolean) : false)
        : await window.api.isFolderInUseByConverter(target.folderPath)
      if (used) return blockReasonText('converter')
    } catch { /* leave null; confirm re-checks before the actual delete */ }
    return null
  }, [isDumpMode, filesInFolder, target.folderPath, openReason, folderOpenReason])

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

  // Keep the disabled state in sync as files open/close or jobs start/finish.
  useEffect(() => {
    let cancelled = false
    computeBlockReason().then(r => { if (!cancelled) setBlockReason(r) })
    return () => { cancelled = true }
  }, [computeBlockReason])

  const confirm = async () => {
    setBusy(true)
    setError(null)
    // Authoritative re-check: a file may have been opened, or a conversion
    // started, since the modal opened.
    const reason = await computeBlockReason()
    if (reason) {
      setBlockReason(reason)
      setBusy(false)
      setError('Can\'t delete: files are currently in use. Close them (or cancel any conversion) and try again.')
      return
    }
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
            <Button variant="primary" size="sm" loading={busy} disabled={!!blockReason} onClick={confirm}>
              {alsoDeleteYt && linkedVideoId ? 'Move to Recycle Bin & Delete from YouTube' : 'Move to Recycle Bin'}
            </Button>
          )}
        </>
      }
    >
      {blockReason && (
        <div className="mb-3 rounded-lg border border-amber-300/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Some of these files are currently in use. Close them (or cancel any conversion) before deleting.
        </div>
      )}
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
                <Tooltip content={f} maxWidth="max-w-md" triggerClassName="block min-w-0">
                  <span className="block truncate">{display}</span>
                </Tooltip>
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
  ytTagTemplates,
  twitchTagTemplates,
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
  ytTagTemplates: Array<{ id: string; name: string; tags: string[] }>
  twitchTagTemplates: Array<{ id: string; name: string; tags: string[] }>
}) {
  const isNewEpisode = !!source
  const { config } = useStore()
  // Default YouTube category to seed onto every newly-created stream
  // (both regular New stream + New Episode). YouTube requires a
  // category on every video and the Push to YouTube flow soft-blocks
  // when local categoryId is empty, so pre-filling here means new
  // streams can push without an extra Settings detour. Falls back to
  // empty when the user hasn't set a default — picks happen in the
  // sidebar instead.
  const defaultYtCategoryId = config.defaultYouTubeCategoryId || ''
  // Resolve default tag templates (per platform) once per render.
  // Only applied when the new stream doesn't already inherit tags from
  // a source episode — never overwrites existing values.
  const defaultYtTags = (() => {
    const id = config.defaultYouTubeTagsTemplateId
    if (!id) return null
    return ytTagTemplates.find(t => t.id === id)?.tags ?? null
  })()
  const defaultTwitchTags = (() => {
    const id = config.defaultTwitchTagsTemplateId
    if (!id) return null
    return twitchTagTemplates.find(t => t.id === id)?.tags ?? null
  })()
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
  // Stream dots for the DatePicker popup, grouped by date from folders.
  const dateMarks = useMemo(() => buildDateMarks(folders), [folders])

  // Build the inherited meta when the source is set. Built fresh per
  // call so the computed ytEpisode reflects the date the user just
  // picked (the next-available number depends on how many siblings
  // already exist strictly before this date).
  const buildInheritedMeta = (): StreamMeta => {
    // Regular "New stream" path: standalone by default, but armed for
    // a one-time auto-upgrade to series if the user later adds a game
    // tag that matches an existing series (handled by an effect in
    // SidebarDetail). Tracking "armed" via `seriesAutoDetectPending`
    // avoids touching existing legacy streams where isSeries is
    // undefined — those keep behaving as series like they always did.
    const base: StreamMeta = {
      date, streamType: [], games: [], comments: '',
      isSeries: false,
      seriesAutoDetectPending: true,
    }
    if (defaultYtCategoryId) base.ytCategoryId = defaultYtCategoryId
    if (defaultYtTags && defaultYtTags.length) {
      base.ytTags = [...defaultYtTags]
      base.ytTagsTemplateId = config.defaultYouTubeTagsTemplateId
    }
    if (defaultTwitchTags && defaultTwitchTags.length) {
      base.twitchTags = [...defaultTwitchTags]
      base.twitchTagsTemplateId = config.defaultTwitchTagsTemplateId
    }
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
      // New Episode mode is always a series — set explicitly so the
      // sidebar Series checkbox shows as on from the first render
      // (rather than depending on the legacy-undefined fallback path).
      isSeries: true,
    }
    // Only attach optional fields when the source actually has them, so
    // we don't write a bunch of '' / undefined keys for nothing.
    if (m.ytGameTitle) meta.ytGameTitle = m.ytGameTitle
    if (m.ytTags?.length) {
      meta.ytTags = m.ytTags
      if (m.ytTagsTemplateId) meta.ytTagsTemplateId = m.ytTagsTemplateId
    } else if (defaultYtTags && defaultYtTags.length) {
      meta.ytTags = [...defaultYtTags]
      meta.ytTagsTemplateId = config.defaultYouTubeTagsTemplateId
    }
    if (m.ytTitleTemplateId) meta.ytTitleTemplateId = m.ytTitleTemplateId
    if (m.twitchTitleTemplateId) meta.twitchTitleTemplateId = m.twitchTitleTemplateId
    if (m.twitchTags?.length) {
      meta.twitchTags = m.twitchTags
      if (m.twitchTagsTemplateId) meta.twitchTagsTemplateId = m.twitchTagsTemplateId
    } else if (defaultTwitchTags && defaultTwitchTags.length) {
      meta.twitchTags = [...defaultTwitchTags]
      meta.twitchTagsTemplateId = config.defaultTwitchTagsTemplateId
    }
    if (m.syncTitle !== undefined) meta.syncTitle = m.syncTitle
    if (m.syncGame !== undefined) meta.syncGame = m.syncGame
    if (m.smThumbnail !== undefined) meta.smThumbnail = m.smThumbnail
    if (m.smThumbnailTemplate) meta.smThumbnailTemplate = m.smThumbnailTemplate
    // Inherit categoryId from the source episode when set; fall back
    // to the global default so new episodes follow the same "always
    // have a category" guarantee as fresh streams.
    if (m.ytCategoryId) meta.ytCategoryId = m.ytCategoryId
    else if (defaultYtCategoryId) meta.ytCategoryId = defaultYtCategoryId
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
            {source.meta?.ytTitle?.trim() && <> — <span className="text-gray-300">{renderStreamTitle(source, folders ?? [source])}</span></>}.
            Games, season, tags, and thumbnail files will be carried over.
          </p>
        ) : (
          <p className="text-xs text-gray-400">
            Pick the stream's date. You'll fill in the title, games, and any other details from the sidebar once it's open.
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-400">Date</label>
          <DatePicker
            value={date}
            onChange={setDate}
            disabled={busy}
            markedDates={dateMarks}
            className="w-full bg-navy-900 border border-white/10 text-gray-200 text-xs rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-purple-500/40 [color-scheme:dark]"
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
