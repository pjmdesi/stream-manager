import fs from 'fs'
import path from 'path'
import { imageSize } from 'image-size'
import { checkLocalFiles } from '../ipc/files'
import { getValidToken } from './youtubeAuth'
import * as ytQuotaState from './ytQuotaState'

const BASE = 'https://www.googleapis.com/youtube/v3'

// Channel ID for the connected user. The "Initialize Livestream" link in the
// renderer needs this to build the YouTube Studio go-live URL. We cache it
// per-process because it's stable for a given OAuth grant — clearTokens()
// in youtubeAuth resets it via clearChannelIdCache().
let cachedChannelId: string | null = null
export function clearChannelIdCache(): void { cachedChannelId = null }

export async function getMyChannelId(clientId: string, clientSecret: string): Promise<string> {
  if (cachedChannelId) return cachedChannelId
  const token = await getValidToken(clientId, clientSecret)
  const res = await fetch(`${BASE}/channels?part=id&mine=true`, {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`channels.list failed (${res.status}): ${text}`)
  }
  const data = await res.json() as { items?: Array<{ id?: string }> }
  const id = data.items?.[0]?.id
  if (!id) throw new Error('No channel found for the connected account.')
  cachedChannelId = id
  return id
}

const YT_THUMBNAIL_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])
const YT_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024 // 2 MB

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

/** Aspect ratios we treat as "thumbnail-shaped": 16:9 (YT widescreen), 1:1
 *  (podcast / square cover), 9:16 (vertical / Shorts). Anything outside these
 *  (banners, sidebars, tall logos) is filtered out of the best-fit list.
 *  ±5% tolerance accommodates near-misses from cropping tools. */
const THUMBNAIL_ASPECTS = [16 / 9, 1, 9 / 16]
const ASPECT_TOLERANCE = 0.05
/** Lower bound on the longer side of a "real" thumbnail. Excludes favicons
 *  and tiny inline icons without rejecting downscaled screenshots from older
 *  recordings. */
const MIN_LONGER_SIDE = 720

function matchesThumbnailAspect(w: number, h: number): boolean {
  if (w <= 0 || h <= 0) return false
  const longer = Math.max(w, h)
  if (longer < MIN_LONGER_SIDE) return false
  const ratio = w / h
  return THUMBNAIL_ASPECTS.some(a => Math.abs(ratio - a) / a <= ASPECT_TOLERANCE)
}

/** Split a list of image paths into two buckets based on how well each one
 *  fits the typical thumbnail shape. Both buckets are restricted to files
 *  that pass the basic YT upload requirements (accepted extension + ≤2 MB).
 *
 *  - `bestFit` — files whose pixel aspect ratio matches 16:9 / 1:1 / 9:16
 *    within ±5% AND whose longer side is ≥720px. Cloud-only files always
 *    fall into this bucket since we don't probe their dimensions (reading
 *    bytes would trigger hydration); we lean inclusive so a cloud-hosted
 *    thumbnail isn't hidden behind "Show all".
 *  - `rest` — everything else that passes the basic check (off-aspect images,
 *    small icons / logos). Surfaced behind the picker's "Show all" link.
 *
 *  Files failing the basic ext + size check are excluded from both buckets. */
export async function categorizeYouTubeThumbnails(
  paths: string[],
): Promise<{ bestFit: string[]; rest: string[] }> {
  const basic = paths.filter(p => {
    const ext = path.extname(p).toLowerCase()
    if (!YT_THUMBNAIL_EXTS.has(ext)) return false
    try { return fs.statSync(p).size <= YT_THUMBNAIL_MAX_BYTES } catch { return false }
  })
  if (basic.length === 0) return { bestFit: [], rest: [] }

  // Local-flag lookup is what gates dimension probing — reading a cloud
  // placeholder triggers a download, which we explicitly want to avoid here.
  const localFlags = await checkLocalFiles(basic)

  const bestFit: string[] = []
  const rest: string[] = []
  for (let i = 0; i < basic.length; i++) {
    const p = basic[i]
    const isLocal = localFlags[i]
    if (!isLocal) {
      // Cloud-only — be inclusive; the picker will show a cloud icon and
      // hydration only happens if the user actually picks this file.
      bestFit.push(p)
      continue
    }
    try {
      const buf = fs.readFileSync(p)
      const dims = imageSize(buf)
      if (matchesThumbnailAspect(dims.width, dims.height)) {
        bestFit.push(p)
      } else {
        rest.push(p)
      }
    } catch {
      // Couldn't read or parse — keep it visible behind "Show all" so the
      // user can still pick it if they know what it is.
      rest.push(p)
    }
  }
  return { bestFit, rest }
}

/** Upload a local image file as the thumbnail for a YouTube broadcast / video. */
export async function uploadThumbnail(
  videoId: string,
  imagePath: string,
  clientId: string,
  clientSecret: string
): Promise<void> {
  const token = await getValidToken(clientId, clientSecret)
  const imageData = fs.readFileSync(imagePath)
  const ext = path.extname(imagePath).toLowerCase()
  const contentType = MIME[ext] ?? 'image/jpeg'
  const url = `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': contentType,
    },
    body: imageData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any
    const apiMsg = err?.error?.message || `YouTube thumbnail upload failed (${res.status})`
    // YouTube returns the same generic auth error for several distinct
    // conditions, none of which the API disambiguates in the response. We
    // augment the message with the most actionable known causes so users
    // aren't stuck staring at a vague "not properly authorized" string.
    if (apiMsg.includes("thumbnail can't be set")) {
      throw new Error(
        `${apiMsg}\n\nCommon causes:\n• An active A/B test (Test & Compare) for this video's thumbnail — stop the test in YouTube Studio and try again.\n• YouTube channel not verified for custom thumbnails.`
      )
    }
    throw new Error(apiMsg)
  }
  // thumbnails.set costs 50 quota units (this call bypasses ytRequest).
  ytQuotaState.addQuotaUsage(50)
}

