import { relativeKey, streamKeyOfFolder } from '../../../shared/streamKey'

/** videoMap is keyed by the video's path relative to its stream folder,
 *  forward-slash normalized. For flat layouts that's just the basename; for
 *  nested layouts (e.g. clips/highlight.mp4) it includes the sub-folder.
 *  Falls back to the basename when the path isn't under the folder.
 *
 *  Single source of truth, shared with main through shared/streamKey:
 *  basename-only lookups silently miss every entry in a subfolder (no
 *  duration/size/Clip badge, wrong "prefer full recording" picks, streams
 *  stuck reading as upcoming). */
export function videoMapKey(folderPath: string, videoPath: string): string {
  return relativeKey(folderPath, videoPath)
}

/** Canonical _meta.json key for a stream: its folder path relative to the
 *  streams directory (the date alone when the folder IS the streams
 *  directory, as in dump mode), else the folder's basename. The same
 *  function main keys with, so both write the same entry. */
export function streamMetaKey(folderPath: string, date: string, streamsDir: string | undefined): string {
  return streamKeyOfFolder(streamsDir || '', folderPath, date)
}
