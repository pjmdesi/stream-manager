/**
 * The one byte formatter for every size the app shows. Counts by 1024 with
 * the plain KB, MB, GB, TB labels, the way Windows Explorer does, so a size
 * in Stream Manager matches the size Explorer shows for the same file.
 * Three significant figures like Explorer: 7.93 GB, 81.2 MB, 812 KB.
 *
 * History: nine private copies of this function once lived in nine
 * components, split between dividing by 1024 and by 1000, so the same
 * recording read 7.9 GB in the files grid and 8.51 GB in the cloud sync
 * dialog (found 2026-09-25). Add call sites; do not add copies.
 */
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) { value /= 1024; unit++ }
  const decimals = value < 10 ? 2 : value < 100 ? 1 : 0
  return `${value.toFixed(decimals)} ${UNITS[unit]}`
}
