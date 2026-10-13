# Stream Manager v2.7.1

A hotfix for the archive presets.
***If you have archived streams with Stream Manager on a PC with an NVIDIA GPU, read the section on existing archives.***

**Test any encoding preset on one recording before using it in the archive process.** Archiving replaces the original recording with a smaller, lower quality version, and this cannot be undone. Run the preset from the Converter page with the output next to the original, compare the two files, and only then archive. The app now shows this notice before the first archive.

## Ignorance and Trust

This problem exists due to my lack of knowledge regarding ffmpeg specifically and encoding in general, but the reason it is in the app at all is because of my overreliance on Claude to provide accurate and complete guidance without fully verifying/questioning it. This mistake was a tough learning experience and has informed how I will approach the app's development from now on.

This issue was caught because I had finally gotten to what I thought was a tiny issue in my todo list: archive encodes seemed larger than expected. Once investigation started, it quickly became clear that the problem was much more serious.

Going forward:

1. Any issue related to encoding (even a tiny one, and especially involving the archive process) will be immediately scrutinized and tested thoroughly, taking priority over basically all other tasks.
2. I will actively seek out more edge cases and potential failure points in the app, rather than just validating the obvious or expected behavior.
3. I will better educate myself on all aspects of the app's various subject areas, particularly those related to encoding and ffmpeg, and won't proceed without sufficient understanding. This is for my own self interest (I actively use the app myself daily) as well as for the reliability and trustworthiness of the app for its users.

This will mean slower development, probably much slower, but the trade-off is that the app will be more reliable and (hopefully) more trustworthy.

## What was wrong

### SM's Converter Archive preset required ffmpeg encoders that were not included in the SM package

Stream Manager includes two archive presets: Archive (AV1) and Archive (H.265). Each names a software encoder and a quality setting, and swaps to a GPU's encoder if a compatible one is available (GPUs are far faster at encoding).

Three things were wrong with that, and they affected all users up to version 2.7.0.

1. **The AV1 preset named an encoder the app did not have.** The ffmpeg build inside Stream Manager was the "essentials" build, which has no SVT-AV1. On a PC with a hardware AV1 encoder the preset silently ran on the GPU instead. On a PC without one it failed with an "unknown encoder" error if you picked it, and the app's recommendation steered you to H.265.
2. **The quality number was handed to the GPU unchanged.** A CRF of 28 for a software encoder and a CQ of 28 for an NVIDIA encoder are not the same thing. So in this situation, archives came out almost as large as the original, and some recordings came out larger than the original (specifically low-bitrate recordings). This is not acceptable for an *archive*.
3. **On AMD and Intel GPUs the setting was not applied at all.** The option the app passed exists only on NVIDIA encoders. AMD and Intel ones ignore it, and ffmpeg fell back to the encoder's default target of about 2 Mbps. Those archives are small, but at a visible quality loss, potentially a large one. If you archived streams through the normal archive process using an AMD or Intel GPU with SM v2.7.0 or earlier, the originals are gone and the archives are what remains; the measurement below shows the quality impact.

I have no way to test an actual Intel GPU, and the AMD numbers come from a Ryzen iGPU.