export interface LiveBroadcast {
  id: string
  snippet: {
    title: string
    description: string
    scheduledStartTime?: string
    actualStartTime?: string
    gameTitle?: string
    categoryId?: string
    tags?: string[]
  }
  status: {
    lifeCycleStatus: string
    privacyStatus: string
  }
}

async function ytRequest(
  path: string,
  options: RequestInit,
  clientId: string,
  clientSecret: string
): Promise<any> {
  // Centralized quota gate. If a previous call already observed a
  // `quotaExceeded` 403, every subsequent call would just burn an
  // error round-trip until midnight PT — short-circuit here instead
  // and let the renderer's banner explain why. `getQuotaState()`
  // lazily auto-clears once the cached `resetsAt` has passed, so
  // calls after midnight PT pass straight through.
  const quota = ytQuotaState.getQuotaState()
  if (quota.exceeded) {
    throw new Error('YouTube API quota exceeded. Quota refreshes at midnight Pacific Time.')
  }
  const token = await getValidToken(clientId, clientSecret)
  const url = `${BASE}${path}`
  console.log('[YT api]', options.method, url)
  if (options.body) console.log('[YT api] body:', options.body)
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  console.log('[YT api] response status:', res.status)
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any
    console.error('[YT api] error body:', JSON.stringify(err))
    // Detect quota-exceeded via the documented `errors[].reason`
    // value. 403 status alone isn't sufficient — perms-related 403s
    // shouldn't trip the quota banner / refresh suppression.
    const isQuotaExceeded = res.status === 403
      && Array.isArray(err?.error?.errors)
      && err.error.errors.some((e: any) => e?.reason === 'quotaExceeded')
    if (isQuotaExceeded) ytQuotaState.markQuotaExceeded()
    throw new Error(err?.error?.message || `YouTube API error ${res.status}`)
  }
  // Estimate quota usage for the successful call: reads (GET) cost 1 unit,
  // writes (insert/update/delete/bind/transition) cost 50.
  ytQuotaState.addQuotaUsage((options.method ?? 'GET').toUpperCase() === 'GET' ? 1 : 50)
  // 204 No Content
  if (res.status === 204) return null
  return res.json()
}

/** Fetch all live broadcasts for the authenticated user.
 *  Queries persistent and event broadcasts separately — broadcastType and broadcastStatus
 *  cannot be combined in a single request. All queries require mine=true. */
export async function getLiveBroadcasts(
  clientId: string,
  clientSecret: string
): Promise<LiveBroadcast[]> {
  const results = await Promise.allSettled([
    // All user broadcasts (any type, any non-completed state) — mine=true is incompatible
    // with broadcastStatus, so we fetch all and filter completed ones out in code
    ytRequest(
      `/liveBroadcasts?${new URLSearchParams({ part: 'snippet,status', mine: 'true', broadcastType: 'all', maxResults: '50' })}`,
      { method: 'GET' },
      clientId, clientSecret
    ),
    // Upcoming scheduled event broadcasts — broadcastStatus is incompatible with mine
    ytRequest(
      `/liveBroadcasts?${new URLSearchParams({ part: 'snippet,status', broadcastStatus: 'upcoming', maxResults: '10' })}`,
      { method: 'GET' },
      clientId, clientSecret
    ),
    // Active/live event broadcasts — broadcastStatus is incompatible with mine
    ytRequest(
      `/liveBroadcasts?${new URLSearchParams({ part: 'snippet,status', broadcastStatus: 'active', maxResults: '5' })}`,
      { method: 'GET' },
      clientId, clientSecret
    ),
  ])

  const seen = new Set<string>()
  const broadcasts: LiveBroadcast[] = []
  const errors: string[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const item of (r.value?.items ?? [])) {
        // Skip completed broadcasts — the mine=true query returns all states including past ones
        if (item.status?.lifeCycleStatus === 'complete') continue
        if (!seen.has(item.id)) { seen.add(item.id); broadcasts.push(item) }
      }
    } else {
      const msg: string = (r.reason as any)?.message ?? 'Unknown error'
      console.warn('[YT api] broadcast query rejected:', msg)
      errors.push(msg)
    }
  }

  // If every query failed with an auth error, surface it so the caller can inform the user
  const allFailed = errors.length === results.length
  if (allFailed) {
    const isAuthError = errors.some(e => /expired|revoked|invalid.*(token|credentials)/i.test(e))
    if (isAuthError) throw new Error('YouTube token has expired or been revoked. Please reconnect in Settings.')
    throw new Error(errors[0])
  }

  // Hydrate tags + categoryId from the videos resource (the
  // liveBroadcasts snippet doesn't carry either).
  const extrasMap = await fetchVideoExtras(broadcasts.map(b => b.id), clientId, clientSecret)
  for (const b of broadcasts) {
    const extras = extrasMap.get(b.id)
    if (extras?.tags) b.snippet.tags = extras.tags
    if (extras?.categoryId) b.snippet.categoryId = extras.categoryId
  }

  return broadcasts
}

