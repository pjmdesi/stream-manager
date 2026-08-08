# Release test checklist — v2.3.0 (2026-08-07)

Build: Stream Manager 2.2.0_DEV.exe from dev @ 02173a9

## This batch (combine overhaul + app-wide)

- [ ] Combine jobs: sending a stream's videos makes a job card with its title link + date; sending the same stream again merges (no duplicate job, no duplicate files); a different stream makes a second job; each external drop (page-level zone or empty state) starts its own job labeled by its folder
- [ ] Rich rows: thumbnail, mono filename, stream link (opens the stream's sidebar), detail chips (codec, resolution, fps, audio layout, size) filling in as probes land; labeled Started/Duration columns (Started tooltip explains auto-sort); Auto-sort tooltip on the job header button
- [ ] Mismatch surfacing: incompatible files show the red table in the job (one row per file, one column per differing property) and the differing chips turn red in the rows (amber for frame-rate-only drift, which stays combinable); Combine disables on hard mismatches
- [ ] Reorder within a job: insertion line between rows (wraps with its row, centered in the gap), no line at no-op positions or beside the dragged row, dropping on the line works, no cancel-cursor flicker
- [ ] Cross-job drag: dragging a row to another job shows the line at the target slot and moves the file (stream link intact); dragging a job's last own-stream file out while foreign files remain → orphan warning + Combine disabled (drag back clears it); dropping a duplicate path onto a job that has it does nothing; finished/running jobs refuse drops; an emptied job keeps only Remove job active and refills via row drags or its drop zone
- [ ] Per-job options: output path defaults to the generating stream's folder (survives foreign files joining) and uniquifies past existing outputs; hand-typed paths survive adds/moves; delete-after checkbox per job; while one job combines, other jobs' Combine buttons disable with the "one at a time" tooltip
- [ ] In-progress output row: spinner + output filename in the footer slot, live purple bar, percent / Elapsed / ETA line, output directory click opens Explorer; Pause suspends ffmpeg (CPU drops in Task Manager), bar turns yellow, elapsed freezes; Resume continues; Cancel (Ban icon, converter styling) removes the partial output and shows the cancelled notice; 15s at 0% flips "Starting" to the amber no-progress notice
- [ ] Cloud gate: combine a job with an offloaded source → blue "Downloading from cloud" phase (no pause offered, progress in the cloud widget), ffmpeg starts only once everything is local; cancelling during the download aborts the run (downloads continue in the queue)
- [ ] Completed job: done row replaces the options footer (green check, output filename, real metadata chips, filled bar, 100%/Elapsed/output-dir line, no redundant remove button); source rows stay as a read-only record (no grips, no per-row remove, links still work); with delete-after the trashed files gray out with struck names (per file); header shows "· done" and the button reads Clear job; sending new files to a finished job starts it over with a fresh _2 output default
- [ ] Combine failure: a failed run's error message includes ffmpeg's actual output (last stderr lines), not just an exit code
- [ ] Nav highlight: Combine nav item lights while jobs exist (including a finished job), clears when the page empties
- [ ] Update check (app-wide): leave a dev build running past the 6-hour cache expiry → the update bubble can appear without a restart (or at minimum verify the launch check still works)
- [ ] Hydration thumbnails (app-wide): add a dehydrated file to a combine/converter list → after the download finishes its thumbnail appears without remounting the page
- [ ] Combined provenance (2026-08-08): run a NEW combine → the output shows in the files grid with the orange Combined border+tag (not Recording) and a Combine icon in its meta line; the grid's collapsed summary counts it as "N combined"; the stream row's video counter includes it; send-to-player prefers it like a recording; NOTE outputs combined before this build keep classifying as recordings (no stamp, cached probe) — expected

## Core regression (every release)

- [ ] Relay: full lifecycle on a real or test stream — bind → ingest → live → complete; post-stream Twitch auto-update fires (60s delay)
- [ ] Watcher/auto-rules: drop a recording into the watch folder → lands in the right stream item
- [ ] New stream + New episode: correct season/episode, templates render
- [ ] YouTube: push + pull a stream's details; thumbnail push; out-of-sync panel clean afterward
- [ ] Converter: one job start→finish; pause/resume; output plays
- [ ] Player: open a video, clip draft → export
- [ ] Thumbnail editor: open, edit, export; variant creation
- [ ] Cloud: pin local + offload one item; statuses update everywhere
- [ ] Launcher: run a launch group (window + tray)
- [ ] Quit/relaunch: no orphaned processes, state restored
