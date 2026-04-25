import fs from 'fs'
import path from 'path'
import { getValidToken } from './youtubeAuth'

const BASE = 'https://www.googleapis.com/youtube/v3'

const YT_THUMBNAIL_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])
const YT_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024 // 2 MB

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

/** Filter a list of image paths to those that meet YouTube's thumbnail requirements:
 *  - Accepted format: JPG, PNG, GIF, WebP
 *  - Max file size: 2 MB
 *  (Resolution ≥ 1280×720 is recommended but not enforced here — YouTube will reject if too small.) */
export function filterYouTubeThumbnails(paths: string[]): string[] {
  return paths.filter(p => {
    const ext = path.extname(p).toLowerCase()
    if (!YT_THUMBNAIL_EXTS.has(ext)) return false
    try { return fs.statSync(p).size <= YT_THUMBNAIL_MAX_BYTES } catch { return false }
  })
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
    throw new Error(err?.error?.message || `YouTube thumbnail upload failed (${res.status})`)
  }
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
    throw new Error(err?.error?.message || `YouTube API error ${res.status}`)
  }
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

  // Hydrate tags from the videos resource (liveBroadcasts snippet doesn't carry them)
  const tagsMap = await fetchTagsForVideos(broadcasts.map(b => b.id), clientId, clientSecret)
  for (const b of broadcasts) {
    const tags = tagsMap.get(b.id)
    if (tags) b.snippet.tags = tags
  }

  return broadcasts
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
    },
    status: {
      lifeCycleStatus: 'complete',
      privacyStatus: item.status?.privacyStatus ?? 'public',
    },
  }
}

/** Fetch tags for a list of video IDs from the videos resource and return a map of id → tags.
 *  Chunks requests to stay within the API's 50-ID-per-request limit. */
async function fetchTagsForVideos(
  ids: string[],
  clientId: string,
  clientSecret: string
): Promise<Map<string, string[]>> {
  if (ids.length === 0) return new Map()
  const map = new Map<string, string[]>()
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    const data = await ytRequest(
      `/videos?${new URLSearchParams({ part: 'snippet', id: chunk.join(','), maxResults: '50' })}`,
      { method: 'GET' },
      clientId, clientSecret
    )
    for (const item of (data?.items ?? [])) {
      if (item.snippet?.tags?.length) map.set(item.id, item.snippet.tags)
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

  // Hydrate tags from the videos resource (liveBroadcasts snippet doesn't carry them)
  const tagsMap = await fetchTagsForVideos(broadcasts.map(b => b.id), clientId, clientSecret)
  for (const b of broadcasts) {
    const tags = tagsMap.get(b.id)
    if (tags) b.snippet.tags = tags
  }

  return broadcasts
}

/** Fetch privacy statuses for a list of video IDs.
 *  Chunks requests to stay within the API's 50-ID-per-request limit.
 *  Returns a map of videoId → privacyStatus. */
export async function fetchPrivacyStatuses(
  ids: string[],
  clientId: string,
  clientSecret: string
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const map = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50)
    const data = await ytRequest(
      `/videos?${new URLSearchParams({ part: 'status', id: chunk.join(','), maxResults: '50' })}`,
      { method: 'GET' },
      clientId, clientSecret
    )
    for (const item of (data?.items ?? [])) {
      if (item.status?.privacyStatus) map.set(item.id, item.status.privacyStatus)
    }
  }
  return map
}

/** Check whether a specific broadcast is currently live and return its privacy status.
 *  Uses a minimal part=status query — costs 1 quota unit. */
export async function checkBroadcastIsLive(
  broadcastId: string,
  clientId: string,
  clientSecret: string
): Promise<{ isLive: boolean; privacyStatus: string | null }> {
  const data = await ytRequest(
    `/liveBroadcasts?${new URLSearchParams({ part: 'status', id: broadcastId })}`,
    { method: 'GET' },
    clientId, clientSecret
  )
  const status = data?.items?.[0]?.status ?? null
  return {
    isLive: status?.lifeCycleStatus === 'live',
    privacyStatus: status?.privacyStatus ?? null,
  }
}

/** Update a broadcast's title, description, and gameTitle.
 *  Only writable snippet fields are sent; scheduledStartTime is preserved from
 *  the current snippet because the API requires it for non-persistent broadcasts. */
export async function updateBroadcastSnippet(
  broadcastId: string,
  updates: { title: string; description: string },
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
  if (currentSnippet.scheduledStartTime) {
    snippet.scheduledStartTime = currentSnippet.scheduledStartTime
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
): Promise<void> {
  const current = await ytRequest(
    `/videos?${new URLSearchParams({ part: 'snippet', id: videoId })}`,
    { method: 'GET' },
    clientId, clientSecret
  )
  const currentSnippet = current?.items?.[0]?.snippet ?? {}

  // Only send writable snippet fields to avoid 400s from read-only properties.
  // Use the caller-supplied title/description if provided — the video resource
  // may not have synced the broadcast snippet update yet.
  await ytRequest(
    `/videos?part=snippet`,
    {
      method: 'PUT',
      body: JSON.stringify({
        id: videoId,
        snippet: {
          title: updatedTitle ?? currentSnippet.title,
          description: updatedDescription ?? currentSnippet.description,
          categoryId: currentSnippet.categoryId,
          defaultLanguage: currentSnippet.defaultLanguage,
          tags,
        },
      }),
    },
    clientId, clientSecret
  )
}
