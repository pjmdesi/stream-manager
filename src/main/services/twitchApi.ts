import { getValidToken } from './twitchAuth'

const BASE = 'https://api.twitch.tv/helix'

async function twitchRequest(
  path: string,
  options: RequestInit,
  clientId: string,
  clientSecret: string
): Promise<any> {
  const token = await getValidToken(clientId, clientSecret)
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Client-Id': clientId,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any
    throw new Error(err?.message || `Twitch API error ${res.status}`)
  }
  if (res.status === 204) return null
  return res.json()
}

/** Get the authenticated user's broadcaster ID. */
async function getBroadcasterId(clientId: string, clientSecret: string): Promise<string> {
  const data = await twitchRequest('/users', { method: 'GET' }, clientId, clientSecret)
  const id = data?.data?.[0]?.id
  if (!id) throw new Error('Could not retrieve Twitch broadcaster ID')
  return id
}

/** Search for a game/category and return its ID, or '' when there is no
 *  CONFIDENT match. Confident = case-insensitive exact name match, tried
 *  first on the full query and then with any parenthetical stripped
 *  ("Deiity (Under Ice)" → "Deiity") — local game names often carry a
 *  subtitle the Twitch catalog doesn't.
 *
 *  Deliberately NEVER falls back to the first search hit: unattended pushes
 *  applied whatever Twitch's fuzzy search ranked first, silently setting a
 *  WRONG category. Decision 2026-07-11: skip the category instead ('' →
 *  categoryApplied=false) and let every push surface report it. */
async function findGameId(
  gameName: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const searchExact = async (query: string): Promise<string> => {
    const data = await twitchRequest(
      `/search/categories?${new URLSearchParams({ query, first: '10' })}`,
      { method: 'GET' },
      clientId, clientSecret
    )
    const results: { id: string; name: string }[] = data?.data ?? []
    return results.find(r => r.name.toLowerCase() === query.toLowerCase())?.id ?? ''
  }

  const full = gameName.trim()
  if (!full) return ''
  const exact = await searchExact(full)
  if (exact) return exact

  const stripped = full.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s{2,}/g, ' ').trim()
  if (stripped && stripped.toLowerCase() !== full.toLowerCase()) {
    return searchExact(stripped)
  }
  return ''
}

/** Fetch the authenticated user's current channel info: title,
 *  category/game name, and tags. Used by the renderer to compare against
 *  local stream metadata and decide whether the "Push to Twitch" button
 *  has anything to push. Returns null if Twitch responds without the
 *  expected payload (rare — usually a not-yet-affiliated account). */
export async function getChannelInfo(
  clientId: string,
  clientSecret: string,
): Promise<{ title: string; gameName: string; tags: string[] } | null> {
  const broadcasterId = await getBroadcasterId(clientId, clientSecret)
  const data = await twitchRequest(
    `/channels?broadcaster_id=${broadcasterId}`,
    { method: 'GET' },
    clientId, clientSecret,
  )
  const row = data?.data?.[0]
  if (!row) return null
  return {
    title: typeof row.title === 'string' ? row.title : '',
    gameName: typeof row.game_name === 'string' ? row.game_name : '',
    tags: Array.isArray(row.tags) ? row.tags.filter((t: unknown): t is string => typeof t === 'string') : [],
  }
}

/** Update the channel title and optionally the game/category + tags.
 *  Tags must already conform to Twitch's rules (≤10, ≤25 chars each,
 *  alphanumeric only) — the renderer filters before sending.
 *
 *  Returns whether the requested category was actually applied: when the
 *  category search finds no match for `gameName`, the PATCH still succeeds
 *  (title/tags) but game_id is omitted — the channel's category is left
 *  unchanged. Callers MUST surface that, or the push looks fully successful
 *  while Twitch silently keeps the old category. `categoryApplied` is true
 *  when no category change was requested. */
export async function updateChannelInfo(
  title: string,
  gameName: string | undefined,
  tags: string[] | undefined,
  clientId: string,
  clientSecret: string
): Promise<{ categoryApplied: boolean }> {
  const broadcasterId = await getBroadcasterId(clientId, clientSecret)

  const body: Record<string, any> = { title }
  let categoryApplied = true
  if (gameName) {
    const gameId = await findGameId(gameName, clientId, clientSecret)
    if (gameId) body.game_id = gameId
    else categoryApplied = false
  }
  if (tags) body.tags = tags

  await twitchRequest(
    `/channels?broadcaster_id=${broadcasterId}`,
    { method: 'PATCH', body: JSON.stringify(body) },
    clientId, clientSecret
  )
  return { categoryApplied }
}
