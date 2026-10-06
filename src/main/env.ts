import { join } from 'path'

/** True on the dev server (electron-vite sets ELECTRON_RENDERER_URL) or when
 *  NODE_ENV says so. A packaged build is never dev. */
export const isDev = process.env['NODE_ENV'] === 'development' || !!process.env['ELECTRON_RENDERER_URL']

/** The app icon: the repo's resources/ on the dev server, Electron's
 *  resourcesPath in a packaged build. Used by the main window, the tray and
 *  the popout player. */
export const iconPath = isDev
  ? join(__dirname, '../../resources/icon.png')
  : join(process.resourcesPath, 'icon.png')
