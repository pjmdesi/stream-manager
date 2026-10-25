import type { LiveBroadcast } from '../types'

// Which YouTube video a stream item most likely belongs to (STR-42): the
// link picker's best match, and the matcher an automatic link-back
// (STR-34) can reuse. Each signal that fits adds to a score and names
// its reason; the best video above the floor is the recommendation.
// Signals, strongest first: the uploaded file's name against the
// recording's, the lengths, the titles, the tags, and the dates last,
// since an edited version can go up months after the stream.

export interface StreamMatchInput {
  /** The stream's resolved title. */
  title: string
  /** The file name of the stream's primary recording, if there is one. */
  recordingName: string | null
  /** That recording's length in seconds, when known. */
  recordingDurationSec: number | null
  tags: string[]
  /** The folder date, YYYY-MM-DD. */
  date: string
}

export interface VideoMatch {
  id: string
  score: number
  /** Short reasons for the chips: "same file name", "same length". */
  reasons: string[]
}

/** The least score a video needs to be recommended: one strong signal,
 *  or a couple of weaker ones that agree. */
export const MATCH_FLOOR = 30

export function scoreVideoMatch(stream: StreamMatchInput, video: LiveBroadcast): VideoMatch {
  let score = 0
  const reasons: string[] = []

  // The uploaded file: YouTube keeps the name the owner uploaded, and a
  // stream's recording usually goes up under its own name. A livestream's
  // own VOD has no upload; YouTube names it "livestream.str", which says
  // nothing about the recording, so it is not compared.
  const ours = stem(stream.recordingName)
  const theirs = stem(video.fileName)
  if (ours && theirs && theirs !== 'livestream') {
    if (ours === theirs) { score += 60; reasons.push('same file name') }
    else if (ours.includes(theirs) || theirs.includes(ours)) { score += 30; reasons.push('file name overlaps') }
  }

  // The length: a recording and its VOD run the same time, give or take
  // the seconds YouTube trims.
  if (stream.recordingDurationSec && video.durationSec) {
    const diff = Math.abs(stream.recordingDurationSec - video.durationSec)
    const tolerance = Math.max(15, stream.recordingDurationSec * 0.02)
    if (diff <= tolerance) { score += 40; reasons.push('same length') }
    else if (diff <= stream.recordingDurationSec * 0.1) { score += 15; reasons.push('similar length') }
  }

  // The title: the words they share, against the words either has.
  const similarity = titleSimilarity(stream.title, video.snippet?.title ?? '')
  if (similarity >= 0.8) { score += 30; reasons.push('title matches') }
  else if (similarity >= 0.5) { score += 15; reasons.push('similar title') }

  // Tags: half of the shorter list shared.
  const ourTags = new Set(stream.tags.map(t => t.trim().toLowerCase()).filter(Boolean))
  const theirTags = (video.snippet?.tags ?? []).map(t => t.trim().toLowerCase()).filter(Boolean)
  if (ourTags.size > 0 && theirTags.length > 0) {
    const shared = theirTags.filter(t => ourTags.has(t)).length
    if (shared / Math.min(ourTags.size, theirTags.length) >= 0.5) { score += 10; reasons.push('shared tags') }
  }

  // The date, weakly: streams and their VODs share a day, but a cut
  // version can go up long after.
  const days = daysBetween(stream.date, video.snippet?.actualStartTime ?? video.snippet?.scheduledStartTime)
  if (days != null) {
    if (days <= 1) { score += 10; reasons.push('same day') }
    else if (days <= 7) { score += 5; reasons.push('same week') }
  }

  return { id: video.id, score, reasons }
}

/** The best video above the floor, or null. Ties go to the newer video. */
export function bestVideoMatch(stream: StreamMatchInput, videos: LiveBroadcast[]): VideoMatch | null {
  let best: VideoMatch | null = null
  for (const v of videos) {
    const m = scoreVideoMatch(stream, v)
    if (m.score < MATCH_FLOOR) continue
    if (!best || m.score > best.score) best = m
  }
  return best
}

/** A file name without its folder and extension, lowercased. */
function stem(name: string | null | undefined): string | null {
  if (!name) return null
  const base = name.split(/[\\/]/).pop() ?? name
  return base.replace(/\.[^.]+$/, '').trim().toLowerCase() || null
}

/** Jaccard similarity of the two titles' words (three letters or more,
 *  case and punctuation ignored). */
function titleSimilarity(a: string, b: string): number {
  const wordsOf = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length >= 3))
  const wa = wordsOf(a)
  const wb = wordsOf(b)
  if (wa.size === 0 || wb.size === 0) return 0
  let shared = 0
  for (const w of wa) if (wb.has(w)) shared++
  return shared / (wa.size + wb.size - shared)
}

/** Whole days between a folder date and an ISO timestamp, by local
 *  calendar day; null when either does not parse. */
function daysBetween(folderDate: string, iso: string | undefined): number | null {
  if (!iso) return null
  const [y, m, d] = folderDate.split('-').map(n => parseInt(n, 10))
  if (!y || !m || !d) return null
  const t = new Date(iso)
  if (isNaN(t.getTime())) return null
  const a = new Date(y, m - 1, d).getTime()
  const b = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()
  return Math.round(Math.abs(a - b) / 86_400_000)
}
