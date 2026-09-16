import type { ThumbnailLayer } from '../types'

/**
 * Auto-naming for new layers (THU-23): "Group 1", "Group 2", "Text 1",
 * "Rectangle 3". The number is a per-file, per-kind count of how many such
 * layers have EVER been created, not how many exist, so deleting or
 * ungrouping "Group 2" never lets a later group take its name and the user
 * can keep track of which is which. The map lives in the canvas file
 * (`nameCounters`) and travels with it.
 */
export type NameCounters = Record<string, number>

/**
 * Counters for a freshly loaded layer list. Each kind starts from the
 * greater of the stored counter and the highest "<Base> N" already in the
 * list, so a file saved before the counters existed, or one whose layers
 * were pasted in from elsewhere, continues where its names left off
 * instead of producing a second "Group 1".
 */
export function seedNameCounters(layers: ThumbnailLayer[], stored?: NameCounters): NameCounters {
  const out: NameCounters = { ...(stored ?? {}) }
  for (const l of layers) {
    const m = /^(.+?) (\d+)$/.exec(l.name)
    if (!m) continue
    const base = m[1]
    const n = Number(m[2])
    if (!Number.isFinite(n)) continue
    if ((out[base] ?? 0) < n) out[base] = n
  }
  return out
}

/** The next name for `base`, advancing its counter in place. */
export function takeLayerName(counters: NameCounters, base: string): string {
  const n = (counters[base] ?? 0) + 1
  counters[base] = n
  return `${base} ${n}`
}
