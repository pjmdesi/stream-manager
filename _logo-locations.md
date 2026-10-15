# Logo and icon locations

The logo will change at some point. This is the list of every place the current mark lives, so a change is a sweep down a list instead of a search. Keep it current: whenever a copy of the logo is added anywhere (a repo file, a service profile, a listing), add it here in the same sitting.

Last full inventory: 2026-10-15.

## Master sources (edit these, export everything else)

| File | What | Last changed |
|---|---|---|
| `src/renderer/src/assets/stream-manager-logo.af` | Affinity Designer master of the logo | 2026-04-02 |
| `src/renderer/src/assets/stream-manager-dev-logo.af` | Affinity master of the dev-build variant | 2026-07-24 |
| website `assets/og-thumb.af` | Affinity master of the social card (contains the logo) | 2026-05-16 |

## App repo (this repo)

| Path | Used by | Notes |
|---|---|---|
| `src/renderer/src/assets/stream-manager-logo.svg` | `src/renderer/src/App.tsx` (sidebar mark, imported as `logoUrl`); `src/renderer/index.html` (icon link) | The in-app logo. 2026-04-08. |
| `resources/icon.png` | `package.json` build config: `win.icon`, `mac.icon`, `linux.icon`, and `extraResources` copies it to `icon.png` next to the app; `src/main/env.ts` resolves that copy as `iconPath` for the window icon (`src/main/index.ts`) and the 16 px tray icon; `README.md` first line renders it | The app icon in every form: exe, taskbar, Start menu, window, tray, README. 2026-04-02. |
| `resources/icon-dev.png` | `scripts/dist.cjs` swaps it in for `_DEV` builds | Dev icon, so dev builds are told apart at a glance. Needs its own redraw. 2026-07-24. |
| `src/renderer/src/assets/stream-manager-dev-logo.svg` | nothing (no reference in `src/`) | Exported dev variant, currently unused. Delete or wire up at the next change. |
| `resources/stream-manager-logo.svg` | nothing (no reference in code or config) | Stray copy of the in-app SVG, same bytes. Delete at the next change. |
| `favicon.zip` (repo root) | nothing | The favicon generator package behind the website's `public/` icons (dated 2026-05-02, same day as those files). Belongs with the website; move or delete at the next change. |
| `resources/_Archive/` | nothing | Older assets kept for reference (currently one old hero screenshot). |

## Website repo (`d:\GitHub\stream-manager-website`)

| Path | Used by | Notes |
|---|---|---|
| `src/assets/stream-manager-logo.svg` | `src/Layout.tsx` header (home link, alt "Stream Manager Logo") | The site's logo. 2026-05-01. Not served as a file: at 2,937 bytes it sits under Vite's 4 KB inline limit, so it is embedded as a data URI in every prerendered page and in the JS bundle. A change needs a rebuild and deploy; nothing hotlinks it; there is no CDN file to purge. |
| `public/favicon.svg` | `index.html` `<link rel="icon" type="image/svg+xml">` | 2026-05-02. A different drawing from the header SVG (different bytes, not the same export), so it needs its own export from the master. |
| `public/favicon.ico` | `index.html` `<link rel="shortcut icon">` | 2026-05-02 |
| `public/favicon-96x96.png` | `index.html` `<link rel="icon" sizes="96x96">` | 2026-05-02 |
| `public/apple-touch-icon.png` | `index.html` `<link rel="apple-touch-icon">` | 180 x 180. 2026-05-02 |
| `public/web-app-manifest-192x192.png`, `public/web-app-manifest-512x512.png` | `public/site.webmanifest` (maskable icons) | 2026-05-02 |
| `public/og-image.png` | `index.html` `og:image` and `twitter:image` | 1200 x 630 social card, carries the logo. 2026-05-12. The `og:image:alt` and `twitter:image:alt` text describes the card as an app screenshot; update it if the card stops being one. |
| `public/screenshots/sm-streams.png`, `public/screenshots/sm-clipper-full.png` | the JSON-LD `screenshot` array in `index.html` (served at stable public URLs; search engines can surface them as rich-result screenshots) | Pre-2.5.0 UI with the old nav, logo in the sidebar. Stale today regardless of the logo; replace with current captures under the same file names. 2026-05-02. |
| `public/itchio-cover.png` | nothing (served live at the root URL) | itch.io store cover: old mark, wordmark, old screenshot. itch.io was dropped 2026-08-28. Delete now rather than at the next change; it is a public URL carrying a dead channel's art. |
| `src/assets/og-image.png` | nothing | Byte-identical duplicate of the public one (confirmed by hash), unreferenced. Delete at the next change. |
| `src/assets/icon.png` | nothing | Byte-identical to the app's `resources/icon.png` (confirmed by hash), unreferenced. Delete at the next change. |
| `assets/og-thumb.png` | nothing in the build | A different export of the `.af` master, not a copy of `public/og-image.png`; keep as the social-card source. 2026-05-01 |
| `public/icons.svg` | site chrome | Icon sprite for GitHub, Discord, Bluesky, X, documentation and social links. Third-party marks only, not the logo; listed so nobody goes looking. |

## Baked into shipped builds

- Every released exe embeds `resources/icon.png` at build time, and the portable launcher wears the same icon. A shipped release keeps the icon it was built with, so Start menu, taskbar and Explorer show the old mark until the user runs a newer release. A logo change reaches users with the next release, not before.
- The GitHub release pages themselves show no logo; the repository's README does (first line).

## External services (no file in any repo; update by hand)

- **AlternativeTo listing**: the app icon on the listing.
- **Discord**: the server icon; the avatar of the release-announcement webhook (`DISCORD_WEBHOOK`, used by `.github/workflows/discord-release.yml`); any role icon that uses the mark.
- **GitHub**: the app repository's social preview image (Settings, General, Social preview), if one has been uploaded; it is separate from `og-image.png`. The website repository is private, so its preview does not matter.
- **Checked 2026-10-15 and clear**: Netlify (no setting, badge or asset outside the repo), Bing Webmaster Tools, Google Search Console, Cloudflare Web Analytics, and `llms.txt` (no image URL). The site's JSON-LD has no `logo` or `image` property today; if one is added, it becomes a new entry here.
- **To check when the time comes**: any Bluesky or X profile that represents the app (the site's icon sprite has both marks, but as of 2026-10-15 the pages link only to Discord), any donation page, and the website session's own inventory below.

## Screenshots that show the logo (re-shoot after a change)

The logo appears in the sidebar of every app screenshot. After a change these go stale:

- App repo: `resources/sm-hero.webp` (README hero).
- Website repo: everything under `src/assets/screenshots/` (hero, streams, player, converter, cloud, launcher, relay, integrations, templates, stream details, thumbnails), the two JSON-LD screenshots under `public/screenshots/`, plus `public/og-image.png` above.
- Onboarding images in `src/renderer/src/assets/onboarding/` show folder layouts, not the app chrome; check rather than assume.

## Sweep procedure

1. Edit the Affinity masters, export the SVG and PNG sizes.
2. In each repo: `git ls-files | grep -iE "logo|icon|favicon|og-"` and replace every hit that is the mark (this list says which hits are the mark and which are third-party icons).
3. Export a favicon SVG from the Affinity master (the current `public/favicon.svg` is its own drawing, not the header SVG) and regenerate the website favicon set from it; the `public/` files above come from one generator run. Keep the same file names so `index.html` and the manifest need no edit.
4. Update the external services, then re-shoot the screenshots.
5. Bump this file's "Last full inventory" date.
