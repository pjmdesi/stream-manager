/** Normalize a filesystem path for DISPLAY: all separators become "/".
 *  Paths arrive with whichever separator built them (main's path.join gives
 *  "\" on Windows, renderer-side string joins give "/"), so the same UI
 *  surface could show both styles — the converter's output-folder link did,
 *  depending on whether the row was a regular conversion or a clip export.
 *  "/" is the app-wide display choice. Display only: pass the ORIGINAL
 *  path to IPC (openInExplorer, fs calls), never this. */
export function displayPath(p: string): string {
  return p.replace(/\\/g, '/')
}
