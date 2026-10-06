import { BrowserWindow } from 'electron'

/** Send one IPC message to every open renderer window (the main window and
 *  the popout player), skipping windows that are mid-close, whose
 *  webContents would throw. The one fan-out for main-to-renderer events;
 *  a message meant for a single window goes through its own webContents. */
export function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }
}
