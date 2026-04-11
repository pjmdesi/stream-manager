import { getValidToken } from './youtubeAuth'

const BASE = 'https://www.googleapis.com/youtube/v3'

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
    // Persistent stream key broadcast — requires mine=true, incompatible with broadcastStatus
    ytRequest(
      `/liveBroadcasts?${new URLSearchParams({ part: 'snippet,status', mine: 'true', broadcastType: 'persistent', maxResults: '5' })}`,
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

  return broadcasts
}

/** Update a broadcast's title, description, and gameTitle.
 *  Only writable snippet fields are sent; scheduledStartTime is preserved from
 *  the current snippet because the API requires it for non-persistent broadcasts. */
export async function updateBroadcastSnippet(
  broadcastId: string,
  updates: { title: string; description: string; gameTitle?: string },
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
    gameTitle: updates.gameTitle ?? currentSnippet.gameTitle ?? '',
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
