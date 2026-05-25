/**
 * Approximate YouTube's tag character count for a comma-separated string.
 *
 * YouTube enforces a 500-char limit across all tags on a video. The count
 * isn't the raw string length — it's:
 *   - sum of trimmed tag lengths
 *   - +1 per comma between tags (whitespace after the comma doesn't count)
 *   - +2 per multi-word tag (YouTube wraps tags containing spaces in
 *     implicit quotes when persisted, and those quotes count)
 *
 * Matches YouTube's own counter within ±1 in observed cases. Used to drive
 * the "X / 500 chars" indicator + warning state on the tag inputs.
 */
export const YT_TAG_CHAR_LIMIT = 500

export function ytTagCharCount(tagsText: string): number {
  const tags = tagsText.split(',').map(t => t.trim()).filter(Boolean)
  if (tags.length === 0) return 0
  let count = 0
  for (const tag of tags) {
    count += tag.length
    if (/\s/.test(tag)) count += 2
  }
  count += tags.length - 1
  return count
}
