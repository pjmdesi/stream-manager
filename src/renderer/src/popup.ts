// Popup player — vanilla TS, no React.
// Receives one-way commands from the main player window via IPC.

export {}

declare global {
  interface Window {
    popupApi: {
      onCommand:  (cb: (cmd: string, ...args: any[]) => void) => () => void
      mouseDown:  (sx: number, sy: number) => void
      mouseDrag:  (sx: number, sy: number) => void
      mouseUp:    (sx: number, sy: number) => void
      reportTime: (t: number) => void
      close:      () => void
    }
  }
}

const video = document.getElementById('video') as HTMLVideoElement

// Report current time back to the main window so it can keep the timeline in sync.
// Throttled: at most one update every 250 ms.
let lastReportedTime = -1
video.addEventListener('timeupdate', () => {
  if (Math.abs(video.currentTime - lastReportedTime) >= 0.25) {
    lastReportedTime = video.currentTime
    window.popupApi.reportTime(video.currentTime)
  }
})

// Use pointer capture so drag events keep firing even when the cursor
// leaves the window content area during a fast drag.
document.body.addEventListener('pointerdown', e => {
  document.body.setPointerCapture(e.pointerId)
  window.popupApi.mouseDown(e.screenX, e.screenY)
})
document.body.addEventListener('pointermove', e => {
  if (e.buttons === 0) return  // no button held
  window.popupApi.mouseDrag(e.screenX, e.screenY)
})
document.body.addEventListener('pointerup', e => {
  document.body.releasePointerCapture(e.pointerId)
  window.popupApi.mouseUp(e.screenX, e.screenY)
})

document.addEventListener('keydown', e => { if (e.key === 'Escape') window.popupApi.close() })

window.popupApi.onCommand((cmd, ...args) => {
  switch (cmd) {
    case 'load': {
      const [filePath, currentTime] = args as [string, number]
      video.src = `file:///${filePath.replace(/\\/g, '/')}`
      video.currentTime = currentTime
      break
    }
    case 'play':
      video.play().catch(() => {})
      break
    case 'pause':
      video.pause()
      break
    case 'seek':
      video.currentTime = args[0] as number
      break
  }
})
