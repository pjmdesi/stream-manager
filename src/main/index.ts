import { app, BrowserWindow, shell, ipcMain, globalShortcut, screen } from 'electron'
import { join } from 'path'
import Store from 'electron-store'
const is = { dev: process.env['NODE_ENV'] === 'development' || !!process.env['ELECTRON_RENDERER_URL'] }

interface WindowState { x: number; y: number; width: number; height: number; maximized: boolean }
const windowStateStore = new Store<{ windowState: WindowState }>({
  name: 'window-state',
  defaults: { windowState: { x: 0, y: 0, width: 1400, height: 900, maximized: false } }
})

function loadWindowState(): WindowState {
  const state = windowStateStore.get('windowState')
  // Validate that the saved position is still on a connected display
  const displays = screen.getAllDisplays()
  const onScreen = displays.some(d =>
    state.x < d.bounds.x + d.bounds.width &&
    state.x + state.width > d.bounds.x &&
    state.y < d.bounds.y + d.bounds.height &&
    state.y + state.height > d.bounds.y
  )
  return onScreen ? state : { ...state, x: 0, y: 0 }
}

function saveWindowState(win: BrowserWindow): void {
  if (win.isMaximized()) {
    windowStateStore.set('windowState', { ...windowStateStore.get('windowState'), maximized: true })
    return
  }
  const { x, y, width, height } = win.getBounds()
  windowStateStore.set('windowState', { x, y, width, height, maximized: false })
}

// Resolve the app icon — dev: project root resources/, prod: electron resourcesPath
const iconPath = is.dev
  ? join(__dirname, '../../resources/icon.png')
  : join(process.resourcesPath, 'icon.png')
const electronApp = { setAppUserModelId: (id: string) => app.setAppUserModelId(id) }
const optimizer = { watchWindowShortcuts: (_win: BrowserWindow) => {} }
import { registerVideoIPC } from './ipc/video'
import { registerFilesIPC } from './ipc/files'
import { registerTemplatesIPC } from './ipc/templates'
import { registerConverterIPC } from './ipc/converter'
import { registerStoreIPC } from './ipc/store'
import { registerStreamsIPC } from './ipc/streams'
import { registerCombineIPC } from './ipc/combine'
import { registerYouTubeIPC } from './ipc/youtube'
import { registerTwitchIPC } from './ipc/twitch'
import { registerVideoPopupIPC } from './ipc/videoPopup'
import { tempManager } from './services/tempManager'
import { fileWatcher } from './services/fileWatcher'

function createWindow(): BrowserWindow {
  const savedState = loadWindowState()

  const mainWindow = new BrowserWindow({
    x: savedState.x || undefined,
    y: savedState.y || undefined,
    width: savedState.width,
    height: savedState.height,
    minWidth: 1000,
    minHeight: 700,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    frame: false,
    backgroundColor: '#1a1a2e',
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false, // Required for local file:// audio/video
      allowRunningInsecureContent: false
    }
  })

  if (savedState.maximized) mainWindow.maximize()

  // Debounced save on move/resize
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const debouncedSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveWindowState(mainWindow), 500)
  }
  mainWindow.on('move', debouncedSave)
  mainWindow.on('resize', debouncedSave)
  mainWindow.on('close', () => saveWindowState(mainWindow))

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Ctrl+` opens DevTools in any build
  globalShortcut.register('CommandOrControl+`', () => {
    mainWindow.webContents.toggleDevTools()
  })

  // Window control IPC
  ipcMain.on('window:minimize', () => mainWindow.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.restore()
    } else {
      mainWindow.maximize()
    }
  })
  ipcMain.on('window:close', () => mainWindow.close())

  return mainWindow
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.streammanager')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Register handlers needed immediately on startup
  registerStoreIPC()    // useStore calls getConfig on mount
  registerStreamsIPC()  // default page — calls listStreams + watchStreamsDir on first render
  registerFilesIPC()   // WatcherContext may autostart the watcher on mount

  createWindow()

  // Defer page-specific handlers — only called when the user navigates there
  setImmediate(() => {
    registerVideoIPC()
    registerTemplatesIPC()
    registerConverterIPC()
    registerCombineIPC()
    registerYouTubeIPC()
    registerTwitchIPC()
    registerVideoPopupIPC()
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  fileWatcher.stop()
  tempManager.cleanupAll()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
