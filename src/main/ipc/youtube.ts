import { ipcMain } from 'electron'
import { startOAuthFlow, exchangeCode, clearTokens, isConnected, REDIRECT_URI } from '../services/youtubeAuth'
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
    return { connected: isConnected(), redirectUri: REDIRECT_URI }
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

  ipcMain.handle('youtube:getBroadcasts', async () => {
    const { clientId, clientSecret } = getCreds()
    return getLiveBroadcasts(clientId, clientSecret)
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
