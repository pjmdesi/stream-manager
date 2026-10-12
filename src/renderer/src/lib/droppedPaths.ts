/** What a drop zone does with the paths the OS handed it (CONV-13).
 *
 *  A drop can carry folders and files of any type; the zone's `accept`
 *  list says what the page can use. Folders are expanded to the accepted
 *  files inside them (recursively, through the same listing the Player's
 *  sibling panel uses, which skips dot and underscore entries and files
 *  still being written) and files of other types are left out. The result
 *  carries what was left out so the zone can say so inline instead of
 *  silently dropping it, and a folder that held nothing usable is named
 *  rather than vanishing. */

export interface ResolvedDrop {
  /** Paths to hand to the page, in drop order; folders expanded in place. */
  files: string[]
  /** Directly dropped files whose type is not accepted. */
  skippedFiles: number
  /** Dropped folders that contained no accepted file. */
  emptyFolders: number
  /** How many of the dropped items were folders (for the message wording). */
  folders: number
}

function extensionOf(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** Expand folders and filter by `accept` (extensions, with or without the
 *  dot, any case). Without an `accept` list every path passes through
 *  untouched, which is what the files grid wants. */
export async function resolveDroppedPaths(paths: string[], accept?: readonly string[]): Promise<ResolvedDrop> {
  if (!accept || accept.length === 0 || paths.length === 0) {
    return { files: paths, skippedFiles: 0, emptyFolders: 0, folders: 0 }
  }
  const accepted = new Set(accept.map(e => (e.startsWith('.') ? e.slice(1) : e).toLowerCase()))
  const ok = (p: string) => accepted.has(extensionOf(p))
  const kinds = await window.api.pathKinds(paths)
  const files: string[] = []
  let skippedFiles = 0
  let emptyFolders = 0
  let folders = 0
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i]
    if (kinds[i] === 'dir') {
      folders++
      const entries = await window.api.listFilesRecursive(p)
      const inside = entries.filter(e => !e.isDirectory && ok(e.path)).map(e => e.path)
      if (inside.length === 0) emptyFolders++
      files.push(...inside)
    } else if (ok(p)) {
      files.push(p)
    } else {
      skippedFiles++
    }
  }
  return { files, skippedFiles, emptyFolders, folders }
}

/** One short line for the zone when a drop left something out, or null
 *  when everything dropped was taken. */
export function dropNotice(r: ResolvedDrop, droppedCount: number): string | null {
  if (r.files.length === 0) {
    if (r.folders === droppedCount) return r.folders === 1 ? 'No supported files in that folder.' : 'No supported files in those folders.'
    if (r.folders === 0) return droppedCount === 1 ? 'That file is not a supported type.' : 'None of those files are a supported type.'
    return 'Nothing to add: no supported files in that drop.'
  }
  const parts: string[] = []
  if (r.skippedFiles > 0) parts.push(r.skippedFiles === 1 ? 'Skipped 1 file of another type.' : `Skipped ${r.skippedFiles} files of other types.`)
  if (r.emptyFolders > 0) parts.push(r.emptyFolders === 1 ? 'One folder had no supported files.' : `${r.emptyFolders} folders had no supported files.`)
  return parts.length > 0 ? parts.join(' ') : null
}
