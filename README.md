# Stream Manager

A desktop app for streamers to manage, review, and process their local recording files. Built with Electron + React.

> 100% vibe-coded with [Claude](https://claude.ai) (Anthropic) — every line of code in this project was written through conversation with Claude Code (I only made the crappy logo lol). Think of that what you will, but the result is a fully functional Electron app that meets my requirements for a personal stream management tool. I’m sharing it here in case it can be useful to other streamers with similar needs. It cost me about $30 and about 2 days of back-and-forth with Claude Code to build. I hope it can save other streamers time and money by providing a ready-made solution for managing their local stream recordings.

---

## Features

### Streams
The main hub. Points at your streams folder and shows every stream session as a row with:
- Thumbnail preview (click to open lightbox)
- Video file count with a hover tooltip listing filenames and durations
- Date, games played, and freeform comments
- Archived status badge
- Per-row actions: send to Player, send to Converter, send to Combine, edit metadata, open folder

**Select mode** lets you multi-select sessions and archive them in bulk using a conversion preset. Sessions that have already been compressed externally can be stamped as archived without re-encoding.

### Video Player
Drop or browse to any video file and play it back. Multi-track audio (common in OBS recordings) is handled explicitly:
- Only the first audio track plays natively — this is a Chromium limitation
- The sidebar lists all detected tracks; select which ones to merge together
- "Merge audio tracks" extracts selected tracks in the background and mixes them into the player with per-track sync
- Merged audio is cached to disk (up to a configurable limit) so repeat opens are instant
- Undo merge to re-select a different combination

### Converter
Queue video files for conversion using ffmpeg presets or external `.bat` scripts. Presets can be imported from a folder of `.bat` files and are available across the app (e.g. as the archive preset).

### Combine
Concatenate multiple video files into one with zero re-encoding (ffmpeg concat demuxer). Files are auto-sorted by timestamp parsed from OBS-style filenames, and can be manually reordered by drag-and-drop. Optionally deletes the source files after a successful combine.

### Auto-Rules *(coming soon)*
File watcher rules that automatically move, copy, or rename files matching a pattern when they appear in a watched folder.

### Settings
- **Streams directory** — root folder scanned for stream sessions
- **Default archive preset** — preset used when archiving sessions
- **Default thumbnail template** — image copied as the thumbnail placeholder on new session creation
- **BAT presets directory** — folder of `.bat` conversion scripts to import
- **Audio cache** — storage limit for merged audio track cache, with current usage display and a clear button

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

| Layer | Technology |
|---|---|
| Framework | [Electron](https://www.electronjs.org/) 28 |
| UI | [React](https://react.dev/) 18 + [TypeScript](https://www.typescriptlang.org/) |
| Styling | [Tailwind CSS](https://tailwindcss.com/) 3 |
| Font | [Recursive Variable](https://www.recursive.design/) (Google Fonts) |
| Icons | [Lucide React](https://lucide.dev/) |
| Video processing | [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) + [fluent-ffmpeg](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg) |
| Bundler | [electron-vite](https://electron-vite.github.io/) |
| Packaging | [electron-builder](https://www.electron.build/) |

---

## Project Structure

```
src/
├── main/               # Electron main process
│   ├── ipc/            # IPC handlers (video, files, streams, combine, converter, store)
│   └── services/       # ffmpeg service, audio cache manager, file watcher
├── preload/            # Context bridge — exposes API to renderer
└── renderer/           # React app
    └── src/
        ├── components/
        │   ├── pages/  # StreamsPage, PlayerPage, ConverterPage, CombinePage, …
        │   └── ui/     # Button, Modal, Slider, FileDropZone
        ├── hooks/      # useVideoPlayer, useStore
        └── types/      # Shared TypeScript interfaces
```

---

## Notes

- Audio cache is stored in the system temp directory under `stream-manager/audio-cache/`
- The app stores its configuration via `electron-store` (persisted in the OS app data folder)
- The portable build includes ffmpeg and ffprobe binaries — no system installation of either is required
