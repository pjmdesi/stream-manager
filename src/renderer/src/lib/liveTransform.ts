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

/** Wrap an angle into 0 ≤ a < 360: the committed form of every angle field
 *  in the app (style guide, "Angle fields"). Live readouts during a gesture
 *  show the raw accumulated angle instead and wrap on release. */
export function normalizeAngle(deg: number): number {
  if (!Number.isFinite(deg)) return 0
  const a = ((deg % 360) + 360) % 360
  // -0 and 359.999… both read as 0.
  return Math.abs(a) < 1e-9 || Math.abs(a - 360) < 1e-9 ? 0 : a
}
