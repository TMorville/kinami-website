# Kinami Design System

## Intent

**Who:** Curious visitors discovering a research/creative studio. Unhurried, contemplative.
**Task:** Browse projects, understand the work, decide whether to reach out.
**Feel:** Sedimentary. Like looking through amber at geological layers. The darkness is depth, not absence. Text emerges like inscriptions. The particle field is the living thing — the UI defers to it.

## Direction

Single-hue monochrome. Warm amber on near-black. No secondary hue. The constraint is the identity. Everything is the same color at different intensities — this creates cohesion that multi-color palettes can't match.

Depth through transparency, not shadow. Surfaces are glass (backdrop-filter blur), not paper. Borders are whisper-quiet amber at low opacity.

---

## Palette

### Base

```
--void:    #0c0a04          /* near-black, warm undertone — not pure black, not blue-black */
--amber:   220, 180, 100    /* the single hue — always used as rgba() */
--ember:   240, 200, 130    /* lighter amber variant — code keywords, bright accents */
```

### Surfaces

```
--surface-base:     #0c0a04                        /* page canvas */
--surface-glass:    rgba(12, 10, 4, 0.75)          /* floating panels — with backdrop-filter: blur(6px) */
--surface-cell:     rgba(12, 10, 4, 0.8)           /* grid cells, cards — with backdrop-filter: blur(8px) */
--surface-cell-hot: rgba(12, 10, 4, 0.95)          /* cell hover state */
--surface-inset:    rgba(0, 0, 0, 0.3)             /* code blocks, recessed areas */
--surface-tag:      rgba(220, 180, 100, 0.04)      /* tag/pill backgrounds */
```

### Borders

```
--border-whisper:   rgba(220, 180, 100, 0.06)      /* panel edges, dividers, code blocks */
--border-subtle:    rgba(220, 180, 100, 0.1)       /* tags, interactive edges */
--border-visible:   rgba(220, 180, 100, 0.2)       /* link underlines (default) */
--border-hover:     rgba(220, 180, 100, 0.5)       /* link underlines (hover) */
```

### Text Hierarchy

All `rgba(220, 180, 100, alpha)` — same hue, opacity controls hierarchy:

```
--text-bright:    0.92    /* panel titles — highest emphasis */
--text-primary:   0.88    /* step titles, stat values, headings */
--text-body:      0.82    /* section text, body paragraphs */
--text-secondary: 0.72    /* step descriptions, code, tags, status text */
--text-muted:     0.55    /* section labels, subtitles, stat labels, step numbers */
--text-dim:       0.4     /* card descriptions in bottom bar */
--text-faint:     0.35    /* card labels in bottom bar */
--text-ghost:     0.3     /* page label (top-right) */
```

### Title Text

```
--title-color:    rgba(220, 180, 100, 0.5)     /* the "kinami" wordmark — deliberately subdued */
```

---

## Typography

### Fonts

```
--font-serif: 'Cormorant Infant', serif    /* display, titles, body text — the feeling */
--font-mono:  'DM Mono', monospace         /* labels, section titles, data, code, tags — the information */
```

Google Fonts load: `Cormorant+Infant:ital,wght@0,300;0,400;1,300` and `DM+Mono:wght@300`

### Type Scale

| Role             | Font   | Size                       | Weight | Tracking     | Line Height |
|------------------|--------|----------------------------|--------|--------------|-------------|
| Display (h1)     | Serif  | clamp(48px, 8vw, 96px)     | 300    | 0.05em       | —           |
| Panel title      | Serif  | 36px                       | 400    | —            | —           |
| Card title       | Serif  | 18px                       | 400    | —            | —           |
| Body / step title| Serif  | 16px                       | 400    | —            | 1.6         |
| Small body       | Serif  | 14px                       | —      | —            | 1.5 / 1.4   |
| Status text      | Mono   | 11px                       | 300    | 0.5px        | —           |
| Code             | Mono   | 12px                       | 300    | —            | 1.6         |
| Label / tag      | Mono   | 10px                       | 300    | 1px / 0.5px  | —           |

