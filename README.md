# Stream Manager

A desktop app for streamers to manage, review, and process their local recording files. Built with Electron + React.

> 100% vibe-coded with [Claude](https://claude.ai) (Anthropic) — every line of code in this project was written through conversation with Claude Code (I only made the crappy logo lol). Think of that what you will, but the result is a fully functional Electron app that meets my requirements for a personal stream management tool. I'm sharing it here in case it can be useful to other streamers with similar needs. It cost me about $30 and about 2 days of back-and-forth with Claude Code to build. I hope it can save other streamers time and money by providing a ready-made solution for managing their local stream recordings.

---

## Features

### Streams

The main hub. Points at your streams folder and shows every stream session (one folder per date) as a row with:

- Thumbnail preview (click to open lightbox)
- Video file count with a hover tooltip listing filenames and durations — cloud-synced offline files are detected and skipped so they aren't downloaded just to be read
- Date, games played, stream type, and freeform comments
- Archived status badge
- Per-row actions: send to Player, send to Converter, send to Combine, edit metadata, open folder, delete

**Select mode** lets you multi-select sessions and archive them in bulk using a conversion preset. Sessions compressed externally can be stamped as archived without re-encoding.

**Metadata** is stored in a single `_meta.json` file at the root of your streams directory rather than inside individual session folders, so taking folders offline (e.g. with a NAS sync client) doesn't affect the app's ability to read session information. Missing folders are detected on load and the user is prompted to remove stale records or keep them visible as warnings.

### Video Player

Drop or browse to any video file and play it back. Multi-track audio (common in OBS recordings) is handled explicitly:

- Only the first audio track plays natively — this is a Chromium limitation
- All detected audio tracks are listed; select which ones to extract and mix together
- Extracted audio is cached to disk so repeat opens are instant
- Per-track volume and mute controls with per-track waveform visualisation (also disk-cached)

Playback controls:

- Play / pause, frame-step forward and back, and jump buttons (±1s, ±5s, ±10s)
- Clickable, editable timecode — type any H:MM:SS.FF value to seek directly, or use arrow keys to increment/decrement individual time segments (hours, minutes, seconds, frames)
- Thumbnail strip (200 frames generated and disk-cached on first load) for visual timeline scrubbing
- Progress bar with current position, hover preview position, and playhead indicators

### Converter

Queue video files for conversion using built-in or imported ffmpeg presets. Features:

- ETA and elapsed time (EMA-smoothed for stable estimates)
- Pause / resume / cancel per job
- Progress bar with paused state indicator
- Completed, cancelled, and error states with per-job clear buttons
- Presets stored as JSON and importable from a configured presets directory

### Combine

Concatenate multiple video files into one with zero re-encoding (ffmpeg concat demuxer). Files are auto-sorted by timestamp parsed from OBS-style filenames and can be manually reordered by drag-and-drop. Optionally deletes source files after a successful combine.

### Auto-Rules

File watcher rules that automatically move, copy, or rename files matching a glob pattern when they appear in a watched folder. Rules can be individually enabled/disabled. The watcher can be configured to start automatically on launch and is always accessible via the sidebar widget.

### YouTube & Twitch Integrations

- Update a live YouTube broadcast title, description, tags, and game title directly from the app
- Update Twitch channel title and category
- Title/description/tag template system for reusable formats with merge fields

### Settings

- Streams directory, default archive preset, default thumbnail template
- Presets directory for importing conversion presets
- Cache directory and storage limit with current usage display and clear button
- Auto-rules behaviour (auto-start watcher on launch)
- YouTube and Twitch OAuth credentials

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- npm

### Install & run

```bash
npm install
npm run dev
```

### Build portable executable (Windows)

```bash
npm run dist
```

Outputs a single portable `.exe` to `dist/` — no installation required, runs from anywhere.

> **Before building:** export `src/renderer/src/assets/stream-manager-logo.svg` as a 256×256 PNG and save it to `resources/icon.png`.

---

## Tech Stack

| Layer         | Technology                                                                     |
| ------------- | ------------------------------------------------------------------------------ |
| Framework     | [Electron](https://www.electronjs.org/) 28                                     |
| UI            | [React](https://react.dev/) 18 + [TypeScript](https://www.typescriptlang.org/) |
| Styling       | [Tailwind CSS](https://tailwindcss.com/) 3                                     |
| Icons         | [Lucide React](https://lucide.dev/)                                            |
| Video         | [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static)                   |
|               | [fluent-ffmpeg](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg)           |
| Persistence   | [electron-store](https://github.com/sindresorhus/electron-store)               |
| File watching | [chokidar](https://github.com/paulmillr/chokidar)                              |
| Bundler       | [electron-vite](https://electron-vite.github.io/)                              |
| Packaging     | [electron-builder](https://www.electron.build/)                                |

---

## Project Structure

```text
src/
├── main/               # Electron main process
│   ├── ipc/            # IPC handlers (video, files, streams, combine, converter, store, …)
│   └── services/       # ffmpeg, cache managers (audio, thumbnail, waveform), file watcher
├── preload/            # Context bridge — exposes typed API to renderer
└── renderer/           # React app
    └── src/
        ├── components/
        │   ├── pages/  # StreamsPage, PlayerPage, ConverterPage, CombinePage, …
        │   └── ui/     # Button, Modal, Slider, Input, FileDropZone
        ├── context/    # ConversionContext, WatcherContext
        ├── hooks/      # useVideoPlayer, useStore, useThumbnailStrip, useWaveform
        └── types/      # Shared TypeScript interfaces
```

---

## Notes

- Session metadata is stored in `_meta.json` at the root of your streams directory (hidden file)
- Audio, thumbnail, and waveform caches are stored under the system temp directory in `stream-manager/`
- App configuration is persisted via `electron-store` in the OS app data folder
- The portable build bundles ffmpeg and ffprobe — no system installation required
- The app is Windows-focused (cloud file attribute checks, portable `.exe` build target) but the core logic is cross-platform

---

## License

[MIT](LICENSE)
