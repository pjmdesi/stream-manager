/** Audio track naming (PLR-23). One resolver for every place a track name
 *  shows (player rows, clip export dialog, converter picker, output file
 *  names), so they all agree.
 *
 *  Precedence: a per-file rename (stored with the track's other settings
 *  in the stream's metadata) wins over a name embedded in the file (the
 *  stream's title tag, which MKV recordings carry and MP4 cannot), which
 *  wins over the default for that track number from Settings (an ordered
 *  list matching the recorder's track layout), which wins over "Track N".
 *  The source rides along so a row can show where its name came from. */

export type TrackNameSource = 'override' | 'embedded' | 'default' | 'fallback'

export interface ResolvedTrackName {
  name: string
  source: TrackNameSource
}

/** OBS records up to six tracks; Settings offers one default per slot. */
export const DEFAULT_TRACK_NAME_SLOTS = 6

export function resolveTrackName(
  index: number,
  embedded: string | undefined,
  override: string | undefined,
  defaults: readonly string[] | undefined,
): ResolvedTrackName {
  const o = override?.trim()
  if (o) return { name: o, source: 'override' }
  const e = embedded?.trim()
  if (e) return { name: e, source: 'embedded' }
  const d = defaults?.[index]?.trim()
  if (d) return { name: d, source: 'default' }
  return { name: `Track ${index + 1}`, source: 'fallback' }
}

/** Tooltip copy for the per-source icon beside a track name. */
export const TRACK_NAME_SOURCE_HINT: Record<TrackNameSource, string> = {
  override: 'Renamed for this file. Double-click to change; clear the name to go back to the file’s own name or the default.',
  embedded: 'Name stored in the recording. Double-click to rename it for this file.',
  default: 'Default name for this track number, from Settings. Double-click to rename it for this file.',
  fallback: 'This recording carries no track names (MP4 cannot store them). Set defaults in Settings, or double-click to name it for this file.',
}
