import type { StreamMeta, StreamFolder, LiveBroadcast } from '../types'
import { applyMergeFields, buildStreamMergeFields, resolvePrimaryGame } from './streamTitle'

// ─── Local ↔ YouTube metadata mismatch ──────────────────────────────────────
// Single source of truth for "does this stream's local meta differ from the
// linked YouTube broadcast/video, and which way?" — used both by the detail
// sidebar's per-field dots and the empty-state Out-of-sync panel. Extracted
// from StreamsPage so both can share the exact same comparison rules.

/** Per-field divergence direction:
 *   'local'   → user changed it in SM (push to sync)
 *   'remote'  → user changed it in YouTube Studio (pull to sync)
 *   'both'    → both sides changed since last sync (conflict)
 *   'unknown' → no `ytLastPushed*` snapshot to compare against — can't tell
 *               direction (legacy / never synced since the feature shipped). */
export type MismatchDirection = 'local' | 'remote' | 'both' | 'unknown'

export type MismatchField =
  | 'title' | 'description' | 'gameTitle' | 'categoryId'
  | 'tags' | 'date' | 'scheduledTime' | 'privacy' | 'thumbnail'

/** A linked stream that differs from its YouTube broadcast, with the per-field
 *  direction map and a single resolvable bucket. Built in StreamsPage, rendered
 *  by the Out-of-sync panel. */
export interface OutOfSyncItem {
  folder: StreamFolder
  mismatch: Map<MismatchField, MismatchDirection>
  kind: 'push' | 'pull' | 'conflict'
  /** Fingerprint of the current divergence (local + remote + thumbnail state).
   *  Stored in `meta.ignoreOutOfSyncSig` when ignored; the item re-surfaces
   *  automatically once this changes (either side edited). */
  signature: string
  /** True when this exact divergence has been ignored (sig matches). */
  ignored: boolean
}

export const MISMATCH_FIELD_LABELS: Record<MismatchField, string> = {
  title: 'Title',
  description: 'Description',
  gameTitle: 'Game',
  categoryId: 'Category',
  tags: 'Tags',
  date: 'Date',
  scheduledTime: 'Time',
  privacy: 'Privacy',
  thumbnail: 'Thumbnail',
}

/** Local YYYY-MM-DD from a broadcast's scheduledStartTime ISO. Compared against
 *  `folder.date` (also local) — a UTC comparison would misclassify broadcasts
 *  whose scheduled time straddles midnight in the user's timezone. */
