import { app, BrowserWindow, shell, ipcMain, screen, Tray, Menu, MenuItem, nativeImage } from 'electron'
import { join } from 'path'
import fs from 'fs'
import Store from 'electron-store'

// ── Diagnostic: trace every mkdir of a date-pattern folder ───────────────
// A phantom "2024-06-18" stream folder keeps reappearing without explicit
// user action. Monkey-patches fs.mkdir{Sync} so any call whose target
// path contains a YYYY-MM-DD segment logs to console with a stack trace,
// pinpointing the call site. Catches both the explicit date folder and
// any path nested under it. Remove once the source is identified.
const __DATE_PATH_RE = /[\\/](\d{4}-\d{2}-\d{2})(-\d+)?([\\/]|$)/
const __origMkdirSync = fs.mkdirSync.bind(fs)
const __origMkdirP = fs.promises.mkdir.bind(fs.promises)
;(fs as unknown as { mkdirSync: typeof fs.mkdirSync }).mkdirSync = ((p: fs.PathLike, opts?: fs.MakeDirectoryOptions | number | string) => {
  if (typeof p === 'string' && __DATE_PATH_RE.test(p)) {
    console.warn('[date-folder mkdirSync]', p)
    console.warn(new Error('mkdir call site').stack)
  }
  return __origMkdirSync(p, opts as fs.MakeDirectoryOptions)
}) as typeof fs.mkdirSync
;(fs.promises as unknown as { mkdir: typeof fs.promises.mkdir }).mkdir = ((p: fs.PathLike, opts?: fs.MakeDirectoryOptions | fs.Mode) => {
  if (typeof p === 'string' && __DATE_PATH_RE.test(p)) {
    console.warn('[date-folder mkdir async]', p)
    console.warn(new Error('mkdir call site').stack)
  }
  return __origMkdirP(p, opts as fs.MakeDirectoryOptions)
}) as typeof fs.promises.mkdir

const is = { dev: process.env['NODE_ENV'] === 'development' || !!process.env['ELECTRON_RENDERER_URL'] }

// x/y are optional: absent means "no saved position" (first run) and lets
// Electron center the window. They must NOT default to 0,0 — a genuine save
// at 0,0 (window snapped to the top-left) is a real position, and the old
// `|| undefined` falsy check treated it as unsaved and re-centered on every
// restart.
interface WindowState { x?: number; y?: number; width: number; height: number; maximized: boolean }
const windowStateStore = new Store<{ windowState: WindowState }>({
  name: 'window-state',
  defaults: { windowState: { width: 1400, height: 900, maximized: false } }
})

