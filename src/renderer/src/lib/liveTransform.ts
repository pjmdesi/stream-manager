import { useSyncExternalStore } from 'react'

/**
 * Live transform readout store (THU-26).
 *
 * While a layer is being dragged, resized, or rotated on the canvas, Konva
 * owns the node and the layer state only updates on release. The gesture
 * handlers write the node's live numbers here every frame; the on-canvas
 * readout and the properties panel's transform inputs subscribe and show
 * them, and nothing else re-renders. Values must never be written into the
 * layer state mid-gesture: a resize carries a temporary scale that only
 * becomes width and height on release, and committing it early makes React
 * push a width onto a node that still has the scale applied.
 */

export interface LiveTransform {
  kind: 'move' | 'resize' | 'rotate'
  /** Layer id of the primary node of the gesture. */
  id: string
  x: number
  y: number
  rotation: number
  /** Live box, when the gesture changes it (resize) or the layer has one. */
  width?: number
  height?: number
  /** Pointer position in stage-container coordinates, for the readout. */
  pointer: { x: number; y: number } | null
}

let current: LiveTransform | null = null
const listeners = new Set<() => void>()

export function setLiveTransform(next: LiveTransform | null): void {
  if (next === null && current === null) return
  current = next
  for (const l of listeners) l()
}

export function getLiveTransform(): LiveTransform | null {
  return current
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Subscribe a component to the live transform. */
export function useLiveTransform(): LiveTransform | null {
  return useSyncExternalStore(subscribe, getLiveTransform, getLiveTransform)
}

/** Normalize a Konva rotation to the -180..180 range the panel shows. */
export function normalizeAngle(deg: number): number {
  let a = deg % 360
  if (a > 180) a -= 360
  if (a <= -180) a += 360
  return a
}
