# Release notes draft (next release from `dev`)

> Running draft, maintained ON `dev`. When a feature lands, append a line to the right section in the same sitting. At promotion time this gets edited into the GitHub-release copy (trim, reword, reorder headline-first; see `archive/_release-notes-v2.md` for the structure, but NO emojis anywhere) and the file is emptied for the next cycle. Wording here is working-quality, not final. Fixes that already shipped in a hotfix release do NOT belong here. Style lessons from the v2.5.0 edit: plain category titles, modest scope claims, user vocabulary only, no micro-detail.

RELEASE-READY COPY for v2.7.0 below (edited 2026-10-02 from the running draft). Paste everything from the title line down into the GitHub release, then empty this file back to the header above.

---

# Thumbnail editor and Electron 44 release

A large thumbnail editor update (groups, masks, group effects, arrows, a reorganized properties panel), a round of converter and cloud sync improvements, stream list additions, player navigation and track naming, and the move to Electron 44. Plus a long list of fixes found while testing it all.

## Thumbnail editor

- Layers can be grouped. Select two or more and press Ctrl+G; Ctrl+Shift+G ungroups. A group moves, rotates, resizes, hides, and fades as one, members scale with it, and groups nest up to three deep. Click a group to select it, double-click to reach a layer inside. The layers panel shows groups as collapsible rows and lets you drag layers in and out.
- Groups can carry a mask. Every group has a mask slot in the layers panel: use a shape already in the group or create a rectangle, ellipse, or polygon fitted to it, and the group is clipped to that outline. Only the outline counts, so the mask's own fill and stroke are off while it serves. For the quick case, select a shape over an image and choose Apply as mask to the layer below; that is the fastest way to crop an image to a shape.
- Groups take drop shadows, an outline, and filters of their own. A masked cut-out casts one clean shadow in the shape of its mask, the outline traces the group's silhouette, and a blur or grayscale applies to the group as a whole.
- An arrow tool joins the shapes, with a choice of head, head length, stem thickness, a tail taper, a bend for curved arrows, and a corner radius. Arrows take fills, strokes, shadows, outlines, and filters like any shape. Resize to scale, rotate to point.
- The triangle tool is now a polygon tool with 3 to 12 sides and a corner radius. Existing triangles open unchanged.
- Gradients come in three kinds, linear, radial, and conic, for fills and strokes alike, and strokes on shapes and text can be gradients now. Swatches remember the kind.
- The properties panel is organized into cards in the same order for every layer type, with collapsible sections that remember their state. Fields with a natural range are slider bars with the value built in: drag, type, or double-click to reset. The position and size fields can be scrubbed by dragging their labels.
- The layers panel grew a selection tab beside the selected rows with duplicate, delete, hide, group, ungroup, and the mask actions. The alignment and flip buttons moved from the toolbar into a small panel under the selection on the canvas.
- Rotation snapping: Ctrl for 90 degree steps, Shift for 5. A readout beside the pointer shows the live position, size, or angle while you drag.
- A Pixel snap toggle, on by default, lands moves and resizes on whole pixels. Turn it off for free placement.
- The top bar has previous and next stream and episode buttons with a jump list, so you can move between thumbnails without leaving the editor. The bracket keys walk the layer selection, Enter steps into a group, Shift+Enter steps out.
- New layers get numbered names (Group 1, Text 2) that are never reused, so a deleted Group 2 stays gone. Rename by double-clicking as before.
- Paste lands above the selected layer, inside its group when it has one. A recent color can be dragged into the palette where you want it. Each stream group in the Assets panel has an Open folder button.

## Streams

- The header shows the size of the whole library beside the item count, with a breakdown by videos, clips, and images on hover.
- Stream rows show the linked YouTube video's views, likes, and dislikes beside the date, and those counts keep up with YouTube during a session.
- With Twitch connected, the sidebar's empty state shows what your Twitch channel is currently set to and which stream it came from, and that stream carries a small Twitch badge in its row.
- The stream list's thumbnails are served from small pre-scaled copies kept in the cache, so a long library scrolls and resizes its thumbnail column with far less work.
- The streams folder watcher no longer opens files to watch them. On Electron 44 the old watcher's per-file registrations read as download requests to a cloud sync client, so deleting or rescheduling a stream could set off a wave of downloads. One watch on the folder now covers the library.
- Deleting a stream removes its row the moment you confirm. The reschedule dialog's second step stays open until you choose. The archived marker in the files grid is reliable. Sending a cloud-offloaded video to the player downloads in the background and opens it when ready, without switching you there.
- The Templates dialog's title and description editors recognize the topic and topics merge fields; templates written with the older game field keep working. Tag suggestions keep their spaces while you type.

## Player

- Stream and episode navigation is the same in the player and the stream sidebar: previous and next for both, a jump-to-episode list, and Ctrl with the up and down arrows (Ctrl+Shift for episodes).
- Audio tracks get proper names even when the recording cannot carry them. Settings has a Default audio track names list for OBS layouts, names stored in a recording still win, and any track can be renamed for a single file by double-clicking it.
- When a recording has a damaged or missing stretch, the player says so and where, and offers to skip past it, instead of calling the codec unsupported.
- Hold Alt while dragging a clip segment handle to move both ends at once. The minute skips have shortcuts: Alt with the arrows for one minute, Alt+Shift for five.

## Converter and cloud sync

- The progress under the Converter item in the navigation reflects the whole batch, and finished jobs move to their own Finished card below the running ones.
- Set all in the ready list applies one preset and output location to every file, and files can be dragged into the order you want them converted.
- An archive with several files uses every free conversion slot. A conversion waiting on a cloud download fails with the sync client's reason instead of waiting forever, and a download that has been working for more than a few minutes shows how long, with a note that a paused sync client holds downloads until it resumes.
- A combine whose sources had to be downloaded first no longer starts on its own when the downloaded files turn out to differ in frame rate.
- Retry all re-runs every failed file in a cloud sync card. Cancel pending does only what it says, appears only when there is something to cancel, and never touches a download the converter started. Thumbnails fill in as cloud files land, and a file requested twice shows one row.

## Settings and under the hood

- Stream Manager runs on Electron 44, up from Electron 34, which had been out of support since mid-2025. No visible changes are intended. If something looks or behaves differently after updating, that is worth a bug report.
- Settings is arranged by what each setting affects: the streams folder under Streams, the default watch folder under Auto-rules, and the cache controls near the bottom with a description of what the cache holds and when clearing makes sense. The cache limit now covers everything in the cache, the least recently used files go first, and Clear cache shows progress and says so if a file could not be removed. The old Cache Directory field, which had no effect, is gone.
- File sizes read the same everywhere in the app and match what Explorer shows for the same file.
- Folder pickers open in the folder you last used for that setting, otherwise your streams folder.
- The Claude connection shows Claude's own mark and color in place of a generic icon in orange.
