import type { StreamMeta, StreamFolder } from '../types'

// ─── Stream title rendering ─────────────────────────────────────────────────
// `meta.ytTitle` stores a raw *template body* (e.g.
// "{game} [PART {episode}/{total_episodes}] | {tagline}") since the
// chip-based title editor landed. Anywhere a stream's human-facing title
// is displayed it must be resolved against the stream's merge fields first,
// or the raw `{game} … {tagline}` markers leak into the UI.
//
// This module is the single source of truth for that resolution so the
// streams list, the sidebar header, the thumbnail editor (toolbar / recents
// / asset panel) and the player recents all agree. The lower-level helpers
// mirror their counterparts in StreamsPage.tsx — kept pure and dependency-free
// here so display code outside the streams page can render titles without
// importing that 6k-line module.

/** `{key}` → fields[key], leaving unknown placeholders untouched. */
export function applyMergeFields(template: string, fields: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => fields[key] ?? `{${key}}`)
}

/** A stream is "standalone" (not part of a series) only when explicitly
 *  flagged. Legacy `undefined` stays a series so older files keep their
 *  season/episode merge fields. */
function isStandalone(meta: StreamMeta | null | undefined): boolean {
  return meta?.isSeries === false
}

/** Effective primary topic/game: `meta.primaryGame` when still present in
 *  `games[]`, else `games[0]`, else ''. */
export function resolvePrimaryGame(meta: StreamMeta | null | undefined): string {
  const games = meta?.games ?? []
  if (meta?.primaryGame && games.includes(meta.primaryGame)) return meta.primaryGame
  return games[0] ?? ''
}

/** Total streams in (game, season). Counts the current folder too; falls
 *  back to 1 so `{total_episodes}` never renders as 0. */
export function detectTotalEpisodes(allFolders: StreamFolder[], gameName: string, season: string): number {
  if (!gameName) return 1
  const lower = gameName.toLowerCase()
  const s = season || '1'
  const count = allFolders.filter(f =>
    !f.isMissing &&
    !isStandalone(f.meta) &&
    ((f.meta?.games?.some(g => g.toLowerCase() === lower)) ||
     (f.detectedGames?.some(g => g.toLowerCase() === lower))) &&
    (f.meta?.ytSeason || '1') === s
  ).length
  return count || 1
}

/** Assemble the field map once the primary game + total-episode count are
 *  known. Shared by the folder-based and meta-only builders so the two
 *  never drift. */
function assembleFields(
  meta: StreamMeta | null | undefined,
  primaryGame: string,
  totalEpisodes: number | undefined,
): Record<string, string> {
  const standalone = isStandalone(meta)
  const allTopics = (meta?.games ?? []).join(' ')
  return {
    // `topic`/`topics` are the canonical keys; `game`/`games` stay as aliases
    // so templates authored before the topic/game rename still resolve.
    topic: primaryGame,
    topics: allTopics,
    game: primaryGame,
    games: allTopics,
    season: standalone ? '' : (meta?.ytSeason ?? '1'),
    episode: standalone ? '' : (meta?.ytEpisode ?? ''),
    tagline: meta?.ytCatchyTitle ?? '',
    title: meta?.ytCatchyTitle ?? '',
    total_episodes: standalone ? '' : (totalEpisodes != null ? String(totalEpisodes) : ''),
  }
}

/** Build the merge-field map for a single stream. Mirrors
 *  StreamsPage.buildYtTitleMergeFields exactly. */
export function buildStreamMergeFields(
  meta: StreamMeta | null | undefined,
  folder: StreamFolder,
  folders: StreamFolder[],
): Record<string, string> {
  const primaryGame = resolvePrimaryGame(meta) || meta?.games?.[0] || folder.detectedGames?.[0] || ''
  const total = isStandalone(meta) ? undefined : detectTotalEpisodes(folders, primaryGame, meta?.ytSeason || '1')
  return assembleFields(meta, primaryGame, total)
}

/** Build the merge-field map from a bare `StreamMeta` when the full folders
 *  list isn't available (e.g. the thumbnail editor, which carries only the
 *  active stream's meta plus a pre-computed episode count). `{total_episodes}`
 *  resolves from `opts.totalEpisodes` when supplied, else renders empty. */
export function buildStreamMergeFieldsFromMeta(
  meta: StreamMeta | null | undefined,
  opts: { totalEpisodes?: number; detectedGames?: string[] } = {},
): Record<string, string> {
  const primaryGame = resolvePrimaryGame(meta) || meta?.games?.[0] || opts.detectedGames?.[0] || ''
  return assembleFields(meta, primaryGame, opts.totalEpisodes)
}

/** Render a raw title template body from a bare `StreamMeta`, falling back to
 *  `fallback` (then the games list) when the body is empty or renders blank.
 *  For callers that have meta but not the folders list. */
export function renderTitleFromMeta(
  meta: StreamMeta | null | undefined,
  opts: { totalEpisodes?: number; detectedGames?: string[]; fallback?: string } = {},
): string {
  const body = meta?.ytTitle?.trim() || meta?.twitchTitle?.trim()
  if (body) {
    const rendered = applyMergeFields(body, buildStreamMergeFieldsFromMeta(meta, opts)).trim()
    if (rendered) return rendered
  }
  return opts.fallback?.trim() || meta?.games?.join(', ') || ''
}

/** Resolve a stream's display title: render its `ytTitle` (or `twitchTitle`)
 *  template body against the merge fields, falling back to the games list
 *  and then the folder name — the same fallback chain the streams list and
 *  sidebar used before, but with the template actually rendered.
 *
 *  Pass the full `folders` list so `{total_episodes}` can be counted; when a
 *  caller only has the one folder, pass `[folder]` (total_episodes then
 *  reflects just that stream, which is the best obtainable estimate). */
export function renderStreamTitle(folder: StreamFolder, folders: StreamFolder[]): string {
  const meta = folder.meta
  const body = meta?.ytTitle?.trim() || meta?.twitchTitle?.trim()
  if (body) {
    const rendered = applyMergeFields(body, buildStreamMergeFields(meta, folder, folders)).trim()
    if (rendered) return rendered
  }
  return meta?.games?.join(', ') || folder.folderName
}
