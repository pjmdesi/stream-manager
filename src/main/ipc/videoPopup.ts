import { ipcMain, BrowserWindow, screen } from 'electron'
import { join } from 'path'

const is = { dev: process.env['NODE_ENV'] === 'development' || !!process.env['ELECTRON_RENDERER_URL'] }
const iconPath = is.dev
  ? join(__dirname, '../../resources/icon.png')
  : join(process.resourcesPath, 'icon.png')

let popupWindow: BrowserWindow | null = null

export function registerVideoPopupIPC(): void {
  ipcMain.handle('popup:open', async (event, filePath: string, currentTime: number, videoWidth: number, videoHeight: number) => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.focus()
      return
    }

    // Scale down to fit screen if the video is larger
    const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
    const maxW = Math.floor(screenW * 0.85)
    const maxH = Math.floor(screenH * 0.85)
    const scale = Math.min(1, maxW / videoWidth, maxH / videoHeight)
    const winW = Math.max(320, Math.round(videoWidth * scale))
    const winH = Math.max(180, Math.round(videoHeight * scale))

    popupWindow = new BrowserWindow({
      width: winW,
      height: winH,
      minWidth: 160,
      minHeight: 90,
      frame: false,
      roundedCorners: false,
      backgroundColor: '#000000',
      title: 'Video Pop-Up',
      icon: iconPath,
      webPreferences: {
        preload: join(__dirname, '../preload/popup.js'),
        sandbox: false,
        webSecurity: false,
      },
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      await popupWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/popup.html`)
    } else {
      await popupWindow.loadFile(join(__dirname, '../renderer/popup.html'))
    }

    // Lock the window to the video's aspect ratio
    popupWindow.setAspectRatio(videoWidth / videoHeight)

    // Custom drag: renderer sends screen coordinates; main moves the window.
    // On mouseup, if the cursor barely moved it's a click → close.
    let dragStart: { screenX: number; screenY: number; winX: number; winY: number } | null = null

    const onMouseDown = (_: Electron.IpcMainEvent, sx: number, sy: number) => {
      if (!popupWindow || popupWindow.isDestroyed()) return
      const [winX, winY] = popupWindow.getPosition()
      dragStart = { screenX: sx, screenY: sy, winX, winY }
    }
    const onMouseDrag = (_: Electron.IpcMainEvent, sx: number, sy: number) => {
      if (!dragStart || !popupWindow || popupWindow.isDestroyed()) return
      popupWindow.setPosition(
        dragStart.winX + (sx - dragStart.screenX),
        dragStart.winY + (sy - dragStart.screenY),
      )
    }
    const onMouseUp = (_: Electron.IpcMainEvent, sx: number, sy: number) => {
      if (!dragStart || !popupWindow || popupWindow.isDestroyed()) return
      const moved = Math.abs(sx - dragStart.screenX) >= 4 || Math.abs(sy - dragStart.screenY) >= 4
      dragStart = null
      if (!moved) popupWindow.close()
    }

    const onTimeUpdate = (_: Electron.IpcMainEvent, time: number) => {
      if (senderWindow && !senderWindow.isDestroyed()) {
        senderWindow.webContents.send('popup:timeupdate', time)
      }
    }

    ipcMain.on('popup:mousedown',  onMouseDown)
    ipcMain.on('popup:mousedrag',  onMouseDrag)
    ipcMain.on('popup:mouseup',    onMouseUp)
    ipcMain.on('popup:timeupdate', onTimeUpdate)

    // Send initial load command once the page is ready
    popupWindow.webContents.send('popup:command', 'load', filePath, currentTime)

    // Close popup if the main window closes (covers app quit too)
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    const onSenderClosed = () => {
      if (popupWindow && !popupWindow.isDestroyed()) popupWindow.close()
    }
    senderWindow?.once('closed', onSenderClosed)

    // Notify the main window when the popup closes and clean up all listeners
    popupWindow.on('closed', () => {
      ipcMain.removeListener('popup:mousedown',  onMouseDown)
      ipcMain.removeListener('popup:mousedrag',  onMouseDrag)
      ipcMain.removeListener('popup:mouseup',    onMouseUp)
      ipcMain.removeListener('popup:timeupdate', onTimeUpdate)
      senderWindow?.removeListener('closed', onSenderClosed)
      popupWindow = null
      if (senderWindow && !senderWindow.isDestroyed()) {
        senderWindow.webContents.send('popup:closed')
      }
    })
  })

  // Relay play/pause/seek/load commands from the main renderer to the popup
  ipcMain.handle('popup:control', async (_event, cmd: string, ...args: any[]) => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.webContents.send('popup:command', cmd, ...args)
    }
  })

  ipcMain.handle('popup:close', async () => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.close()
    }
  })

  // Also handle the renderer-side close button (sent via ipcRenderer.send, not invoke)
  ipcMain.on('popup:close', () => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.close()
    }
  })
}
