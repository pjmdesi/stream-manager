import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('popupApi', {
  onCommand: (cb: (cmd: string, ...args: any[]) => void) => {
    const handler = (_: Electron.IpcRendererEvent, cmd: string, ...args: any[]) => cb(cmd, ...args)
    ipcRenderer.on('popup:command', handler)
    return () => ipcRenderer.removeListener('popup:command', handler)
  },
  mouseDown: (sx: number, sy: number) => ipcRenderer.send('popup:mousedown', sx, sy),
  mouseDrag: (sx: number, sy: number) => ipcRenderer.send('popup:mousedrag', sx, sy),
  mouseUp:   (sx: number, sy: number) => ipcRenderer.send('popup:mouseup', sx, sy),
  close:     () => ipcRenderer.send('popup:close'),

  // WebRTC signaling: popup → main renderer (answer SDP)
  rtcSend: (data: unknown) => ipcRenderer.send('popup:rtc-p2m', data),
})