/** Fetch a single broadcast by ID from /liveBroadcasts. Returns the full
 *  LiveBroadcast (incl. scheduledStartTime) for upcoming/active/completed
 *  states. Use this — NOT getVideoById — when you need the broadcast's
 *  scheduledStartTime; the /videos endpoint doesn't carry that field.
 *  Tags are hydrated from the videos resource the same way the bulk
 *  fetch does. */
export async function getBroadcastById(
  broadcastId: string,
  clientId: string,
  clientSecret: string,
): Promise<LiveBroadcast | null> {
  const data = await ytRequest(
    `/liveBroadcasts?${new URLSearchParams({ part: 'snippet,status', id: broadcastId })}`,
    { method: 'GET' },
    clientId, clientSecret,
  )
  const item = data?.items?.[0]
  if (!item) return null
  const extrasMap = await fetchVideoExtras([broadcastId], clientId, clientSecret)
  const extras = extrasMap.get(broadcastId)
  if (extras?.tags) item.snippet.tags = extras.tags
  if (extras?.categoryId) item.snippet.categoryId = extras.categoryId
  return item as LiveBroadcast
}

/** Fetch a single video by ID and return it as a LiveBroadcast-shaped object, or null if not found. */
export async function getVideoById(
  videoId: string,
  clientId: string,
  clientSecret: string
): Promise<LiveBroadcast | null> {
  const data = await ytRequest(
    `/videos?${new URLSearchParams({ part: 'snippet,status', id: videoId })}`,
    { method: 'GET' },
    clientId, clientSecret
  )
  const item = data?.items?.[0]
  if (!item) return null
  return {
    id: item.id,
    snippet: {
      title: item.snippet.title ?? '',
      description: item.snippet.description ?? '',
      actualStartTime: item.snippet.publishedAt,
      tags: item.snippet.tags ?? [],
      // Forward `categoryId` so single-video lookups (used for the
      // VOD path that backs most "old stream items" — see callers in
      // StreamsPage's fallback lookup + the post-push refresh) carry
      // the same field that the bulk-list paths now populate. Without
      // this the in-memory broadcast for an old VOD has categoryId
      // undefined, so the symmetric mismatch check sees `'' === ''`
      // and the Pull button never appears.
      categoryId: item.snippet.categoryId ?? undefined,
    },
    status: {
      lifeCycleStatus: 'complete',
      privacyStatus: item.status?.privacyStatus ?? 'public',
    },
  }
}

/** Batched video lookup → LiveBroadcast-shaped objects (snippet + status) for
 *  many IDs at once. Chunks at the API's 50-ID-per-request limit; 1 quota unit
 *  per chunk (so ~4 units for 200 IDs). Used by the Out-of-sync panel to
 *  compare local meta against YouTube for every linked stream cheaply.
 *  `scheduledStartTime` / `gameTitle` are liveBroadcast-only and stay absent
 *  here — past videos don't need them, and `actualStartTime` (= publishedAt)
 *  marks them as started so the schedule mismatch is correctly skipped. */
export async function getVideosByIds(
  ids: string[],
  clientId: string,
  clientSecret: string
): Promise<LiveBroadcast[]> {
  if (ids.length === 0) return []
  const out: LiveBroadcast[] = []
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    const data = await ytRequest(
      `/videos?${new URLSearchParams({ part: 'snippet,status', id: chunk.join(','), maxResults: '50' })}`,
      { method: 'GET' },
      clientId, clientSecret
    )
    for (const item of (data?.items ?? [])) {
      out.push({
        id: item.id,
        snippet: {
          title: item.snippet?.title ?? '',
          description: item.snippet?.description ?? '',
          actualStartTime: item.snippet?.publishedAt,
          tags: item.snippet?.tags ?? [],
          categoryId: item.snippet?.categoryId ?? undefined,
        },
        status: {
          lifeCycleStatus: 'complete',
          privacyStatus: item.status?.privacyStatus ?? 'public',
        },
      })
    }
  }
  return out
}

/** A channel video as needed to import it into a stream item: metadata +
 *  thumbnail URL + a normalized local date. Shared shape between main and the
 *  renderer's import picker (mirror in renderer types). */
export interface YouTubeImportVideo {
  videoId: string
  title: string
  description: string
  tags: string[]
  categoryId?: string
  /** 'public' | 'unlisted' | 'private' */
  privacyStatus: string
  /** Local YYYY-MM-DD: actual stream start for livestreams, else publish date. */
  date: string
  /** Raw ISO publish timestamp. */
  publishedAt: string
  isLivestream: boolean
  /** status.uploadStatus — 'processed' for a normal published video; drafts and
   *  failed/rejected uploads report something else. */
  uploadStatus: string
  durationSeconds?: number
  thumbnailUrl?: string
}

/** Largest available thumbnail URL from a snippet.thumbnails object. */
function pickThumbUrl(thumbs: any): string | undefined {
  if (!thumbs) return undefined
  return (thumbs.maxres ?? thumbs.standard ?? thumbs.high ?? thumbs.medium ?? thumbs.default)?.url
}

