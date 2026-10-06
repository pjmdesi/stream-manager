import fs from 'fs'

/** Remove a file that a just-killed child process may still hold open. On
 *  Windows the handle can outlive the process by a moment, so a failed
 *  unlink is retried a few times; a file that is already gone is success.
 *  Used for partial outputs after a cancelled extraction or a failed
 *  auto-rule copy. */
export async function unlinkWithRetry(p: string, attempts = 3): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.promises.unlink(p)
      return
    } catch (err: any) {
      if (err.code === 'ENOENT') return
      await new Promise(r => setTimeout(r, 300))
    }
  }
}
