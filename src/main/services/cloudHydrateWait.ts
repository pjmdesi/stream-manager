import fs from 'fs'
import { startHydrateRequest, type HydrateRequest } from './cfapi'
import { checkLocalFiles } from '../ipc/files'

// Shared "wait for a cloud placeholder to become local" used by the
// converter's two hydrate paths (archive groups and standalone jobs).
//
// Why not just poll attributes: a placeholder's attributes say "offline"
// until the whole file has landed, and nothing more. A recall the provider
// aborted, one the user cancelled from the Windows notification, and one
// that is slowly progressing all look the same to a poll, so a job could
// sit on "downloading" forever. Why not just block on CfHydratePlaceholder:
// the cloud widget does, and it learns about provider-side aborts (pausing
// the sync client fails the in-flight transfers), but a request the user
// cancelled from Windows simply stays pending inside the OS until the
// provider is nudged again.
//
// So this does both, plus a progress watch:
//   - A live CfHydratePlaceholder request (child process) is the ear for
//     provider errors: when it reports a failure the wait fails with the
//     provider's reason.
//   - An attribute poll is the eye for completion, independent of the
//     request (the poll settles the wait the moment the file is local).
//   - The file's on-disk allocation (fs.stat blocks, which libuv fills from
//     AllocationSize on Windows) is the pulse. The provider writes recalled
//     data into the placeholder, so allocation grows while a transfer is
//     alive. When it has not grown for STALL_MS a fresh request is issued
//     beside the live one (a second request restarts a transfer the user
//     cancelled from Windows; overlapping requests for an active transfer
//     are coalesced by the platform). When it has not grown for
//     DEAD_MS the wait fails so the job gets an end state instead of an
//     open-ended "downloading".
// Requests are never killed to force a restart: only a dehydrate aborts a
// transfer, so a dropped request would not stop anything, and a live one
// is what carries the provider's error back to us.

export type HydrateWaitResult =
  | { outcome: 'local' }
  | { outcome: 'cancelled' }
  | { outcome: 'failed'; reason: string }

export interface HydrateWaitOptions {
  /** Checked every poll tick; true ends the wait with 'cancelled'. */
  isCancelled: () => boolean
  pollMs?: number
  stallMs?: number
  deadMs?: number
}

const POLL_MS = 2000
/** No on-disk growth for this long: issue another request. */
const STALL_MS = 3 * 60 * 1000
/** No on-disk growth for this long: give up. */
const DEAD_MS = 30 * 60 * 1000
/** Live requests per file. One is the ear; a second is the restart nudge.
 *  More would only stack idle PowerShell processes. */
const MAX_LIVE_REQUESTS = 2

async function allocatedBytes(filePath: string): Promise<number> {
  try {
    const st = await fs.promises.stat(filePath)
    return typeof st.blocks === 'number' ? st.blocks * 512 : 0
  } catch {
    return 0
  }
}

export async function waitForCloudFile(filePath: string, opts: HydrateWaitOptions): Promise<HydrateWaitResult> {
  const pollMs = opts.pollMs ?? POLL_MS
  const stallMs = opts.stallMs ?? STALL_MS
  const deadMs = opts.deadMs ?? DEAD_MS

  const requests: HydrateRequest[] = []
  let providerFailure: string | null = null
  const issueRequest = () => {
    const req = startHydrateRequest(filePath)
    requests.push(req)
    void req.result.then(res => {
      if (res.outcome === 'failed' && providerFailure === null) providerFailure = res.reason ?? 'unknown'
    })
  }
  const liveCount = () => requests.filter(r => r.alive).length
  const finish = (result: HydrateWaitResult): HydrateWaitResult => {
    for (const r of requests) r.kill()
    return result
  }

  issueRequest()
  let lastAllocated = await allocatedBytes(filePath)
  let lastGrowthAt = Date.now()
  let lastStallNudgeAt = lastGrowthAt

  while (true) {
    if (opts.isCancelled()) return finish({ outcome: 'cancelled' })

    const [local] = await checkLocalFiles([filePath])
    if (local) return finish({ outcome: 'local' })

    // A provider error on any request fails the wait, unless the file
    // landed in the same instant (checked above) or the user cancelled.
    if (providerFailure !== null) {
      if (opts.isCancelled()) return finish({ outcome: 'cancelled' })
      return finish({ outcome: 'failed', reason: providerFailure })
    }

    const now = Date.now()
    const allocated = await allocatedBytes(filePath)
    if (allocated > lastAllocated) {
      lastAllocated = allocated
      lastGrowthAt = now
      lastStallNudgeAt = now
    } else if (now - lastGrowthAt >= deadMs) {
      return finish({
        outcome: 'failed',
        reason: `No download progress for ${Math.round(deadMs / 60000)} minutes. The sync client may be paused or the download was cancelled; check it, then requeue.`,
      })
    } else if (now - lastStallNudgeAt >= stallMs) {
      lastStallNudgeAt = now
      // Every request has exited without a verdict (nothing to hear) or the
      // live one is stuck: ask again. Capped so a long stall cannot stack
      // processes; the dead timer is the end state.
      if (liveCount() < MAX_LIVE_REQUESTS) issueRequest()
    }

    await new Promise(r => setTimeout(r, pollMs))
  }
}
