# Stream Manager v2.7.1

A hotfix for the archive presets. If you have archived streams with Stream Manager on a PC with an NVIDIA GPU, read the section on existing archives.

## What was wrong

Stream Manager ships two archive presets, Archive (AV1) and Archive (H.265). Each names a software encoder and a quality setting, and swaps in your GPU's encoder when it has one, because a GPU finishes a multi-hour stream in minutes where the CPU takes hours. Two things were wrong with that, in every version up to 2.7.0.

1. **The AV1 preset named an encoder the app did not have.** The ffmpeg build inside Stream Manager was the "essentials" build, which has no SVT-AV1. On a PC with a hardware AV1 encoder the preset silently ran on the GPU instead. On a PC without one it failed with an "unknown encoder" error if you picked it, and the app's recommendation steered you to H.265.
2. **The quality number was handed to the GPU unchanged.** A CRF of 28 for a software encoder and a CQ of 28 for an NVIDIA encoder are not the same quality; the NVIDIA scale sits much higher. So NVIDIA archives came out near-lossless and almost as large as the original, and a low-bitrate recording came out larger than the original. That is not an archive.
3. **On AMD and Intel GPUs the setting was not applied at all.** The option the app passed exists only on NVIDIA encoders; AMD and Intel ones ignore it, and ffmpeg fell back to the encoder's default target of about 2 Mbps. Those archives are small, but at a visible quality loss on high-motion footage. If you archived streams on an AMD or Intel GPU with 2.7.0 or earlier, the originals are gone and the archives are what remains; the measurement below shows how far they fell.

Measured on 30-second excerpts of three real recordings, scored with VMAF against a lossless copy (98.6 is the model's ceiling for this content; 93 to 95 is transparent to most viewers; the shipped settings are in bold):

| Encode | 1440p60, 13 Mbps | 1080p60, 7 Mbps | 1080p60, 3.7 Mbps |
|---|---|---|---|
| **2.7.0 Archive (AV1) on an NVIDIA GPU** (CQ 28) | 81% of original, VMAF 97.7 | 94%, 97.7 | 121%, 97.3 |
| **2.7.0 Archive (H.265) on an NVIDIA GPU** (CQ 26) | 63%, 96.9 | 75%, 96.6 | 77%, 96.4 |
| **2.7.0 Archive (H.265) on an AMD GPU** (setting ignored, default 2 Mbps) | 16%, 85.1, worst frames 57 | | |
| Archive (H.265) on the CPU, x265 CRF 26 | 19%, 92.6 | 26%, 90.6 | 31%, 94.9 |
| **2.7.1 Archive (AV1) on an NVIDIA GPU** (CQ 36) | 37%, 96.4 | 46%, 95.4 | 52%, 96.5 |
| **2.7.1 Archive (H.265) on an NVIDIA GPU** (CQ 30) | 38%, 95.6 | 46%, 94.3 | 45%, 95.5 |
| **2.7.1 Archive (AV1) on the CPU**, SVT-AV1 CRF 32 | 28%, 96.3 | 40%, 95.6 | 70%, 97.3 |

The GPU encoder's own speed tier (p7, two-pass) changed size by about 3 percent for twice the time, so the quality number was the whole story.

A full recording archived with 2.7.1 on an NVIDIA GPU (NVENC AV1, CQ 36) matches the excerpt figures: 3 h 50 m of 1440p60 gameplay went from 25.2 GB to 6.5 GB (26 percent), and four 30-second samples spread across it scored VMAF 96.3 to 98.0 against the original.

## What 2.7.1 changes

- **The app now carries the full ffmpeg build**, with SVT-AV1 included, so Archive (AV1) runs on every PC. The download grows by up to 50 MB for it.
- **GPU quality is translated, not copied.** NVIDIA: CQ 30 for H.265, CQ 36 for AV1, CQ 32 for H.264 presets that use a CRF. AMD: QVBR level 36 for H.265 and 37 for AV1 (that scale runs the other way). Intel: ICQ at the CRF plus a small margin. The NVIDIA values were measured as above; the AMD values on a Radeon integrated GPU; the Intel values could not be measured here and lean toward quality over size. If your archives look off on AMD or Intel, say so. The settings sit one step above the smallest files that still scored well, after a dark 2D recording showed visible softening at the smaller setting.
- **Archive (AV1) is SVT-AV1 at CRF 32 on the CPU** (was 28, which left a low-bitrate recording at 89 percent of its original size). On a recent 12-core CPU the encode runs at about two thirds of real time at 1440p60 and faster than real time at 1080p60; a GPU with an AV1 encoder (NVIDIA RTX 40 and 50, AMD RX 7000, Intel Arc) runs it in minutes.
- **Archives are written out of a sync client's sight.** Conversions, archives, clip exports and combined files are written as `<name>.tmp`, which Synology Drive and OneDrive leave alone by default, are read back and checked, and only then take their final name. Found while testing this release: an archive written straight into a synced folder came out with a 5 MB hole, because the sync client uploaded the file within seconds of its creation while holding a lock on it, and what ffmpeg wrote during that window never reached the disk. Every earlier version wrote archives that way.
- **The presets say what runs.** Manage presets shows "Runs on this PC as NVIDIA NVENC AV1 (hardware)" or "SVT-AV1 on the CPU" under each preset, and the descriptions name the encoders and quality settings.
- **A notice before the first archive.** The first time Archive is used, the app says that the original is replaced by a smaller, lower quality file with no way back, and lists how to test a preset on one recording first.
- **The recommendation checks what works.** It used to read the list of encoders compiled into ffmpeg, which includes every GPU encoder on every PC, so it recommended AV1 everywhere. It now probes the GPU: AV1 when a hardware AV1 encoder exists, H.265 when only a hardware H.265 encoder does, AV1 on a CPU-only machine.
- **A build cannot ship without SVT-AV1 again.** Packaging refuses an ffmpeg that lacks it.

## Existing archives

Files archived with 2.7.0 or earlier are intact and play normally. On an NVIDIA GPU they are near-lossless and roughly three times larger than an archive needs to be. Archiving them again with 2.7.1 reclaims that space at a small generation loss (an encode of an encode); whether that is worth it is your call, and the app will not do it on its own. On an AMD or Intel GPU they were encoded at about 2 Mbps regardless of the source; nothing can restore the detail that encode dropped, and archiving them again would only lose more. On a PC with no usable GPU encoder the AV1 preset never ran, so nothing was archived with it.

Windows' own players need codec packages from the Microsoft Store: the free "AV1 Video Extension" for AV1 and the "HEVC Video Extensions" for H.265. A missing AV1 extension is the usual reason an AV1 archive plays as audio only or not at all in Media Player. Stream Manager's own player plays both without extensions.

A fuller guide for existing archives, with the cases by GPU and the steps to archive again, is at https://stream-manager.app/archive-notice.

## Known limits

- A very low bitrate recording can still come out larger than the original with any quality-based encode. A size check before the original is replaced is planned.
- The AMD and Intel quality values are unverified on discrete GPUs; see above.

## Questions and bug reports

- Ask in the Discord server at https://discord.gg/MMjuHe6ZM2, or open an issue at https://github.com/pjmdesi/stream-manager/issues. A bug report is most useful with the Stream Manager version, your Windows version, and the steps that led to it.
