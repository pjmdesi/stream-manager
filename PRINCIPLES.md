# Design principles

These are the rules Stream Manager is built against, so you can check it against
the app's behavior or its source code and decide for yourself whether it holds.

They are published at https://stream-manager.app/principles. This file is the
canonical copy: any change to a principle is a dated, public commit rather than
a quiet edit, which is the point. Changing one should be difficult and visible.

Adopted September 2026.

Each entry carries two notes the website does not: where the behavior lives in
the code, and what would break the principle. The second is the useful one when
checking a future change against what has been published.

---

## Your files are yours

Your library is made of ordinary folders and files on your own disk. What Stream
Manager knows about them lives in a readable JSON file beside them (JSON is a
plain text format with basic hierarchy), not in a proprietary database. No
telemetry or analysis is performed on your files or other stream-related data.
There is nothing to export or migrate, and nothing is obscured. If you delete
the Stream Manager app, every media file and detail of your streams is left on
your machine untouched.

*Where this lives:* `_meta.json` written per streams directory
(`src/main/ipc/streams.ts`); settings in `electron-store` JSON under AppData. No
database dependency exists in `package.json`.

*What would break it:* introducing SQLite or any store that holds data the files
themselves do not.

## No account, no analytics, no tracking

There is nothing to sign up for and nothing tracking how you use the app. The
only external request Stream Manager regularly makes on its own is a check
against Stream Manager's public GitHub repository for a new version, and you can
switch that off in Settings. The one other request it can make happens if a
user-prompted or pre-approved request to YouTube fails: the app checks two
standard connectivity endpoints to work out whether your internet connection is
down or if YouTube is. This request sends nothing about you, and it only runs
after a failure.

*Where this lives:* `src/main/services/updateCheck.ts` (6 hour cache TTL,
honours the `checkForUpdates` setting); `src/main/ipc/net.ts` (the two
connectivity probes, reactive only, 30 second result cache). No analytics or
telemetry package is a dependency.

*What would break it:* any usage reporting, any crash reporter that transmits,
any request on a timer that is not the update check.

## It only talks to services you connect

YouTube, Twitch, and Claude are optional, and each one uses credentials you
supply yourself: your own Google Cloud OAuth app, your own Twitch login, your
own Anthropic API key. Those credentials are encrypted and saved to your disk,
tied to your Windows user account, so another account on the same machine cannot
read them and a copied settings folder is unusable elsewhere. Your stream
details go to those services when you ask for them and not otherwise. Stream
Manager has no server of its own for anything to be sent to.

*Where this lives:* the complete set of hosts the app contacts is
`api.github.com` (updates), `googleapis.com` / `accounts.google.com` (YouTube,
user's OAuth app) plus YouTube's image servers when a video's thumbnail is
downloaded into your library during import or linking (the URL comes from the
YouTube API response), `api.twitch.tv` / `id.twitch.tv` (Twitch),
`api.anthropic.com` (user's key), and the two connectivity probes above. Links
the app offers (GitHub, YouTube Studio, the Google Cloud console) open in your
own browser and are not requests the app makes. Encryption at rest is
`src/main/services/secretStorage.ts` (Electron `safeStorage`, DPAPI on Windows,
`enc1:` marker prefix), applied at the write boundary in `youtubeAuth.ts`,
`twitchAuth.ts`, and the config store's secret fields.

*What would break it:* adding a first-party backend, routing any user data
through a host the user did not connect, or storing a new credential without
running it through `encryptSecret`.

## Stream Manager never speaks unless spoken to

No in-app toasts, no Windows notifications, no "what's new" on launch. Status
and errors appear inside the app, next to the thing they are about. Popup
notifications can be useful, but they are also an abused surface on your
desktop, so Stream Manager is designed to refrain from using them entirely
rather than deciding case by case.

*Where this lives:* the no-toast and no-OS-notification rules in
`~style_guide.md` under "App-level rules (hard preferences)". Errors from
background or tray-initiated actions raise and focus the main window and surface
in-app instead.

*What would break it:* any toast library, any use of the Windows notification
centre, any modal that appears on launch to announce a change.

## When something fails, it says so, and says why

Failures appear where you are working, with the actual error message rather than
a generic "something went wrong" (whenever possible). Nothing fails quietly in
the background, and nothing pretends to have succeeded.

*Where this lives:* the "errors surface inline" rule in `~style_guide.md`; IPC
handlers reject with real messages rather than swallowing them.

*What would break it:* a catch block that swallows an error, a generic failure
message that hides the cause when the real one is available, or a background
task that fails without surfacing it in the app.

## Your library survives a crash

Stream details (`_meta.json`) are written to a temporary file and swapped into
place in a single step, so an interrupted write cannot leave a damaged one.
Backups are kept on your machine and restored automatically if a problem is
found, and a file that cannot be recovered is preserved beside its replacement.
A crash or a power cut during this save process costs at most your last single
change. Changes are automatically saved as soon as you make them. Your settings
files are written the same way, though the backups above are specific to your
library's metadata.

*Where this lives:* `writeAllMeta` in `src/main/ipc/streams.ts` (temp sibling,
flush, atomic rename; refuses to write while the store is in a failed-read
state), rotating backups plus `backupMetaOnQuit`, and `_meta.corrupt-*.json`
preservation on unrecoverable corruption. Callers invoke `writeAllMeta`
synchronously at each mutation, with no write debounce. Other stores go through
`electron-store` (conf's `atomically`), which gives the same atomic replacement
but none of the backup or corruption-recovery machinery above.

*What would break it:* batching metadata writes behind a timer, or extending the
"backed up and recoverable" claim to stores that only get atomic replacement.

## Every release can be traced back to its source

Each version is built by a public pipeline on GitHub's own infrastructure,
straight from the public code, and only publishes if that code passes its
checks. The full build log is public and a SHA-256 checksum sits beside the
download, so the file you run can be matched to the code that produced it.

*Where this lives:* `.github/workflows/release.yml` (typecheck and lint gate,
then build, on every `v*` tag) and `_release-process.md`. The pipeline builds
from the tag, which is what ties a download to an exact commit; the public copy
says "the public code" deliberately, for readers who do not use GitHub. The
SHA-256 digest beside each download is computed and shown by GitHub for every
release asset, not produced by the build, so the build cannot alter it.

*What would break it:* publishing an exe that was built or uploaded outside the
pipeline, since its digest would then match no public build log, or a release
whose tag does not point at the commit the notes describe.

---

## Reporting a broken principle

If you find something here that does not match Stream Manager's design or
behavior, that is a bug. Open an issue at
https://github.com/pjmdesi/stream-manager/issues or get in touch in the Discord
server. Being told a principle has slipped is more useful than the principle
looking tidy.
