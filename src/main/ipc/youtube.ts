import { ipcMain } from 'electron'
import { startOAuthFlow, exchangeCode, clearTokens, isConnected, getValidToken, REDIRECT_URI } from '../services/youtubeAuth'
import { getLiveBroadcasts, getCompletedBroadcasts, updateBroadcastSnippet, updateVideoTags, filterYouTubeThumbnails, uploadThumbnail, getVideoById, checkBroadcastIsLive, fetchVideoStatuses, createBroadcast, getMyChannelId, clearChannelIdCache } from '../services/youtubeApi'
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
    clearChannelIdCache()
  })

  ipcMain.handle('youtube:getChannelId', async () => {
    const { clientId, clientSecret } = getCreds()
    if (!clientId || !clientSecret) throw new Error('YouTube credentials not configured.')
    return await getMyChannelId(clientId, clientSecret)
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

  ipcMain.handle('youtube:getVideoStatuses', async (_event, videoIds: string[]) => {
    const { clientId, clientSecret } = getCreds()
    try {
      const map = await fetchVideoStatuses(videoIds, clientId, clientSecret)
      return Object.fromEntries(map)
    } catch {
      return {}
    }
  })

  ipcMain.handle('youtube:checkBroadcastIsLive', async (_event, broadcastId: string) => {
    const { clientId, clientSecret } = getCreds()
    try {
      return await checkBroadcastIsLive(broadcastId, clientId, clientSecret)
    } catch {
      return { isLive: false, privacyStatus: null }
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

  ipcMain.handle('youtube:createBroadcast', async (
    _event,
    params: { title: string; description: string; scheduledStartTime: string; privacyStatus: 'public' | 'unlisted' | 'private' },
  ) => {
    const { clientId, clientSecret } = getCreds()
    try {
      return await createBroadcast(params, clientId, clientSecret)
    } catch (e: any) {
      console.error('[YT main] createBroadcast — error:', e.message)
      throw e
    }
  })

  ipcMain.handle('youtube:getCompletedBroadcasts', async () => {
    const { clientId, clientSecret } = getCreds()
    try {
      return await getCompletedBroadcasts(clientId, clientSecret)
    } catch (e: any) {
      console.error('[YT main] getCompletedBroadcasts — error:', e.message)
      throw e
    }
  })

  ipcMain.handle('youtube:getVideoById', async (_event, videoId: string) => {
    const { clientId, clientSecret } = getCreds()
    return getVideoById(videoId, clientId, clientSecret)
  })

  ipcMain.handle('youtube:updateVideo', async (
    _event,
    videoId: string,
    title: string,
    description: string,
    tags: string[]
  ) => {
    const { clientId, clientSecret } = getCreds()
    await updateVideoTags(videoId, tags, clientId, clientSecret, title, description)
  })

  ipcMain.handle('youtube:getQualifyingThumbnails', (_event, paths: string[]) => {
    return filterYouTubeThumbnails(paths)
  })

  ipcMain.handle('youtube:uploadThumbnail', async (_event, videoId: string, imagePath: string) => {
    const { clientId, clientSecret } = getCreds()
    await uploadThumbnail(videoId, imagePath, clientId, clientSecret)
  })

  ipcMain.handle('youtube:updateBroadcast', async (
    _event,
    broadcastId: string,
    snippet: { title: string; description: string },
    tags: string[]
  ) => {
    const { clientId, clientSecret } = getCreds()
    await updateBroadcastSnippet(broadcastId, snippet, clientId, clientSecret)
    if (tags.length > 0) {
      await updateVideoTags(broadcastId, tags, clientId, clientSecret, snippet.title, snippet.description)
    }
  })
}
