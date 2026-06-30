# Pre-Release Test Checklist

Covers everything since the last **public** release (v1.12.0) through the current internal build (v1.28.2) — ~89 commits. Plan: ~2 weeks, ~4 real streams, marking items off and logging any issues at the bottom.

Legend: `- [ ]` = not yet confirmed · `- [x]` = confirmed working · add `⚠` + a note for anything flaky.

---

## 1. Streaming-day critical path (exercise every stream — most important)

- [x] App launches cleanly; window controls sit correctly on the **first** frame (no shift after load)
- [x] YouTube stays connected across days / token refreshes without re-auth
- [x] Twitch stays connected / token refreshes without re-auth
- [x] Relay: broadcast picker selects the intended broadcast (scheduled vs. the persistent default)
- [x] Relay: stream binds + transitions to **live** on YouTube reliably
- [x] Relay: monitor-stream / health shows correct status while live
- [x] Relay: stream ends → broadcast transitions to **complete** after the grace period
- [ ] Relay: a dropped/reconnected encoder is handled without killing the broadcast
- [x] Post-stream **Twitch auto-update to the next broadcast** fires (now +60s delay) — confirm 3rd-party services tag it to the *new* broadcast, not the previous one *(your existing to-check item)*
- [ ] Across all ~4 streams: going live + ending left **no errors** in the console

## 2. Stream metadata & YouTube publishing

- [ ] Create a stream item; metadata persists to `_meta.json` and reloads correctly
- [ ] Chip title editor: merge fields render right — `{game}`, `{episode}`, `{total_episodes}`, `{topic}`/`{topics}`, dates
- [ ] Rendered title preview matches what actually gets pushed
- [ ] Description chip editor + inline merge-field picker
- [ ] Push to YouTube: title / description / tags / category all land
- [ ] Push **thumbnail** to YouTube — both a **livestream** VOD and a **regular video** (incl. a re-upload that replaced a deleted livestream → should no longer error)
- [ ] Push **privacy** (public / unlisted / private) — both broadcast and regular-video paths
- [ ] Out-of-sync panel: per-field mismatch dots (local / remote / both) are accurate
- [ ] Pull-from-YouTube (overwrite local) works
- [ ] Broadcast date/time sync — push, pull, and the reschedule conflict modes
- [ ] Linked-broadcast privacy/time row: **no layout jump** on open; shows "Loading…" then the real value
- [ ] **Processing spinner** appears on a just-ended stream and clears once YouTube finishes processing *(your post-stream to-check)*

## 3. Twitch publishing

- [ ] Push to Twitch: title + category + tags
- [ ] Independent Twitch **category** picker (separate from the YouTube game)
- [ ] Twitch in-sync detection + post-push category-rename prompt
- [ ] Twitch tag chip editor

## 4. YouTube import & bulk-link  *(biggest new feature)*

- [x] Import: picker lists channel videos; Shorts, the default broadcast, and drafts are handled sensibly
- [x] Import creates stream items with metadata **+ thumbnail**, marked in-sync (no false mismatch dots, thumbnail not flagged)
- [x] Bulk-link: matches unlinked folders to videos by date; the per-row reconcile dropdown works
- [x] Link "pull metadata (overwrite)" toggle + the existing-thumbnail handling behave
- [x] Completion summary screens show for both import and link
- [ ] Both are disabled in dump-mode

## 5. Streams list & detail sidebar

- [x] Sidebar open/close animation is smooth (the perf work)
- [x] Cloud-status icons on file cards appear **instantly** on reopen (no spinner / re-check)
- [x] Tag-based multi-select: clicking a type/game chip selects all matching; Ctrl-click deselects
- [x] Selected rows are clearly distinguishable (brighter, keep their category hue)
- [x] Multi-select bulk actions (send-to-converter, archive, etc.)
- [x] Files grid: thumbnails load; multi-select (range, shortcuts); per-file actions
- [x] Unified media grid (videos + images together)
- [x] Series prev/next-episode navigation; month-calendar empty state
- [x] Search field (the `/` hint stays visible with the sidebar open) + type/game filters
- [x] Italic "detected-from-filename" game tags are **gone** everywhere (detection removed)
- [x] A large library (200+ items) opens / scrolls without lag

## 6. Converter

- [ ] Presets + per-file output settings
- [ ] Queue UI + ETA widget; concurrent-conversion cap holds
- [ ] Send to converter — whole stream **and** an individual file
- [ ] Extracted-audio filename includes the track number + name
- [ ] Exported clips carry the container/provenance marker
- [ ] No failed or stuck jobs across the test period

## 7. Player

- [ ] Playback + multi-track audio
- [ ] Session Videos panel switches between videos in the same folder
- [ ] Send-to-Player hydration check (spinner) for cloud files, then opens
- [ ] Clip export

## 8. Thumbnails

- [x] Editor: layers, arrow-key nudge, multi-shadow / outline, paste image
- [x] Carousel: set-as-thumbnail (bookmark icon), delete
- [x] YouTube thumbnail picker
- [x] Filter slider double-click-to-reset

## 9. Launcher

- [x] Launch groups run apps **and** website/URL items
- [x] Full-width list + sliding detail sidebar; selected-row edge indicator
- [x] Launch behaves across a real pre-stream routine

## 10. Cloud sync (Synology)

- [x] Offload (dehydrate) a stream's files
- [x] Pin-local (hydrate) — files download and metadata re-reads (duration/codec/thumbnail)
- [x] Cloud status icons accurate (CloudCheck = local, Cloud = offloaded)
- [x] No renderer hang on cloud-placeholder files

## 11. AI (Claude)

- [x] Model selection
- [x] Tag / tagline / description suggestions, grounded in the stream's context

## 12. App shell / foundational

- [ ] Tray menu reflects current state (not stale)
- [x] Settings; unsaved-changes nav-guard
- [x] Quota tracker estimate looks right; auto-clears at PT midnight
- [x] Keyboard shortcuts work (and are surfaced in button tooltips)
- [x] Tooltips position correctly near screen edges (no flipping below the trigger)
- [x] Portable build runs from its expected path

## 13. Recently fixed — watch for regressions

- [x] Window-control buttons don't shift on launch (splash alignment)
- [x] Delete-button tooltip stays **above** the button
- [x] Search `/` hint isn't clipped when the sidebar is open
- [x] Thumbnail push to a relinked regular video succeeds (no "Live broadcast not found")

---

## Issues log

> date · stream # · area · what happened

-
