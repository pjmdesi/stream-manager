import { app, ipcMain, BrowserWindow, screen } from 'electron'
import { join } from 'path'
import Store from 'electron-store'

const is = { dev: process.env['NODE_ENV'] === 'development' || !!process.env['ELECTRON_RENDERER_URL'] }
const iconPath = is.dev
  ? join(__dirname, '../../resources/icon.png')
  : join(process.resourcesPath, 'icon.png')

// ── Popup window state persistence ───────────────────────────────────────────
interface PopupState { x: number; y: number; width: number; height: number }
const popupStateStore = new Store<{ popupState: PopupState | null }>({
  name: 'popup-window-state',
  defaults: { popupState: null },
})

function loadPopupState(): PopupState | null {
  const state = popupStateStore.get('popupState')
  if (!state) return null
  // Discard saved position if the window would end up off all connected displays
  const onScreen = screen.getAllDisplays().some(d =>
    state.x < d.bounds.x + d.bounds.width  &&
    state.x + state.width  > d.bounds.x    &&
    state.y < d.bounds.y  + d.bounds.height &&
    state.y + state.height > d.bounds.y
  )
  return onScreen ? state : null
}

function savePopupState(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const [x, y]           = win.getPosition()
  const [width, height]  = win.getSize()
  popupStateStore.set('popupState', { x, y, width, height })
}

// ── The popup window is created on first use and reused — hide/show rather than
// destroy/recreate so the compositor surface stays warm between opens.
let popupWindow: BrowserWindow | null = null
let popupPageReady = false
let senderWindow: BrowserWindow | null = null
let onSenderClosed: (() => void) | null = null
let dragStart: { screenX: number; screenY: number; winX: number; winY: number } | null = null

// Allow the real close (and app exit) when the process is actually quitting.
let appIsQuitting = false
app.on('before-quit', () => { appIsQuitting = true })

function computePopupSize(
  videoWidth: number, videoHeight: number,
  cropMode: string | undefined,
): { winW: number; winH: number; aspectRatio: number } {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
  const maxW = Math.floor(screenW * 0.85)
  const maxH = Math.floor(screenH * 0.85)

  if (cropMode === '9:16') {
    const cropAspect = 9 / 16
    const scale = Math.min(1, maxH / videoHeight, maxW / (videoHeight * cropAspect))
    const winH = Math.max(180, Math.round(videoHeight * scale))
    const winW = Math.max(101, Math.round(winH * cropAspect))
    return { winW, winH, aspectRatio: cropAspect }
  }

  const scale = Math.min(1, maxW / videoWidth, maxH / videoHeight)
  const winW = Math.max(320, Math.round(videoWidth * scale))
  const winH = Math.max(180, Math.round(videoHeight * scale))
  return { winW, winH, aspectRatio: videoWidth / videoHeight }
}

// Compute the inline CSS to position the video element within the popup window
// for a given crop mode. All values are expressed as percentages / calc() so
// the layout stays correct at any window size without needing to be recomputed.
function computeCropStyle(
  _winW: number, _winH: number,
  videoWidth: number, videoHeight: number,
  cropMode: string | undefined, cropX: number | undefined,
): string | null {
  if (cropMode === '9:16') {
    const cropAspect   = 9 / 16
    const sourceAspect = videoWidth / videoHeight
    // How much wider the video is than the window (e.g. 16/9 source ≈ 3.16× a 9:16 window)
    const widthRatio = sourceAspect / cropAspect          // e.g. 3.160...
    const overhang   = widthRatio - 1                     // fraction of window width that sticks out
    const pan        = (cropX ?? 0.5) * overhang          // how far left to shift (as fraction of window width)
    const widthPct   = (widthRatio * 100).toFixed(4)      // e.g. "316.0494"
    const leftPct    = (-pan * 100).toFixed(4)            // e.g. "-108.0247"
    return `position:absolute;top:0;height:100%;width:${widthPct}%;left:${leftPct}%;object-fit:fill;`
  }
  return null
}