### Rules

- Serif for anything a human would read as prose
- Mono for anything structural: labels, section headings, metadata, code, tags, stats labels
- Mono is always uppercase with letter-spacing when used as labels
- Weights are light: serif uses 300–400, mono uses 300 only

---

## Spacing

### Base Unit: 4px

| Token  | Value | Use |
|--------|-------|-----|
| xs     | 4px   | Icon gaps, tight pairs |
| sm     | 6px   | Tag padding (vertical), step title margin |
| md     | 8px   | Tag gaps, label margins |
| lg     | 12px  | Tag padding (horizontal), step gaps, status bar gap, panel title margin |
| xl     | 16px  | Section title margin, code block padding, step gap within content |
| 2xl    | 20px  | Step group gaps, close button size |
| 3xl    | 24px  | Cell padding, stat grid gaps, close button offset, panel subtitle margin-bottom |
| 4xl    | 32px  | Panel subtitle margin |
| 5xl    | 40px  | Section margins, status bar margin-top |
| 6xl    | 60px  | Panel padding |

### Content Widths

- Panel content max-width: 600px
- Stats grid: repeat(3, 1fr) with 24px gap

---

## Depth Strategy

**Borders-only.** No box-shadows anywhere. Depth comes from:

1. **Backdrop-filter blur** on floating surfaces (6px for panels, 8px for cells)
2. **Opacity differences** between surface layers
3. **Border at 0.06 opacity** — disappears when you're not looking, findable when you need structure

### Border Radius

- 0px — most elements (sharp, geological)
- 4px — code blocks (slight softening for inset content)
- 12px — tags/pills (rounded for small interactive elements)
- 50% — status dots

---

## Animation

### Timing

| Context          | Duration | Easing                              |
|------------------|----------|--------------------------------------|
| Hover states     | 0.3s     | ease                                 |
| Bottom bar       | lerp     | rAF-driven (factor 0.08), snap at idle |
| Panel split      | 0.6s     | cubic-bezier(0.4, 0, 0.2, 1)        |
| Status pulse     | 2s       | ease-in-out, infinite                |

### Interaction Patterns

- Bottom bar: hidden by default, scroll down to reveal (wheel/touch), snaps to open/closed
- Panel: split-curtain reveal (left side compresses to 50vw, right slides in)
- Close: click left side, close button (X), or Escape key
- Hover on cells: background opacity shift only (0.8 → 0.95)

---

## Grid Patterns

### Bottom Bar

```
grid-template-columns: repeat(3, 1fr)
gap: 1px
background: var(--border-whisper)    /* 1px gap creates the grid lines */
```

6 cells across 2 rows. Grid gap-as-border pattern — the container background shows through 1px gaps.

### Stats Grid

```
grid-template-columns: repeat(3, 1fr)
gap: 24px
text-align: center
```

---

## Component Patterns

### Section Block

```
margin-bottom: 40px
```

Section title (mono, uppercase, 10px, muted) followed by content. Consistent vertical rhythm.

### Step List

Horizontal layout: step-num (mono, 12px, muted) + step-content (title + description). Gap 16px between num and content, 20px between steps.

### Tag / Pill

Mono, 10px, 0.5px tracking, 6px 12px padding. Background at 0.04, border at 0.1. Border-radius 12px.

### Status Bar

Top border (0.06), flex row, 12px gap. Pulsing dot (8px, 50% radius) + mono status text.

### Code Block

Inset surface (rgba(0,0,0,0.3)), whisper border, 4px radius, 16px padding. Code lines in mono 12px. Keywords in ember color.

---

## Mobile (max-width: 768px)

- Panel goes full-width (100vw), left side collapses to 0
- Bottom bar switches to single column
- Stats grid switches to single column
- Panel padding reduces to 40px 24px
- Panel content max-width: 100%

---

## Signature

The particle canvas IS the product identity. Every page has it. The UI floats above it as translucent glass. The single-hue constraint — everything is amber at different opacities — is what makes kinami look like kinami. Adding a second color would break the identity.