/** ISO-8601 duration (PT#H#M#S) → seconds. */
function parseIsoDuration(iso: string | undefined): number | undefined {
  if (!iso) return undefined
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!m) return undefined
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0))
}

/** ISO timestamp → local YYYY-MM-DD, so imported folders match how SM names
 *  streams by the user's local date. */
function isoToLocalDate(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A non-livestream upload at or under this length is treated as a Short — the
 *  Data API exposes no Short flag, and YouTube caps Shorts at 1m1s. Shorts
 *  belong to a larger stream item, so the importer skips them. */
const SHORT_MAX_SECONDS = 61

/** List every video on the connected channel (uploads playlist), newest first,
 *  with the metadata + thumbnail needed to import each as a stream item. Walks
 *  channels.list → uploads playlist → playlistItems (paged) → videos.list
 *  (batched 50). Quota: 1 (channel) + 1 per 50 (playlistItems) + 1 per 50
 *  (videos) — a few units even for large channels. */
export async function getChannelVideos(
  clientId: string,
  clientSecret: string,
): Promise<YouTubeImportVideo[]> {
  // Uploads playlist id for the connected account.
  const ch = await ytRequest(
    `/channels?${new URLSearchParams({ part: 'contentDetails', mine: 'true' })}`,
    { method: 'GET' }, clientId, clientSecret,
  )
  const uploads = ch?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads as string | undefined
  if (!uploads) return []

  // Collect all upload video ids (playlistItems returns newest-first). Dedupe —
  // pagination can repeat an id when the channel uploads mid-walk.
  const ids: string[] = []
  const seenIds = new Set<string>()
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({ part: 'contentDetails', playlistId: uploads, maxResults: '50' })
    if (pageToken) params.set('pageToken', pageToken)
    const page = await ytRequest(`/playlistItems?${params}`, { method: 'GET' }, clientId, clientSecret)
    for (const it of (page?.items ?? [])) {
      const vid = it?.contentDetails?.videoId
      if (vid && !seenIds.has(vid)) { seenIds.add(vid); ids.push(vid) }
    }
    pageToken = page?.nextPageToken
  } while (pageToken)

  // Hide the persistent "default" broadcast (no scheduled time) — same detection
  // as the broadcast picker (isLikelyDefaultBroadcast). It shouldn't back an
  // imported stream item. Non-fatal: if broadcasts can't be fetched, don't hide.
  const defaultIds = new Set<string>()
  try {
    for (const b of await getLiveBroadcasts(clientId, clientSecret)) {
      if (!b.snippet?.scheduledStartTime) defaultIds.add(b.id)
    }
  } catch { /* leave defaultIds empty */ }

  // Hydrate details in 50-id batches (videos.list preserves the id order).
  const out: YouTubeImportVideo[] = []
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    const data = await ytRequest(
      `/videos?${new URLSearchParams({ part: 'snippet,status,contentDetails,liveStreamingDetails,fileDetails', id: chunk.join(','), maxResults: '50' })}`,
      { method: 'GET' }, clientId, clientSecret,
    )
    for (const item of (data?.items ?? [])) {
      if (defaultIds.has(item.id)) continue // hide the persistent default broadcast
      const sn = item.snippet ?? {}
      const live = item.liveStreamingDetails
      const durationSeconds = parseIsoDuration(item.contentDetails?.duration)
      // Skip Shorts — they belong to a larger stream item, not their own. Detect
      // via aspect ratio (Shorts are portrait) + the 1m1s cap. When fileDetails
      // has no stream dimensions, fall back to the duration cap alone.
      const vs = item.fileDetails?.videoStreams?.[0]
      const portrait = vs?.aspectRatio != null
        ? Number(vs.aspectRatio) < 1
        : (vs?.widthPixels && vs?.heightPixels) ? vs.heightPixels > vs.widthPixels : undefined
      if (!live && durationSeconds != null && durationSeconds <= SHORT_MAX_SECONDS && portrait !== false) continue
      const dateIso = (live?.actualStartTime as string | undefined) || sn.publishedAt
      out.push({
        videoId: item.id,
        title: sn.title ?? '',
        description: sn.description ?? '',
        tags: sn.tags ?? [],
        categoryId: sn.categoryId ?? undefined,
        privacyStatus: item.status?.privacyStatus ?? 'public',
        date: isoToLocalDate(dateIso),
        publishedAt: sn.publishedAt ?? '',
        isLivestream: !!live,
        uploadStatus: item.status?.uploadStatus ?? 'processed',
        durationSeconds,
        thumbnailUrl: pickThumbUrl(sn.thumbnails),
      })
    }
  }
  return out
}

/** Fetch tags for a list of video IDs from the videos resource and return a map of id → tags.
 *  Chunks requests to stay within the API's 50-ID-per-request limit. */
/** Returns per-id `{ tags, categoryId }` for fields the
 *  `/liveBroadcasts` resource doesn't carry — both live on the
 *  `/videos` snippet. Either field may be absent on a given video
 *  (tags is an array we omit when empty; categoryId can be missing
 *  on very old uploads). Callers iterate the returned map and assign
 *  whichever fields are present. */