// Resize win to (newW × newH) keeping its visual center in place,
// clamped so the window stays within the nearest display's work area.
function resizeAroundCenter(win: BrowserWindow, newW: number, newH: number): void {
  const [curW, curH] = win.getSize()
  const [curX, curY] = win.getPosition()
  const cx = curX + Math.round(curW / 2)
  const cy = curY + Math.round(curH / 2)
  const wa = screen.getDisplayNearestPoint({ x: cx, y: cy }).workArea
  const x  = Math.max(wa.x, Math.min(wa.x + wa.width  - newW, cx - Math.round(newW / 2)))
  const y  = Math.max(wa.y, Math.min(wa.y + wa.height - newH, cy - Math.round(newH / 2)))
  win.setBounds({ x, y, width: newW, height: newH })
}

// Compute a new (w, h) that preserves the user's current height while
// matching a new aspect ratio, clamped to min/max bounds.
function sizeFromHeight(
  currentH: number, aspectRatio: number,
  minW: number, minH: number, maxW: number,
): { w: number; h: number } {
  let h = Math.max(minH, currentH)
  let w = Math.round(h * aspectRatio)
  if (w < minW) { w = minW; h = Math.round(w / aspectRatio) }
  if (w > maxW) { w = maxW; h = Math.round(w / aspectRatio) }
  return { w, h }
}

function hidePopup() {
  if (!popupWindow || popupWindow.isDestroyed() || !popupWindow.isVisible()) return

  savePopupState(popupWindow)
  popupWindow.hide()

  // Notify the main renderer that the popup is visually dismissed.
  // Intentionally keep senderWindow and onSenderClosed intact — the main window
  // may close later while the popup is hidden, and we need the listener active
  // so the popup is destroyed and window-all-closed can fire.
  if (senderWindow && !senderWindow.isDestroyed()) {
    senderWindow.webContents.send('popup:closed')
  }
}

