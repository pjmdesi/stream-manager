# v2.5.0 GitHub release copy (working file)

> Paste the body below into the draft release, then this file gets deleted and `_release-notes-draft.md` gets emptied.

---

The navigation refresh release. The sidebar is reorganized around how the app is actually used, the old bottom-of-sidebar widgets now live inside their nav items, the stream detail sidebar got a full reorganization, and a long polish pass touched nearly every page. This is also the first release built and published through Stream Manager's public CI pipeline.

## Navigation redesign

- The nav is organized into three groups: creation pages (Streams, Player, Thumbnails), utilities (Converter, Combine), and session tools (Launcher, Auto-Rules), with Integrations and Settings at the bottom. The expanded sidebar is slightly wider.
- The Converter, Launcher, and Auto-Rules widgets moved from the bottom of the sidebar into their nav items:
  - Converter: aggregate progress and ETA slide open under the item while jobs run.
  - Launcher: an always-visible launch button on the row runs the pinned group and doubles as feedback (spinner, check, or warning with details in the tooltip). Ctrl+L still quick-launches.
  - Auto-Rules: promoted to a real nav item, with a Start/Stop control on the row and a "Running" status line while the watcher runs.
- Context subtitles under active items show the open stream, video, or thumbnail canvas, and the right-edge activity accent fades with them.
- The Integrations item shows per-service health (YouTube, Twitch, Claude AI): green when healthy, amber when something is broken. The collapsed rail aggregates this to a single dot or a warning triangle.
- Page-jump shortcuts follow the nav's visual order: Ctrl+1 through Ctrl+7 map to positions, and Ctrl+PageUp/PageDown cycle in the same order.
- Collapsed sidebar polish: each item's column hovers and selects as one unit, clicking anywhere outside a control navigates, and the collapse/expand animation is fully choreographed. The startup-page star moved to each row's left edge (hover to reveal).

## Stream detail sidebar reorganization

- The header leads with the stream title, with the date, episode navigation, Archived control, and a New episode button (up from the footer pile) on the row below.
- The files grid sits in its own input-style panel with the section's controls in a header inside it: collapse, type filters, file operations (Open folder and Offload / Pin local moved here from the footer), and select mode. Collapsing shrinks the panel to a summary bar that keeps the file operations available.
- When a stream has no SM-created thumbnail yet, a "Create thumbnail" tile sits in the files grid where the thumbnail card will appear, opening the thumbnail editor directly.
- Bulk-select buttons say how many files each will actually affect ("Offload selected (2) to cloud") and disable themselves when the answer is zero.
- The broadcast section leads with a Date button (the header date button's twin, opening the same reschedule modal), so date, broadcast time, and privacy are all verifiable right where the push happens.
- The Series controls are one segment group: a check toggle fused to the season/episode steppers. Turning Series off disables the numbers in place instead of hiding them.
- The Twitch title and category fields are override toggles: off by default and showing exactly what will be pushed (the YouTube title, the picked topic tag). Turning one on seeds the editor with the inherited value, and the custom title editor is a full twin of the YouTube title field, with templates, merge fields, and AI suggestions included.
- The YouTube thumbnail row is informational now: the push always uploads the stream's primary thumbnail, chosen in the files grid. The old per-push override picker is gone.
- The footer is down to Archive and Delete with permanent labels; the Player, Converter, Thumbnails, and Combine buttons are gone now that the files grid covers their jobs.
- Both date buttons' tooltips include a small reference calendar, and the Reschedule and New stream / New episode dialogs now show their calendar permanently in one compact panel.

## UI polish

- Four new tag colors: Purple, Brown, Black, and White. The color previously labeled Purple was actually the app's neutral cool gray, so it is now honestly labeled Gray, and tag textures draw in light ink on Black tags so the patterns stay visible.
- Converter and Combine progress now fills the row's own background instead of a thin bar squeezed between row elements, and each conversion row's status icon sits in its own column so the state reads at a glance.
- The last plain number inputs (cache limit, max simultaneous conversions, the relay's custom port) are now stepper fields, and spinner tooltips state their actual step ("+128, Shift = x10").
- Thumbnail editor: the Layers and Properties panels are collapsible like their siblings, and palette edit mode is unmistakable now (amber pencil, amber outline around the panel contents).
- Ctrl+= (plus) now zooms the app UI back in, matching how browsers treat the key. Previously an accidental zoom-out was a one-way trip for anyone who didn't know the reset shortcut.
- The Help modal caught up with the app: merge fields render as real chips instead of brace text, the shortcuts list matches the new nav order, and the old Widgets section became a Stream Relay section.
- Assorted fixes: hovering a stream row's date shows the complete date; row hover actions and file card buttons collapse to icons at narrow widths instead of overflowing; stream titles no longer wrap with a stray leading space after a "|"; the Integrations page opens in its last-known state instead of flashing the disconnected layout.

## Under the hood

- Releases are now built and published through a public CI pipeline (GitHub Actions): every release exe is built in a clean environment directly from the tagged source, with the build log public and a SHA-256 checksum on each download. Nothing changes about how the app is downloaded or used; it just makes every release verifiable.
