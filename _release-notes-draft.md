# Release notes draft (next release from `dev`)

> Running draft, maintained ON `dev`. When a feature lands, append a line to the right section in the same sitting. At promotion time this gets edited into the GitHub-release copy (trim, reword, reorder headline-first; see `archive/_release-notes-v2.md` for the structure, but NO emojis anywhere) and the file is emptied for the next cycle. Wording here is working-quality, not final. Fixes that already shipped in a hotfix release do NOT belong here. Style lessons from the v2.5.0 edit: plain category titles, modest scope claims, user vocabulary only, no micro-detail.

Target: TBD · emptied 2026-09-09 after the v2.6.0 release.

## Under the hood

- Stream Manager now runs on Electron 44 (Chromium 152, Node 24), up from Electron 34, which had been out of support since mid-2025. This brings ten versions of browser engine security fixes and performance work to the app. No visible changes are intended; if something looks or behaves differently after updating, that is worth a bug report.
- Folder pickers open somewhere sensible again: the folder you last chose for that setting, otherwise your streams folder, otherwise Videos. The new Electron would have opened them in Downloads.
