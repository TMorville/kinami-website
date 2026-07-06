# Team of Traders — Interactive Trade Visualization

**Date:** 2026-07-05
**Status:** Design approved, pending spec review
**Repo (build):** `~/kinami/website` (kinami.io, Vite + vanilla JS, GitHub Pages)
**Repo (data source):** `TMorville/trading` (`~/code/trading`, private)
**Proposed URL:** `kinami.io/teamoftraders`

---

## 1. Purpose & framing

A **portfolio piece for kinami.io** that visualizes a multi-agent LLM trading system's activity over ~3 months (Apr–Jul 2026, EU + US paper markets). Explicitly **cool-factor > useful-factor**, but grounded in substance.

**The reframe that drives everything:** the subject is *not* "trades and their P&L" — every trading site has an equity curve. The subject is **a legible AI team planning, acting, and being scored by money.** The unique asset is the *reasoning trail*: a weekly strategy (the plan), a per-trade rationale (the execution), and the outcome (win/loss) as honest consequence. P&L is the stakes, not the headline.

**Honesty is a feature, not a risk.** The data includes a losing EU book (~€10k → ~€8.8k), a first-hour "fat-finger" (ENR filled at 10× expected, €14,737 instead of €1,500, "EMERGENCY POSITION REDUCTION"), and a winning US book (~$10k → ~$11.7k, outperforming a near-flat QQQ). All of it is shown, not hidden. An honest "here's an AI trading, sometimes badly" piece is more impressive and safer than a returns brag.

### Audience (assumed, unvalidated)

People evaluating Tobias / Kinami's technical craft — recruiters, prospective clients, sharp technical peers browsing kinami.io — plus general "whoa" onlookers. Cool-first, but with enough substance that a technical viewer respects it. No formal audience card exists (`history/audience-*.md`); if rigor is wanted, run `/audience`.

### Chosen direction

**Approach A — "Ledger of a Mind."** Time-as-sediment: a generative amber strata field that is *simultaneously* the ambient art hero and the explorable substrate. Two alternative directions (B "Constellation of Decisions", C "Split-screen dossier", and an A+B blend) were considered and are preserved as vault notes for future exploration — see the `trader` workstream.

---

## 2. Experience shape

**Hybrid: generative-art hero → explorable instrument.** One strata visual system, two modes — this is deliberate: it keeps the art half and the explorer half from drifting apart, because they render the same object.

Three layers, plus weekly strategy woven through all of them:

1. **Strata engine (ambient hero)** — alive on load.
2. **Narrative scrollytelling** — scroll scrubs time; the story unfolds.
3. **Explorer** — the strata turns interactive; dig into any trade or week.
4. **Weekly strategy & reasoning** — plan → execution → outcome, threaded through 1–3.

---

## 3. Data foundation & the OSS-safe seam

### 3.1 The single seam

An **export script in the trading repo** (`scripts/export_showcase.py`) reads the private `runs/` data, computes derived values, sanitizes, and emits **one file: `showcase.json`**. The website consumes only that baked file — it never links back into the private system.

This single seam is what:
- makes **"live-ready later"** a small change (a live feed only has to emit the same schema);
- **guarantees nothing private leaks** when the trading repo is later open-sourced as `teamoftraders`;
- keeps the frontend a pure static build.

### 3.2 Sources (per market: `paper_eu`, `paper_us`)

| File | Provides |
|---|---|
| `trade_log.csv` | `timestamp, ticker, action, shares, price, commission, fill_id, reasoning` (~70/market) |
| `portfolio_history.csv` | `date, cash, total_equity, daily_pnl, positions_json, benchmark_close` (~42 rows) |
| `events.jsonl` | agent narrative stream (`agent`, `action`, `cycle_id`, `message`) (~750/market) |
| `strategies/*.json` | weekly strategy artifacts (thesis, watchlist, triggers, risk posture, key events, notes) (15 EU / 17 US) |

Data span: **2026-04-08 → 2026-07-03.** Starting capital: **$10,000 (US) / €10,000 (EU).** `paper_v1` is a dead early run — **excluded.**

### 3.3 Derived computation (in the export)

- **Round-trip P&L** — FIFO-match buys→sells per ticker per market → *realized* win/loss per closed lot; open positions carry *unrealized* from the latest `positions_json`.
- **Equity track** — daily `total_equity` in **raw currency (€ / $)** as the headline number.
- **Benchmark, normalized to currency** — convert `benchmark_close` into "what the same starting capital would have become in the index" (€10k / $10k invested at day 0), so the comparison line is in € / $ next to the equity line, not an abstract index level.
- **Week tagging** — every trade is tagged with its ISO `week_id` (from `timestamp`), joining execution to plan.
- **Beats** — curated shortlist of pivotal moments for the narrative (see §5).
- **Narrative pulls** — selected `events.jsonl` messages tied to beats, so "team thinking" is visible.

### 3.4 Sanitization (the human + machine gate)

