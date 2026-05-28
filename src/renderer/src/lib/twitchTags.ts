/**
 * Filter a list of tags down to the subset that fits Twitch's channel-tags
 * rules. Twitch's PATCH /channels endpoint enforces:
 *   - At most 10 tags
 *   - At most 25 characters per tag
 *   - No whitespace, no special characters (alphanumeric only — Twitch
 *     rejects with HTTP 400 if violated)
 *
 * Returns the kept set and the rejected set so the UI can surface
 * "X tags skipped on Twitch" without silently losing them.
 */
export const TWITCH_TAG_MAX_COUNT = 10
export const TWITCH_TAG_MAX_LENGTH = 25

const TWITCH_TAG_ALLOWED = /^[A-Za-z0-9]+$/

export interface TwitchTagFilterResult {
  /** Tags that pass Twitch's rules, in input order, capped at 10. */
  compat: string[]
  /** Tags that failed Twitch's rules (any reason), in input order. */
  skipped: string[]
}

export function toTwitchCompatibleTags(tags: string[]): TwitchTagFilterResult {
  const compat: string[] = []
  const skipped: string[] = []
  for (const raw of tags) {
    const t = raw.trim()
    if (!t) continue
    if (
      t.length > TWITCH_TAG_MAX_LENGTH ||
      !TWITCH_TAG_ALLOWED.test(t) ||
      compat.length >= TWITCH_TAG_MAX_COUNT
    ) {
      skipped.push(t)
      continue
    }
    compat.push(t)
  }
  return { compat, skipped }
}
