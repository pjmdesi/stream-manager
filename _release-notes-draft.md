# Release notes draft (next release from `dev`)

> Running draft, maintained ON `dev`. When a feature lands, append a line to the right section in the same sitting. At promotion time this gets edited into the GitHub-release copy (trim, reword, reorder headline-first; see `archive/_release-notes-v2.md` for the structure, but NO emojis anywhere) and the file is emptied for the next cycle. Wording here is working-quality, not final. Fixes that already shipped in a hotfix release do NOT belong here. Style lessons from the v2.5.0 edit: plain category titles, modest scope claims, user vocabulary only, no micro-detail.

Target: TBD · emptied 2026-09-09 after the v2.6.0 release.

## Under the hood

- Stream Manager now runs on Electron 44 (Chromium 152, Node 24), up from Electron 34, which had been out of support since mid-2025. This brings ten versions of browser engine security fixes and performance work to the app. No visible changes are intended; if something looks or behaves differently after updating, that is worth a bug report.
- Folder pickers open somewhere sensible again: the folder you last chose for that setting, otherwise your streams folder, otherwise Videos. The new Electron would have opened them in Downloads.
- Buttons that carry a tooltip no longer render a pixel taller than their neighbors in a few toolbars. The tooltip wrapper is now a block-level box, which removes the stray line spacing that caused it.

## Streams

- The streams page header shows the size of the whole library next to the item count. Hover it for a breakdown by videos, clips, and images. With a cloud sync client the figure reads as space used on this PC out of the library's full size.
- Stream rows show the linked YouTube video's views, likes, and dislikes in a new column beside the date. Hover for the exact figures. They arrive with the status check that already runs, so they cost no extra quota, and that check now repeats every fifteen minutes while the app is in use (less often when idle or minimized) so privacy badges and counts keep up with YouTube during a session.
- The archived marker on files in the files grid is reliable now. It is recorded with the file's other details when Stream Manager reads the file, instead of being re-checked every time the grid opens, which sometimes missed it (and never noticed a freshly finished archive until the stream was reopened).
- Sending a cloud-offloaded video to the player no longer holds a dialog open while it downloads. Confirming starts the download in the background through the cloud sync widget, and when it finishes the video opens in the player without switching you to it (the Player item in the navigation shows what is open). The old dialog also offered to cancel the download, which was never actually possible; that option is gone.

## Converter

- The combined progress shown under the Converter item in the navigation now reflects the whole batch. Jobs still waiting for a slot count at zero and finished jobs count as complete, so the bar climbs steadily from the first job to the last instead of only tracking whatever happens to be encoding. The job count next to it now reads as completed out of total.
- The ready list has a Set all group in its header: pick an encode preset and an output location once, click Apply, and every file in the list takes them. Each row can still be changed on its own afterwards.
- Files in the ready list can be dragged into the order you want them converted in. Start all submits them in that order.
- Finished conversions move to their own Finished card below Converting, so the jobs still running stay at the top of the page during a long batch. Failed and cancelled jobs land there too, with their counts in the header. An archive group stays in Converting, whole, until its last file has finished. Clear all in the Finished header removes everything in that card.
- A conversion waiting on a cloud download no longer sits on "Downloading from cloud" forever when the download dies. If the sync client reports an error, the job fails with that reason. A download cancelled from Windows is asked for again a few minutes later, and a six-hour limit now covers archive jobs too, which previously had none.
- An archive with several files now uses every free conversion slot instead of converting one file at a time. When several streams are archived at once, the next slot goes to the stream with the fewest conversions running, so they still progress together.

## Cloud sync

- A Retry all button in the cloud sync panel re-runs every failed file in a card at once, instead of one retry click per row.
- A download that has been working for more than a few minutes now shows how long, in the cloud sync panel and on converter rows, with a note that a paused sync client holds downloads until it resumes. Stream Manager cannot tell a paused client from a slow transfer, so the row keeps waiting rather than failing.
- The cloud sync list no longer shows the same file twice when it is requested a second time while already downloading, such as pinning a file and then archiving it. The second request joins the existing row.
- Cancel pending in the cloud sync panel now does only what it says for every row. Downloads the converter started were still being aborted by it; they now finish like any other download in flight, and the Converter page's own Cancel remains the way to stop one. The button also appears only while there are waiting files to cancel, the waiting rows flip to cancelled the moment it is clicked, and it no longer reads "Cancelling" for the rest of a download.

## Integrations

- The Claude connection now shows Claude's own mark and color on the Integrations page, in Settings, in the sidebar status, and in Help, in place of a generic robot icon in orange. Orange in the app means "YouTube has a newer value" and is no longer shared with Claude.
