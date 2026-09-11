import { startHydrateRequest, type HydrateRequest } from './cfapi'
import { checkLocalFiles } from '../ipc/files'

// Shared "wait for a cloud placeholder to become local" used by the
// converter's two hydrate paths (archive groups and standalone jobs).
//
// What the stack lets us observe (verified against Synology Drive):
//   - A placeholder's attributes say "offline" until the whole file has
//     landed, and nothing more. The sync client downloads to a temporary
//     location and moves the finished file into place, so size on disk
//     shows nothing until the very end either. There is no progress to
//     read from the file.
//   - A live CfHydratePlaceholder request hears provider-side failures:
//     pausing the sync client fails the in-flight transfers, a stopped
//     client rejects requests outright. A request the user cancelled from
//     the Windows notification does not fail; it stays pending inside the
//     OS, and only a fresh request restarts the transfer.
//   - Overlapping requests for one file are coalesced by the platform, so a
//     duplicate request is harmless while a transfer is active.
//   - Only a dehydrate aborts a transfer; dropping a request does not.
//
// So this keeps a live request as the ear for provider errors, polls
// attributes as the eye for completion, and re-issues a request on a
// timer as the restart nudge for a Windows-side cancel (a rolling window
// of two live requests, so a long wait cannot stack idle processes). An
// absolute timeout is the only end state left for a transfer the provider
// is holding without error, such as a client paused for hours.

export type HydrateWaitResult =
  | { outcome: 'local' }
  | { outcome: 'cancelled' }
  | { outcome: 'failed'; reason: string }

export interface HydrateWaitOptions {
  /** Checked every poll tick; true ends the wait with 'cancelled'. */
  isCancelled: () => boolean
  pollMs?: number
  renudgeMs?: number
  timeoutMs?: number
}

const POLL_MS = 2000
/** How often a fresh request is issued while the file is still offline. */
const RENUDGE_MS = 5 * 60 * 1000
/** Give up after this long. Generous: a slow NAS recalling several large
 *  files can legitimately run for hours. */
const TIMEOUT_MS = 6 * 60 * 60 * 1000
/** Live requests per file: the oldest is dropped when a new one is issued
 *  beyond this. Dropping a request does not touch the transfer. */
const MAX_LIVE_REQUESTS = 2

export async function waitForCloudFile(filePath: string, opts: HydrateWaitOptions): Promise<HydrateWaitResult> {
  const pollMs = opts.pollMs ?? POLL_MS
  const renudgeMs = opts.renudgeMs ?? RENUDGE_MS
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS

  const requests: HydrateRequest[] = []
  let providerFailure: string | null = null
  const issueRequest = () => {
    const live = requests.filter(r => r.alive)
    while (live.length >= MAX_LIVE_REQUESTS) live.shift()!.kill()
    const req = startHydrateRequest(filePath)
    requests.push(req)
    void req.result.then(res => {
      if (res.outcome === 'failed' && providerFailure === null) providerFailure = res.reason ?? 'unknown'
    })
  }
  const finish = (result: HydrateWaitResult): HydrateWaitResult => {
    for (const r of requests) r.kill()
    return result
  }

  const startedAt = Date.now()
  let lastRequestAt = startedAt
  issueRequest()

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
    if (now - startedAt >= timeoutMs) {
      return finish({
        outcome: 'failed',
        reason: `The download did not finish within ${Math.round(timeoutMs / 3600000)} hours. Check that the sync client is running and not paused, then requeue.`,
      })
    }
    if (now - lastRequestAt >= renudgeMs) {
      lastRequestAt = now
      issueRequest()
    }

    await new Promise(r => setTimeout(r, pollMs))
  }
}
