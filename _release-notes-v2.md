# Stream Manager 2.0

> Draft release notes — public delta v1.12.0 → v2.0.8 (~220 commits). Working doc: trim, reword, and split into GitHub-release + website copy as needed. Sections are ordered headline-first.

Stream Manager 2.0 is the biggest release since the app began: a built-in stream relay, full two-way YouTube sync, YouTube import, a rebuilt streams page, and a long reliability campaign that touched every corner of the app.

---

## ✨ Headline features

### Stream Relay
Route your encoder (OBS, etc.) through Stream Manager to YouTube — no more copying stream keys per broadcast.
- Local RTMP relay with one-time setup: point your encoder at `rtmp://localhost:1935/sm` and SM handles the rest.
- Automatically binds your stream to the next scheduled broadcast (or the channel default), takes it live, and completes it after a grace period when you stop.
- Live status widget in the sidebar: lifecycle stage, bitrate, duration, encoder speed.
- Post-stream, SM can auto-update your Twitch channel info toward the *next* scheduled stream (60s delay so third-party services tag the right broadcast).
- Guided first-run setup with stream-key auto-fill from your channel.

### Two-way YouTube sync
Your stream item and its YouTube video stay honestly in sync — and you always know when they're not.
- Per-field mismatch indicators (title, description, tags, category, privacy, thumbnail, broadcast time) that know *which side* changed.
- Push and pull per stream, plus an Out-of-Sync panel that sweeps the whole library.
- Thumbnail push for both livestream VODs and regular videos; privacy staged with the push; broadcast date/time sync with reschedule conflict handling.
- Built-in API quota tracker: estimates the day's usage, warns before you hit the wall, auto-clears at the Pacific-midnight reset, and throttles idle polling to stretch your quota.

### YouTube import & bulk-link
Bring an existing channel into Stream Manager in minutes.
- Import channel videos as stream items — metadata and thumbnail included, arriving already in-sync.
- Bulk-link matches your existing local folders to videos by date, with a per-row reconcile dropdown for the ambiguous ones.

### Template & metadata system
- Chip-based title and description editors with merge fields: `{topic}`, `{episode}`, `{total_episodes}`, `{season}`, `{tagline}`, `{date}`, `{season_links}` and more — with a live rendered preview of exactly what gets pushed.
- Title, description, and tag templates with per-platform defaults, game-tag→template links, and bulk auto-bind.
- Series support: season/episode auto-numbering (keyed to a stream's *primary* topic/game), previous/next episode navigation, `{season_links}` builds a linked episode list into descriptions.

### Twitch publishing
- Push title, category, and tags to Twitch — with a category picker independent of the YouTube game.
- In-sync detection, tag chip editor with templates, and a rename prompt when Twitch's category name differs from your tag.

---

## 🖥 Page-by-page

### Streams page (rebuilt)
- New list + detail-sidebar layout with a month calendar, search (`/`), and type/game filters.
- Tag-based multi-select and bulk actions: send to converter, archive, offload/pin, and more.
- Unified media grid in the sidebar: videos and images together, multi-select with range/keyboard support, per-file actions.
- Live processing spinner on just-ended streams until YouTube finishes encoding.
- **Targeted refreshes**: a change to one stream now updates only that row — no more full-page thumbnail flashes when a file lands or a conversion finishes.
- Smooth with large libraries (200+ items).

### Player
- Multi-track audio playback and extraction (extracted files carry the track number + name).
- Clip drafts: mark regions, crop, bleep, and export through the converter — drafts persist per stream, exported clips are tagged with their source (and a provenance marker that survives file moves).
- Session Videos panel: every video in the stream's folder one click away, clips nested under their source, full metadata on hover.
- Recents on the empty state, cloud-aware opening (hydration check + progress before playback).

### Thumbnail editor
- Multi-shadow stacks and outline effects, image filters with double-click-to-reset sliders, merge-field text layers.
- Thumbnail variants per stream, template library, paste-from-clipboard, YouTube thumbnail picker.
- Robust multi-layer editing: ctrl/shift selection (canvas and layers list), rigid group moves with proper snapping, reliable undo/redo.
- Missing-font protection: if a text layer's font isn't installed, the editor warns you and pauses image export so a substitute font can never silently overwrite your thumbnail.

### Converter
- Overhauled presets (including HandBrake import), per-file output settings, queue UI with ETA, and a global concurrency cap.
- Honest job controls: pause/resume that actually suspend the encode, safe cancels, collision-proof output names.
- Archive (convert-and-replace) pipeline with a crash-safe backup swap — the original is never at risk.

### Combine
- Compatibility gate blocks combinations that would produce a broken file (codec/resolution/audio-layout mismatches) and advises on frame-rate drift.
- Cancellable runs, in-use protection on source files, nav activity indicator.

### Launcher
- Launch groups for your pre-stream routine — apps *and* websites/URLs in one click.
- Full-width list with a sliding detail sidebar; per-app error chips when something fails to launch (no more silent Windows dialogs).

### Cloud sync (Windows Cloud Files / Synology / OneDrive / Dropbox)
- Offload streams to the cloud and pin them back from inside SM, with live per-file status icons everywhere.
- Selected thumbnails are protected from offload so your stream list always renders.
- Failures surface with real reasons instead of failing silently.

### AI assistance (Claude)
- Inline suggestions (Ctrl+Space) for titles, taglines, descriptions, and tags — grounded in the stream's own context (topic, tags, previous taglines).
- Model selection from the models your API key can access.

---

## 🧰 Reliability & foundation

- **Your metadata is safe**: `_meta.json` writes are atomic and crash-safe, with rolling backups, automatic restore, and a hard refusal to write over a failed read.
- Offline detection with honest connection banners and cached status badges; integrations reflect real connectivity, live.
- Auto-rules: verified single-writer file operations, cancellable in-flight operations, quit protection — and recordings that cross midnight now land in the previous day's stream item.
- Sessions that span midnight are also handled in bulk-link date matching.
- Consistent custom tooltips everywhere (with keyboard shortcuts surfaced), edge-aware positioning.
- Countless "honest error" fixes: anything that fails now says so, in the UI, with the actual reason.

---

## 🛠 Under the hood

- Electron 34, Vite 7 toolchain, dependency audit cleared.
- Scoped `streams:changed` event pipeline (per-stream reloads, per-path write-echo registry) — less I/O, no redundant rescans.
- Idle-polling throttles and render memoization for large libraries.

## ⚠️ Notes / compatibility

- Windows is the supported platform for 2.0.
- Existing libraries upgrade in place; no migration steps required. (`_meta.json` gains fields but stays backward-compatible.)
- Dump-folder mode remains supported but second-class — folder-per-stream is the recommended layout and some newer features (import, bulk-link, scoped refreshes) are folder-mode only.