Measured on 30-second excerpts of three real recordings. Quality is scored with VMAF, the open-source measure developed by Netflix for how close an encoded video looks to its source, on a scale of 0 to 100 (https://github.com/Netflix/vmaf). A score of 93 to 95 is transparent to most viewers, and 98.6 is the highest score the model gives this content, found by scoring a lossless copy against itself. Sizes are a percentage of the original excerpt. The shipped settings are in bold:

| Encode | 1440p60, 13 Mbps | 1080p60, 7 Mbps | 1080p60, 3.7 Mbps |
|---|---|---|---|
| **2.7.0 Archive (AV1) on an NVIDIA GPU** (CQ 28) | 81% of original, VMAF 97.7 | 94%, 97.7 | 121%, 97.3 |
| **2.7.0 Archive (H.265) on an NVIDIA GPU** (CQ 26) | 63%, 96.9 | 75%, 96.6 | 77%, 96.4 |
| **2.7.0 Archive (H.265) on an AMD GPU** (setting ignored, default 2 Mbps) | 16%, 85.1, worst frames 57 | | |
| **2.7.1 Archive (AV1) on an NVIDIA GPU** (CQ 33) | 49%, 97.0 | 60%, 96.5 | 71%, 96.9 |
| **2.7.1 Archive (H.265) on an NVIDIA GPU** (CQ 27) | 56%, 96.6 | 65%, 96.1 | 67%, 96.2 |
| **2.7.1 Archive (AV1) on the CPU**, SVT-AV1 CRF 29 | 35%, 96.7 | 49%, 96.3 | 85%, 97.4 |
| **2.7.1 Archive (H.265) on the CPU**, x265 CRF 23 | 28%, 94.5 | 38%, 93.5 | 45%, 96.0 |

Slower GPU encoder settings were not the answer: the slowest, two-pass mode made the files only about 3 percent smaller and took twice as long. The size came down to the quality number alone.

A full recording archived with SM v2.7.1 on an NVIDIA GPU (NVENC AV1, CQ 33) does better than the excerpt figures: 3 h 50 m of 1440p60 gameplay went from 25.2 GB to 8.5 GB (34 percent), and four 30-second samples spread across it scored VMAF 97.0 to 98.3 against the original.

## What 2.7.1 changes

- **The app now carries the full ffmpeg build**, with SVT-AV1 included, so Archive (AV1) runs on every PC. The download grows by up to 50 MB after adding it.
- **GPU quality is now translated when needed.** NVIDIA: CQ 27 for H.265, CQ 33 for AV1, CQ 32 for H.264 presets that use a CRF. AMD: QVBR level 39 for H.265 and 40 for AV1 (that scale runs the other way). Intel: ICQ at the CRF plus a small margin. The NVIDIA values were measured as above; the AMD values on a Radeon integrated GPU; the Intel values could not be measured here and lean toward quality over size. If your archives look off on AMD or Intel, say so. Further tweaks were made after reviewing actual encodes of real stream files (resulting in a quality setting increase).
- **Archive (AV1) is SVT-AV1 at CRF 29 on the CPU.** On a recent 12-core CPU the encode runs at about two thirds of real time at 1440p60 and around real time at 1080p60. A GPU with an AV1 encoder (NVIDIA RTX 40 and 50, AMD RX 7000, Intel Arc) runs about five times faster than real time: a 3 h 50 m recording took 45 minutes on an RTX 5080, where the CPU path would take close to six hours.
- **Archives are written out of a sync client's sight.** Conversions, archives, clip exports and combined files are written as `<name>.tmp` while encoding, which most cloud sync tools leave alone by default. They are then read back and checked, and only then take their final name. Found while testing this release: an archive written straight into a synced folder came out with a 5 MB hole, because the sync client uploaded the file within seconds of its creation while holding a lock on it, and what ffmpeg wrote during that window never reached the disk. Every earlier version wrote archives that way. *This is the same class of issue as recording from OBS straight to a synced folder, which is already recommended against in SM's documentation (https://stream-manager.app/get-started).*
- **The presets say what runs.** Manage presets shows "Runs on this PC as NVIDIA NVENC AV1 (hardware)" or "SVT-AV1 on the CPU" under each preset, and the descriptions name the encoders and quality settings.
- **A notice before the first archive.** The first time the Archive process is used in SM, the app says that the original is replaced by a smaller, lower quality file with no way back, and lists how to test a preset on one recording first.
- **The recommendation checks what works.** It used to read the list of encoders compiled into ffmpeg, which includes every GPU encoder on every PC, so it recommended AV1 everywhere. It now probes the GPU: AV1 when a hardware AV1 encoder exists, H.265 when only a hardware H.265 encoder does, AV1 on a CPU-only machine.
- **A build cannot ship without SVT-AV1 again.** Packaging refuses an ffmpeg that lacks it.

## Dealing with existing archives

Files archived with 2.7.0 or earlier are intact and play normally. Anything previously marked as archived will remain marked as such.

On an **NVIDIA GPU, AV1** archives are near-lossless at 80 to 120 percent of the original; archiving them again with 2.7.1 brings them to about half to two thirds, at a small generation loss (an encode of an encode). Whether that is worth it is your call, and the app will not do it on its own.

**NVIDIA H.265** archives came out at 63 to 77 percent, and 2.7.1 would land them only about ten points lower, so leave those alone.

On an **AMD or Intel GPU**, archives were encoded at about 2 Mbps regardless of the source; nothing can restore the detail that encode dropped, and archiving them again would only lose more. On a PC with no usable GPU encoder the AV1 preset never ran, so nothing was archived with it.

### Playback outside of SM

Windows' own players need codec packages from the Microsoft Store: the free "AV1 Video Extension" for AV1 and the "HEVC Video Extensions" for H.265. If you have struggled to play archived files, make sure the appropriate extension is installed. A missing AV1 extension is the usual reason an AV1 archive plays as audio only or not at all in Media Player. Stream Manager's own player plays both without extensions: it runs on Chromium, which decodes AV1 itself and H.265 through the GPU's hardware decoder.

A fuller guide for existing archives, with the cases by GPU and the steps to archive again, is at https://stream-manager.app/archive-notice.

## Known limits

- A very low bitrate recording can still come out larger than the original with any quality-based encode. A size check before the original is replaced is planned.
- The AMD and Intel quality values are unverified on discrete GPUs; see above.

## Questions and bug reports

- Ask in the Discord server at https://discord.gg/MMjuHe6ZM2, or open an issue at https://github.com/pjmdesi/stream-manager/issues. A bug report is most useful with the Stream Manager version, your Windows version, and the steps that led to it.