function localDateFromIso(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Compare a stream's local meta against its linked YouTube broadcast/video.
 *  Returns a per-field direction map; an empty map means "in sync". Mirrors
 *  the rules the detail sidebar has always used. */
export function computeBroadcastMismatch(
  folder: StreamFolder,
  folders: StreamFolder[],
  broadcast: LiveBroadcast | null | undefined,
): Map<MismatchField, MismatchDirection> {
  const map = new Map<MismatchField, MismatchDirection>()
  if (!broadcast) return map
  const meta = folder.meta
  const mergeFields = buildStreamMergeFields(meta, folder, folders)

  const directionFor = (localChanged: boolean, remoteChanged: boolean, hasSnapshot: boolean): MismatchDirection => {
    if (!hasSnapshot) return 'unknown'
    if (localChanged && remoteChanged) return 'both'
    if (localChanged) return 'local'
    return 'remote'
  }

  // Title — meta.ytTitle is a raw template body; resolve before comparing
  // against YouTube's already-rendered value (the snapshot is also rendered).
  const localTitle = applyMergeFields(meta?.ytTitle ?? '', mergeFields).trim()
  const remoteTitle = (broadcast.snippet.title ?? '').trim()
  if (remoteTitle !== localTitle) {
    const snapshot = meta?.ytLastPushedTitle
    const has = snapshot !== undefined
    map.set('title', directionFor(
      has && (snapshot ?? '').trim() !== localTitle,
      has && (snapshot ?? '').trim() !== remoteTitle,
      has,
    ))
  }

  const normDesc = (s: string | undefined) => (s ?? '').replace(/\r\n/g, '\n').trim()
  const localDesc = normDesc(meta?.ytDescription)
  const remoteDesc = normDesc(broadcast.snippet.description)
  if (remoteDesc !== localDesc) {
    const snapshot = meta?.ytLastPushedDescription
    const has = snapshot !== undefined
    map.set('description', directionFor(
      has && normDesc(snapshot) !== localDesc,
      has && normDesc(snapshot) !== remoteDesc,
      has,
    ))
  }

  // gameTitle has no symmetric snapshot (the YT API won't let us write it, so
  // we only ever read it) — divergence is always "remote-ahead".
  const localGame = resolvePrimaryGame(meta) || meta?.games?.[0] || ''
  if (broadcast.snippet.gameTitle && broadcast.snippet.gameTitle !== localGame) {
    map.set('gameTitle', 'remote')
  }

  const localCat = meta?.ytCategoryId ?? ''
  const remoteCat = broadcast.snippet.categoryId ?? ''
  if (localCat !== remoteCat) {
    if (!localCat && remoteCat) {
      // No local category set — an empty category can't be pushed to YouTube,
      // so this can only resolve as a pull. Also covers legacy streams created
      // before category snapshots existed (no `ytLastPushedCategoryId`), which
      // would otherwise read as 'unknown' and get push-grouped.
      map.set('categoryId', 'remote')
    } else {
      const snapshot = meta?.ytLastPushedCategoryId
      const has = snapshot !== undefined
      map.set('categoryId', directionFor(
        has && (snapshot ?? '') !== localCat,
        has && (snapshot ?? '') !== remoteCat,
        has,
      ))
    }
  }

  const normTagSet = (tags: string[] | undefined) =>
    [...(tags ?? [])].map(t => t.trim().toLowerCase()).filter(Boolean).sort().join('|')
  const localTagSet = normTagSet(meta?.ytTags)
  const remoteTagSet = normTagSet(broadcast.snippet.tags)
  const tagsDiffer = (remoteTagSet && remoteTagSet !== localTagSet) || (!remoteTagSet && localTagSet)
  if (tagsDiffer) {
    const snapshot = meta?.ytLastPushedTags
    const has = snapshot !== undefined
    const snapshotSet = normTagSet(snapshot)
    map.set('tags', directionFor(
      has && snapshotSet !== localTagSet,
      has && snapshotSet !== remoteTagSet,
      has,
    ))
  }

  // Date + time only matter while the broadcast can still be rescheduled
  // (upcoming — YT rejects schedule edits on live/completed).
  if (!broadcast.snippet.actualStartTime && broadcast.snippet.scheduledStartTime) {
    const remoteDate = localDateFromIso(broadcast.snippet.scheduledStartTime)
    if (remoteDate && remoteDate !== folder.date) {
      const snapshot = meta?.ytLastPushedDate
      const has = snapshot !== undefined
      map.set('date', directionFor(
        has && snapshot !== folder.date,
        has && snapshot !== remoteDate,
        has,
      ))
    }
    const remoteIso = new Date(broadcast.snippet.scheduledStartTime)
    if (!isNaN(remoteIso.getTime())) {
      const remoteTime = `${String(remoteIso.getHours()).padStart(2, '0')}:${String(remoteIso.getMinutes()).padStart(2, '0')}`
      // Local time only counts as intent when explicitly set; otherwise the
      // displayed value falls back to the broadcast's own time.
      const localTime = meta?.scheduledTime
      if (localTime !== undefined && localTime !== remoteTime) {
        const snapshot = meta?.ytLastPushedScheduledTime
        const has = snapshot !== undefined
        map.set('scheduledTime', directionFor(
          has && snapshot !== localTime,
          has && snapshot !== remoteTime,
          has,
        ))
      }
    }
  }

  // Privacy — same skip-when-unset semantics as scheduledTime.
  const localPrivacy = meta?.ytPrivacyStatus
  const remotePrivacy = broadcast.status?.privacyStatus
  if (localPrivacy !== undefined && remotePrivacy && localPrivacy !== remotePrivacy) {
    const snapshot = meta?.ytLastPushedPrivacy
    const has = snapshot !== undefined
    map.set('privacy', directionFor(
      has && snapshot !== localPrivacy,
      has && snapshot !== remotePrivacy,
      has,
    ))
  }

  return map
}

/** Build the meta patch for pulling a broadcast's current values into local
 *  SM state. Overwrites title/description/game/tags/category/privacy with
 *  YouTube's values and snapshots them as `ytLastPushed*` so the direction
 *  dots read "in sync" afterwards. Date is intentionally NOT pulled (folder
 *  rename belongs to the reschedule flow); the time override is cleared and
 *  snapshotted instead. Shared by the sidebar Pull button + the bulk pull. */
export function buildPullUpdate(broadcast: LiveBroadcast): Partial<StreamMeta> {
  const update: Partial<StreamMeta> = {
    // Pulled title is YouTube's rendered string — becomes the title body
    // verbatim (no merge fields). Clear the template binding too.
    ytTitle: broadcast.snippet.title,
    ytDescription: broadcast.snippet.description,
    ytTitleTemplateId: '',
  }
  if (broadcast.snippet.gameTitle) update.ytGameTitle = broadcast.snippet.gameTitle
  if (broadcast.snippet.tags?.length) {
    update.ytTags = broadcast.snippet.tags
    update.ytTagsTemplateId = ''
  }
  if (broadcast.snippet.categoryId) update.ytCategoryId = broadcast.snippet.categoryId
  const remotePrivacy = broadcast.status?.privacyStatus
  if (remotePrivacy === 'public' || remotePrivacy === 'unlisted' || remotePrivacy === 'private') {
    update.ytPrivacyStatus = remotePrivacy
    update.ytLastPushedPrivacy = remotePrivacy
  }
  // Snapshot the pulled values so direction-aware mismatch doesn't immediately
  // re-flag them as "remote ahead".
  update.ytLastPushedTitle = broadcast.snippet.title ?? ''
  update.ytLastPushedDescription = broadcast.snippet.description ?? ''
  update.ytLastPushedTags = broadcast.snippet.tags ?? []
  if (broadcast.snippet.categoryId) update.ytLastPushedCategoryId = broadcast.snippet.categoryId
  if (broadcast.snippet.scheduledStartTime) {
    const remote = new Date(broadcast.snippet.scheduledStartTime)
    if (!isNaN(remote.getTime())) {
      update.scheduledTime = undefined
      update.ytLastPushedScheduledTime = `${String(remote.getHours()).padStart(2, '0')}:${String(remote.getMinutes()).padStart(2, '0')}`
    }
  }
  return update
}

/** cyrb53 — fast, compact, non-cryptographic string hash. Collision risk is
 *  negligible for the ignore signature, and it keeps `_meta.json` small (a
 *  short token instead of the full title/description). */
function hashStr(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** Fingerprint the full sync-relevant state (local + remote + thumbnail) so an
 *  ignored item re-surfaces the moment either side changes. Stored verbatim in
 *  `meta.ignoreOutOfSyncSig` at ignore time and re-derived on every check. */
export function outOfSyncSignature(
  folder: StreamFolder,
  folders: StreamFolder[],
  broadcast: LiveBroadcast,
  thumb?: { current: string | null; pushed: string | undefined },
): string {
  const meta = folder.meta
  const mergeFields = buildStreamMergeFields(meta, folder, folders)
  const normTags = (t?: string[]) => [...(t ?? [])].map(x => x.trim().toLowerCase()).filter(Boolean).sort().join(',')
  const parts = [
    applyMergeFields(meta?.ytTitle ?? '', mergeFields).trim(),
    (meta?.ytDescription ?? '').replace(/\r\n/g, '\n').trim(),
    normTags(meta?.ytTags),
    meta?.ytCategoryId ?? '',
    meta?.ytPrivacyStatus ?? '',
    resolvePrimaryGame(meta) || meta?.games?.[0] || '',
    folder.date,
    meta?.scheduledTime ?? '',
    (broadcast.snippet.title ?? '').trim(),
    (broadcast.snippet.description ?? '').replace(/\r\n/g, '\n').trim(),
    normTags(broadcast.snippet.tags),
    broadcast.snippet.categoryId ?? '',
    broadcast.status?.privacyStatus ?? '',
    broadcast.snippet.gameTitle ?? '',
    broadcast.snippet.scheduledStartTime ?? '',
    thumb?.current ?? '',
    thumb?.pushed ?? '',
  ]
  return hashStr(parts.join('␟'))
}

/** Bucket a stream's mismatch map into a single resolvable direction:
 *   'push'     → all differing fields favor local (or are unknown) → push to YT
 *   'pull'     → all favor remote → pull into SM
 *   'conflict' → mixed directions or a 'both' field → needs manual resolution
 *   'none'     → in sync
 *  `unknown` is grouped with push: SM is the user's metadata source, and a push
 *  surfaces every change in the confirm dialog before anything is written. */
export function classifyMismatch(map: Map<MismatchField, MismatchDirection>): 'push' | 'pull' | 'conflict' | 'none' {
  if (map.size === 0) return 'none'
  const dirs = [...map.values()]
  if (dirs.some(d => d === 'both')) return 'conflict'
  const pushy = dirs.some(d => d === 'local' || d === 'unknown')
  const pully = dirs.some(d => d === 'remote')
  if (pushy && pully) return 'conflict'
  return pully ? 'pull' : 'push'
}
