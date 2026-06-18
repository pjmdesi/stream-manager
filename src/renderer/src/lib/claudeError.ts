/**
 * Normalize a Claude-generation failure into a short, user-readable string for
 * the inline AI hint lines.
 *
 * `claude:generate` throws `new Error(<Anthropic message>)` in the main
 * process; Electron's `ipcRenderer.invoke` then re-wraps that on rejection as
 * `Error invoking remote method 'claude:generate': Error: <message>`. Strip
 * both wrappers so the user sees the actual cause (e.g. "Your credit balance
 * is too low…", "model: … not found", a rate-limit notice) rather than IPC
 * plumbing.
 */
export function cleanClaudeError(e: unknown): string {
  let msg = e instanceof Error ? e.message : String(e ?? '')
  msg = msg.replace(/^Error invoking remote method '[^']*':\s*/, '')
  msg = msg.replace(/^Error:\s*/, '')
  msg = msg.trim()
  return msg || 'Generation failed'
}