async function fetchVideoExtras(
  ids: string[],
  clientId: string,
  clientSecret: string
): Promise<Map<string, { tags?: string[]; categoryId?: string }>> {
  if (ids.length === 0) return new Map()
  const map = new Map<string, { tags?: string[]; categoryId?: string }>()
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    const data = await ytRequest(
      `/videos?${new URLSearchParams({ part: 'snippet', id: chunk.join(','), maxResults: '50' })}`,
      { method: 'GET' },
      clientId, clientSecret
    )
    for (const item of (data?.items ?? [])) {
      const extras: { tags?: string[]; categoryId?: string } = {}
      if (item.snippet?.tags?.length) extras.tags = item.snippet.tags
      if (item.snippet?.categoryId) extras.categoryId = String(item.snippet.categoryId)
      if (extras.tags || extras.categoryId) map.set(item.id, extras)
    }
  }
  return map
}

/** Fetch the authenticated user's completed (past) live broadcasts, sorted newest-first.
 *  Paginates through all available results (API max is 50 per page). */
export async function getCompletedBroadcasts(
  clientId: string,
  clientSecret: string
): Promise<LiveBroadcast[]> {
  const broadcasts: LiveBroadcast[] = []
  let pageToken: string | undefined

  do {
    const params: Record<string, string> = { part: 'snippet,status', broadcastStatus: 'completed', maxResults: '50' }
    if (pageToken) params.pageToken = pageToken
    const data = await ytRequest(
      `/liveBroadcasts?${new URLSearchParams(params)}`,
      { method: 'GET' },
      clientId, clientSecret
    )
    broadcasts.push(...(data?.items ?? []))
    pageToken = data?.nextPageToken
  } while (pageToken)

  // Hydrate tags + categoryId from the videos resource (the
  // liveBroadcasts snippet doesn't carry either).
  const extrasMap = await fetchVideoExtras(broadcasts.map(b => b.id), clientId, clientSecret)
  for (const b of broadcasts) {
    const extras = extrasMap.get(b.id)
    if (extras?.tags) b.snippet.tags = extras.tags
    if (extras?.categoryId) b.snippet.categoryId = extras.categoryId
  }

  return broadcasts
}

export interface VideoStatus {
  privacyStatus: string
  /** True iff the video is (or was) a livestream — i.e. the YouTube
   *  resource carries a `liveStreamingDetails` block. Regular uploads
   *  never have it; both upcoming/active/completed broadcasts do. */
  isLivestream: boolean
  /** status.uploadStatus — 'uploaded' while YouTube is still processing the
   *  video (a just-ended stream's VOD isn't editable in Studio yet),
   *  'processed' once it's ready, 'failed'/'rejected' on error. */
  uploadStatus: string
  /** True when the video ID was queried but absent from the videos.list
   *  response — i.e. the video no longer exists on YouTube (deleted, or not
   *  visible to this account). Lets the UI flag dead links explicitly rather
   *  than leaving them indistinguishable from a not-yet-fetched status. */
  missing?: boolean
}

/** Fetch privacy + livestream-or-not status for a list of video IDs.
 *  Chunks requests to stay within the API's 50-ID-per-request limit.
 *  Returns a map of videoId → status. */
export async function fetchVideoStatuses(
  ids: string[],
  clientId: string,
  clientSecret: string
): Promise<Map<string, VideoStatus>> {
  if (ids.length === 0) return new Map()
  const map = new Map<string, VideoStatus>()
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    const data = await ytRequest(
      `/videos?${new URLSearchParams({ part: 'status,liveStreamingDetails', id: chunk.join(','), maxResults: '50' })}`,
      { method: 'GET' },
      clientId, clientSecret
    )
    // videos.list silently omits IDs that no longer exist — the response just
    // has fewer items. Track which of the chunk's IDs actually came back so
    // the absentees can be marked `missing` explicitly (a dead link the UI
    // should warn about) instead of being left out of the map entirely
    // (indistinguishable from "not fetched yet").
    const returned = new Set<string>()
    for (const item of (data?.items ?? [])) {
      if (item.id) returned.add(item.id)
      if (!item.status?.privacyStatus) continue
      map.set(item.id, {
        privacyStatus: item.status.privacyStatus,
        isLivestream: !!item.liveStreamingDetails,
        uploadStatus: item.status.uploadStatus ?? 'processed',
      })
    }
    for (const id of chunk) {
      if (!returned.has(id)) {
        map.set(id, { privacyStatus: '', isLivestream: false, uploadStatus: 'processed', missing: true })
      }
    }
  }
  return map
}

/** Check live-status + privacy for a batch of broadcasts in a single call.
 *  Uses `liveBroadcasts.list?id=a,b,c` — 1 quota unit regardless of ID count,
 *  so polling N upcoming broadcasts costs the same as polling one. Chunks at
 *  50 IDs per call to stay under the API's per-request cap. Returns a map
 *  keyed by broadcast ID; missing IDs (deleted broadcasts, wrong account)
 *  are simply absent from the result. */
