import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import Store from 'electron-store'
import { startOAuthFlow, exchangeCode, clearTokens, isConnected, getValidToken, REDIRECT_URI } from '../services/youtubeAuth'
import { getLiveBroadcasts, getCompletedBroadcasts, updateBroadcastSnippet, updateBroadcastStatus, updateVideoStatus, deleteVideo, updateVideoTags, categorizeYouTubeThumbnails, uploadThumbnail, getVideoById, getVideosByIds, getBroadcastById, checkBroadcastsAreLive, fetchVideoStatuses, createBroadcast, getMyChannelId, clearChannelIdCache, getDefaultStreamKey, getVideoCategories, getChannelVideos } from '../services/youtubeApi'
import * as ytQuotaState from '../services/ytQuotaState'
import { getStore } from './store'

function getCreds() {
  const config = getStore().get('config') as any
  return {
    clientId: (config.youtubeClientId ?? '') as string,
    clientSecret: (config.youtubeClientSecret ?? '') as string,
  }
}

// Last-known per-video status (privacy / kind / processing), persisted so
// the streams list can render badges instantly on launch, even with no
// network. Disposable UI cache — deliberately NOT in _meta.json (that
// file is synced, backed up user data). `missing` is never cached so a
// stale "video deleted" warning can't resurrect from disk; a genuinely
// missing id is also evicted, for the same reason.
const ytStatusCache = new Store<{ statuses: Record<string, { privacyStatus: string; isLivestream: boolean; uploadStatus: string }> }>({
  name: 'yt-status-cache',
  defaults: { statuses: {} },
})

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

  // Lists every video on the connected channel for the "Import from YouTube"
  // picker. Read-only; a few quota units even for large channels.
  ipcMain.handle('youtube:listChannelVideos', async () => {
    const { clientId, clientSecret } = getCreds()
    if (!clientId || !clientSecret) throw new Error('YouTube credentials not configured.')
    return await getChannelVideos(clientId, clientSecret)
  })

  // Download a video's YouTube thumbnail into a stream folder (importer). Returns
  // the saved filename within targetDir, or null on failure. Non-throwing so a
  // bad thumbnail doesn't fail the whole import of an item.
  ipcMain.handle('youtube:downloadThumbnail', async (_e, targetDir: string, url: string): Promise<{ filename: string; hash: string } | null> => {
    try {
      if (!targetDir || !url) return null
      const { net } = await import('electron')
      const res = await net.fetch(url)
      if (!res.ok) return null
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length === 0) return null
      const filename = 'youtube-thumbnail.jpg'
      fs.writeFileSync(path.join(targetDir, filename), buf)
      // sha1 of the bytes — the same hash thumbnail:hashFile computes — so the
      // out-of-sync thumbnail check reads this imported thumbnail as in-sync.
      const hash = crypto.createHash('sha1').update(buf).digest('hex')
      return { filename, hash }
    } catch {
      return null
    }
  })

  ipcMain.handle('youtube:validateToken', async () => {
    if (!isConnected()) return { valid: false, error: 'Not connected' }
    const { clientId, clientSecret } = getCreds()
    try {
      await getValidToken(clientId, clientSecret)
      return { valid: true }
    } catch (e: any) {
      const msg = (e?.message ?? String(e)) as string
      // Only a definitive auth response from Google means the token is
      // actually bad. Anything else (offline, DNS, timeout, 5xx) is a
      // connectivity problem — reporting those as "expired" sent users
      // into reconnect flows that couldn't possibly help.
      const authProblem = /invalid_grant|invalid_client|unauthorized|expired|revoked/i.test(msg)
      return { valid: false, error: msg, reason: authProblem ? 'auth' as const : 'network' as const }
    }
  })

  ipcMain.handle('youtube:getVideoStatuses', async (_event, videoIds: string[]) => {
    const { clientId, clientSecret } = getCreds()
    try {
      const map = await fetchVideoStatuses(videoIds, clientId, clientSecret)
      const obj = Object.fromEntries(map)
      // Persist last-known statuses for instant badges on next launch.
      try {
        const prev = ytStatusCache.get('statuses', {})
        const merged: typeof prev = { ...prev }
        for (const [id, st] of Object.entries(obj)) {
          if (st.missing) { delete merged[id]; continue }
          merged[id] = { privacyStatus: st.privacyStatus, isLivestream: st.isLivestream, uploadStatus: st.uploadStatus ?? 'processed' }
        }
        // Soft cap — once unlinked videos have accumulated past this,
        // keep only the ids from the current fetch.
        const keys = Object.keys(merged)
        if (keys.length > 2000) for (const k of keys) { if (!(k in obj)) delete merged[k] }
        ytStatusCache.set('statuses', merged)
      } catch { /* cache write is best-effort */ }
      return obj
    } catch {
      // null, NOT {} — the renderer must be able to tell "the fetch
      // failed, keep what you have and retry" from "none of these ids
      // exist anymore". An empty object here blanked every status badge
      // for the whole session on one transient network/API error.
      return null
    }
  })

  ipcMain.handle('youtube:getVideoStatusCache', () => {
    try { return ytStatusCache.get('statuses', {}) } catch { return {} }
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

  ipcMain.handle('youtube:getVideosByIds', async (_event, ids: string[]) => {
    const { clientId, clientSecret } = getCreds()
    try {
      return await getVideosByIds(ids, clientId, clientSecret)
    } catch (e: any) {
      console.error('[YT main] getVideosByIds — error:', e.message)
      throw e
    }
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

  ipcMain.handle('youtube:updateVideoStatus', async (
    _event,
    videoId: string,
    privacyStatus: 'public' | 'unlisted' | 'private',
  ) => {
    const { clientId, clientSecret } = getCreds()
    try {
      await updateVideoStatus(videoId, privacyStatus, clientId, clientSecret)
    } catch (e: any) {
      console.error('[YT main] updateVideoStatus — error:', e.message)
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
