# Release notes draft (next release from `dev`)

> Running draft, maintained ON `dev`. When a feature lands, append a line to the right section in the same sitting. At promotion time this gets edited into the GitHub-release copy (trim, reword, reorder headline-first; see `archive/_release-notes-v2.md` for the structure, but NO emojis anywhere) and the file is emptied for the next cycle. Wording here is working-quality, not final. Fixes that already shipped in a hotfix release do NOT belong here.

Target: TBD (the nav-refresh release) · emptied 2026-08-28 after the v2.4.0 release, then seeded from the nav-redesign branch merge the same day.

## Under the hood

- Releases are now built and published through a public CI pipeline (GitHub Actions): every release exe is built in a clean environment directly from the tagged source, with the build log public and a SHA-256 checksum shown on each download. Nothing changes about how the app is downloaded or used; it just makes every release verifiable.

## UI polish

- Four new tag colors: Purple, Brown, Black, and White. The color that was previously labeled Purple is actually the app's neutral cool gray, so it is now honestly labeled Gray, and its picker swatch is a step darker so it can't be confused with the new White. The new Purple is a true purple. Tag textures draw in light ink on Black tags so the patterns stay visible.

- Number fields' spinner buttons now state their actual step in the tooltip ("+128" on the cache limit) instead of a generic "Increment" label, and the last plain number inputs (Settings cache limit, max simultaneous conversions, and the relay's custom port) now use the app's standard stepper fields.
- Hovering a stream row's date now shows the complete date ("Saturday, July 25, 2026") instead of just the day of the week.

- The palette panel's edit mode is unmistakable now: the pencil button lights up amber and an amber outline wraps the panel contents while editing. Previously the only tell was a subtly highlighted pencil, and the grayed-out recents list read as disabled rather than in-edit.
- Thumbnail editor sidebar: the Layers and Properties panels are now collapsible like the Assets and Palette panels, the Layers panel has a header icon matching its siblings, and the asset-sources control in the Assets header looks like an actual button instead of a second decorative icon.

- Ctrl+= (plus) now zooms the app UI back in, matching how browsers treat the key. Previously only Ctrl+minus and Ctrl+0 worked, so an accidental zoom-out was a one-way trip for anyone who didn't know the reset shortcut.
- The player's "Enable Multi-track Audio" button now has a tooltip explaining what the mode does: one row per audio track, with the ability to choose which tracks to listen to and extract.
- The Integrations page now opens in its last-known state instead of flashing the disconnected layout (briefly showing the expanded YouTube setup instructions, then reflowing) while its connection checks run.
- The Stream Relay section header on the Integrations page now wears the same icon as the relay widget in the sidebar, slightly larger than the other section icons, so the two are recognizable as the same feature.
- File cards in a stream item's files grid collapse their action buttons to icon-only when the grid gets narrow, instead of letting the labels overflow onto the thumbnail at minimum window width.
- The Archived checkbox in the stream detail sidebar header now sits next to the date and episode navigation buttons instead of floating in the header's center, where it overlapped the episode buttons at minimum window width.
- The stream list's hover action buttons hide when the list gets too narrow for them, instead of encroaching on the date and title text at minimum window width.
- Detail sidebar reorganization, part 1: the New episode button moved from the footer's button pile into the sidebar header, next to the episode navigation where series actions belong. Same Ctrl+Shift+N shortcut.
- Detail sidebar reorganization, part 2: Open folder and Offload / Pin local moved from the footer to the files section header, next to the files they act on, and they stay visible while the grid is collapsed. When a stream has no SM-created thumbnail yet, a "Create thumbnail" tile now sits in the files grid where the thumbnail card will appear, opening the thumbnail editor directly.
- Detail sidebar reorganization, part 3: the broadcast section now leads with a Date button (the header date button's twin, opening the same reschedule modal), so date, broadcast time, and privacy are all verifiable right where the push happens. The footer's Player, Converter, and Thumbnails buttons are gone now that the files grid covers their jobs; Combine, Archive, and Delete remain.
- Both date buttons' tooltips now include a small reference calendar showing the stream's month, with the item's date and today highlighted, for a quick look without opening the reschedule dialog.
- The files grid sits inside an input-style container (dark background, subtle border, rounded to match the file cards), so the section reads as one field in the sidebar's column instead of cards floating on the page background.
- The files grid's bulk-select buttons now say how many files each will actually affect ("Offload selected (2) to cloud"): convert and combine count only videos, offload and pin count files by where they currently live, and delete counts what in-use checks will let through. Buttons that would affect zero files disable themselves.
- Converter and Combine progress redesign: instead of a thin bar squeezed between row elements (which never lined up between conversion rows and the archive group header), progress now fills the row's own background, a green fill on the archive group header and the app's neutral tint on conversion rows. The percentage, elapsed time, and ETA text stay where they were, completed rows return to the normal background, each conversion row's status icon sits in its own larger column so the state reads at a glance, and filenames use the same monospaced style as the stream list's date names.

## Navigation redesign

- The nav is reorganized into three groups: creation pages (Streams, Player, Thumbnails), utilities (Converter, Combine, Auto-Rules), and session tools (Launcher, with Stream Relay joining once it gets its own page). Integrations and Settings float to the bottom of the item area. The expanded sidebar is slightly wider.
- Page-jump shortcuts now follow the nav's visual order: Ctrl+1 through Ctrl+7 map to item positions (Thumbnails is Ctrl+3, Converter Ctrl+4, Combine Ctrl+5, Auto-Rules Ctrl+6, Launcher Ctrl+7). Ctrl+PageUp/PageDown cycle in the same order.
- The Converter, Launcher, and Auto-Rules widgets no longer sit at the bottom of the sidebar; their info and controls live inside their nav items:
    a. Converter: aggregate progress, status, and ETA appear under the item while jobs run, sliding open when a job starts and sliding shut when the last one finishes.
    b. Launcher: an always-visible launch button on the row wears the pinned group's own icon and doubles as feedback (spinner while launching, check on success, warning when apps fail, details in the tooltip with the app list). Ctrl+L still quick-launches.
    c. Auto-Rules: promoted from a widget to a real nav item, with a Start/Stop control on the row and a "Running" status line (enabled/total rules) while the watcher runs.
- Context subtitles appear under active items: the open stream's title under Streams, the open video's stream (or its filename when external) under Player, the open canvas's stream under Thumbnails, and transient launch feedback under Launcher. Subtitles animate in and out, and the right-edge activity accent fades with them. Selecting a stream also gives the Streams item the same active styling the other items use.
- The Integrations item shows per-service status: a dot and icon for each connected service (YouTube, Twitch, Claude AI), green when healthy, amber when broken (expired token, invalid key). Never-connected services show nothing. The collapsed rail aggregates this to a single green dot, or a warning triangle when any service is broken. Replaces the old YouTube-only warning triangle.
- The startup-page star moved to the left edge of each row (hover to reveal), leaving the row's right side to the action buttons and the activity accent.
- Collapsed sidebar polish: each item's column (icon, control, status) hovers, highlights, and selects as one unit, and clicking anywhere in the column outside the actual control navigates to the page. Controls line up across items.
- Collapse/expand animation pass: while collapsing, expanded content clips against the moving edge and the compact controls slide in once the width settles; expanding dismisses the compact controls instantly and reveals the expanded layout with the motion. The Stream Relay widget follows the same choreography.