- **Strip:** `fill_id` (IB order identifiers), raw filesystem paths, internal cycle ids not needed for display, any field flagged private.
- **Keep verbatim:** all `reasoning` / `thesis` / `market_thesis` / `notes` prose — it is the point.
- **Human gate:** `showcase.json` is a curated snapshot; the operator eyeballs it before publishing.
- **Machine gate:** an export unit test asserts the output contains **no `fill_id` and none of the stripped fields**, and validates against the documented schema (§3.5). A leak becomes a red test.

### 3.5 `showcase.json` schema (the enforceable contract)

```jsonc
{
  "generated_at": "2026-07-05T00:00:00Z",
  "span": { "start": "2026-04-08", "end": "2026-07-03" },
  "markets": {
    "us": {
      "currency": "USD",
      "starting_capital": 10000,
      "benchmark_label": "QQQ",
      "equity": [
        { "date": "2026-05-08", "equity": 11767.18, "benchmark_equity": 10412.3, "daily_pnl": 0 }
      ],
      "trades": [
        {
          "id": "us-0001",
          "date": "2026-04-08T17:13:20Z",
          "ticker": "CRDO",
          "action": "buy",            // buy | sell
          "shares": 7,
          "price": 108.5,
          "notional": 759.5,
          "week_id": "2026-W15",
          "reasoning": "Highest-conviction AI optical networking play…",
          "agent": "trader",
          "realized_pnl": null,        // set on the closing lot(s)
          "is_win": null               // true | false | null (open)
        }
      ],
      "weeks": [
        {
          "week_id": "2026-W22",
          "created_at": "2026-05-26T13:30:00Z",
          "generated_by": "trader:strategist",
          "market_thesis": "AI infrastructure and cybersecurity remain the dominant thrusts…",
          "risk_posture": "moderate",
          "watchlist": [
            { "ticker": "NVDA", "direction": "long", "thesis": "3sh held through earnings…",
              "triggers": [ { "action": "trim", "comparison": ">=", "price_threshold": 228.0 } ] }
          ],
          "key_events": [
            { "date": "2026-05-26", "ticker": "ZS", "severity": "HIGH", "description": "Zscaler Q3 earnings…" }
          ],
          "notes": "UNIVERSE SCAN W22 — candidates considered…",
          "revisions": []              // v1-optional: mid-week _v2 strategy diffs
        }
      ]
    },
    "eu": { "currency": "EUR", "starting_capital": 10000, "benchmark_label": "…", "…": "…" }
  },
  "beats": [
    { "id": "genesis", "market": "eu", "trade_id": "eu-0001", "title": "First position",
      "note": "…", "kind": "genesis" },
    { "id": "fatfinger", "market": "eu", "trade_id": "eu-0003", "kind": "disaster" },
    { "id": "crdo-win", "market": "us", "trade_id": "us-0002", "kind": "best-win" }
    // + worst-drawdown, current-state
  ]
}
```

Schema decisions: raw currency primary (per approval); `is_win`/`realized_pnl` drive win/loss coloring; `week_id` is the plan↔execution join key; `beats` is a curated pointer list, not derived, so the narrative is authorable.

---

## 4. Visual system — the strata engine (Layer 1)

A **seeded, deterministic generative canvas** (like the Halvorsen logo mark), amber-on-void, single hue.

- **Two columns: EU (left) · US (right)** — the two teams.
- **Time flows vertically.** Each trading day is a thin stratum; each **trade is a grain/bloom** deposited into its day's layer.
- **Encoding (single-hue, opacity/size/warmth only):**
  - *size* ≈ position notional (€ / $)
  - *warmth / brightness* ≈ win; *darkening / erosion* ≈ loss
  - buys **deposit** grains; sells **carve** them
- **Week bands** — subtle dividers demarcate ISO weeks (the strategy spine, §7).
- **Idle animation** — a subtle drift/shimmer so it reads as alive on load. The UI floats above as translucent glass; the field is the product identity (per design system).

**Renderer:** default **Canvas2D** (hundreds of grains is trivial). Escalate the hero to **WebGL/GLSL** only if richer glow is wanted — decided during build, not a v1 requirement.

---

## 5. Narrative scrollytelling (Layer 2)

**GSAP + ScrollTrigger** (full plugin suite is free since 2024).

- Scroll scrubs time downward; strata accrete as you descend.
- The **equity line draws on** (DrawSVG) against the normalized-benchmark line; headline readout in raw € / $.
- Each **chapter opens with its week's `market_thesis`** as a serif inscription (the team stating the plan), then that week's trades deposit beneath it.
- At curated **beats**, the view settles and the trade's *actual reasoning* surfaces (SplitText serif reveal) with a mono tag naming the speaking agent.

**Beat arc (curated, honest):** genesis → EU fat-finger ("EMERGENCY POSITION REDUCTION") → CRDO +23.8% in 5 days → worst drawdown → today.

---

## 6. Explorer (Layer 3)

At scroll's end (and via a **mode toggle**) the same strata becomes fully interactive — **D3** (Canvas-backed) for total aesthetic control.

