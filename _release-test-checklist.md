# Pre-Release Test Checklist

Covers everything since the last **public** release (v1.12.0) through the current internal build (v1.28.2) — ~89 commits. Plan: ~2 weeks, ~4 real streams, marking items off and logging any issues at the bottom.

Legend: `- [ ]` = not yet confirmed · `- [x]` = confirmed working · add `⚠` + a note for anything flaky.

---

## 1. Streaming-day critical path (exercise every stream — most important)

- [x] App launches cleanly; window controls sit correctly on the **first** frame (no shift after load)
- [ ] YouTube stays connected across days / token refreshes without re-auth
- [ ] Twitch stays connected / token refreshes without re-auth
- [ ] Relay: broadcast picker selects the intended broadcast (scheduled vs. the persistent default)
- [ ] Relay: stream binds + transitions to **live** on YouTube reliably
- [ ] Relay: monitor-stream / health shows correct status while live
- [ ] Relay: stream ends → broadcast transitions to **complete** after the grace period
- [ ] Relay: a dropped/reconnected encoder is handled without killing the broadcast
- [ ] Post-stream **Twitch auto-update to the next broadcast** fires (now +60s delay) — confirm 3rd-party services tag it to the *new* broadcast, not the previous one *(your existing to-check item)*
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

- [ ] Import: picker lists channel videos; Shorts, the default broadcast, and drafts are handled sensibly
- [ ] Import creates stream items with metadata **+ thumbnail**, marked in-sync (no false mismatch dots, thumbnail not flagged)
- [ ] Bulk-link: matches unlinked folders to videos by date; the per-row reconcile dropdown works
- [ ] Link "pull metadata (overwrite)" toggle + the existing-thumbnail handling behave
- [ ] Completion summary screens show for both import and link
- [ ] Both are disabled in dump-mode

## 5. Streams list & detail sidebar

- [ ] Sidebar open/close animation is smooth (the perf work)
- [ ] Cloud-status icons on file cards appear **instantly** on reopen (no spinner / re-check)
- [ ] Tag-based multi-select: clicking a type/game chip selects all matching; Ctrl-click deselects
- [ ] Selected rows are clearly distinguishable (brighter, keep their category hue)
- [ ] Multi-select bulk actions (send-to-converter, archive, etc.)
- [ ] Files grid: thumbnails load; multi-select (range, shortcuts); per-file actions
- [ ] Unified media grid (videos + images together)
- [ ] Series prev/next-episode navigation; month-calendar empty state
- [ ] Search field (the `/` hint stays visible with the sidebar open) + type/game filters
- [ ] Italic "detected-from-filename" game tags are **gone** everywhere (detection removed)
- [ ] A large library (200+ items) opens / scrolls without lag

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

- [ ] Editor: layers, arrow-key nudge, multi-shadow / outline, paste image
- [ ] Carousel: set-as-thumbnail (bookmark icon), delete
- [ ] YouTube thumbnail picker
- [ ] Filter slider double-click-to-reset

## 9. Launcher

- [ ] Launch groups run apps **and** website/URL items
- [ ] Full-width list + sliding detail sidebar; selected-row edge indicator
- [ ] Launch behaves across a real pre-stream routine

## 10. Cloud sync (Synology)

- [ ] Offload (dehydrate) a stream's files
- [ ] Pin-local (hydrate) — files download and metadata re-reads (duration/codec/thumbnail)
- [ ] Cloud status icons accurate (CloudCheck = local, Cloud = offloaded)
- [ ] No renderer hang on cloud-placeholder files

## 11. AI (Claude)

- [ ] Model selection
- [ ] Tag / tagline / description suggestions, grounded in the stream's context

## 12. App shell / foundational

- [ ] Tray menu reflects current state (not stale)
- [ ] Settings; unsaved-changes nav-guard
- [ ] Quota tracker estimate looks right; auto-clears at PT midnight
- [ ] Keyboard shortcuts work (and are surfaced in button tooltips)
- [ ] Tooltips position correctly near screen edges (no flipping below the trigger)
- [ ] Portable build runs from its expected path

## 13. Recently fixed — watch for regressions

- [ ] Window-control buttons don't shift on launch (splash alignment)
- [ ] Delete-button tooltip stays **above** the button
- [ ] Search `/` hint isn't clipped when the sidebar is open
- [ ] Thumbnail push to a relinked regular video succeeds (no "Live broadcast not found")

---

## Issues log

> date · stream # · area · what happened

-
