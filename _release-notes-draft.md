# Release notes draft (next release from `dev`)

> Running draft, maintained ON `dev`. When a feature lands, append a line to the right section in the same sitting. At promotion time this gets edited into the GitHub-release copy (trim, reword, reorder headline-first; see `archive/_release-notes-v2.md` for the section structure, but NO emojis anywhere and no "# Stream Manager vX.Y.Z" title line: the release copy opens with a short plain-prose summary, then the `## ` sections, because the Discord release announcement posts that summary and nothing after the first heading) and the file is emptied for the next cycle. Wording here is working-quality, not final. Fixes that already shipped in a hotfix release do NOT belong here. Style lessons from the v2.5.0 edit: plain category titles, modest scope claims, user vocabulary only, no micro-detail.

Target: TBD · emptied 2026-10-02 after the v2.7.0 release. The "Questions and bug reports" section at the bottom is standing copy: it stays through every emptying and closes every release.

## Under the hood

- The download is about a third smaller. The packaged app carried ffprobe builds for macOS and Linux and a 32-bit Windows one that could never run; only the one for your machine ships now.
- Routine dependency update: Electron 44.5.1 and current versions of the build and UI libraries, which clears every known advisory in the packages the app ships except one in the auto-rules file watcher that only a rule pattern you write yourself could trigger.

## Converter

- An archive whose result would be no smaller than the original no longer replaces it. The original stays, the larger file waits for two hours in case you want it anyway (Replace anyway on the row, behind a confirmation), and the row says what happened. A stream is marked archived only when its files were actually replaced.
- Converting rows show the source size beside the source name, the output size growing beside the output name, an estimated final size (with its share of the source) from 5 percent on, and the time remaining. The Combine page shows the same while it runs.
- Every conversion, archive, clip export and combine the app runs is now recorded in a log on this PC: the files, the preset and its settings, the timings, and how it ended. Settings, under System, has an Open logs folder button. Records are kept for a year.
- Taking a job off the Converter page no longer looks like a deletion. A finished row has a Clear button and a waiting one a Remove button, both with a list icon instead of the trash can, and each says on hover that the files on disk are not touched. Files in the ready list have the same Remove, and the Combine page's Clear job, Remove job and per-file remove buttons follow suit.

## Streams

- Linking a YouTube video to a stream opens a picker window in place of the menu that grew upward from the sidebar's footer. It shows the stream and its current link at the top, then a search field and the channel's videos as rows with a thumbnail, the date, the privacy, whether it is a livestream, and the video id; the privacy opens the video and the id opens it in YouTube Studio, each with a copy button. Videos already linked to another stream stay behind a filter. The stream and episode arrows work inside the window, so links can be checked stream after stream. The channel's video list is kept on this PC, so the picker lists it at once and asks YouTube only for newer videos.
- For a stream with no link, the picker leads with its best guess at the right video, marked Best match, with the reasons beside it: the length, the title, the tags and the date, or the uploaded file's name for an upload.
- The sidebar footer shows the linked video as the same row the picker uses, with the date, privacy and id, and its Broadcast options (privacy, and for an upcoming stream the date and time) as one group under it. Link, Change and Unlink sit on the heading. For an upcoming stream with no link, Push to YouTube creates the broadcast with those options and pushes the details; the separate Create broadcast button is gone.
- Files the converter produced (conversions, clip exports and combined files) show a lightning bolt in the badge under their thumbnail; an archived file keeps the archive icon there. New conversions are stamped inside the file, as clip exports and archives already were, so the mark survives a move or an offload. Files converted before this version carry no stamp and show no bolt.
- The YouTube import's summary now says when an imported stream landed on a day that already had one, with the folder name it was given, the way New stream does; the folder used to get its numeric suffix without a word.

## Player

- Moving to the previous or next stream when all of its videos are in the cloud no longer starts a download on its own or ends in an error. The player shows that stream with its videos and their cloud status; click one to download it, and again to open it once it has landed.

- The player's Selected Stream block links to the stream's item on the Streams page: click its thumbnail or title, in the open panel or the collapsed rail.
- Dragging a track's volume slider in the player no longer leaves the slider focused, so the arrow keys and Space go back to the player as soon as the mouse button comes up; a slider reached with Tab keeps the keyboard.
- Session Videos in the player fills in at once when a video opens or the stream changes, with each file's cloud status following a moment later; it used to wait a second or more on that check and showed the previous stream's files in the meantime.

## Combine

- Rows for files dropped from outside a stream now carry an "External file" line where a stream's name would be, so every row has the same height.

## Cloud sync

