import { ipcMain } from 'electron'
import { startOAuthFlow, exchangeCode, clearTokens, isConnected, getValidToken, REDIRECT_URI } from '../services/youtubeAuth'
import { getLiveBroadcasts, getCompletedBroadcasts, updateBroadcastSnippet, updateBroadcastStatus, deleteVideo, updateVideoTags, categorizeYouTubeThumbnails, uploadThumbnail, getVideoById, getBroadcastById, checkBroadcastsAreLive, fetchVideoStatuses, createBroadcast, getMyChannelId, clearChannelIdCache, getDefaultStreamKey, getVideoCategories } from '../services/youtubeApi'
import * as ytQuotaState from '../services/ytQuotaState'
import { getStore } from './store'

function getCreds() {
  const config = getStore().get('config') as any
  return {
    clientId: (config.youtubeClientId ?? '') as string,
    clientSecret: (config.youtubeClientSecret ?? '') as string,
  }
}

export function registerYouTubeIPC(): void {
  // Dev-only: re-apply the persisted force-quota flag on every launch
  // so the toggle in Settings → Dev Tools survives restarts. Read once
  // at register time; subsequent toggles flow through the IPC handler
  // below + Settings save handler.
  try {
    const persisted = !!(getStore().get('config') as any).devForceYouTubeQuotaExceeded
    if (persisted) ytQuotaState.setForcedExceeded(true)
  } catch { /* startup safety — never block IPC reg on this */ }

  ipcMain.handle('youtube:getStatus', () => {
    const connected = isConnected()
    console.log('[YT main] getStatus — connected:', connected)
    return { connected, redirectUri: REDIRECT_URI }
  })

  // Renderer reads this on mount + listens for `youtube:quota-changed`
  // pushes to react to mid-session changes. The state auto-clears after
  // midnight PT — the renderer doesn't have to poll or schedule a clear.
  ipcMain.handle('youtube:getQuotaState', () => ytQuotaState.getQuotaState())
  // Dev-only knob exposed to the Settings page so QA flows can poke
  // the quota gate without burning real API units. The handler itself
  // doesn't check app.isPackaged — the renderer guards visibility.
  // Returns the resulting state so the caller can update local UI
  // without an extra round-trip.
  ipcMain.handle('youtube:setForcedQuotaExceeded', (_e, forced: boolean) => {
    ytQuotaState.setForcedExceeded(!!forced)
    return ytQuotaState.getQuotaState()
  })
  ipcMain.handle('youtube:getForcedQuotaExceeded', () => ytQuotaState.isForcedExceeded())

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

  ipcMain.handle('youtube:checkBroadcastsAreLive', async (_event, broadcastIds: string[]) => {
    const { clientId, clientSecret } = getCreds()
    try {
      return await checkBroadcastsAreLive(broadcastIds, clientId, clientSecret)
    } catch {
      return {}
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

  // Fetch the channel's default persistent stream key. Used by the Stream
  // Relay setup flow to auto-fill the outbound key field. One-shot — the
  // result is cached in electron-store by the caller; this IPC just talks
  // to YouTube.
  ipcMain.handle('youtube:getDefaultStreamKey', async () => {
    const { clientId, clientSecret } = getCreds()
    try {
      return await getDefaultStreamKey(clientId, clientSecret)
    } catch (e: any) {
      console.error('[YT main] getDefaultStreamKey — error:', e.message)
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

  ipcMain.handle('youtube:getBroadcastById', async (_event, broadcastId: string) => {
    const { clientId, clientSecret } = getCreds()
    return getBroadcastById(broadcastId, clientId, clientSecret)
  })

  ipcMain.handle('youtube:getCategories', async (_event, regionCode?: string) => {
    const { clientId, clientSecret } = getCreds()
    return getVideoCategories(regionCode || 'US', clientId, clientSecret)
  })

  ipcMain.handle('youtube:updateVideo', async (
    _event,
    videoId: string,
    title: string,
    description: string,
    tags: string[],
    categoryId?: string,
  ) => {
    const { clientId, clientSecret } = getCreds()
    await updateVideoTags(videoId, tags, clientId, clientSecret, title, description, categoryId)
  })

  ipcMain.handle('youtube:getQualifyingThumbnails', (_event, paths: string[]) => {
    return categorizeYouTubeThumbnails(paths)
  })

  ipcMain.handle('youtube:uploadThumbnail', async (_event, videoId: string, imagePath: string) => {
    const { clientId, clientSecret } = getCreds()
    await uploadThumbnail(videoId, imagePath, clientId, clientSecret)
  })

  ipcMain.handle('youtube:updateBroadcast', async (
    _event,
    broadcastId: string,
    snippet: { title: string; description: string; scheduledStartTime?: string },
    tags: string[],
    categoryId?: string,
  ) => {
    const { clientId, clientSecret } = getCreds()
    await updateBroadcastSnippet(broadcastId, snippet, clientId, clientSecret)
    // categoryId lives on the underlying video resource (not the
    // broadcast snippet), so even when there are no tags to push we
    // still need to round-trip through updateVideoTags whenever a
    // category override is supplied. Without the categoryId param we
    // only round-trip when tags are non-empty (existing behavior).
    if (tags.length > 0 || categoryId !== undefined) {
      await updateVideoTags(broadcastId, tags, clientId, clientSecret, snippet.title, snippet.description, categoryId)
    }
  })

  ipcMain.handle('youtube:updateBroadcastStatus', async (
    _event,
    broadcastId: string,
    privacyStatus: 'public' | 'unlisted' | 'private',
  ) => {
    const { clientId, clientSecret } = getCreds()
    try {
      await updateBroadcastStatus(broadcastId, privacyStatus, clientId, clientSecret)
    } catch (e: any) {
      console.error('[YT main] updateBroadcastStatus — error:', e.message)
      throw e
    }
  })

  ipcMain.handle('youtube:deleteVideo', async (_event, videoId: string) => {
    const { clientId, clientSecret } = getCreds()
    try {
      await deleteVideo(videoId, clientId, clientSecret)
    } catch (e: any) {
      console.error('[YT main] deleteVideo — error:', e.message)
      throw e
    }
  })
}
