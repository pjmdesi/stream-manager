import type { StreamFolder } from '../types'

// A reload that found nothing new must change nothing (STR-56).
//
// A scan answers with fresh objects every time, and the Streams page used
// to take them as they came: every reload replaced the stream's entry, the
// whole page under it re-rendered, and the stream's thumbnails were given
// a new address and loaded again. With a library in a cloud sync folder a
// reload follows merely LOOKING at a stream (reading its thumbnails moves
// their change time, which the watcher cannot tell from a write), so the
// page flashed two seconds after every selection and anything mid-edit in
// the sidebar was rebuilt under the cursor.
//
// These helpers let the page keep the entry it has when the scan's answer
// says the same thing, and give a thumbnail a new address only when its
// own file was overwritten. Both read the stamp (modified time and size)
// the scan records per thumbnail.

/** Whether two entries for one stream say the same thing. They are plain
 *  data from the scan, so their JSON is the comparison; an entry the page
 *  edited optimistically compares equal once the scan agrees with it. */
export function sameStreamFolder(a: StreamFolder, b: StreamFolder): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

/** Whether a thumbnail that both entries list was overwritten in place:
 *  same path, another stamp. Only that needs a new address, since the
 *  browser holds the old bytes under the old one; a file added, removed or
 *  reordered does not. An entry without stamps (or with a list the page
 *  trimmed out of step) cannot say, and counts as overwritten so a stale
 *  image is never kept. */
export function thumbnailOverwritten(prev: StreamFolder, next: StreamFolder): boolean {
  const ps = prev.thumbnailStamps
  const ns = next.thumbnailStamps
  if (!ps || !ns || ps.length !== prev.thumbnails.length || ns.length !== next.thumbnails.length) {
    return prev.thumbnails.length > 0 && next.thumbnails.length > 0
  }
  const before = new Map<string, string>()
  prev.thumbnails.forEach((p, i) => before.set(p, ps[i]))
  return next.thumbnails.some((p, i) => before.has(p) && before.get(p) !== ns[i])
}

/** A full reload's answer laid over the list the page has: an entry that
 *  says the same as the one on the page is kept as it is (the same object,
 *  so nothing under it re-renders), and when every entry is kept in the
 *  same order the list itself is. `restamp` names the streams with a
 *  thumbnail overwritten in place. */
export function mergeStreamList(prev: StreamFolder[], next: StreamFolder[]): { list: StreamFolder[]; restamp: string[] } {
  const old = new Map<string, StreamFolder>()
  for (const f of prev) old.set(f.relativePath, f)
  const restamp: string[] = []
  let unchanged = prev.length === next.length
  const list = next.map((nf, i) => {
    const of = old.get(nf.relativePath)
    if (!of) { unchanged = false; return nf }
    if (sameStreamFolder(of, nf)) {
      if (prev[i] !== of) unchanged = false
      return of
    }
    unchanged = false
    if (thumbnailOverwritten(of, nf)) restamp.push(nf.relativePath)
    return nf
  })
  return { list: unchanged ? prev : list, restamp }
}