function loadWindowState(): WindowState {
  const state = windowStateStore.get('windowState')
  // First run (or legacy 0,0 default that was never a real save): no
  // position — leave x/y undefined so Electron centers the window.
  if (typeof state.x !== 'number' || typeof state.y !== 'number') {
    return { ...state, x: undefined, y: undefined }
  }
  // Validate that the saved position is still on a connected display.
  const displays = screen.getAllDisplays()
  const onScreen = displays.some(d =>
    state.x! < d.bounds.x + d.bounds.width &&
    state.x! + state.width > d.bounds.x &&
    state.y! < d.bounds.y + d.bounds.height &&
    state.y! + state.height > d.bounds.y
  )
  // Off-screen (display disconnected): drop the position and re-center
  // rather than pinning to 0,0.
  return onScreen ? state : { ...state, x: undefined, y: undefined }
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

if (process.platform === 'win32') {
  app.setAppUserModelId('com.streammanager')
}
import { registerVideoIPC } from './ipc/video'
import { registerFilesIPC } from './ipc/files'
import { registerTemplatesIPC } from './ipc/templates'
import { registerConverterIPC, getConverterStatus, getActiveConversionCounts } from './ipc/converter'
import { registerStoreIPC, getStore, setConfigPartial } from './ipc/store'
import { registerStreamsIPC, backupMetaOnQuit } from './ipc/streams'
import { registerCombineIPC } from './ipc/combine'
import { registerYouTubeIPC } from './ipc/youtube'
import { registerTwitchIPC } from './ipc/twitch'
import { registerVideoPopupIPC } from './ipc/videoPopup'
import { registerLauncherIPC } from './ipc/launcher'
import { registerClaudeIPC } from './ipc/claude'
import { registerNetIPC } from './ipc/net'
import { registerThumbnailIPC } from './ipc/thumbnail'
import { registerCloudSyncIPC } from './ipc/cloudSync'
import { registerStreamRelayIPC } from './ipc/streamRelay'
import { registerUpdateCheckIPC } from './services/updateCheck'
import { tempManager } from './services/tempManager'
import { fileWatcher } from './services/fileWatcher'

function createWindow(): BrowserWindow {
  const savedState = loadWindowState()

  const mainWindow = new BrowserWindow({
    x: savedState.x,
    y: savedState.y,
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
      allowRunningInsecureContent: false,
      // Electron's built-in spell checker is on by default, but set
      // explicitly so the context-menu handler below can rely on
      // params.misspelledWord / params.dictionarySuggestions being
      // populated for editable fields.
      spellcheck: true
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
    const { isEditable, selectionText, editFlags, misspelledWord, dictionarySuggestions } = params
    const hasSelection = selectionText.trim().length > 0
    if (!isEditable && !hasSelection) return

    const menu = new Menu()

    // Spell-check section: appears at the top when the cursor is on a
    // misspelled word inside an editable field. Chromium populates
    // dictionarySuggestions automatically when spellcheck is enabled in
    // webPreferences. Up to 5 suggestions are returned; clicking one
    // replaces the misspelled word in place.
    if (isEditable && misspelledWord) {
      if (dictionarySuggestions.length > 0) {
        for (const suggestion of dictionarySuggestions) {
          menu.append(new MenuItem({
            label: suggestion,
            click: () => mainWindow.webContents.replaceMisspelling(suggestion),
          }))
        }
      } else {
        menu.append(new MenuItem({ label: 'No suggestions', enabled: false }))
      }
      menu.append(new MenuItem({ type: 'separator' }))
      menu.append(new MenuItem({
        label: 'Add to dictionary',
        click: () => mainWindow.webContents.session.addWordToSpellCheckerDictionary(misspelledWord),
      }))
      menu.append(new MenuItem({ type: 'separator' }))
    }

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

  // Ctrl+` opens DevTools in any build — scoped to the app window via
  // before-input-event. The old globalShortcut.register was OS-GLOBAL: it
  // stole the key from every other app (VS Code's terminal toggle) the
  // whole time SM ran, even hidden in the tray.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // NOTE: Electron's Input.type is camelCase ('keyDown'), not the DOM's
    // lowercase 'keydown' — matching the wrong casing silently never fires.
    if (
      input.type === 'keyDown' && input.code === 'Backquote' &&
      (input.control || input.meta) && !input.alt && !input.shift
    ) {
      event.preventDefault()
      mainWindow.webContents.toggleDevTools()
    }
  })

  // Window control IPC
  ipcMain.on('window:minimize', () => mainWindow.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.restore()
    else mainWindow.maximize()
  })
  ipcMain.handle('window:isMaximized', () => mainWindow.isMaximized())
  mainWindow.on('maximize',   () => mainWindow.webContents.send('window:maximizeChange', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximizeChange', false))
  ipcMain.on('window:close', () => mainWindow.close())

  // Native redo for the focused editable field. Chromium maps redo to Ctrl+Y
  // on Windows but not Ctrl+Shift+Z; the renderer detects the editable +
  // Ctrl/Cmd+Shift+Z and routes here so text inputs match the app's
  // Ctrl+Shift+Z redo convention. `sender.redo()` is the same native command
  // the right-click "Redo" menu item fires.
  ipcMain.on('edit:redo', (e) => e.sender.redo())

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
    if (!win.isVisible()) win.show()
    win.focus()
    // Flash the taskbar icon so the user gets a visual cue that their second
    // launch attempt was redirected to the existing instance. Windows stops
    // the flash automatically when the user interacts with the window.
    win.flashFrame(true)
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

  // Layout: app brand at top, then rarely-touched startup toggles, then the
  // live watcher/converter status (sits right above the actions so the user
  // can glance at it before clicking), then Open + Quit at the very bottom
  // where the cursor lands when the menu pops up from the tray.
  return Menu.buildFromTemplate([
    { label: 'Stream Manager', enabled: false },
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: !!config?.startWithWindows,
      // Dev builds would register the dev-electron exe path with Windows
      // login, which is never what we want. Only allow toggling in packaged
      // builds.
      enabled: app.isPackaged,
      click: (item) => {
        const exePath = process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath
        app.setLoginItemSettings({ openAtLogin: item.checked, path: exePath })
        // Through the broadcasting helper so an open Settings page (and any
        // other consumer of the shared config state) sees the change live.
        setConfigPartial({ startWithWindows: item.checked })
      }
    },
    {
      label: 'Start Minimized',
      type: 'checkbox',
      checked: !!config?.startMinimized,
      enabled: app.isPackaged && !!config?.startWithWindows,
      click: (item) => {
        setConfigPartial({ startMinimized: item.checked })
      }
    },
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
    { label: 'Quit', click: () => app.quit() }
  ])
}

// Last-resort error traps. Without these, ANY uncaught exception or
// unhandled rejection in main (observed: a transient EPERM stat from a
// watcher's write-stability polling racing a killed ffmpeg's file-handle
// release) pops Electron's modal "JavaScript error in the main process"
// dialog — scary, stackless, and for transient fs races entirely
// pointless. Log the FULL stack instead so the next occurrence is
// actually diagnosable, and keep the app running.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaught exception:', err?.stack ?? err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandled rejection:', (reason as Error)?.stack ?? reason)
})

