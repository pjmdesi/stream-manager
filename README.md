# Stream Manager

<img src="resources/icon.png" width="48" alt="Stream Manager icon" /> A desktop app for streamers to manage, review, and process their local recording files. Yet another app built with Electron + React. Windows only (for now), feel free to adapt this to other platforms if you're so inclined. Contributions are welcome.

![Stream Manager screenshot](resources/stream-manager-screenshot.png)

> Vibe-coded with [Claude](https://claude.ai) (Anthropic) — this project was written through conversation with Claude Code (I only made the crappy logo and some text adjustments). Think of that what you will, but the result is a fully functional Electron app that meets my requirements for a personal stream management tool. I'm sharing it here in case it can be useful to other streamers with similar needs. I hope it can save other streamers time and money by providing a free, ready-made solution for managing their streams.

---
- [Stream Manager](#stream-manager)
  - [Getting Started (as a user)](#getting-started-as-a-user)
  - [Recommended Usage Flow](#recommended-usage-flow)
  - [Features](#features)
    - [Streams](#streams)
    - [Video Player](#video-player)
    - [Converter](#converter)
    - [Auto-Rules](#auto-rules)
    - [YouTube \& Twitch Integrations](#youtube--twitch-integrations)
  - [Getting Started (as a dev)](#getting-started-as-a-dev)
    - [Prerequisites](#prerequisites)
    - [Install \& run](#install--run)
    - [Build portable executable (Windows)](#build-portable-executable-windows)
  - [Tech Stack](#tech-stack)
  - [Project Structure](#project-structure)
  - [License](#license)
---

## Getting Started (as a user)

1. Download the latest release for Windows from the [Releases](https://github.com/your-repo/Stream-Manager/releases) page.
2. Extract the ZIP file and run `StreamManager.exe` (no installation required, runs from anywhere, can be moved freely. Data is stored on your machine in a safe place).
3. On first launch, you'll be prompted to select your main "Streams" folder where your recordings are stored. This is where the app will automatically detect and organize your stream sessions. You can change this folder later in settings if needed.
   * You can choose between 2 modes: **Dump mode** (all files are stored in the root of the selected folder) or **Folder-per-stream mode** (each stream session gets its own subfolder).
   * I recommend **Folder-per-stream mode** for better organization and to avoid clutter, but the app supports both.
   * If you choose **Dump mode**, the app will still be able to detect and group your recordings based on their filenames, but all files will remain in a single folder.
   * You can choose to update an existing **dump** folder structure to match the **folder-per-stream** format during setup.

---

## Recommended Usage Flow

1. Before you stream, click the "New Stream" button to initialize a new stream session folder with the date-based naming format (defaulting to the present date at time of creation). This will help the app automatically detect and group your recordings and assets later on. Here, you can also send title, description, tags, and game info updates to YouTube and Twitch if you have those integrations set up. Those will also be saved as metadata for the stream session and can be edited later.

   ![Stream Manager New Stream Button Screenshot](resources/stream-manager-new-stream-button.png)
2. Set your streaming software (OBS, Streamlabs, etc.) to save recordings to a designated "Raw Recordings" folder. This is important if you use cloud-sync software like Synology Drive NAS, OneDrive, or Google Drive to backup your streams. Recording directly to a cloud-synced folder can cause encoding errors and ruin recordings.

   ![OBS Output Settings Screenshot](resources/obs-recording-output.png)
3. Set up an auto-rule in the app to watch that folder and move/rename new files to your main "Streams" folder in the OBS date-based format that the app recognizes. I recommend keeping the app open while streaming so the watcher can automatically organize your recordings as soon as they are created by OBS, but you can also open the app after your stream and it will detect any new files and automatically organize them for you (if you have the auto-start file watcher setting enabled).

    ![Stream Manager Auto-Rules Screenshot](resources/stream-manager-auto-rules-setup.png)
4. _**Stream your heart out!**_
5. After your stream, the app will have automatically organized your recordings. Find the session in the Streams page and optionally add any missing metadata like games played, stream type, and comments to help you remember the details of each session.
6. Optionally review the recording in the built-in player and export clips for sharing on social media or YouTube, or send the whole session to the converter to compress it for other uses like archiving or uploading to other services.

## Features

### Streams

The main hub for browsing and managing local recordings of your stream sessions. Video files, thumbnails, and other related assets in your designated folder are scanned and grouped automatically:

- Auto-detection of stream files (video and thumbnails) from date-based naming conventions (the default OBS format).
- Custom tagging and metadata — games played, stream type, and freeform comments.
- Batch archive processing — multi-select sessions and compress the video files inside in bulk using a conversion preset.
- Cloud-sync aware — offline files (Synology Drive, OneDrive, DropBox, Google Drive, etc.) are detected and certain features are skipped to prevent unwanted bulk downloads.

**Metadata** is stored in a single `_meta.json` file at the root of your streams directory, so stream info is maintained and validated separately from the files themselves. Missing folders are detected on load and the user is prompted to confirm updates (in case you made changes outside of the app).

### Video Player

Drop or browse to any video file and play it back with a visual thumbnail and waveform track for rich scrubbing info. Multi-track audio (common in OBS recordings) is explicitly supported. Review, clip, and export stream sessions with precision using these tools:

- **Single-click screenshot capture** — capture a screenshot at the current playback position and save it as a PNG file. The file is named with the original video filename plus the timestamp and saved to the same folder as the video for easy reference or making thumbnails.
- **Multi-track audio support** — if multiple audio tracks are detected, the user can choose to merge them into a single track for easier playback and clipping (Chromium limits audio playback from a video file to only one track at a time). Merged audio is temporary, so it won't clutter your folders.
- **Thumbnail strip** — extracted from the video at 10-second intervals to provide visual cues while scrubbing. Cached to disk for performance and persistence across sessions.
- **Waveform display** — full-file audio waveform rendered as a zoomable strip. Raw PCM is sampled at 200 Hz and cached to disk; the visible range is re-bucketed to 1,200 peaks on the fly so detail stays sharp at any zoom level.
- **Clip mode** — set in/out points and export a clip directly from the player. If multi-track audio has not been merged yet, the app warns and offers to merge before entering clip mode
- **Bleep markers (clip mode)** — mark regions to be bleeped (censored) or silenced while clipping and in the exported file. Control bleep volume from silent (mutes all other audio) to 1.5× (shared across all markers).
- **Video pop-out for OBS** — pop the video into a dedicated frameless window sized to the video's native resolution. Streaming software like OBS can then capture that window independently. The pop-out locks its aspect ratio on resize and has no rounded corners. All playback controls from the main window (play/pause, seek, skip, timecode input) continue to work on the pop-out player.

### Converter

Queue video files for conversion using ffmpeg presets. Easily visualize progress with the sidebar widget while doing other tasks in-app. Presets can be imported from exported HandBrake preset files (JSON) or created manually if you're crazy.

- **Conversion presets** — Presets I've personally found useful are included out of the box. New presets can be imported from other apps such as HandBrake (JSON format) or created manually if you're adventurous.
  - "Archive" preset with h.264 video and 128 kbps mono audio for long-term storage of stream sessions with good quality and smaller file sizes.
  - "Upload" preset with h.264 video and 320 kbps stereo audio for clips intended for sharing on social media or YouTube.
- **Batch processing** — add as many files to the queue as you want, and the app will process them one at a time. Progress is visualized in the sidebar widget, and you can continue using other features of the app while conversions are running in the background.
- **Auto-archiving** — optionally send stream sessions to the converter with the "Archive" preset directly from the Streams page. This is a great way to quickly compress and organize your stream recordings without having to manually add them to the converter.
- **Remuxing support** — Like the OBS "Remux Recordings" feature, the app can quickly change a video's container format (e.g. from MKV to MP4) without re-encoding, as long as the video and audio codecs are compatible. This is great for making your recordings more widely compatible without losing quality or spending time on a full conversion or having to open OBS.
- **Combine tool** — concatenate multiple video files into one with zero re-encoding using ffmpeg's concat demuxer. Files are auto-sorted by timestamp parsed from OBS-style filenames and can be manually reordered by drag-and-drop. Optionally deletes source files after a successful combine. This is useful for streamers who have their recordings split into multiple files due to file size limits or accidental stops/starts, and want to easily merge them back together without losing quality or having to open OBS.

### Auto-Rules

File watcher rules that automatically move, copy, or rename files matching a glob pattern when they appear in a watched folder. Rules can be individually enabled/disabled. The watcher can be configured to start automatically on launch and is always accessible via the sidebar widget. This is useful for streamers who want to automate the organization of their recordings as soon as they are created by their streaming software, without having to manually move files around or run batch processes. For instance if you drop your recordings into a "Raw Recordings" folder, you can set up a rule to automatically move them to your main "Streams" folder and rename them to match the OBS date-based format that the app recognizes. The app with then automatically pick them up and add them to your stream library with the correct metadata.

### YouTube & Twitch Integrations

- Update a live YouTube broadcast title, description, tags, and game title directly from the app.
- Update Twitch channel title and category.
- Separate templates for titles, descriptions, and tags for reusable formats with merge fields.

---

## Getting Started (as a dev)

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
| Framework     | [Electron](https://www.electronjs.org/) 34                                     |
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
├── main/                       # Electron main process
│   ├── ipc/
│   │   ├── combine.ts          # Concat-demux pipeline
│   │   ├── converter.ts        # ffmpeg conversion queue
│   │   ├── files.ts            # File system operations
│   │   ├── store.ts            # App config persistence
│   │   ├── streams.ts          # Stream folder management
│   │   ├── templates.ts        # Folder template engine
│   │   ├── twitch.ts           # Twitch API integration
│   │   ├── video.ts            # Playback, waveform, thumbnails
│   │   ├── videoPopup.ts       # OBS pop-out window (frameless, aspect-locked)
│   │   └── youtube.ts          # YouTube API integration
│   └── services/
│       ├── audioCacheManager.ts      # Extracted track cache
│       ├── ffmpegService.ts          # ffmpeg/ffprobe wrappers
│       ├── fileWatcher.ts            # chokidar-based auto-rules watcher
│       ├── tempManager.ts            # Temp file lifecycle
│       ├── thumbnailCacheManager.ts  # Per-file thumbnail cache
│       ├── twitchApi.ts / twitchAuth.ts
│       ├── waveformCacheManager.ts   # Binary PCM waveform cache
│       └── youtubeApi.ts / youtubeAuth.ts
├── preload/
│   ├── index.ts        # Context bridge — exposes typed api to renderer
│   └── popup.ts        # Context bridge for the video pop-out window
└── renderer/
    ├── index.html
    ├── popup.html              # Minimal shell for the video pop-out
    └── src/
        ├── popup.ts            # Pop-out player logic (vanilla TS, no React)
        ├── components/
        │   ├── OnboardingModal.tsx
        │   ├── pages/
        │   │   ├── PlayerPage.tsx    # Video player, waveform, clip mode, bleep markers
        │   │   ├── StreamsPage.tsx   # Stream session browser
        │   │   ├── ConverterPage.tsx
        │   │   ├── CombinePage.tsx
        │   │   ├── RulesPage.tsx     # Auto-rules / file watcher
        │   │   ├── SettingsPage.tsx
        │   │   ├── TemplatesPage.tsx
        │   │   └── YouTubePage.tsx
        │   └── ui/             # Button, Modal, Slider, Input, FileDropZone
        ├── context/            # ConversionContext, WatcherContext
        ├── hooks/
        │   ├── useVideoPlayer.ts     # Playback, seek throttling, multi-track sync
        │   ├── useWaveform.ts        # PCM re-bucketing, SVG path generation
        │   ├── useThumbnailStrip.ts
        │   └── useStore.ts
        └── types/              # Shared TypeScript interfaces
```

---

## License

[MIT](LICENSE)
