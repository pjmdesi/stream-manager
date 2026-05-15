/**
 * A preset is compatible with the clip-export pipeline only if it
 * re-encodes both video and audio. The pipeline runs every segment
 * through a filter_complex (trim / optional crop / optional bleep /
 * concat) which emits decoded [vout] and [aout] streams — those can't
 * be stream-copied, and a video-less preset (`-vn`) has nothing to map
 * [vout] to. The main process applies the same check in
 * addClipToQueue; keep these regexes in sync.
 */
export function isClipExportCompatible(args: string): boolean {
  if (/(?:^|\s)(?:-c:v|-vcodec)\s+copy(?:\s|$)/.test(args)) return false
  if (/(?:^|\s)(?:-c:a|-acodec)\s+copy(?:\s|$)/.test(args)) return false
  if (/(?:^|\s)-vn(?:\s|$)/.test(args)) return false
  return true
}
