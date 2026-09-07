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

### The gated deck is built in another repo

`dronereporter/deck/index.html` is a **StatiCrypt payload, not source.** Editing it
here is not how a slide changes, and grep cannot read it. The plaintext lives in
`TMorville/dronetracker` at `deck/` (`index.html`, `deck.js`, `gate-template.html`,
its own `assets/`), and `deck/DEPLOY.md` there carries the publish flow.

To change the deck: edit the plaintext there, re-encrypt with StatiCrypt using the
**same password** (shared out of band, never committed — it keeps every `?ref=`
tracking link in an investor inbox working), then copy **only `out/index.html`**
into `dronereporter/deck/` on a branch. Never copy `assets/` or `deck.js` across:
this repo is the authority for those, and the dronetracker copies are a local
rendering convenience that goes stale by design.

To verify a rebuilt payload, decrypt it rather than trusting the file size. Read
`staticryptSaltUniqueVariableName` and `staticryptEncryptedMsgUniqueVariableName`
out of the page, reproduce the three PBKDF2 rounds (1k SHA-1, then 14k and 585k
SHA-256, with the salt used as its own hex *string*), take the first 32 hex chars of
the payload as the IV, and decrypt AES-256-CBC. Diff that plaintext against the
deck currently on `main` — the diff should be exactly the lines you meant to change.
Run a wrong password as the control; it must fail to decrypt.

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
- **`dronereporter/deck/assets/` is a THIRD copy.** The gated deck is its own
  document root, so it cannot reference `../assets/` and keeps duplicates of
  `threat-data.json`, `threat-map.js`, `europe.min.geojson`, `hero.mp4` and
  `hero-poster.jpg`. It drifted for two months in 2026 (site copy 29 incidents, deck
  copy 36, and the site lacked the deck's cache-buster). Since 2026-09-03 the first
  two files are managed: **never hand-edit `threat-data.json`**; run
  `node scripts/threat-data.mjs add <candidates.json>` (validates, sorts, bumps
  `updated`, copies to the deck) or `node scripts/threat-data.mjs sync`, and
  `tests/threat-data/` fails when the site and deck copies differ. The deck's HTML is
  a staticrypt payload, so `threat-map.js` keeps a `fillFootline` no-op for the
  deck's `#threat-footline` and one file serves both roots. The other three files are
  still unmanaged: `cmp` after editing. Verify the served file, not the repo file.
  A **fourth** copy of these files sits in the dronetracker `deck/` dir next to the
  deck's plaintext source; it is outside all of the above and is expected to be stale
  (see "The gated deck is built in another repo").
- **Finding new incidents is a daily procedure**, the repo-local skill
  `.claude/skills/threat-intake/SKILL.md` (`/threat-intake`). Declined candidates go
  to `scripts/threat-intake/rejected.json`. Both maps ping incidents whose event date
  is under 7 days old; the window is sized to that daily cadence.
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