export async function checkBroadcastsAreLive(
  broadcastIds: string[],
  clientId: string,
  clientSecret: string
): Promise<Record<string, { isLive: boolean; privacyStatus: string | null }>> {
  const map: Record<string, { isLive: boolean; privacyStatus: string | null }> = {}
  if (broadcastIds.length === 0) return map
  for (let i = 0; i < broadcastIds.length; i += 50) {
    const chunk = broadcastIds.slice(i, i + 50)
    const data = await ytRequest(
      `/liveBroadcasts?${new URLSearchParams({ part: 'status', id: chunk.join(','), maxResults: '50' })}`,
      { method: 'GET' },
      clientId, clientSecret
    )
    for (const item of (data?.items ?? [])) {
      if (!item?.id) continue
      map[item.id] = {
        isLive: item.status?.lifeCycleStatus === 'live',
        privacyStatus: item.status?.privacyStatus ?? null,
      }
    }
  }
  return map
}

/** Update a broadcast's title, description, and gameTitle.
 *  Only writable snippet fields are sent; scheduledStartTime is preserved from
 *  the current snippet because the API requires it for non-persistent broadcasts. */
/** Create a new live broadcast via liveBroadcasts.insert. Mirrors what visiting YouTube
 * Studio's "Go Live" page does — reserves a broadcast that the user can later bind to a
 * stream key in OBS. Returns the newly-created broadcast resource. */
export async function createBroadcast(
  params: { title: string; description: string; scheduledStartTime: string; privacyStatus: 'public' | 'unlisted' | 'private' },
  clientId: string,
  clientSecret: string
): Promise<{ id: string; snippet: any; status: any }> {
  const body = {
    snippet: {
      title: params.title || 'Untitled stream',
      description: params.description || '',
      scheduledStartTime: params.scheduledStartTime,
    },
    status: {
      privacyStatus: params.privacyStatus,
      selfDeclaredMadeForKids: false,
    },
    contentDetails: {
      enableAutoStart: false,
      // enableAutoStop = true is a safety net for SM-created broadcasts: if SM
      // crashes mid-stream and never gets to fire liveBroadcasts.transition,
      // YouTube will still auto-complete the broadcast ~1 minute after ingest
      // stops (per https://developers.google.com/youtube/v3/live/life-of-a-broadcast).
      // SM's normal end-of-stream flow still calls transition('complete') explicitly
      // so the VOD finalizes immediately instead of waiting for the ~60s timeout.
      enableAutoStop: true,
      // Skip the broadcast's "testing" phase so transition('live') works
      // straight from 'ready'. With enableMonitorStream:true (YouTube
      // Studio's default for manually-created broadcasts) the broadcast
      // has to go ready → testing → live; calling transition('live')
      // from 'ready' is rejected. SM doesn't show a monitor preview
      // anyway — it's just routing bytes through to YouTube — so the
      // testing phase has no UX value for our use case. Externally-
      // created broadcasts that the user picks may still have this on,
      // so the orchestrator also checks contentDetails at bind time and
      // does the testing transition for those.
      enableMonitorStream: false,
    },
  }
  return ytRequest(
    `/liveBroadcasts?part=snippet,status,contentDetails`,
    { method: 'POST', body: JSON.stringify(body) },
    clientId, clientSecret
  )
}

/** Fetch the channel's default persistent stream key via liveStreams.list.
 *  Returns the first stream owned by the authenticated user — for the vast
 *  majority of channels this is the "Default ingestion" stream that's been
 *  there since the channel enabled live streaming.
 *
 *  Returns null if the channel has no streams yet (rare — usually means
 *  the user has never enabled live streaming on the channel). Throws on
 *  API/auth failure so callers can surface the real reason. */
export async function getDefaultStreamKey(
  clientId: string,
  clientSecret: string,
): Promise<{ streamId: string; streamName: string; ingestionAddress: string } | null> {
  const res = await ytRequest(
    `/liveStreams?${new URLSearchParams({ part: 'id,cdn,snippet', mine: 'true', maxResults: '10' })}`,
    { method: 'GET' },
    clientId, clientSecret,
  )
  const items = res?.items ?? []
  if (items.length === 0) return null
  // Prefer the one whose snippet.title contains "Default" (YouTube creates one
  // automatically named "Default ingestion"); fall back to the first if no
  // such match exists (some channels have renamed it).
  const defaultStream = items.find((s: any) => /default/i.test(s.snippet?.title ?? '')) ?? items[0]
  const streamName: string | undefined = defaultStream?.cdn?.ingestionInfo?.streamName
  const ingestionAddress: string | undefined = defaultStream?.cdn?.ingestionInfo?.ingestionAddress
  if (!streamName) return null
  return {
    streamId: defaultStream.id,
    streamName,
    ingestionAddress: ingestionAddress ?? 'rtmp://a.rtmp.youtube.com/live2',
  }
}

/** Bind a broadcast to a stream. The stream becomes the ingest pipe for the
 *  broadcast; without binding, calling transition('live') will fail.
 *  Idempotent — binding a broadcast that's already bound to the same stream
 *  is a no-op as far as YouTube cares. */
export async function bindBroadcast(
  broadcastId: string,
  streamId: string,
  clientId: string,
  clientSecret: string,
): Promise<void> {
  await ytRequest(
    `/liveBroadcasts/bind?${new URLSearchParams({ id: broadcastId, part: 'id,status', streamId })}`,
    { method: 'POST' },
    clientId, clientSecret,
  )
}

