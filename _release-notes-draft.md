# Release notes draft (next release from `dev`)

> Running draft, maintained ON `dev`. When a feature lands, append a line to the right section in the same sitting. At promotion time this gets edited into the GitHub-release copy (trim, reword, reorder headline-first; see `archive/_release-notes-v2.md` for the structure, but NO emojis anywhere) and the file is emptied for the next cycle. Wording here is working-quality, not final. Fixes that already shipped in a hotfix release do NOT belong here. Style lessons from the v2.5.0 edit: plain category titles, modest scope claims, user vocabulary only, no micro-detail.

Target: TBD · emptied 2026-10-02 after the v2.7.0 release.

## Under the hood

- Routine dependency update: Electron 44.5.1 and current versions of the build and UI libraries, which clears every known advisory in the packages the app ships except one in the auto-rules file watcher that only a rule pattern you write yourself could trigger.
