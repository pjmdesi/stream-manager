/** Every container the app treats as a video. One list for main (what a
 *  stream folder's videos are) and the renderer (what the Converter, Combine
 *  and Player dropzones and open dialogs accept, and what the Player's
 *  sibling list shows), so a format that shows up in a stream's files is
 *  taken everywhere else. The files grid dropzone is unrestricted on
 *  purpose and does not use it. Pure values: this file runs in both
 *  processes. */
export const VIDEO_EXTENSIONS: readonly string[] = [
  'mkv', 'mp4', 'mov', 'avi', 'ts', 'flv', 'webm',
  'wmv', 'm4v', 'mpg', 'mpeg', 'm2ts', 'mts', 'vob',
  'divx', '3gp', 'ogv', 'asf', 'rmvb', 'f4v', 'hevc',
]

const EXT_SET = new Set(VIDEO_EXTENSIONS)

/** True for a video extension, with or without the dot, any case. */
export function isVideoExtension(ext: string): boolean {
  return EXT_SET.has((ext.startsWith('.') ? ext.slice(1) : ext).toLowerCase())
}

/** True when a path or file name ends in a video extension. */
export function isVideoFile(pathOrName: string): boolean {
  const base = pathOrName.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 && isVideoExtension(base.slice(dot + 1))
}