/** Transition a broadcast's lifecycle status. Valid targets:
 *    'testing'   — receive on monitor stream only (we don't use this)
 *    'live'      — broadcast is visible to viewers
 *    'complete'  — broadcast is over; finalizes the VOD
 *
 *  Pre-conditions YouTube enforces:
 *    - 'live' requires the bound stream to be in 'active' status (i.e.
 *      receiving data); if called too soon after bind, fails with an error
 *      mentioning stream status. Caller should retry with a delay.
 *    - 'complete' can be called from 'live' (normal end-of-stream) or
 *      'testing'; idempotent if already 'complete'. */
export async function transitionBroadcast(
  broadcastId: string,
  broadcastStatus: 'testing' | 'live' | 'complete',
  clientId: string,
  clientSecret: string,
): Promise<void> {
  await ytRequest(
    `/liveBroadcasts/transition?${new URLSearchParams({ id: broadcastId, part: 'id,status', broadcastStatus })}`,
    { method: 'POST' },
    clientId, clientSecret,
  )
}

/** Fetch a broadcast's `contentDetails` — currently used by the relay
 *  orchestrator to decide whether to do the `testing` transition before
 *  `live`. `enableMonitorStream` defaults to true on YouTube-Studio-
 *  created broadcasts: with it enabled the broadcast MUST be moved
 *  through `ready → testing → live`; calling `transition('live')` from
 *  `ready` directly is the most common cause of "rejected the transition"
 *  errors. SM-created broadcasts explicitly opt out (see createBroadcast),
 *  but users can also pick broadcasts they made elsewhere — so we check
 *  per-broadcast rather than assuming our default. */
export async function getBroadcastContentDetails(
  broadcastId: string,
  clientId: string,
  clientSecret: string,
): Promise<{ enableMonitorStream?: boolean; enableAutoStart?: boolean; enableAutoStop?: boolean } | null> {
  const data = await ytRequest(
    `/liveBroadcasts?${new URLSearchParams({ part: 'contentDetails', id: broadcastId })}`,
    { method: 'GET' },
    clientId, clientSecret,
  )
  const item = data?.items?.[0]
  if (!item) return null
  const cd = item.contentDetails ?? {}
  return {
    enableMonitorStream: cd.enableMonitorStream,
    enableAutoStart: cd.enableAutoStart,
    enableAutoStop: cd.enableAutoStop,
  }
}

/** Fetch a liveStream's ingest status. Used by the orchestrator to poll
 *  until YouTube is actually receiving + validating data before calling
 *  transition('live') — calling it before the stream is 'active' is the
 *  most common cause of "couldn't go live" failures.
 *
 *  streamStatus progresses: created → ready → active (receiving data).
 *  healthStatus.status: noData → bad/ok/good as ingest health is assessed.
 *  Returns nulls if the stream id isn't found. Costs 1 quota unit. */
export async function getStreamStatus(
  streamId: string,
  clientId: string,
  clientSecret: string,
): Promise<{ streamStatus: string | null; healthStatus: string | null }> {
  const res = await ytRequest(
    `/liveStreams?${new URLSearchParams({ part: 'status', id: streamId })}`,
    { method: 'GET' },
    clientId, clientSecret,
  )
  const status = res?.items?.[0]?.status ?? null
  return {
    streamStatus: status?.streamStatus ?? null,
    healthStatus: status?.healthStatus?.status ?? null,
  }
}

/** Look up a stream's id by its stream key. Used when the user manually
 *  pasted a key (skipping auto-fill) so we don't have the id cached. */
export async function findStreamIdByName(
  streamName: string,
  clientId: string,
  clientSecret: string,
): Promise<string | null> {
  if (!streamName) return null
  const res = await ytRequest(
    `/liveStreams?${new URLSearchParams({ part: 'id,cdn', mine: 'true', maxResults: '20' })}`,
    { method: 'GET' },
    clientId, clientSecret,
  )
  const items = res?.items ?? []
  const match = items.find((s: any) => s?.cdn?.ingestionInfo?.streamName === streamName)
  return match?.id ?? null
}

/** Update a broadcast's privacy via `liveBroadcasts.update?part=status`.
 *  The status part is its own writable surface, so we don't need to fetch
 *  and re-send unrelated snippet fields. Works for upcoming, live, and
 *  completed broadcasts — completed broadcasts (VODs) are still under the
 *  liveBroadcasts resource until they're old enough that YouTube migrates
 *  them to plain videos. */
export async function updateBroadcastStatus(
  broadcastId: string,
  privacyStatus: 'public' | 'unlisted' | 'private',
  clientId: string,
  clientSecret: string,
): Promise<void> {
  await ytRequest(
    `/liveBroadcasts?part=status`,
    {
      method: 'PUT',
      body: JSON.stringify({
        id: broadcastId,
        status: { privacyStatus },
      }),
    },
    clientId, clientSecret
  )
}

/** Update a regular video's privacy via `videos.update?part=status`. This is
 *  the fallback for stream items linked to a plain video with no liveBroadcast
 *  record — e.g. a re-upload that replaced a deleted livestream — where
 *  updateBroadcastStatus 404s "Live broadcast not found". videos.update drops
 *  any status field omitted from the request body, so we read the current
 *  status and merge privacyStatus in to preserve embeddable / license /
 *  madeForKids rather than silently resetting them. */
