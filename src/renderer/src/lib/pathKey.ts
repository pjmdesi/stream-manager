/** Path helpers for comparing and keying paths that different parties built:
 *  Explorer drops and dialogs, the Streams Directory setting as typed, and
 *  main's directory walks. Windows volumes are case-insensitive, so two
 *  spellings of one file must compare equal. */

/** Identity key for in-memory comparison only: forward slashes, no trailing
 *  slash, lowercased. Not for display and not for anything persisted. */
export function pathKey(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** `p` relative to `root` with forward slashes, or its basename when it is
 *  not under `root`. Case is kept: the result is used as a persisted key
 *  (videoMap, stream meta) and must match what is already on disk. */
export function relativeKey(root: string, p: string): string {
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const fp = p.replace(/\\/g, '/').replace(/\/+$/, '')
  if (r && fp.startsWith(r + '/')) return fp.slice(r.length + 1)
  return fp.split('/').pop() ?? fp
}