function getOrCreatePopup(): BrowserWindow {
  if (popupWindow && !popupWindow.isDestroyed()) return popupWindow

  popupPageReady = false
  popupWindow = new BrowserWindow({
    width: 640,
    height: 360,
    minWidth: 101,
    minHeight: 90,
    frame: false,
    roundedCorners: false,
    backgroundColor: '#000000',
    title: 'Video Pop-Up',
    icon: iconPath,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/popup.js'),
      sandbox: false,
      webSecurity: false,
      backgroundThrottling: false,
    },
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    popupWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/popup.html`)
  } else {
    popupWindow.loadFile(join(__dirname, '../renderer/popup.html'))
  }

  popupWindow.webContents.once('did-finish-load', () => {
    popupPageReady = true
    if (is.dev) popupWindow?.webContents.openDevTools({ mode: 'detach' })
  })

  // Debounced position/size save on every move or resize
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const debouncedSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (popupWindow && !popupWindow.isDestroyed()) savePopupState(popupWindow)
    }, 500)
  }
  popupWindow.on('move',   debouncedSave)
  popupWindow.on('resize', debouncedSave)

  // Hide instead of close when the user dismisses the popup — BUT allow the real
  // close when the app is actually quitting so window-all-closed can fire.
  popupWindow.on('close', e => {
    if (!appIsQuitting) {
      e.preventDefault()
      hidePopup()
    }
  })

  popupWindow.on('closed', () => {
    popupWindow = null
    popupPageReady = false
    senderWindow = null
    onSenderClosed = null
  })

  return popupWindow
}

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
  if (!moved) hidePopup()
}

export function registerVideoPopupIPC(): void {
  ipcMain.on('popup:mousedown', onMouseDown)
  ipcMain.on('popup:mousedrag', onMouseDrag)
  ipcMain.on('popup:mouseup',   onMouseUp)

  // ── WebRTC signaling relay ────────────────────────────────────────────────
  // Popup → main renderer: answer SDP (vanilla ICE — all candidates in SDP)
  ipcMain.on('popup:rtc-p2m', (_event, data) => {
    senderWindow?.webContents.send('popup:rtc-p2m', data)
  })

  // popup:open now takes (offerSdp, videoWidth, videoHeight, cropMode?, cropX?)
  // The offer SDP is forwarded to the popup as a 'webrtc-offer' command.
  ipcMain.handle('popup:open', async (event, offerSdp: string, videoWidth: number, videoHeight: number, cropMode?: string, cropX?: number) => {
    const popup = getOrCreatePopup()

    if (popup.isVisible()) {
      popup.focus()
      return
    }

    // Track which main window opened the popup so we can relay events back,
    // and destroy the popup (not just hide) when the main window closes so
    // window-all-closed fires and the app can exit.
    if (onSenderClosed && senderWindow && !senderWindow.isDestroyed()) {
      senderWindow.removeListener('closed', onSenderClosed)
    }
    senderWindow = BrowserWindow.fromWebContents(event.sender)
    onSenderClosed = () => {
      const pw = popupWindow
      senderWindow = null
      onSenderClosed = null
      dragStart = null
      if (pw && !pw.isDestroyed()) pw.destroy()
    }
    senderWindow?.once('closed', onSenderClosed)

    const { winW, winH, aspectRatio } = computePopupSize(videoWidth, videoHeight, cropMode)
    popup.setAspectRatio(aspectRatio)

    const savedState = loadPopupState()
    let actualW: number, actualH: number
    if (savedState) {
      // Restore from saved height; derive width from current aspect ratio so the
      // window is always the right shape regardless of crop mode at time of save.
      const { width: screenW } = screen.getPrimaryDisplay().workAreaSize
      const [minW, minH] = popup.getMinimumSize()
      actualH = Math.max(minH, savedState.height)
      actualW = Math.round(actualH * aspectRatio)
      if (actualW < minW) { actualW = minW; actualH = Math.round(actualW / aspectRatio) }
      if (actualW > Math.floor(screenW * 0.95)) { actualW = Math.floor(screenW * 0.95); actualH = Math.round(actualW / aspectRatio) }
      popup.setSize(actualW, actualH)
      popup.setPosition(savedState.x, savedState.y)
    } else {
      actualW = winW
      actualH = winH
      popup.setSize(winW, winH)
    }

    const sendOffer = () => {
      const cropStyle = computeCropStyle(actualW, actualH, videoWidth, videoHeight, cropMode, cropX)
      popup.webContents.send('popup:command', 'crop', cropStyle ?? null)
      popup.webContents.send('popup:command', 'webrtc-offer', offerSdp)
    }

    if (popupPageReady) {
      sendOffer()
    } else {
      popup.webContents.once('did-finish-load', () => {
        popupPageReady = true
        sendOffer()
      })
    }

    popup.show()
    popup.focus()
  })

  ipcMain.handle('popup:setcrop', async (_event, videoWidth: number, videoHeight: number, cropMode: string, cropX: number) => {
    if (!popupWindow || popupWindow.isDestroyed() || !popupWindow.isVisible()) return
    const { aspectRatio } = computePopupSize(videoWidth, videoHeight, cropMode)
    const [minW, minH] = popupWindow.getMinimumSize()
    const { width: screenW } = screen.getPrimaryDisplay().workAreaSize
    const [, curH] = popupWindow.getSize()
    const { w, h } = sizeFromHeight(curH, aspectRatio, minW, minH, Math.floor(screenW * 0.95))
    resizeAroundCenter(popupWindow, w, h)
    popupWindow.setAspectRatio(aspectRatio)
    const cropStyle = computeCropStyle(w, h, videoWidth, videoHeight, cropMode, cropX)
    popupWindow.webContents.send('popup:command', 'crop', cropStyle ?? null)
  })

  ipcMain.handle('popup:close', async () => hidePopup())
  ipcMain.on('popup:close', () => hidePopup())
}