app.whenReady().then(() => {

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Register handlers needed immediately on startup
  registerStoreIPC()    // useStore calls getConfig on mount
  registerStreamsIPC()  // default page — calls listStreams + watchStreamsDir on first render
  registerFilesIPC()   // WatcherContext may autostart the watcher on mount
  registerCloudSyncIPC()  // streams page probes cloud-sync:is-active on mount
  registerUpdateCheckIPC()

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

  // Dev-only: load the React DevTools browser extension so the Components +
  // Profiler tabs appear in the detached DevTools. (Verified: the extension's
  // hook has no perceptible effect on animation smoothness — the dev-build
  // sidebar-slide hitch is identical with and without it, so this stays
  // unconditional rather than behind an opt-in flag.) The dynamic import +
  // is.dev guard keep this devDependency out of packaged builds (it's never
  // required in prod). Electron registers extension content scripts
  // asynchronously, so the first page load always races the install and misses
  // the DevTools hook (the tabs only worked after a manual Ctrl+R) — installing
  // before createWindow doesn't help and broke the DevTools auto-open. Instead,
  // once the install resolves, reload the page one time to automate that Ctrl+R.
  if (is.dev) {
    void import('electron-devtools-installer')
      .then((mod) => {
        // CJS interop varies by how electron-vite emits the externalized import
        // (require → module.exports; dynamic import → namespace), so resolve the
        // installer fn + React id defensively from both the module.exports
        // object and any lexer-detected named export.
        const m = mod as any
        const exp = m.default ?? m
        const installExtension = typeof exp === 'function' ? exp : (exp.default ?? exp)
        const reactTools = exp.REACT_DEVELOPER_TOOLS ?? m.REACT_DEVELOPER_TOOLS
        return installExtension(reactTools, { loadExtensionOptions: { allowFileAccess: true } })
      })
      .then((res: unknown) => {
        console.log(`[devtools] React DevTools loaded: ${(res as any)?.name ?? res}`)
        const wc = mainWindow.webContents
        if (wc.isDestroyed()) return
        // Reload after the initial load settles so the two don't interleave.
        if (wc.isLoading()) wc.once('did-finish-load', () => { if (!wc.isDestroyed()) wc.reload() })
        else wc.reload()
      })
      .catch((err: unknown) => console.warn('[devtools] React DevTools failed to load:', err))
  }

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

  // Confirm before quitting if conversions or auto-rule file operations are
  // still running, or the Settings page holds an unsaved draft. Intercepts
  // the window's 'close' event and asks the renderer to show its own styled
  // modal; the renderer calls back via 'app:proceedQuit'. Because app.quit()
  // routes through this close event too, tray Quit and Alt+F4 are covered.
  let confirmedClose = false
  // Mirrored from the renderer (SettingsPage → App → here) so the close
  // path can see the draft state the in-app nav guard already tracks.
  let rendererSettingsDirty = false
  ipcMain.on('app:settingsDirty', (_event, dirty: boolean) => {
    rendererSettingsDirty = !!dirty
  })
  mainWindow.on('close', (event) => {
    if (confirmedClose) return
    const { running, queued } = getActiveConversionCounts()
    const fileOps = fileWatcher.getActiveFileOpCount()
    if (running === 0 && fileOps === 0 && !rendererSettingsDirty) return
    event.preventDefault()
    if (!mainWindow.isVisible()) {
      mainWindow.show()
      mainWindow.focus()
    }
    mainWindow.webContents.send('app:confirmQuit', { running, queued, fileOps, settingsDirty: rendererSettingsDirty })
  })
  ipcMain.on('app:proceedQuit', async () => {
    confirmedClose = true
    // Abort in-flight watcher copies and sweep their partial destination
    // files while the process is still alive to do it.
    await fileWatcher.abortAllInFlight()
    mainWindow.close()
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
    registerNetIPC()
    registerThumbnailIPC()
    // Stream Relay — registers IPC + auto-starts the ffmpeg child if the
    // user had it enabled when SM last quit. Deferred since the YouTube
    // integration page is the typical entry point and the relay's auto-
    // start logic looks at the saved config which is already loaded.
    registerStreamRelayIPC()

    // Eagerly probe available GPU encoders so the preset editor's encoder
    // dropdown is instant when the user opens it. Result is cached in
    // ffmpegService for the lifetime of the process.
    import('./services/ffmpegService').then(m => m.detectAvailableEncoders().catch(() => {}))
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  fileWatcher.stop()
  tempManager.cleanupAll()
  // Catch the tail of the rolling _meta.json backups: writes since the last
  // interval-gated backup get one final copy before shutdown.
  backupMetaOnQuit()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
