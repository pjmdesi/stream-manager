/**
 * Cycle-free bridge between long-running writers (converter jobs, archive
 * swaps) and the file watchers that must ignore their in-progress output.
 *
 * Writers register a predicate ("is this path an output I'm currently
 * writing?"); watchers call `isInFlightWrite` from their chokidar `ignored`
 * callbacks. Watching a growing ffmpeg output is pure churn — repeated
 * change events thrash the streams page thumbnails — and chokidar's
 * write-stability stat-polling can race a cancelled job's file-handle
 * release into EPERM errors. Completion/cancel paths fire their own
 * explicit events, so ignoring the in-flight file loses nothing.
 *
 * This module exists because the watchers used to `require()` the converter
 * lazily to dodge an import cycle (converter → streams → converter). The
 * main process bundles to a single file, so that runtime require threw
 * MODULE_NOT_FOUND and the catch silently disabled the ignore — the classic
 * silent-catch failure. This registry has no imports, so everyone can
 * depend on it statically.
 */
type PathPredicate = (filePath: string) => boolean

const predicates: PathPredicate[] = []

/** Called once at module load by each writer (e.g. the converter). */
export function registerInFlightWritePredicate(fn: PathPredicate): void {
  predicates.push(fn)
}

/** True when any registered writer is currently writing `filePath`. */
export function isInFlightWrite(filePath: string): boolean {
  return predicates.some(fn => fn(filePath))
}