export async function updateVideoStatus(
  videoId: string,
  privacyStatus: 'public' | 'unlisted' | 'private',
  clientId: string,
  clientSecret: string,
): Promise<void> {
  const data = await ytRequest(
    `/videos?part=status&id=${encodeURIComponent(videoId)}`,
    { method: 'GET' },
    clientId, clientSecret,
  )
  const current = data?.items?.[0]?.status ?? {}
  await ytRequest(
    `/videos?part=status`,
    {
      method: 'PUT',
      body: JSON.stringify({
        id: videoId,
        status: { ...current, privacyStatus },
      }),
    },
    clientId, clientSecret,
  )
}

/** Delete a YouTube video (including the VOD of a completed livestream).
 *  Irreversible — there's no recycle bin on YouTube. Quota cost: 50 units.
 *  Works for both regular videos and finished livestream VODs since both
 *  live under the videos resource once the broadcast completes. Throws on
 *  any non-2xx so the caller can surface the failure (most commonly
 *  "video not found" if the user already deleted it elsewhere). */
export async function deleteVideo(
  videoId: string,
  clientId: string,
  clientSecret: string,
): Promise<void> {
  await ytRequest(
    `/videos?${new URLSearchParams({ id: videoId })}`,
    { method: 'DELETE' },
    clientId, clientSecret
  )
}

export async function updateBroadcastSnippet(
  broadcastId: string,
  updates: { title: string; description: string; scheduledStartTime?: string },
  clientId: string,
  clientSecret: string
): Promise<void> {
  // Fetch current snippet so we don't lose scheduledStartTime (required field)
  const current = await ytRequest(
    `/liveBroadcasts?${new URLSearchParams({ part: 'snippet', id: broadcastId })}`,
    { method: 'GET' },
    clientId, clientSecret
  )
  const currentSnippet = current?.items?.[0]?.snippet ?? {}

  // Only send writable fields — spreading the full snippet back causes 400s
  // because the response contains read-only fields (channelId, publishedAt, etc.)
  const snippet: Record<string, any> = {
    title: updates.title,
    description: updates.description,
  }
  // Caller-supplied scheduledStartTime wins (e.g., reschedule push); else
  // preserve the existing one. scheduledStartTime is a required field on
  // upcoming broadcasts, so omitting it entirely 400s.
  const nextScheduled = updates.scheduledStartTime ?? currentSnippet.scheduledStartTime
  if (nextScheduled) {
    snippet.scheduledStartTime = nextScheduled
  }

  await ytRequest(
    `/liveBroadcasts?part=snippet`,
    {
      method: 'PUT',
      body: JSON.stringify({ id: broadcastId, snippet }),
    },
    clientId, clientSecret
  )
}

/** Update tags (and optionally title/description) on the video resource.
 *  Passing updatedTitle/updatedDescription avoids a race where the video resource
 *  hasn't reflected a just-made broadcast snippet update yet. */
export async function updateVideoTags(
  videoId: string,
  tags: string[],
  clientId: string,
  clientSecret: string,
  updatedTitle?: string,
  updatedDescription?: string,
  updatedCategoryId?: string,
): Promise<void> {
  const current = await ytRequest(
    `/videos?${new URLSearchParams({ part: 'snippet', id: videoId })}`,
    { method: 'GET' },
    clientId, clientSecret
  )
  const currentSnippet = current?.items?.[0]?.snippet ?? {}

  // Only send writable snippet fields to avoid 400s from read-only properties.
  // Use the caller-supplied title/description if provided — the video resource
  // may not have synced the broadcast snippet update yet. `updatedCategoryId`
  // overrides the existing categoryId when supplied — the regular YT push
  // flow uses this to push the user's chosen category alongside title/tags
  // in one round-trip; omitting it preserves whatever's currently on the
  // video (back-compat for any caller that doesn't know about category).
  await ytRequest(
    `/videos?part=snippet`,
    {
      method: 'PUT',
      body: JSON.stringify({
        id: videoId,
        snippet: {
          title: updatedTitle ?? currentSnippet.title,
          description: updatedDescription ?? currentSnippet.description,
          categoryId: updatedCategoryId ?? currentSnippet.categoryId,
          defaultLanguage: currentSnippet.defaultLanguage,
          tags,
        },
      }),
    },
    clientId, clientSecret
  )
}

/** A single entry from the `videoCategories.list` response. `assignable`
 *  is false for some categories (e.g. legacy ones YouTube no longer lets
 *  users pick) — the caller should filter those out before presenting a
 *  dropdown. */
export interface YouTubeVideoCategory {
  id: string
  title: string
  assignable: boolean
}

/** Fetches the assignable video categories for a region. YouTube's
 *  category list is region-specific (e.g. some regions don't have
 *  "Nonprofits & Activism"), so the caller passes the regionCode — 'US'
 *  is a safe default that covers the common ones (Gaming, Entertainment,
 *  Music, etc.). The list changes rarely, so the renderer caches it for
 *  the session rather than re-fetching per sidebar mount. */
export async function getVideoCategories(
  regionCode: string,
  clientId: string,
  clientSecret: string,
): Promise<YouTubeVideoCategory[]> {
  const res = await ytRequest(
    `/videoCategories?${new URLSearchParams({ part: 'snippet', regionCode })}`,
    { method: 'GET' },
    clientId, clientSecret
  )
  const items: any[] = res?.items ?? []
  return items.map(i => ({
    id: String(i.id),
    title: String(i.snippet?.title ?? ''),
    assignable: !!i.snippet?.assignable,
  }))
}
