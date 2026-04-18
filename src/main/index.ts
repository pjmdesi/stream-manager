import { app, BrowserWindow, shell, ipcMain, globalShortcut, screen, Tray, Menu, MenuItem, nativeImage } from 'electron'
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
import { registerConverterIPC, getConverterStatus } from './ipc/converter'
import { registerStoreIPC, getStore } from './ipc/store'
import { registerStreamsIPC } from './ipc/streams'
import { registerCombineIPC } from './ipc/combine'
import { registerYouTubeIPC } from './ipc/youtube'
import { registerTwitchIPC } from './ipc/twitch'
import { registerVideoPopupIPC } from './ipc/videoPopup'
import { registerLauncherIPC } from './ipc/launcher'
import { registerClaudeIPC } from './ipc/claude'
import { registerThumbnailIPC } from './ipc/thumbnail'
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

  mainWindow.webContents.on('context-menu', (_event, params) => {
    const { isEditable, selectionText, editFlags } = params
    const hasSelection = selectionText.trim().length > 0
    if (!isEditable && !hasSelection) return

    const menu = new Menu()
    if (isEditable) {
      menu.append(new MenuItem({ role: 'undo', enabled: editFlags.canUndo }))
      menu.append(new MenuItem({ role: 'redo', enabled: editFlags.canRedo }))
      menu.append(new MenuItem({ type: 'separator' }))
      menu.append(new MenuItem({ role: 'cut', enabled: editFlags.canCut }))
    }
    if (isEditable || hasSelection) {
      menu.append(new MenuItem({ role: 'copy', enabled: editFlags.canCopy || hasSelection }))
    }
    if (isEditable) {
      menu.append(new MenuItem({ role: 'paste', enabled: editFlags.canPaste }))
      menu.append(new MenuItem({ role: 'selectAll', enabled: editFlags.canSelectAll }))
    }
    menu.popup({ window: mainWindow })
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

function buildTrayMenu(mainWindow: BrowserWindow): Electron.Menu {
  const watcherStatus = fileWatcher.getStatus()
  const converterStatus = getConverterStatus()
  const config = getStore().get('config') as any

  const watcherLabel = watcherStatus.active
    ? `Watcher: Active · ${watcherStatus.ruleCount} rule${watcherStatus.ruleCount !== 1 ? 's' : ''}`
    : 'Watcher: Off'
  const converterLabel = converterStatus.active
    ? `Converter: ${converterStatus.label}`
    : 'Converter: Idle'

  return Menu.buildFromTemplate([
    { label: 'Stream Manager', enabled: false },
    { type: 'separator' },
    { label: watcherLabel, enabled: false },
    { label: converterLabel, enabled: false },
    { type: 'separator' },
    {
      label: 'Open', click: () => {
        mainWindow.show()
        mainWindow.focus()
      }
    },
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: !!config?.startWithWindows,
      enabled: app.isPackaged,
      click: (item) => {
        const startMinimized = !!config?.startMinimized
        ipcMain.emit('_setStartup', item.checked, startMinimized)
        const exePath = process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath
        app.setLoginItemSettings({ openAtLogin: item.checked, path: exePath })
        const s = getStore()
        const cur = s.get('config') as any
        s.set('config', { ...cur, startWithWindows: item.checked })
      }
    },
    {
      label: 'Start Minimized',
      type: 'checkbox',
      checked: !!config?.startMinimized,
      enabled: app.isPackaged && !!config?.startWithWindows,
      click: (item) => {
        const s = getStore()
        const cur = s.get('config') as any
        s.set('config', { ...cur, startMinimized: item.checked })
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.streammanager')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Register handlers needed immediately on startup
  registerStoreIPC()    // useStore calls getConfig on mount
  registerStreamsIPC()  // default page — calls listStreams + watchStreamsDir on first render
  registerFilesIPC()   // WatcherContext may autostart the watcher on mount

  // Re-register startup entry on each launch (packaged only) to self-heal if app has been moved.
  // For portable builds, PORTABLE_EXECUTABLE_FILE is the actual .exe on disk (not the temp-extracted copy).
  if (app.isPackaged) {
    const config = getStore().get('config') as any
    const exePath = process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath
    if (config?.startWithWindows) {
      app.setLoginItemSettings({ openAtLogin: true, path: exePath })
    }
  }

  const mainWindow = createWindow()

  // Create system tray — always visible while app is running
  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  const tray = new Tray(trayIcon)
  tray.setToolTip('Stream Manager')

  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.focus()
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  tray.on('right-click', () => {
    // Build a fresh menu on every right-click and pass it directly to popUpContextMenu.
    // Passing via setContextMenu() causes Windows to cache and show the old menu before
    // the right-click event fires, resulting in stale status lines.
    tray.popUpContextMenu(buildTrayMenu(mainWindow))
  })

  // Minimize-to-tray IPC — called by the title bar button
  ipcMain.on('window:minimizeToTray', () => {
    mainWindow.hide()
  })

  // Start minimized: hide the window before it's shown if both flags are set
  if (app.isPackaged) {
    const config = getStore().get('config') as any
    if (config?.startWithWindows && config?.startMinimized) {
      mainWindow.once('ready-to-show', () => mainWindow.hide())
    }
  }

  // Defer page-specific handlers — only called when the user navigates there
  setImmediate(() => {
    registerVideoIPC()
    registerTemplatesIPC()
    registerConverterIPC()
    registerCombineIPC()
    registerYouTubeIPC()
    registerTwitchIPC()
    registerVideoPopupIPC()
    registerLauncherIPC()
    registerClaudeIPC()
    registerThumbnailIPC()
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
