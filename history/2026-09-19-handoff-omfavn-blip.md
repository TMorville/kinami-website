# Handoff: omfavn.app, fix the ensō blip, then merge #34

Written 2026-09-19 by session `omfavn-web`. **This file is public once merged**: GitHub Pages
serves the whole repo root, `history/` included (see Facts). No account or zone IDs in here
for that reason; read them from the Cloudflare dashboard or API.

## Where things are

| What | Location | State |
|---|---|---|
| Site source | `omfavn/` in `TMorville/kinami-website`. This checkout is a **worktree**: `/Users/tomo/kinami/website/.claude/worktrees/omfavn-web` | clean |
| Branch, PR | `feat/omfavn-ink-hero`, head `5d8f73e`, plus the commit adding this note. [#34](https://github.com/TMorville/kinami-website/pull/34) open | `5d8f73e` pushed; checks green (`tests`, `Cloudflare Pages: omfavn`, `Cloudflare Pages: dronereporter`). The handoff commit is **not** pushed |
| Branch preview | https://feat-omfavn-ink-hero.omfavn.pages.dev/ | serves `5d8f73e`, verified by content plus a 404 negative control on 2026-09-19 |
| Production | https://omfavn.app | still the page from before #34. [#32](https://github.com/TMorville/kinami-website/pull/32) (site) and [#33](https://github.com/TMorville/kinami-website/pull/33) (privacy page) are merged |
| Tally form | https://tally.so/r/ODRBAk, in Tobias's Tally account (`tomo@omfavn.app`) | published. Self email notifications on, to `tomo@omfavn.app`. One test submission, "TEST from Claude", still to delete |
| Cloudflare | zone `omfavn.app` (active, `cora`/`ganz`), Pages project `omfavn` (build output dir `omfavn`, no build command), custom domains apex **and** `www`, redirect `https://www.*` → `https://${1}` 301 with query string preserved, SSL Full, Always Use HTTPS, Email Routing `hello@` and `tomo@omfavn.app` → `tomo@kinami.io` | all verified via API read-back and `dig @1.1.1.1` |
| Pipeline scripts | `history/2026-09-19-omfavn-ink-pipeline/` (`seedance.py`, `key.sh`, `prompt-a.txt`, `verify_domain.sh`) | copied from the session scratchpad. Their hard-coded paths point at that scratchpad |
| Vault | `~/notes/20-projects/omfavn/README.md`, the `omfavn.app` paragraph; chapter `[[2026-09-18_omfavn-app-landing]]` | README updated with this handoff path |

## The next task: the blip

**Symptom (Tobias):** "after the animation is done and the omfavn to embrace lands, the logo
disappears for 0.1 s and appears again".

**Cause, measured on the preview 2026-09-19.** The script at the bottom of `omfavn/index.html`
sets `paint.src = 'assets/ink.webp'` 2800 ms after `paint.webp` fires `load`. `ink.webp` is not
preloaded, so the visible `<img>` is empty until it downloads and decodes.

| ms after navigation | Event |
|---|---|
| 651 | `paint.webp` complete |
| 3100 | tag animation ends (delay 2200 + duration 900) |
| 3460 | `.ink-paint` blank: `currentSrc` empty, `naturalWidth` 0 |
| 3482 | `ink.webp` requested for the first time |
| 3503 | `ink.webp` complete |

The gap was about 40 ms on this fast connection. It will be longer on a phone.

**Fix options, not yet chosen:**
1. **Preferred.** Put a second `<img src="assets/ink.webp">` under the animated one, both
   absolutely positioned in `.mark`. Call `decode()` on it, then hide the animated layer. No
   `src` swap ever happens on a visible element.
2. Preload `ink.webp` (`<link rel="preload" as="image">`), `await new Image().decode()`, then
   swap. This is still a swap on the visible element, so check for a dropped frame.
3. Drop the swap. `paint.webp` has loop count 1 and holds its last frame for 10 s
   (`-delay 1000`); the swap is only insurance against a browser looping it. Only take this if
   it verifiably stops on the last frame in Chrome **and** Safari/iOS.

Keep the reduced-motion branch, which sets `ink.webp` immediately. After the fix, re-run the
blip probe under "How to verify": no sample after ~650 ms may show `naturalWidth` 0.

**Fixed 2026-09-19 with option 1, in `5f93dad`.** The still is a hidden layer under the animation
and the handover waits for `still.decode()`. Reduced motion is now CSS. The probe (per animation
frame, `ink.webp` delayed 400 ms) found 25 empty frames on the old page in Chromium and in WebKit,
and 0 on the new page in both. With a 5000 ms delay the painting held its last frame until the
still was ready. The last frame of `paint.webp` and `ink.webp` differ by 0.04% RMSE, so the
handover is not visible.

## Decisions already made

- The brush-painted ensō: "i like the effect a lot".
- "omfavn under it instead of inside." Done in `5d8f73e`.
- "remove the press and hold. its fine that it juts animates on load." Removed in `5d8f73e`,
  with its button, hint, halo and script. Do not bring it back.
- Closed beta copy, his words: "Omfavn is in closed beta until we are ready to share it. If you
  are interested in the closed beta see here." Shipped with a comma before "see here", which
  links to `beta/`.
- Beta page: a Tally form with "Tell us a bit about your family", email, and a sign-up button.
  Tally was chosen over the earlier mailto.
- Privacy framing: the recording disclosure lives on `/privacy/`, not in the page's face. His
  words: "it should be tucked away somewhere under a privacy tab because it's non-controversial",
  on a parent-choice basis, like Instagram or TikTok.
- "What it is": three drafts went to Codex, and Codex's rewrite shipped: "Record dinner or
  bedtime on your iPhone, in Danish. Oline, Omfavn's AI parenting coach, listens to the words and
  the tone, then writes you one reflection on the moment." Keep "AI" in the copy. Tobias has
  not commented on this copy (see Open).
- The palette and type are pinned by the app and the deck:
  - paper `#F5F0E8`, ink `#2A2520`, sienna `#A0522D`, ochre `#C4A265`, and `#E8A574` as the
    accent on ink.
  - Cormorant Infant, at 24 px and up only.
  - DM Mono.
  - Body text in `ui-rounded` (SF Pro Rounded, the app's body face).

## Facts learned that must not be lost

- **`CLAUDE.md` and `history/` are public at kinami.io.** `kinami.io/CLAUDE.md` and
  `kinami.io/history/2026-09-01-live-map-plan.md` both answer 200 `text/markdown` (checked
  2026-09-19).
- **Cloudflare dashboard: the Redirect Rules "Deploy" button silently does nothing.** It
  reports validation passed and saves nothing. Create the rule with
  `PUT /zones/{zone}/rulesets/phases/http_request_dynamic_redirect/entrypoint`, from the logged-in
  dashboard tab, with the `X-CSRF-Token` header taken from the `csrf_token` cookie, then read it
  back. This is annotated on the dronereporter runbook in the vault.
- **A Pages custom-domain attach creates only the apex CNAME.** Attach `www` as its own custom
  domain, or the www redirect never fires. The attach is also refused until the zone is `active`.
- **Some Cloudflare dashboard URLs render blank when loaded directly** (`/add-site`,
  `/workers-and-pages/create/pages`). Navigate to them from inside the dashboard.
- **Outbound port 25 is blocked from this Mac**, so SMTP probes cannot run. Mail to
  `@omfavn.app` is configured and its DNS verified, but delivery has never been tested.
- **Tally** is Belgian and stores responses on Google Cloud in Belgium (tally.so/help/gdpr, read
  2026-09-18). The free plan allows colours and font, and includes owner email notifications.
  "Made with Tally" stays unless he pays for Pro.
- **The animation pipeline** is in `history/2026-09-19-omfavn-ink-pipeline/`:
  1. A `gpt-image` brush still of the ensō, with the iOS app icon as reference.
  2. Seedance 2 image-to-video: 720p, 5 s, 1:1, audio off. First frame is blank paper,
     colour-matched to the still; `end_image_url` is the still. Total generation cost was
     about $2.
  3. `key.sh` keys it to transparent sienna: `SIZE=800 FPS=20 END=2.6 LEVEL=44%,86%`, frame
     delay 5 cs, last frame 1000 cs, loop 1.
- **The source media exist only in the temporary scratchpad** and will be lost:
  `/private/tmp/claude-501/-Users-tomo-kinami-website/085538eb-5db4-464c-9f64-9a13e6cdf1dd/scratchpad/brush/`
  (`enso-a.mp4`, `gen-image.png`). Regenerating gives a different stroke.
- **zsh parses `$SIZE:$SIZE:flags` as variable modifiers.** Brace them: `${SIZE}`.

## Open for the user

1. Merge #34 once the blip is fixed.
2. Delete the Tally test row "TEST from Claude", and check its notification email reached the
   Titan inbox. That is the first proof that `@omfavn.app` forwarding works.
3. Approve or change the "What it is" copy.
4. The "Made with Tally" badge on the form: keep it (free) or pay for Tally Pro.
5. Public `CLAUDE.md` and `history/` at kinami.io: acceptable, or move them out of the served
   root.
6. Mail is receive-only; replies leave as `tomo@kinami.io`. Parked in the vault mail-estate
   note.

## Not done

- The blip fix is committed (`5f93dad`) but not yet verified on the branch preview.
- No 301 from `kinami.io/omfavn/*` to `omfavn.app`. dronereporter has the equivalent; nobody
  asked for this one.
- `apple-app-site-association` is not hosted on `omfavn.app` (from the vault README).
- The source media are not stored anywhere durable (see Facts).

## How to verify

- **Local.** `python3 -m http.server <session port> --bind 127.0.0.1 --directory omfavn`. Use a
  port no other session uses and kill it afterwards.
- **Browser.** The Playwright MCP is shared and single-instance. Save screenshots only under
  `.playwright-mcp/`. Wait at least 3.5 s after load before a screenshot, or you capture the
  stroke mid-paint.
  - Viewports: 1440×900, 768×1024, 390×844, 360×640, 844×390. The hero is `100svh`, so 360×640
    matters.
- **Cache.** After an edit, load with `?nocache=<timestamp>`. An axe re-run once reported an
  already-fixed violation from cache.
- **Blip probe.** In `browser_run_code_unsafe`, navigate with `waitUntil: 'commit'`. Then sample
  `.ink-paint` every 20 ms for 4.5 s, recording `currentSrc`, `complete` and `naturalWidth`, and
  log `.webp` request times with `page.on('request')`.
- **Preview URL.** `gh api repos/TMorville/kinami-website/commits/<branch>/check-runs --jq '.check_runs[] | select(.name|test("omfavn")) | .output.summary'`,
  then grep for the `pages.dev` host. Verify by a string that exists only in the new build, and
  run a 404 negative control.
- **Live domain.** `history/2026-09-19-omfavn-ink-pipeline/verify_domain.sh`. It uses
  `curl --resolve` to get past a stale local DNS cache, and checks titles, 404 negative controls,
  assets, the www 301 with query string, and the certificate. `/404.html` answers 308 → `/404`;
  that is Pages normalising, not a failure.
- **Accessibility.** Inject axe-core 4.10.2 from cdnjs. On paper, 11 px text at `--ink-faint`
  fails contrast; use `--ink-dim`.
- **Worktree hook.** One plain command per Bash call. No `git -C` into other checkouts. Write
  files with Write/Edit. Put Codex prompts in a file and `cat` it into `codex exec`.

## Pane map (cmux workspace:4 "omfavn-web", 2026-09-19)

| Session | Surface | Works on | State | Action |
|---|---|---|---|---|
| omfavn-web | surface:44 | this site | handing off | none |
| omfavn-deck-finish | surface:45 | omfavn seed deck. The name suggests it succeeds `omfavn-deck`, which briefed this site work and is no longer listed | idle | answer it if it messages; otherwise leave it |
| p1-job-queue | surface:31 | omfavn backend | busy | not ours |
| p2-mac-worker | surface:34 | omfavn backend | busy | not ours |
| p3-cloud-ios | surface:35 | omfavn iOS | idle | not ours |
| pa-53, pa-b6, merry-twirling-newt-34 | other workspaces | other work | idle | not ours |
