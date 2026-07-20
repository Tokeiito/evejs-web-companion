# The EVE design system

The client's one visual language. It lives in **`web/src/styles.css`** (Tailwind
v4, CSS-first) and nowhere else. Panels are written in bare semantic elements
plus the component classes below — a panel gets the whole look by being ordinary
HTML, which is why restyles stay low-churn and behavior-preserving.

**There is no second styling approach.** Do not add a per-panel `<style>` block
for anything another panel could want; add it here instead.

## The look

EVE-style dark industrial: near-black backgrounds with a blue cast, cool
desaturated blue-grey text, one restrained accent, condensed uppercase
letter-spaced headers, tight scannable data rows, and tabular numerals
everywhere a number can line up under another number.

## Tokens

All tokens are Tailwind `@theme` variables, so they are usable both as CSS
custom properties (`var(--color-shield)`) and as Tailwind utilities
(`text-shield`).

### Surfaces — four depths, darkest first

| Token | Value | Use |
| --- | --- | --- |
| `--color-bg` | `#05080d` | the page |
| `--color-panel` | `#0d131c` | a panel frame |
| `--color-panel-2` | `#16273a` | a raised control (buttons) |
| `--color-panel-3` | `#0a1017` | an inset well (meter tracks, zebra rows, reflow cards) |
| `--color-field` | `#070b11` | an input well — darker than the panel so a field reads as a hole, not a bump |

### Lines

`--color-line` (frames), `--color-line-strong` (control borders, header rules),
`--color-row-line` (row separators).

### Text

| Token | Value | Use |
| --- | --- | --- |
| `--color-text` | `#c8d4e2` | body copy |
| `--color-text-bright` | `#e6f0fa` | emphasis, values you read off |
| `--color-cell` | `#a9bccd` | table data |
| `--color-muted` | `#8fa3b8` | labels, secondary copy |

### Accent and state

`--color-accent` `#7fb4d9`, `--color-accent-bright` `#a9d3f0`,
`--color-accent-dim` `#3d6f96`, with `--color-on-accent` `#06131f` as the ink on
a filled accent. State: `--color-good` `#6cc79a`, `--color-warn` `#d9a441`,
`--color-danger` `#e08a8a` (ink `--color-on-danger`).

### Ship resources — the shield / armor / hull triad

First-class palette members, not one-offs. EVE players read these three colours
as fast as they read the numbers, and the fitting window (R21) leans on them
heavily.

| Token | Value |
| --- | --- |
| `--color-shield` | `#4a9fd8` |
| `--color-armor` | `#c8a24a` |
| `--color-hull` | `#c46a5a` |
| `--color-capacitor` | `#5ab98c` |
| `--color-cpu` | `#7fb4d9` |
| `--color-powergrid` | `#b58ad0` |
| `--color-calibration` | `#9aa8bb` |

## Components

### Chrome

- **`section` / `.panel`** — the panel frame. Thin cool border, lifted surface,
  a hairline accent along the top edge that fades to the right.
- **`.panel-head`** — title left, actions right, divided from the body; bleeds
  to the panel edges. Put an `<h1>`/`<h2>` and a `.controls` row in it.
- **`section > h2`** — gets a small accent tick so the eye finds each block.
- **`.divider`** — an `<hr>` between blocks inside one panel.
- **`section.bulk`** — the bulk-action bar; accent-tinted so it stands apart
  from the tables it acts on.

### Typography

`h1` / `h2` / `h3` are condensed, uppercase, letter-spaced (`0.14em` / `0.12em` /
`0.08em`). Body copy stays comfortable and mixed case — the theme is not
allowed to cost readability.

**Tabular numerals** are on `table.guests`, `.num`, `dl.kv dd`, `.hud-value`,
`ol.route`, `button.character .detail`, and all form fields. Any new numeric
readout must set `font-variant-numeric: tabular-nums`.

### Data tables

`table.guests` is the data table. Two shapes use it:

- **record tables** (a `thead` + many columns) — these also take `.reflow`,
  sit inside `<div class="table-wrap overflow-x-auto">`, and carry a
  `data-label` on **every** `<td>`;
- **key/value tables** (a `<th>` row-label + a `<td>` value, no `thead`) —
  already narrow, unchanged at every width.

Density: tight rows, uppercase column headers on a stronger rule, zebra
striping and a hover highlight above 640px.

**`.num`** marks a numeric column — right-aligned, tabular, no wrap, bright
ink. Put it on the `<th>` **and** every `<td>` of that column. Applies to ISK,
quantities, distances, jumps, efficiencies and percentages.

**`.empty`** is the one "there is nothing here" treatment: calm, inset, centred,
dashed border — visibly different from `.error`, because an empty result is a
fact and not a fault.

### Controls

| Class | Role |
| --- | --- |
| *(bare `<button>`)* | secondary — the default |
| `.primary` | the one action the panel most expects you to take |
| `.minor` | tertiary / ghost |
| `.danger` | the armed half of a two-step destroy |
| `.active` | selected (tabs, chat sub-tabs, agent chips) |

`nav.tabs` is the tab strip. `.controls` and `.agent-filter` are the labelled
control rows; `.row-actions` is the in-row action group.

All targets are **≥40px (2.5rem)** tall — checked at every width.

### Meters

`.hud` > `.hud-gauge.<resource>` > (`.hud-head` > `.hud-label` + `.hud-value`) +
(`.hud-track` > `.hud-fill`). Add the resource class (`shield`, `armor`, `hull`,
`capacitor`, `cpu`, `powergrid`, `calibration`) to colour the fill and the
label. The track carries `role="meter"` plus `aria-valuenow/min/max`.

Every gauge renders its label **and** its value as text next to the bar, so the
bar is a fast visual summary and never the only way to read the state.

### Badges

`.badge` plus an optional `.good` / `.warn` / `.bad` / `.accent`. A badge always
carries its own text, so colour is reinforcement.

## Invariants this system must not break

- **R7d** — zero visible numeric IDs. Names resolve through `store/names.ts`;
  an unresolved name renders `—`, never the raw ID.
- **R8** — no horizontal page scroll at 360px; record tables keep `.reflow` +
  `data-label` and still become labelled cards at ≤640px; targets stay ≥40px.
- **R9a** — plain player language, no developer jargon in the UI.
- **`web/src/ui/panelFirstMount.test.ts`** — all 16 panels must still render on
  first mount.

## Accessibility

Body text aims for **WCAG AA (≥4.5:1)**. Every palette colour was measured
against `--color-bg`, `--color-panel` and `--color-panel-3`: the floor is
`--color-hull` at **4.93:1** on `--color-panel`; every other pairing is ≥5:1 and
most are AAA. Filled controls were measured ink-on-fill (`.primary` 8.42:1,
`.danger` 7.67:1).

**Nothing critical is conveyed by colour alone.** `.error` carries a leading
marker, `tr.unread` uses weight, `tr.self` uses weight and brightness, badges
carry text, and every gauge prints its value.
