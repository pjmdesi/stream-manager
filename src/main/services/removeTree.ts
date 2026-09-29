import fs from 'fs'
import path from 'path'

/**
 * Delete a directory tree file by file and report what could not go,
 * instead of `fs.rmSync(dir, { recursive: true, force: true })`, which
 * stops at the first locked or unreadable entry and throws away the rest
 * of the job along with the reason. Used by the cache managers' clearAll
 * so Settings can say honestly which files stayed behind (a cache file
 * open in another process, a permissions problem) rather than reporting
 * an empty cache that is not.
 *
 * Returns one line per failure ("<path>: <code>"); an empty list means the
 * tree is gone. Directories that still hold a failed file are left in
 * place and not reported twice. A missing root is not a failure.
 */
export function removeTree(root: string): string[] {
  const failed: string[] = []
  const codeOf = (err: unknown) => (err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : String(err))
  const walk = (dir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (err) {
      if (codeOf(err) !== 'ENOENT') failed.push(`${dir}: ${codeOf(err)}`)
      return
    }
    for (const entry of entries) {
      const p = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(p)
      } else {
        try { fs.unlinkSync(p) } catch (err) { if (codeOf(err) !== 'ENOENT') failed.push(`${p}: ${codeOf(err)}`) }
      }
    }
    // Only an empty directory can go; one that kept a failed file stays
    // silently, its file is already on the list.
    try { fs.rmdirSync(dir) } catch { /* not empty, or already gone */ }
  }
  walk(root)
  return failed
}
