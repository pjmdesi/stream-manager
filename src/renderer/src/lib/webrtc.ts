/** WebRTC plumbing shared by the player (the sending side) and the popout
 *  window (the receiving side). Both ends run the same loopback connection. */

/** Inject b=AS and b=TIAS bandwidth lines into every m=video section of an
 *  SDP. This bypasses Chrome's congestion controller, which otherwise starts
 *  at ~300 kbps and ramps up slowly even on a loopback connection. A missing
 *  or non-positive bitrate leaves the SDP untouched. */
export function injectSdpBandwidth(sdp: string, bitsPerSec: number): string {
  if (!isFinite(bitsPerSec) || bitsPerSec <= 0) return sdp
  const kbps = Math.floor(bitsPerSec / 1000)
  return sdp.replace(
    /(m=video[^\r\n]*\r?\n)/g,
    `$1b=AS:${kbps}\r\nb=TIAS:${bitsPerSec}\r\n`,
  )
}

/** Resolves once ICE gathering is complete, or after 2 s with whatever
 *  candidates exist; local connections gather in under 100 ms. */
export function waitForIceComplete(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') { resolve(); return }
    const onStateChange = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', onStateChange)
        resolve()
      }
    }
    pc.addEventListener('icegatheringstatechange', onStateChange)
    setTimeout(() => { pc.removeEventListener('icegatheringstatechange', onStateChange); resolve() }, 2000)
  })
}
