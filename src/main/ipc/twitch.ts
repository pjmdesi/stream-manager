import { ipcMain } from 'electron'
import { startOAuthFlow, exchangeCode, clearTokens, isConnected } from '../services/twitchAuth'
import { updateChannelInfo } from '../services/twitchApi'
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
  })

  ipcMain.handle('twitch:disconnect', () => {
    clearTokens()
  })

  ipcMain.handle('twitch:updateChannel', async (
    _event,
    title: string,
    gameName?: string
  ) => {
    const { clientId, clientSecret } = getCreds()
    await updateChannelInfo(title, gameName, clientId, clientSecret)
  })
}
