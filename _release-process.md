# Release process

How code moves from an idea to a published release. Adopted 2026-07-25, after v2.0.12.

## Branches & build types

| | `master` | `dev` |
|---|---|---|
| Role | Release branch — always shippable, matches (or is about to become) the published release | Integration branch — all feature work lands here |
| Direction | Receives `dev` at promotion time; receives hotfixes directly | Receives `master` immediately after every hotfix (so dev is always a superset of master) |

Three build types (terms + indicators pinned in [`~style_guide.md`](~style_guide.md)):

- **Release build** — `npm run release:*` on `master`. Clean artifact name, normal icon, **no chips**. The absence of markers is enforced by `scripts/dist.cjs` (only non-master builds get dev markers), so a marker showing up in a release exe means the build ran on the wrong branch.
- **Dev build** — `npm run dist` on any other branch. `_DEV` artifact name, yellow dev icon, purple branch chip (from the shipped `dev-branch.txt`). This is the dogfooding/testing exe.
- **Dev server** — `npm run dev`. Amber `server` chip; branch chip too when off master.

## Daily rhythm (on `dev`)

1. Implement the item; verify with the numbered steps; `npm run typecheck` and `npm run lint` (two separate runs).
2. Commit (developer commits; Claude drafts the message).
3. **Append a line to [`_release-notes-draft.md`](./_release-notes-draft.md) in the same sitting.** This is what makes release notes a ten-minute edit instead of commit archaeology.

## Themed batches

[`_todo.md`](./_todo.md)'s improvement list is grouped by app area. A release batch = one theme (or a small set of related themes) worked to completion. Small themed batches are easier to regression-test, produce coherent release notes ("the thumbnail editor release"), and keep the suspect list short when something breaks. Avoid letting dev drift too many commits past master.

## Dogfooding

Between releases, periodically `npm run dist` on dev and use the `_DEV` exe as the daily driver — **especially for real streams**, which are the highest-value test environment. Packaged builds differ from the dev server (resource paths, PowerShell/cfapi, tray, single-instance), so bugs hide in that gap.

## Stabilization sweep (before promoting)

When the batch is done: stop adding features, build a fresh `_DEV` exe, and run a checklist against **the packaged build** (not the dev server). Keep the checklist as a repo-root working file (`_release-test-checklist-<date>.md`), archive to `archive/` when done — same convention as v2.

Checklist template:

```markdown
# Release test checklist — v<X.Y.0> (<date>)

Build: Stream Manager <version>_DEV.exe from dev @ <commit>

## This batch
- [ ] (re-run each new feature's verification steps in the packaged build)

## Core regression (every release)
- [ ] Relay: full lifecycle on a real or test stream — bind → ingest → live → complete; post-stream Twitch auto-update fires (60s delay)
- [ ] Watcher/auto-rules: drop a recording into the watch folder → lands in the right stream item
- [ ] New stream + New episode: correct season/episode, templates render
- [ ] YouTube: push + pull a stream's details; thumbnail push; out-of-sync panel clean afterward
- [ ] Converter: one job start→finish; pause/resume; output plays
- [ ] Player: open a video, clip draft → export
- [ ] Thumbnail editor: open, edit, export; variant creation
- [ ] Cloud: pin local + offload one item; statuses update everywhere
- [ ] Launcher: run a launch group (window + tray)
- [ ] Quit/relaunch: no orphaned processes, state restored
```

## Promotion (dev → master)

Since v2.5.0 the SHIPPED exe is built by CI (`.github/workflows/release.yml`): pushing the release tag triggers a clean-environment build that attaches the exe to a draft GitHub release. The local build that `release:minor` produces is no longer what ships (the dist folder carries a marker saying so); it only exists as a byproduct of the version script.

Dev must already contain master (guaranteed by the hotfix rule). Then:

```powershell
git checkout master
git merge dev                # clean merge; dev is a superset
npm run typecheck            # paranoia pass on the merged result
npm run lint
npm run release:minor        # bumps X.Y.0, commits, tags vX.Y.0 (local build is a byproduct, not the artifact)
git push origin master
git push origin vX.Y.0       # THIS triggers the CI release build
```

Then on GitHub:

1. Actions: wait for the release workflow run on the tag to go green (a few minutes; typecheck + lint + dist on a clean runner).
2. Releases: the workflow created a DRAFT release for the tag with the exe attached. Download that exe and smoke it: correct name, normal icon, **no chips** (a dev marker means the tag was cut from the wrong branch).
3. Edit the draft: paste notes (edited from `_release-notes-draft.md`, then empty the draft file for the next cycle), mark **latest**, publish. No manual exe attach; the workflow already did it.
4. Verify `releases/latest` resolves to the new version; the website's download buttons point there.

Back in the repo:

```powershell
git checkout dev
git merge master             # bring the version-bump commit back
git push
```

## Hotfixes

Bug in the published release → fix on `master`:

```powershell
git checkout master
# fix, verify, commit
npm run release:patch
git push origin master
git push origin vX.Y.Z       # triggers the CI build, same as a minor release
# wait for Actions, smoke the CI exe from the draft release, publish (marked latest)
git checkout dev
git merge master             # IMMEDIATELY — keeps dev a superset
git push
```

Never fix release bugs on dev first: master falls behind and the next promotion inherits untested drift. Hotfix notes go straight into the GitHub release, NOT into `_release-notes-draft.md` (that file is only for unreleased work).

## Versioning

- **Minor** (`release:minor`) — a themed feature batch promoted from dev.
- **Patch** (`release:patch`) — hotfix on master.
- **Major** — reserved for platform-scale shifts (a v3).
