# Kinami Website — kinami.io + dronereporter.io

The live Kinami site: `TMorville/kinami-website`, served as **static HTML from the
repo root** (no build step in the deploy path, no `dist/` committed, no CI
workflow). Vite is a local convenience only, and `npm run dev` serves on Vite's
default port (no port is configured). **`npm run build` currently fails**, and
nothing in the deploy path calls it. See "Vite config is stale" below.

One repo, two deploy targets. See "Deployment" below before touching
`dronereporter/`.

## Pages

Each page is its own `index.html`; there is no single "main page".

- `index.html` — the Kinami landing page
- `teamoftraders/` — Team of Traders showcase. **Not on `main`.** It lives only on
  the `feature/teamoftraders-showcase` branch, along with `lib/teamoftraders/` and
  `docs/`. Its PR ([#9](https://github.com/TMorville/kinami-website/pull/9)) was
  closed 2026-09-01 without merging; the branch is still there.
- `dronereporter/` — product page + `privacy/`, `terms/`, `deck/`
- `dronetracker/` — legacy paths, now three redirect stubs pointing at
  `https://dronereporter.io/`. No content of its own.

### Vite config is stale

`vite.config.js` lists 47 rollup inputs. 46 of them are `pages/*.html` exploration
files that were deleted, so `npm run build` fails on the first missing entry. It
does not register `teamoftraders/index.html` either. This breaks nothing today,
because every host serves static HTML from the repo and no build runs in the
deploy path, but do not trust the config as a description of the site. Fix it
before relying on a build.

## Shared code

- `lib/logo/` — the animated logo/lockup (strange-attractor mark, `mark-animator.js`,
  render + export helpers, `preview.html`, smoke tests)
- `lib/teamoftraders/` — the showcase's modules. Only on the showcase branch, not `main`.
- `assets/` — logo and Team of Traders assets
- `pages/` — **output only**: `renders/` (mp4) and `screenshots/` (png). Not source.

## Design

`.interface-design/system.md` is the source of truth for tokens, type scale,
spacing, surfaces, animation, and component patterns — and it is the upstream
system that `~/kinami/presentations/design.md` and the Drone Reporter Flutter app
mirror. Read it before building or modifying any UI.

Single-hue amber on warm near-black: every color is `rgba(220, 180, 100, α)` at
varying opacity. No secondary hue — hierarchy comes from opacity, depth from
hairline borders and blur.

## Deployment

Two hosts build from this one repo, both off `main`. A push to `main` triggers
both.

1. **GitHub Pages** serves the whole repo root at **kinami.io**.
2. **Cloudflare Pages** (project `dronereporter`) serves the **`dronereporter/`
   subtree as its own document root** at **dronereporter.io**. Build command is
   empty, framework preset None, build output directory `dronereporter`. Every
   branch also gets a preview deployment, so a PR branch has its own URL.

Consequences for the `dronereporter/` subtree:

- **Keep every internal path relative.** The subtree is served at two different
  roots at once (`/` on dronereporter.io, `/dronereporter/` on kinami.io), so
  root-absolute paths break on one of them. Home page to privacy is `privacy/`,
  a legal page back to privacy is `../privacy/`.
- **Assets must live inside the subtree.** Cloudflare Pages cannot see anything
  above `dronereporter/`. The icons and `og.png` are copied into
  `dronereporter/assets/logo/`; the originals in `/assets/logo/` stay because the
  kinami.io root page uses them. Change one, copy to the other.
- **`dronereporter/deck/assets/` is a THIRD copy, and it drifts.** The gated deck is
  its own document root, so it cannot reference `../assets/` and keeps duplicates of
  `threat-data.json`, `threat-map.js`, `europe.min.geojson`, `hero.mp4` and
  `hero-poster.jpg`. Nothing keeps them in sync and no test catches divergence. On
  2026-09-01 the site copy of `threat-data.json` was found two months behind the deck
  copy one directory over (29 incidents vs 36), and it also lacked the cache-buster
  the deck copy had gained *because* the map was serving stale data on reload — so the
  public site had the older data and the bug that makes old data stick. **After
  editing either copy, `cmp` the pair and copy across.** Verify the served file, not
  the repo file.
- Absolute URLs are correct in exactly two places: crawler metadata
  (`og:*`, `twitter:*`, `canonical`) points at `https://dronereporter.io/`, and
  the "kinami.io" back-links point at `https://kinami.io/` because they are now
  cross-domain.
- `dronereporter/404.html` is what makes HTTP status codes meaningful on the
  Cloudflare project. Without it, Pages served the root `index.html` with 200 for
  every unmatched path. If you verify a deployment, verify by content and always
  run a negative control against a path you know does not exist.
- Redirects and headers are handled at the Cloudflare layer, not by a
  `_redirects` or `_headers` file in this repo. Do not add one.
- Do not move or rename the subtree. The Pages project builds from it in place.

## Sibling checkout

`~/kinami/website-bg` is a second working copy of this same repo on the
`logo/animated-background` branch. Changes there are not in this checkout until
merged; don't assume the two agree.
