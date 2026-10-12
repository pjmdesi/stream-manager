/** In-memory path identity for the renderer's in-use and open-item checks.
 *  Paths arrive from different parties (Explorer drops and dialogs, the
 *  Streams Directory setting as typed, main's directory walks) and Windows
 *  volumes are case-insensitive, so two spellings of one file must compare
 *  equal. Forward slashes, no trailing slash, lowercased. Not for display
 *  and not for anything persisted: the persisted keys (videoMap, stream
 *  meta) keep their casing and live in shared/streamKey. */
export function pathKey(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}
