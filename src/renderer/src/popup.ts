// Popup player — vanilla TS, no React.
// Displays a MediaStream received from the main window via a local WebRTC
// peer connection. The main window's <video> element is the sole decoder;
// this window just renders the stream it sends, so there is no independent
// disk I/O, hardware-decoder cold-start, or seek lag here.

export {}

declare global {
  interface Window {
    popupApi: {
      onCommand: (cb: (cmd: string, ...args: any[]) => void) => () => void
      mouseDown: (sx: number, sy: number) => void
      mouseDrag: (sx: number, sy: number) => void
      mouseUp:   (sx: number, sy: number) => void
      close:     () => void
      rtcSend:   (data: unknown) => void
    }
  }
}

const video = document.getElementById('video') as HTMLVideoElement

// ── Drag to dismiss ──────────────────────────────────────────────────────────

document.body.addEventListener('pointerdown', e => {
  document.body.setPointerCapture(e.pointerId)
  window.popupApi.mouseDown(e.screenX, e.screenY)
})
document.body.addEventListener('pointermove', e => {
  if (e.buttons === 0) return
  window.popupApi.mouseDrag(e.screenX, e.screenY)
})
document.body.addEventListener('pointerup', e => {
  document.body.releasePointerCapture(e.pointerId)
  window.popupApi.mouseUp(e.screenX, e.screenY)
})

document.addEventListener('keydown', e => { if (e.key === 'Escape') window.popupApi.close() })

// ── WebRTC stream reception ──────────────────────────────────────────────────

let pc: RTCPeerConnection | null = null

function closePc() {
  if (pc) { pc.close(); pc = null }
  video.srcObject = null
}

// ── Command channel ──────────────────────────────────────────────────────────

window.popupApi.onCommand((cmd, ...args) => {
  switch (cmd) {
    case 'webrtc-offer': {
      const offerSdp = args[0] as string
      closePc()

      pc = new RTCPeerConnection({ iceServers: [] })

      pc.ontrack = (e) => {
        console.log('[popup] ontrack fired, streams:', e.streams.length)
        if (!video.srcObject) {
          video.srcObject = e.streams[0] ?? new MediaStream([e.track])
          video.play().catch(err => console.warn('[popup] play() failed:', err))
        }
      }

      pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: offerSdp }))
        .then(() => pc!.createAnswer())
        .then(answer => pc!.setLocalDescription({
          type: 'answer',
          sdp: injectSdpBandwidth(answer.sdp!, 200_000_000),
        }))
        .then(() => waitForIceComplete(pc!))
        .then(() => {
          // Send the complete answer SDP (vanilla ICE — all candidates embedded)
          window.popupApi.rtcSend({ type: 'answer', sdp: pc!.localDescription!.sdp })
          console.log('[popup] Answer sent, ICE state:', pc!.iceGatheringState)
        })
        .catch(err => console.error('[popup] WebRTC setup error:', err))
      break
    }

    case 'crop': {
      const style = args[0] as string | null
      if (style) {
        document.body.classList.add('cropped')
        video.setAttribute('style', style)
      } else {
        document.body.classList.remove('cropped')
        video.removeAttribute('style')
      }
      break
    }
  }
})

function injectSdpBandwidth(sdp: string, bitsPerSec: number): string {
  const kbps = Math.floor(bitsPerSec / 1000)
  return sdp.replace(
    /(m=video[^\r\n]*\r?\n)/g,
    `$1b=AS:${kbps}\r\nb=TIAS:${bitsPerSec}\r\n`,
  )
}

function waitForIceComplete(peerConnection: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (peerConnection.iceGatheringState === 'complete') { resolve(); return }
    const onStateChange = () => {
      if (peerConnection.iceGatheringState === 'complete') {
        peerConnection.removeEventListener('icegatheringstatechange', onStateChange)
        resolve()
      }
    }
    peerConnection.addEventListener('icegatheringstatechange', onStateChange)
    // Safety timeout: don't wait forever — if we have at least some candidates, proceed
    setTimeout(() => { peerConnection.removeEventListener('icegatheringstatechange', onStateChange); resolve() }, 2000)
  })
}
