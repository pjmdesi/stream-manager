import type { StreamFolder } from '../types'
import { isStandalone, resolvePrimaryGame, isPrimaryGameOf } from './streamTitle'

/** A stream's neighbors within its series (same primary game and season),
 *  plus the full sibling list sorted by episode number. Shared by the
 *  streams page sidebar and the player's Selected Stream block (PLR-27). */
export interface SeriesNav {
  prev: StreamFolder | null
  next: StreamFolder | null
  /** Every episode in the series and season, the current one included,
   *  sorted ascending by episode number (unnumbered ones last). */
  siblings: StreamFolder[]
}

export const EMPTY_SERIES_NAV: SeriesNav = { prev: null, next: null, siblings: [] }

export function seriesNavFor(folder: StreamFolder | null | undefined, folders: StreamFolder[]): SeriesNav {
  if (!folder) return EMPTY_SERIES_NAV
  // Standalone streams have no siblings concept: callers render their
  // empty state (disabled prev/next, no picker).
  if (isStandalone(folder.meta)) return EMPTY_SERIES_NAV
  // The user-selected primary (drag-reorder / tag-field selection), not
  // blindly games[0], and membership is primary-only so a stream that
  // carries this game as a secondary tag does not appear as an episode.
  const primaryGame = resolvePrimaryGame(folder.meta) || folder.detectedGames?.[0]
  if (!primaryGame) return EMPTY_SERIES_NAV
  // `|| '1'` (not `?? '1'`) so empty strings also collapse to the first
  // season: clearing the field should still associate with siblings that
  // have season undefined or ''.
  const season = folder.meta?.ytSeason || '1'
  const list = folders
    .filter(f =>
      !f.isMissing &&
      !isStandalone(f.meta) &&
      isPrimaryGameOf(f, primaryGame) &&
      (f.meta?.ytSeason || '1') === season
    )
    .sort((a, b) => {
      const epA = parseInt(a.meta?.ytEpisode ?? '', 10)
      const epB = parseInt(b.meta?.ytEpisode ?? '', 10)
      return (isNaN(epA) ? Infinity : epA) - (isNaN(epB) ? Infinity : epB)
    })
  const idx = list.findIndex(f => f.relativePath === folder.relativePath)
  return {
    prev: idx > 0 ? list[idx - 1] : null,
    next: idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null,
    siblings: list,
  }
}
