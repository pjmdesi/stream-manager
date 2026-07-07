/** videoMap is keyed by the video's path relative to its stream folder,
 *  forward-slash normalized. For flat layouts that's just the basename; for
 *  nested layouts (e.g. clips/highlight.mp4) it includes the sub-folder.
 *  Falls back to the basename when the path isn't under the folder.
 *
 *  Single source of truth — basename-only lookups silently miss every entry
 *  in a subfolder (no duration/size/Clip badge, wrong "prefer full recording"
 *  picks, streams stuck reading as upcoming). */
export function videoMapKey(folderPath: string, videoPath: string): string {
  const fp = folderPath.replace(/\\/g, '/').replace(/\/$/, '')
  const vp = videoPath.replace(/\\/g, '/')
  return vp.startsWith(fp + '/') ? vp.slice(fp.length + 1) : vp.split('/').pop() ?? vp
}
