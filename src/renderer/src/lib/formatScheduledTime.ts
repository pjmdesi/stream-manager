/** A broadcast's scheduled start for a compact label: `Today 7:00 PM`,
 *  `Tomorrow 7:00 PM`, else `Oct 6 7:00 PM`, in the user's locale and
 *  timezone. Empty string when the ISO timestamp does not parse. Used by the
 *  relay widget and the broadcast picker. */
export function formatScheduledTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const isTomorrow = d.toDateString() === tomorrow.toDateString()
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return `Today ${time}`
  if (isTomorrow) return `Tomorrow ${time}`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + time
}
