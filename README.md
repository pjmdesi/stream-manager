# <img src="resources/icon.png" width="36" alt="Stream Manager icon" /> Stream Manager

**Website:** [stream-manager.app](https://stream-manager.app/) · **Discord:** [Join the community](https://discord.gg/ufMSh9d8hu)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Latest Release](https://img.shields.io/github/v/release/pjmdesi/stream-manager)](https://github.com/pjmdesi/stream-manager/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/pjmdesi/stream-manager/total)](https://github.com/pjmdesi/stream-manager/releases)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows-blue)](https://github.com/pjmdesi/stream-manager#)

A desktop app for streamers to manage, review, and process their local recording files. Yet another app built with Electron + React. Windows only (for now), feel free to adapt this to other platforms if you're so inclined. Contributions are welcome.

## Mission

Stream Manager is designed to be the central hub for everything pre- and post-stream. It organizes your raw files, metadata, clips, and workflow in one place so you can spend less time wrangling files and more time creating content. If used in the recommended way, you should never have to open your file explorer again to manage your stream-related files.

## Who this is for

- Streamers who record and store their streams locally and want a better way to manage those files and related metadata.
- Streamers who stream to YouTube and/or Twitch and want an easier way to keep their stream metadata in sync with their local files.
- Streamers who want a built-in tool for clipping and thumbnail creation without needing to use separate apps like Premiere, DaVinci, HandBrake, Photoshop, Affinity, etc.
- Streamers who want to automate parts of their workflow, like moving files from a recording folder to their main stream library, launching all their streaming apps at once, and archiving old streams with consistent encoding settings and tagging.

![Stream Manager screenshot](resources/sm-streams.png)

---

- [Stream Manager](#stream-manager)
  - [Mission](#mission)
  - [Getting Started (as a user)](#getting-started-as-a-user)
  - [Recommended Workflow](#recommended-workflow)
  - [Features](#features)
    - [Streams](#streams)
    - [Video Player](#video-player)
    - [Thumbnail Editor](#thumbnail-editor)
    - [Converter](#converter)
    - [Auto-Rules](#auto-rules)
    - [Launcher](#launcher)
    - [Integrations](#integrations)
      - [YouTube](#youtube)
      - [Twitch](#twitch)
      - [Claude AI](#claude-ai)
  - [Getting Started (as a dev)](#getting-started-as-a-dev)
    - [Prerequisites](#prerequisites)
    - [Install \& run](#install--run)
    - [Build portable executable (Windows)](#build-portable-executable-windows)
  - [Tech Stack](#tech-stack)
  - [Project Structure](#project-structure)
  - [License](#license)

---

## Getting Started (as a user)

**Before starting:** Stream Manager requires consistent naming of files that must include the stream date (preferably as the first part of the filename). Without that, the app has no way to automatically detect and organize them. The default OBS naming format (`YYYY-MM-DD HH-MM-SS`) is recommended and works out of the box. Other formats are not officially supported but may still work.

1. Download the latest release for Windows from the [Releases](https://github.com/pjmdesi/stream-manager/releases) page.
2. Extract the ZIP file and run `StreamManager.exe`.  
_No installation required, runs from anywhere, can be moved freely. Stream Manager's data (settings) is stored on your machine in AppData. Stream item data is stored next to your stream files_
3. Select your main "Streams" folder where your recordings are stored when prompted.
4. The app **scans the folder and auto-detects your structure** and pre-selects the right structure mode. You can change this mode as well:
   - flat folder-per-stream — **recommended**
   - "dump"-folder (all files loose with no subfolders) — **not recommended, some app features disabled**  
   _You can choose to convert an existing **dump** folder structure to **folder-per-stream** format during setup, or in Settings._
5. The app will scan the folder for video files, thumbnails, and other related files. Then it will group them into stream items. Click on a stream item to view and edit its metadata.
6. (Optional) Set up an auto-rule to watch your streaming software's recording output folder and automatically move/rename new files to your main "Streams" folder. This is recommended for the smoothest experience.
7. (Optional) Connect the app to YouTube and/or Twitch to enable metadata synchronization for your streams (title, description, tags, game info, thumbnail, etc.).

---

## Recommended Workflow

1. Before you stream, click the "New Stream" button and fill in the details.

   ![Stream Manager New Stream Button Screenshot](resources/stream-manager-new-stream-button.png)
2. Set your streaming software to save to a **recordings folder**. This is important if you use cloud-sync software like those for a NAS, OneDrive, or Google Drive to backup your streams.  

    > _⚠️ **Important:** Recording directly to a cloud-synced folder can cause encoding errors and ruin recordings (in my experience). Stream Manager detects and adapts to cloud-synced storage._

   ![OBS Output Settings Screenshot](resources/obs-recording-output.png)  
   
3. Set up an auto-rule in the app to watch that **recordings folder** and move/rename new files to your main **Streams** folder (the app will help you set this up during onboarding).

    ![Stream Manager Auto-Rules Screenshot](resources/stream-manager-auto-rules-setup.png)
4. _**Stream your heart out!**_
5. After your stream, the app will automatically organize your recordings. Find the session in the Streams page and optionally add any missing info like the topics/games, stream type, and personal comments.
6. Review the recording in the built-in player and export clips for sharing on social media or YouTube, or send the whole session to the converter to compress it for other uses like archiving or uploading to other services.

---

## How this is built

Stream Manager is built with substantial assistance from Claude (Anthropic's AI assistant) and GitHub Copilot. I'm a front-end developer by trade with a cursory understanding of backend systems; building a full Electron desktop app with multi-track video processing, ffmpeg integration, OAuth flows, and cloud-aware file handling is outside my normal scope and would take years to learn. If you want to see an example of a fully hand-coded application of mine, see [ClpChk](https://github.com/pjmdesi/clp-chk-react).  
Claude is used heavily for architecture, implementation, debugging, code cleanup, and documentation through months of iterative back-and-forth. The product direction, UX decisions, feature scope, testing, and final calls on what is shipped are mine. If you're curious about my take on AI-assisted development, I'm happy to discuss in issues or Discord.

---

## Features

Stream Manager is built around keeping everything about your stream sessions in one place — the recording, metadata, clips, and publishing destinations all collected and organized.

### Streams

![Stream Manager screenshot](resources/sm-streams.png)

The main hub for browsing and managing local recordings of your stream sessions. Video files, thumbnails, and other related assets in your designated folder are scanned and grouped automatically:

- **Custom tagging and metadata** — games played, stream type, and freeform comments. Stream types support custom color and texture theming so you can visually distinguish categories at a glance. Add and style tags to work for you.
- **Episode series tracking** — assign streams seasons and episodes. Episodes are iterated automatically, new seasons are manually set. `{season}`, `{episode}`, `{total_episodes}` merge fields become available in stream titles and description templates.
- **Archive processing** — choose sessions to compress and tag as archived.
- **Cloud-sync aware** — offline files (Synology Drive, OneDrive, DropBox, Google Drive, etc.) are detected and certain features are adapted to account for that functionality. Using the Windows Cloud Files API directly, file data can be offloaded to free local space, or pinned local in bulk.
- **New Episode** — clone an existing stream as the next episode in its series. Stream type and games carry over, source thumbnails copy automatically, and the editing modal opens pre-filled.
- **Reusable templates** — Use merge fields including `{game}`, `{season}`, `{episode}`, `{total_episodes}`, `{title}`, and `{season_links}` to more easily create consistent titles, descriptions, and tags. Save and edit templates using the built-in editor or directly from the editing modal.

**Metadata** is stored in a single `_meta.json` file at the root of your streams directory, so stream info is maintained and validated separately from the files themselves allowing easy movement of your library and the location of the app.

**LLM-assisted metadata** — if you have a Claude API key configured in Integrations, press **Ctrl+Space** in any YouTube title, description, or tags field while editing a stream to get an inline suggestion generated at the cursor position. When the text appears, press **Tab** to accept or **Esc** to dismiss. The model uses the stream's date, games, type tags, and the prompt field for context.

### Video Player

![Stream Manager screenshot](resources/sm-player.png)

Open your stream videos and clips (or drop in any video file) and play it back with thumbnail and waveform tracks. Multi-track audio (common in OBS recordings) is supported. Review, clip, and export stream sessions with precision using these tools:

- **Multi-track audio support** — if multiple audio tracks are detected, the user can choose to merge them into a single track for easier playback and clipping (Chromium limits audio playback from a video file to only one track at a time). Merged audio is temporary, so it won't clutter your folders.
- **Clip mode** — export a polished clip directly from the player. Your work autosaves as you go. Exported clips stay linked to their source and are one click away from being branched into a brand-new draft, so the original export always stays intact.
- **Shape-aware cropping** — configure the aspect ratio for the video with the crop tool, works independently for each segment. Repurpose the same highlight for widescreen, square, or vertical clips without re-editing.
- **Bleep markers** — mark regions to be bleeped or silenced (censored) while clipping. Mutes all audio for the duration of the bleep marker.
- **Video pop-out for OBS** — pop the open video into a dedicated frameless window. Streaming software like OBS can then capture that window independently. Use the precision playback controls to go frame-by-frame forward AND BACKWARD (I'm looking at you VLC!) or seek to a specific timecode and immediately see it in the pop-up. Useful for showing videos on stream without needing to crop the source.

### Thumbnail Editor

![Stream Manager screenshot](resources/sm-thumbnails.png)

A built-in canvas editor for designing stream and clip thumbnails without leaving the app. Save reusable templates, then pick one when you create a new stream to instantly get a finished thumbnail with your standard branding.

- **Layered canvas** — drop in images, text, and shapes. Layers support drag, resize, rotate, opacity, ordering, and visibility toggles.
- **Templates** — save a layout as a reusable template. When you create a new stream, pick a template to instantly generate a thumbnail with your standard design and branding.
- **Per-stream autosave** — thumbnails save to the stream folder as you edit and re-open to exactly where you left off; exported PNGs live alongside the source video so they're detected as stream thumbnails automatically.
- **Layer effects** — full [Konva](https://konvajs.org/) filter library on image layers with sliders + toggles, plus drop shadow on every layer type.
- **Merge fields** — text layers can include `{title}`, `{game}`, `{date}`, `{season}`, `{episode}`, and `{total_episodes}` markers that substitute live in the canvas as you edit. When editing a template, the markers render literally so the layout can be reused across streams without manually editing text every time.

### Converter

![Stream Manager screenshot](resources/sm-converter.png)

Queue video files for conversion using ffmpeg presets.

- **Conversion presets** — Presets I've personally found useful are included out of the box. New presets can be imported from other apps such as HandBrake (JSON format) or created manually if you're adventurous.
- **Batch archiving** — send stream sessions to the converter directly from the Streams page.
- **Remuxing support** — Like the OBS "Remux Recordings" feature, the app can quickly change a video's container format (e.g. from MKV to MP4) without re-encoding.
- **Combine tool** — concatenate multiple video files into one with zero re-encoding using ffmpeg's concat demuxer. Files are auto-sorted by timestamp parsed from OBS-style filenames and can be manually reordered by drag-and-drop.
- **Sidebar widget** — easily visualize progress while doing other tasks in-app.

### Auto-Rules

![Stream Manager screenshot](resources/sm-auto-rules.png)

File watcher rules that can automatically **move, copy, rename, or convert** files. The watcher can be configured to start automatically on launch and is always accessible via the sidebar widget.

### Launcher

![Stream Manager screenshot](resources/sm-launcher.png)

Create named groups of apps that can be launched together with a single click — useful for spinning up your full streaming setup (OBS, chat apps, Discord, game launchers, browser profiles, and any other apps that help you stream) all at once.

- **Launch groups** — organize apps into named groups, each with a custom icon (chosen from the full Lucide icon library) and a reorderable app list. Apps can be `.exe` files or `.lnk` shortcuts, and can be browsed or dragged directly from Explorer.
- **Individual launch** — launch a single app from a group without firing the rest.
- **Sidebar widget** — pin one group to the sidebar for one-click access without navigating to the Launcher page.

### Integrations

![Stream Manager screenshot](resources/sm-integrations.png)

#### YouTube

- OAuth connection — authorize once and the app manages token refresh automatically. Connection status is shown in the sidebar.
- Update title, thumbnail, description, and tags, directly from Stream Manager (but not category or game titles, boo YouTube...). This works for upcoming livestreams, past VODs, and regular videos.

_You will need a google cloud project and OAuth 2.0 credentials to connect your YouTube account._

##### YouTube API Limitations

- The app cannot set or update a livestream or video's category or game due to YouTube API limitations. You will need to do this manually through YouTube studio.
- YouTube's API has no controls for the newer A/B testing features for thumbnails and titles, so those cannot be managed through the app.

#### Twitch

- OAuth connection with automatic token refresh.
- Update your Twitch channel title and category from the stream item metadata dialogs.

##### Twitch API Limitations

- The app does not connect to past VODs on Twitch, so stream metadata cannot be synced after the fact like with YouTube. Twitch's API only allows updating the current stream's title and category, so those are the only fields that can be managed through the app.
- Twitch's API does not allow updating the go live notification or stream tags, so those cannot be managed through the app.

#### Claude AI

- Connect your [Anthropic API key](https://console.anthropic.com/) to enable AI-assisted YouTube details generation, powered by [Claude Haiku](https://www.anthropic.com/claude/haiku).
- Press **Ctrl+Space** in the title, description, or tags field while editing stream metadata to request a suggestion at the cursor position. Suggestions appear as inline ghost text — **Tab** to accept, **Esc** to dismiss.
- An optional system prompt lets you give the model standing instructions about your channel's style and tone.
- The API key is stored locally and never sent to any servers other than Anthropic's.

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

| Layer            | Technology                                                                     |
| ---------------- | ------------------------------------------------------------------------------ |
| Framework        | [Electron](https://www.electronjs.org/) 34                                     |
| UI               | [React](https://react.dev/) 18 + [TypeScript](https://www.typescriptlang.org/) |
| Styling          | [Tailwind CSS](https://tailwindcss.com/) 3                                     |
| Icons            | [Lucide React](https://lucide.dev/)                                            |
| Animation        | [motion](https://motion.dev/)                                                  |
| Thumbnail canvas | [Konva](https://konvajs.org/) + [react-konva](https://konvajs.org/docs/react/) |
| Video            | [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static)                   |
|                  | [fluent-ffmpeg](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg)           |
| Persistence      | [electron-store](https://github.com/sindresorhus/electron-store)               |
| File watching    | [chokidar](https://github.com/paulmillr/chokidar)                              |
| Bundler          | [electron-vite](https://electron-vite.github.io/)                              |
| Packaging        | [electron-builder](https://www.electron.build/)                                |

---

## Project Structure

```text
src/
├── main/                       # Electron main process
│   ├── ipc/
│   │   ├── claude.ts           # Claude AI metadata generation
│   │   ├── combine.ts          # Concat-demux pipeline
│   │   ├── converter.ts        # ffmpeg conversion queue + clip export tagging
│   │   ├── files.ts            # File system operations
│   │   ├── launcher.ts         # App launch groups
│   │   ├── store.ts            # App config persistence
│   │   ├── streams.ts          # Stream folder management + clip drafts
│   │   ├── templates.ts        # Folder template engine
│   │   ├── thumbnail.ts        # Thumbnail editor templates & canvas persistence
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
        │   │   ├── PlayerPage.tsx        # Video player, waveform, clip mode with drafts, shape-aware crop, bleep markers, Session Videos panel
        │   │   ├── StreamsPage.tsx       # Stream session browser
        │   │   ├── ConverterPage.tsx
        │   │   ├── CombinePage.tsx
        │   │   ├── RulesPage.tsx         # Auto-rules / file watcher (move/copy/rename/convert)
        │   │   ├── SettingsPage.tsx
        │   │   ├── TemplatesPage.tsx
        │   │   ├── ThumbnailPage.tsx     # Konva-based thumbnail editor w/ templates, snapping, undo/redo
        │   │   ├── LauncherPage.tsx      # App launch groups
        │   │   └── IntegrationsPage.tsx  # YouTube, Twitch, Claude AI
        │   └── ui/             # Button, Modal, Slider, Tooltip, GhostTextArea, …
        ├── context/            # ConversionContext, WatcherContext, StoreContext, ThumbnailEditorContext
        ├── hooks/
        │   ├── useVideoPlayer.ts       # Playback, seek throttling, multi-track sync
        │   ├── useWaveform.ts          # PCM re-bucketing, SVG path generation
        │   ├── useThumbnailStrip.ts
        │   ├── useFieldSuggestion.ts   # Ctrl+Space AI suggestion for inputs
        │   └── useStore.ts
        └── types/              # Shared TypeScript interfaces
```

---

## License

[MIT](LICENSE)
