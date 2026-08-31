# Kinami Website — kinami.io + dronereporter.io

The live Kinami site: `TMorville/kinami-website`, served as **static HTML from the
repo root** (no build step in the deploy path, no `dist/` committed, no CI
workflow). Vite is a local convenience only — `npm run dev` on port 5199.

One repo, two deploy targets. See "Deployment" below before touching
`dronereporter/`.

## Pages

Each page is its own `index.html`; there is no single "main page".

- `index.html` — the Kinami landing page
- `teamoftraders/` — Team of Traders showcase (the current active work)
- `dronereporter/` — product page + `privacy/`, `terms/`, `deck/`
- `dronetracker/` — product page + `privacy/`, `terms/`

`vite.config.js` only registers `index.html` and `teamoftraders/index.html` as
rollup inputs. The other pages are static-served and never enter a bundle — if you
add a page that needs bundling, add it to the config too.

## Shared code

- `lib/logo/` — the animated logo/lockup (strange-attractor mark, `mark-animator.js`,
  render + export helpers, `preview.html`, smoke tests)
- `lib/teamoftraders/` — the showcase's render/interaction/narrative modules
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