- **Hover a grain** → glass tooltip (ticker, action, P&L glyph).
- **Click a grain** → detail panel (design-system glass surface): ticker · action · shares · price · **raw P&L (€/$)** · full reasoning · agent · date · **link to its week's strategy**.
- **Filters** (mono pills): market · ticker · agent · win/loss.
- **Timeline scrubber.**
- **Equity chart crosshair** reads raw equity + benchmark at any date.

---

## 7. Weekly strategy & reasoning (Layer 4 — threaded)

The **plan → execution → outcome** spine. Makes reasoning first-class, not decoration.

- **Export:** `weeks[]` per market (§3.5) — thesis, directional watchlist, risk posture, key events, notes. Trades carry `week_id`.
- **Narrative:** chapters open on the week's thesis (§5).
- **Explorer — surface a week:** a **week rail** (mono, down the side); click a week → glass **strategy panel** showing thesis, watchlist intents (ticker · long/short · thesis), risk posture, key events. Alongside it the payoff view: **planned intents vs what actually traded vs win/loss** ("W22 planned NVDA-hold + ZS-entry; here's what filled and how it did").
- **Cross-link:** clicking a trade links back to the intent it executed ("watchlist intent #1 from W22"); trade ↔ plan navigable both ways.
- **Deferrable:** mid-week `_v2` strategy revisions ("the plan changed") → `revisions[]`, v1-optional.

---

## 8. Integration into kinami.io

- New page `pages/teamoftraders.html`, wired into `vite.config.js` `rollupOptions.input`.
- Design tokens from `.interface-design/system.md`: `--void #0c0a04`, `--amber 220,180,100`, glass surfaces (backdrop-filter blur), borders-only depth (no shadows), Cormorant Infant (prose) + DM Mono (data/labels). Reuse `lib/` (logo lockup) where it fits.
- Baked `showcase.json` under `assets/teamoftraders/`.
- Dependencies added to the website: GSAP (+ ScrollTrigger, DrawSVG, SplitText), D3. All framework-agnostic — fit the vanilla Vite setup; no React (visx skipped for that reason).

---

## 9. Performance, fallbacks, accessibility

- Data is tiny (~140 trades, ~85 daily rows); only the particle field costs anything.
- **`prefers-reduced-motion`** → static composed strata, no autoplay scrub.
- **Mobile / low-power** → reduced particle count + static strata; design-system mobile rules (panel full-width, single column).
- **No-JS / load failure** → static poster + the narrative beats rendered as plain readable prose. This prose fallback doubles as the accessibility path so the piece is not a pure-canvas dead end.

---

## 10. Testing & verification

- **Export script:** unit tests on FIFO P&L correctness; **sanitization assertion** (no `fill_id` / stripped fields in output); schema validity.
- **Schema contract test:** `showcase.json` validates against §3.5 — the enforceable promise a future live feed must keep.
- **Frontend:** Playwright MCP visual pass at **1440 / 768 / 390**, console-error check; then `/ux` + `/web-design` passes before "done" (screenshots at three viewports, not just type-checks).

---

## 11. Scope — explicitly OUT of v1 (YAGNI)

- Live / auto-updating feed (deferred; schema makes it a small change).
- Directions B / C / A+B blend (→ vault notes).
- Any real-money framing.
- Deep per-agent drill-down beyond labeling who spoke.
- Backend / auth / CMS — stays a static baked page.
- Mid-week `_v2` "plan changed" revisions (deferrable within Layer 4).

---

## 12. Build order (detail belongs in the plan)

1. **Export script + schema + tests** (trading repo) — de-risks everything, locks the data contract.
2. **Strata engine** (Layer 1) — the core visual system.
3. **Narrative scroll** (Layer 2).
4. **Explorer** (Layer 3) + **weekly strategy surface** (Layer 4).
5. **Polish, fallbacks, verification** (§9–10).

---

## 13. Relationship to the deferred "teamoftraders" open-sourcing (Project A)

This viz is Project B. Project A (clean-room extraction of the trading repo → public `teamoftraders`) is a separate spec. The **shared seam is the sanitized export** (§3): designing it OSS-safe here means the data-publication boundary is already solved when Project A begins.

---

## Amendment A1 — 2026-07-06: horizontal timeline layout

User feedback on the first rendered build rejected the vertical two-column sediment layout. §4–§6 geometry is superseded:

- **Time flows left→right.** Two stacked lanes: EU (top), US (bottom), shared x axis of trading days; ISO-week stripes as vertical whisper dividers with labels.
- **Trades sit ON the equity curve**: each lane draws its equity line (ember, solid) vs benchmark (amber, dashed); trades are glowing markers at their date positioned on the path (small deterministic jitter): size = notional, ring = sell, bright ember = win, dim amber = loss, mid = open.
- **Pre-record window** (trading began 2026-04-08; daily snapshots begin 2026-05-08): the path starts at a synthetic anchor (date of first trade, starting capital — the book verifiably started at exactly €/$10,000) drawn as a *dotted faint* segment to the first real snapshot; markers in that window interpolate along it. The explorer crosshair labels this window "no daily record".
- Everything else stands: narrative scrollytelling (reveal now sweeps left→right), explorer interactions, weekly-strategy layer, design tokens, static fallbacks, the showcase.json contract (unchanged — this is presentation-only).
