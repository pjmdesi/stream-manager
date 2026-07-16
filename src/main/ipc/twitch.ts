import { ipcMain, BrowserWindow } from 'electron'
import { startOAuthFlow, exchangeCode, clearTokens, isConnected } from '../services/twitchAuth'
import { getChannelInfo, updateChannelInfo } from '../services/twitchApi'
import { getStore } from './store'

function getCreds() {
  const config = getStore().get('config') as any
  return {
    clientId: (config.twitchClientId ?? '') as string,
    clientSecret: (config.twitchClientSecret ?? '') as string,
  }
}

export function registerTwitchIPC(): void {
  ipcMain.handle('twitch:getStatus', () => {
    return { connected: isConnected() }
  })

  ipcMain.handle('twitch:connect', async () => {
    const { clientId, clientSecret } = getCreds()
    if (!clientId || !clientSecret) throw new Error('Twitch Client ID and Secret must be saved in settings first.')
    const code = await startOAuthFlow(clientId)
    await exchangeCode(code, clientId, clientSecret)
    // Tell every window the connection is live — mirrors youtube:connected.
    // Persistent pages (StreamsPage) fetch Twitch status on mount only, so
    // without this a reconnect left "Push to Twitch" disabled until restart.
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('twitch:connected')
    }
  })

  ipcMain.handle('twitch:disconnect', () => {
    clearTokens()
    // Mirror of twitch:connected — mounted pages disable their push
    // controls immediately instead of failing on the next push attempt.
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('twitch:disconnected')
    }
  })

  ipcMain.handle('twitch:updateChannel', async (
    _event,
    title: string,
    gameName?: string,
    tags?: string[]
  ) => {
    const { clientId, clientSecret } = getCreds()
    return updateChannelInfo(title, gameName, tags, clientId, clientSecret)
  })

  ipcMain.handle('twitch:getChannel', async () => {
    const { clientId, clientSecret } = getCreds()
    return getChannelInfo(clientId, clientSecret)
  })
}
