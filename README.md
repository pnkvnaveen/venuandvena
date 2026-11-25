# venuandvena.com

The Venu & Vena website: the home of the kids' brand, for parents of 3 to 5 year olds. It shows the
YouTube episodes and Shorts, our apps (Echo Pals first) and a feedback form, in the channel's Paper
Garden look.

It is a Cloudflare Worker with static assets on the personal Cloudflare account, deployed by
Cloudflare Workers Builds on every merge into `main` (deploy command `npx wrangler deploy`; wrangler
runs the build itself). Nothing is deployed from a laptop or a cloud session.

## Rules (a kids' brand)

- No ads, no analytics, no cookies, nothing loaded from other sites. `npm run check` fails if a page
  loads anything from another address, and the Worker sends a strict Content-Security-Policy.
- YouTube plays only after a tap, in the youtube-nocookie.com player. Thumbnails come from our own
  address (`/thumb/<id>`), so the browser contacts Google only when someone presses play.
- Fast on phones, 48 px touch targets, dark mode, WCAG AA contrast, keyboard friendly.

## Layout

| Path | What it is |
| --- | --- |
| `site/pages/` | One file per page. `pages/about.html` is served at `/about`. A comment at the top sets the title, description, menu item and body class. |
| `site/layout.html` | The shared header and footer. |
| `site/css`, `site/js`, `site/img`, `site/fonts` | Copied as they are. Fonts (Baloo 2, Andika, SIL OFL) are stored here, never loaded from Google. |
| `site/data/videos.json` | The channel's public episodes and Shorts, from `tools/sync_videos.py`. |
| `site/pages/studio/` | The Venu & Vena Studio app's home and privacy pages (the Google sign-in app), served at `/studio`. The old copies at the repo root stay for GitHub Pages until the app's consent screen points here. |
| `scripts/build.mjs` | Builds `dist/` from `site/`. No dependencies. |
| `scripts/check.mjs` | The checks above, plus a test of the newest-video logic. |
| `src/worker.js` | Keeps the Home page's newest episode current from the channel's public feed, serves thumbnails, redirects www, sets security headers. |
| `tools/make_art.py` | Makes the pictures from the channel's own art (run from a `venu-vena-studio` checkout). |
| `tools/sync_videos.py` | Refreshes `videos.json` from the YouTube API (read-only). |

## Commands

```sh
npm install
npm run dev      # builds, then serves on http://localhost:8787
npm run check    # builds and checks
python3 tools/sync_videos.py   # needs YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN
```

## Fixed addresses

The Echo Pals app links to these, so they must never change: `/echopals`, `/echopals/privacy`,
`/echopals/support`.