- Offloading a file now checks the sync client's own record of it first. A file the client has not finished uploading, or whose cloud copy the client registered at a different size than the file on this PC, is kept here and its row in the Cloud sync window says why. Retry once the client has caught up.

## Fixes

- The files grid shows the archived marker in the same place for every kind of video (inside the Recording, Clip or Combined badge); clips and combined files used to carry it next to the name instead.
- New stream no longer refuses a date that already has a stream. It says so and creates the new one alongside (a dump folder still holds one stream per date, and says that instead).
- In a dump-folder library, Offload and Pin local on a stream now act on that stream's files only; they used to queue the whole folder.
- Conversions, archives, clip exports and combined files are now written under a temporary name and checked before they take their final name. A cloud sync client no longer sees a file while it is still being written, and a result that did not finish properly is kept aside and reported instead of being treated as done. An archive's original is removed only after the replacement has passed that check.
- Canceling a conversion in the moment before its encoder started could leave that encoder running with no row for it. The app now keeps one list of every ffmpeg process it starts, checks that each still belongs to something, and stops any that does not. Quitting stops them all, including the stream relay, which used to outlive the app and hold its port.
- The Converting list has a Cancel all button, with a confirmation.
- Opening a stream item from another page, such as the converter's link back to its stream, ends select mode on the streams list if it was left on; the item used to open behind a list still in selection.
- Coming back to a page no longer animates its buttons from icon-only to icon and label as if the window had just been widened; they land in place at once, and only a real resize animates them. The streams page's open detail sidebar no longer fades in on return either.
- Moving to the previous or next stream with the thumbnail editor's arrows showed the stream's raw title template, merge fields and all, under the Thumbnails entry in the navigation and in the editor's recents; the title renders now.
- Picking a template for a stream that had no thumbnail could land in the editor for a moment and then fall back to the overview with nothing saved, when the library changed under it in that moment. A thumbnail that has not been saved yet is no longer mistaken for a deleted one.
- The episode picker in the thumbnail editor's top bar opened half under the navigation rail; it now opens centered on its button and stays inside the window.
- A converter job row shows its progress percentage under the status icon, in the icon's color, and collapses its buttons to icons sooner when the window is narrow; the figures used to run under the buttons and push the output folder link out of sight.
- Deleting a file from a stream's files grid now asks first, naming the file and its size, and says when the file is offloaded, since that delete reaches the cloud copy too. The select-mode Delete asks the same way.
- Dropping a folder on the Converter, Combine or Player brings in the video files inside it, subfolders included; it used to arrive as a single item that then failed. Files of other types are left out, and the drop zone says what it skipped; a pick from the browse dialog goes through the same check.
- A canceled conversion whose partial file is kept no longer takes the name of an existing file; it is kept as a "-partial" sibling instead. With the delete-partials setting on, a canceled re-export no longer deletes the previous finished file.

## Across the app

- The small action buttons in rows and file cards (the converter and combine rows, the file cards and their toolbar) are brighter at rest, matching the stream sidebar's Archive and Delete, and a disabled one now stands apart from its neighbors.
- The Converter, Combine and Player accept every video format a stream folder can hold (WMV, M4V, MPG, M2TS and the rest), where their drop zones and open dialogs used to take seven.

- The previous and next stream buttons, with the episode picker, look the same in every place they appear: the streams sidebar, the player, the thumbnail editor and the link picker, each group on a slightly darker field. The thumbnail editor shows them as soon as it opens, disabled for the moment the stream list takes, instead of a second or two later.

## Settings

- Three thumbnail settings that no longer did anything are gone: use the built-in creator by default, default built-in template, and default external template. Thumbnails start in the built-in editor, and a file made elsewhere is added to a stream like any other file.
- Default Watch Directory now does what it says: adding a new auto-rule starts with that folder filled in.
- The episode numbering setting works now, under its new name, Number episodes automatically. Off, a new episode starts with an empty episode number for you to type; on, it fills in the next number for that topic and season as before.

## Dump-folder libraries

- The dump-folder layout (every stream's files in one folder, told apart by the date in their names) is being retired. Stream Manager 3.0.0 will open a library only in the folder-per-stream layout; no date is set for that release, and this version keeps opening a dump folder as before. A dump library gets a notice on its first launch and a standing reminder at the top of the Streams page, both leading to the one-click conversion that was already in Settings. Setup no longer offers the dump layout as a choice: a folder that uses it is recognized, the retirement is explained, and the conversion is offered as the next step, with undo. It is not required until 3.0.0.

## Questions and bug reports

- Ask in the Discord server at https://discord.gg/MMjuHe6ZM2, or open an issue at https://github.com/pjmdesi/stream-manager/issues. A bug report is most useful with the Stream Manager version, your Windows version, and the steps that led to it.
