import { ipcMain } from 'electron'
import { startOAuthFlow, exchangeCode, clearTokens, isConnected, getValidToken, REDIRECT_URI } from '../services/youtubeAuth'
import { getLiveBroadcasts, updateBroadcastSnippet, updateVideoTags } from '../services/youtubeApi'
import { getStore } from './store'

function getCreds() {
  const config = getStore().get('config') as any
  return {
    clientId: (config.youtubeClientId ?? '') as string,
    clientSecret: (config.youtubeClientSecret ?? '') as string,
  }
}

export function registerYouTubeIPC(): void {
  ipcMain.handle('youtube:getStatus', () => {
    const connected = isConnected()
    console.log('[YT main] getStatus — connected:', connected)
    return { connected, redirectUri: REDIRECT_URI }
  })

  ipcMain.handle('youtube:connect', async () => {
    const { clientId, clientSecret } = getCreds()
    if (!clientId || !clientSecret) throw new Error('Client ID and Secret must be saved in settings first.')
    const code = await startOAuthFlow(clientId)
    await exchangeCode(code, clientId, clientSecret)
  })

  ipcMain.handle('youtube:disconnect', () => {
    clearTokens()
  })

  ipcMain.handle('youtube:validateToken', async () => {
    if (!isConnected()) return { valid: false, error: 'Not connected' }
    const { clientId, clientSecret } = getCreds()
    try {
      await getValidToken(clientId, clientSecret)
      return { valid: true }
    } catch (e: any) {
      return { valid: false, error: e.message as string }
    }
  })

  ipcMain.handle('youtube:getBroadcasts', async () => {
    const { clientId, clientSecret } = getCreds()
    console.log('[YT main] getBroadcasts — clientId set:', !!clientId, '| clientSecret set:', !!clientSecret)
    try {
      const result = await getLiveBroadcasts(clientId, clientSecret)
      console.log('[YT main] getBroadcasts — returned', result.length, 'broadcasts')
      return result
    } catch (e: any) {
      console.error('[YT main] getBroadcasts — error:', e.message)
      throw e
    }
  })

  ipcMain.handle('youtube:updateBroadcast', async (
    _event,
    broadcastId: string,
    snippet: { title: string; description: string; gameTitle?: string },
    tags: string[]
  ) => {
    console.log('[YT main] updateBroadcast received — broadcastId:', broadcastId)
    console.log('[YT main] snippet:', JSON.stringify(snippet))
    console.log('[YT main] tags:', tags)
    const { clientId, clientSecret } = getCreds()
    console.log('[YT main] clientId set:', !!clientId, '| clientSecret set:', !!clientSecret)
    await updateBroadcastSnippet(broadcastId, snippet, clientId, clientSecret)
    console.log('[YT main] snippet updated OK')
    if (tags.length > 0) {
      await updateVideoTags(broadcastId, tags, clientId, clientSecret, snippet.title, snippet.description)
      console.log('[YT main] tags updated OK')
    }
  })
}
