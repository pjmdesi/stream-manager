/**
 * Normalize an error from an `ipcRenderer.invoke` rejection into a short,
 * user-readable string.
 *
 * Main-process handlers throw `new Error(<real message>)`; Electron then
 * re-wraps that on rejection as
 * `Error invoking remote method '<channel>': Error: <message>`. Strip both
 * wrappers so the user sees the actual cause (e.g. "Your credit balance is
 * too low…", "The user is not enabled for live streaming.") rather than IPC
 * plumbing.
 */
export function cleanIpcError(e: unknown): string {
  let msg = e instanceof Error ? e.message : String(e ?? '')
  msg = msg.replace(/^Error invoking remote method '[^']*':\s*/, '')
  msg = msg.replace(/^Error:\s*/, '')
  msg = msg.trim()
  return msg || 'Something went wrong'
}
