import { app, safeStorage } from 'electron'

/**
 * Encryption-at-rest for stored secrets (OAuth tokens, client secrets, API
 * keys) using Electron's safeStorage — DPAPI on Windows, so ciphertext is
 * bound to the Windows user profile rather than a key shipped in the app.
 * electron-store's own `encryptionKey` option is deliberately NOT used: its
 * key would live in the source, which is obfuscation, not encryption.
 *
 * Encrypted values are stored as strings with an explicit marker prefix so
 * plaintext (legacy values, or values written while OS encryption was
 * unavailable) is distinguished deliberately instead of guessed at:
 *
 *   enc1:<base64 of safeStorage.encryptString output>
 *
 * No real credential starts with "enc1:" (Google tokens start "ya29." or
 * "1//", client secrets "GOCSPX-", Anthropic keys "sk-ant-", Twitch tokens
 * are bare hex), so the marker is unambiguous.
 *
 * Failure philosophy (honest errors, never destructive):
 * - Encrypting with OS encryption unavailable degrades to storing plaintext,
 *   exactly what shipped before this existed. Never blocks a save.
 * - Decryption failure (DPAPI keys invalidated by an admin password reset,
 *   a copied-in AppData folder from another machine, hand-tampering) returns
 *   null so callers degrade to "not connected"/"no key". The stored value is
 *   NEVER deleted or overwritten by a failed read — the user reconnects and
 *   the next successful write replaces it.
 * - An OLDER build reading ciphertext treats it as a token, fails the API
 *   call, and prompts a normal reconnect; nothing corrupts.
 *
 * safeStorage is only usable after app.ready, so availability checks are
 * made lazily at call time (never at module load) and treat "not ready yet"
 * as "unavailable".
 */

const PREFIX = 'enc1:'

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(PREFIX)
}

/** True when secrets can actually be encrypted RIGHT NOW. */
export function canEncryptSecrets(): boolean {
  try {
    return app.isReady() && safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/** Encrypt a secret for storage. Empty and already-encrypted values pass
 *  through; when OS encryption is unavailable the plaintext passes through
 *  (the pre-encryption behavior — a save must never fail over this). */
export function encryptSecret(plain: string): string {
  if (!plain || isEncryptedSecret(plain)) return plain
  if (!canEncryptSecrets()) return plain
  try {
    return PREFIX + safeStorage.encryptString(plain).toString('base64')
  } catch {
    return plain
  }
}

export type SecretReadResult =
  | { ok: true; value: string; wasPlaintext: boolean }
  | { ok: false; error: string }

/** Read a stored secret. Plaintext (legacy) values come back as-is with
 *  `wasPlaintext: true` so callers can migrate them; ciphertext is
 *  decrypted. Never throws. */
export function readSecret(stored: string): SecretReadResult {
  if (!stored || !isEncryptedSecret(stored)) {
    return { ok: true, value: stored, wasPlaintext: !!stored }
  }
  if (!canEncryptSecrets()) {
    return { ok: false, error: 'OS encryption is unavailable, so the stored (encrypted) value cannot be read.' }
  }
  try {
    return { ok: true, value: safeStorage.decryptString(Buffer.from(stored.slice(PREFIX.length), 'base64')), wasPlaintext: false }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Convenience for config-style fields: decrypted value, or '' on failure
 *  with one honest console line naming the field (the UI then behaves as
 *  "not configured" and the user re-enters the value; the stored bytes are
 *  left untouched). */
export function readSecretOrEmpty(stored: string | undefined, label: string): string {
  const r = readSecret(stored ?? '')
  if (r.ok) return r.value
  console.error(`[secretStorage] Could not decrypt ${label} (${r.error}). ` +
    'This happens when the Windows user profile changed or the file came from another machine. ' +
    'Treating it as not set — re-enter it in Integrations. The stored value was not modified.')
  return ''
}
