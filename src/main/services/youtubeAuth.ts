import http from 'http'
import { shell } from 'electron'
import Store from 'electron-store'

const REDIRECT_PORT = 42813
export const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`
const SCOPE = 'https://www.googleapis.com/auth/youtube'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

export interface YouTubeTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number  // ms since epoch
}

const tokenStore = new Store<{ tokens: YouTubeTokens | null }>({
  name: 'youtube-auth',
  defaults: { tokens: null }
})

export function getTokens(): YouTubeTokens | null {
  return tokenStore.get('tokens', null)
}

export function setTokens(tokens: YouTubeTokens): void {
  tokenStore.set('tokens', tokens)
}

export function clearTokens(): void {
  tokenStore.set('tokens', null)
}

export function isConnected(): boolean {
  const t = getTokens()
  return !!(t?.refreshToken)
}

export function buildAuthUrl(clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

/** Opens the system browser and waits for the OAuth callback on localhost. */
export async function startOAuthFlow(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) return
      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`)
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')

      const html = (msg: string) =>
        `<html><body style="font-family:sans-serif;padding:2rem;background:#0d0d1a;color:#e2e8f0"><h2>${msg}</h2><p>You can close this tab.</p></body></html>`

      res.writeHead(200, { 'Content-Type': 'text/html' })
      if (code) {
        res.end(html('Connected to YouTube! ✓'))
        server.close()
        resolve(code)
      } else {
        res.end(html('Authentication failed.'))
        server.close()
        reject(new Error(error || 'Authentication failed'))
      }
    })

    server.listen(REDIRECT_PORT, () => {
      shell.openExternal(buildAuthUrl(clientId))
    })

    server.on('error', reject)

    // 5-minute timeout
    setTimeout(() => {
      server.close()
      reject(new Error('OAuth timed out'))
    }, 5 * 60 * 1000)
  })
}

export async function exchangeCode(
  code: string,
  clientId: string,
  clientSecret: string
): Promise<YouTubeTokens> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
  const data = await res.json() as any
  if (data.error) throw new Error(data.error_description || data.error)

  const tokens: YouTubeTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  setTokens(tokens)
  return tokens
}

export async function refreshAccessToken(
  clientId: string,
  clientSecret: string
): Promise<string> {
  const tokens = getTokens()
  if (!tokens?.refreshToken) throw new Error('Not connected to YouTube')

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: tokens.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json() as any
  if (data.error) throw new Error(data.error_description || data.error)

  const updated: YouTubeTokens = {
    ...tokens,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  setTokens(updated)
  return data.access_token
}

/** Returns a valid access token, refreshing if needed. */
export async function getValidToken(
  clientId: string,
  clientSecret: string
): Promise<string> {
  const tokens = getTokens()
  if (!tokens) throw new Error('Not connected to YouTube')
  // Refresh if within 5 minutes of expiry
  if (Date.now() > tokens.expiresAt - 5 * 60 * 1000) {
    return refreshAccessToken(clientId, clientSecret)
  }
  return tokens.accessToken
}
