/** Local calendar date and clock strings. Stream dates and push times are
 *  the user's local day and time, so these build from the local getters;
 *  `toISOString()` would move a late-evening stream to the next UTC day. */

/** `YYYY-MM-DD` in the user's timezone. */
export function localDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** `HH:MM`, 24-hour, in the user's timezone. */
export function localTimeString(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Local `YYYY-MM-DD` for an ISO timestamp, or '' when it does not parse.
 *  Compared against `folder.date` (also local): a UTC comparison would
 *  misclassify broadcasts whose scheduled time straddles midnight. */
export function localDateFromIso(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return localDateString(d)
}
