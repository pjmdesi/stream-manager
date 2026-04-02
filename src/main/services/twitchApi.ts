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

/** Search for a game/category and return its ID, or empty string if not found. */
async function findGameId(
  gameName: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  if (!gameName.trim()) return ''
  const data = await twitchRequest(
    `/search/categories?${new URLSearchParams({ query: gameName, first: '5' })}`,
    { method: 'GET' },
    clientId, clientSecret
  )
  const results: { id: string; name: string }[] = data?.data ?? []
  // Prefer exact match (case-insensitive), fall back to first result
  const exact = results.find(r => r.name.toLowerCase() === gameName.toLowerCase())
  return (exact ?? results[0])?.id ?? ''
}

/** Update the channel title and optionally the game/category. */
export async function updateChannelInfo(
  title: string,
  gameName: string | undefined,
  clientId: string,
  clientSecret: string
): Promise<void> {
  const broadcasterId = await getBroadcasterId(clientId, clientSecret)

  const body: Record<string, any> = { title }
  if (gameName) {
    const gameId = await findGameId(gameName, clientId, clientSecret)
    if (gameId) body.game_id = gameId
  }

  await twitchRequest(
    `/channels?broadcaster_id=${broadcasterId}`,
    { method: 'PATCH', body: JSON.stringify(body) },
    clientId, clientSecret
  )
}
