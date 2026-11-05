# DAO-OS L4: the element set (design)

- **Date:** 2026-10-29
- **Status:** draft for the operator's review, with the gallery below. No L4 plan is written until the
  operator has looked at the gallery and answered §18.
- **Lane:** L4 of `dao-os/docs/superpowers/specs/2026-10-29-dao-os-house-architecture-design.md`
  (the *house spec*). Its §5 is binding here; this document fixes what §5 leaves to design.
- **Language:** `dao-os/CONTEXT.md` is binding. Its words are used exactly as defined there
  (house, public door, members' side, member, System, kind, view, map, workspace write, conversation,
  visibility, publication, element, element set, skin).
- **Builds on:** org-os 0.6 `feat/platform-v2` (`packages/admin`): its skin mechanism
  (`app/src/design/skins/`, `css.test.ts`, `skins.test.ts`, `contrast.test.ts`), its parts (P4 §4),
  boards (P4 §5), marks (`parts/marks.ts`), panels machine and reading states
  (`server/systems/driver.ts`: `unknown | reading | fresh | aged | failed`).
- **Judged against:** `dao-os/docs/design/prototypes/proto-quiet.html` (the frame) and
  `proto-structure.html` (the map, the type, the palette). Neither's code is reused.
- **Gallery (the thing the operator reviews):** `docs/design/dao-os-element-gallery.html`, screenshots
  in `docs/design/gallery-shots/`. Every value in the gallery is a token in §3; where this document and
  the gallery disagree, this document wins and the gallery is fixed.

---

## 1. What L4 builds, and what it does not

**L4 builds** the element set (§6–§11), the frame (§5), the map view (§8) and the DAO look as the
default token set (§3), and redraws every existing 0.6 page and part onto them (§14). Each element is
built with all its states, driven by fixtures on `/parts`, and screenshot-tested at 1440 and 390 in
light and dark.

**L4 does not build behaviour owned by other lanes.** Where an element needs it, L4 draws the element
in every state from fixtures and exposes the props/events the owning lane will wire:

| Behaviour | Owner | What L4 ships instead |
|---|---|---|
| SIWE sign-in, sessions, membership from Hats, the visibility gate, the private store | L5 | Sign-in element in all states; the *view as* control and band, driven by a fixture visibility filter; visibility marker and "members only" slot; restricted field rendering |
| Pages saved to git, the editor engine, collections and custom collections, views' saved state, comments/mentions/notifications store, presence transport, Notion import | L6 | Page editor chrome and body styles; table/board/calendar/list views with fixture collections; comment thread, mention, mention picker, presence in all states |
| Compose wizard content, the compose canvas's writes, prepared deployments, the DAO shelf | L7 | Compose canvas element (placing, connecting, selecting, invalid edge, deployment order, not-deployed nodes) on fixtures; wizard steps element (exists in 0.6, redrawn) |
| Drivers' reads (multi-chain Safe, Hats, Snapshot, Gardens) | L2 | Every reading state drawn from fixture `DriverRead`s; chain-disagreement attention |
| Library add/remove and receipts | L1 | Library entry card and preview, with *Added*, *Not added*, *Needs*, *Built in*, id-taken and edited-since-add states |
| Static public door build and hosting | L9 | The public door's layout and elements as client routes rendering only `public` fixture records |
| EIP-4824 / DAOIP-5 output | L8 | daoURI line in the door footer, `DAOIP-5` fact on grant pools |

L4 changes no server contract. Where 0.6 already has the data (proposals, changes, systems reads,
library preview, wizards, boards), the redrawn pages use it as they do today.

## 2. What each prototype gives

| From *Quiet precision* (the frame) | From *Living structure* (map, type, palette) |
|---|---|
| Left sidebar of sections with counts, search field, foot with Public door and identity | Fraunces + Geist + Geist Mono; mono eyebrows |
| Home: dated line, **Needs you** first (tile, title, meta with meter, trailing action), Systems table, Recently | Warm paper neutrals, moss and clay; dotted map canvas |
| Hairline lists inside raised surfaces; quiet chips; kbd hints | The DAO map: layered nodes, labelled edges, attention dot with ring, caption under the map, flow along edges |
| Proposal page: header, body, prepared-transaction card with "the house never signs", path timeline in an aside | Public door: big Fraunces hero with an italic moss phrase, facts row, map plate, numbered editorial sections, pools as cards, decisions ledger |
| Changes tray with Review / Propose | Signer dots on the door's treasury panel |

**Dropped from the prototypes, on purpose:** per-kind hues on the map (Q12: moss and clay are the only
colours — kinds are told by glyph); coloured chain dots (house spec §5: neutral chips); the floating
tray pill (it covered rows; §5.6); an attention ring that pulses forever (WCAG 2.2.2; §3.7); the
"Simulate" links (prototype-only).

## 3. Tokens: the `house` skin

### 3.1 Mechanism (unchanged from 0.6)

- The look stays a skin: a CSS file of token values, `app/src/design/skins/house.css`, registered in
  `skins/index.ts` and `skins/index.css`. **`house` becomes `FALLBACK_SKIN` and the shipped default.**
- No part, block, page or element holds a raw value: `design.css`/`base.css` draw only with
  `var(--token)`; `css.test.ts`'s `rawValues` guard keeps passing unchanged.
- Every colour token is an opaque `#rrggbb` (the contrast test's parser reads only that, `var(--x)` or
  `transparent`). Shadows and the scrim may use `rgba()` (they are not colour tokens the test measures).
- Light is `:root[data-skin="house"]`; dark is the same selector under
  `@media (prefers-color-scheme: dark)` with `:not([data-theme="light"])`, and again under
  `[data-theme="dark"]`, holding identical values (`contrast.test.ts` checks the two agree).
- **Every token `bare` defines, `house` defines.** New tokens below are added to `bare` too (set to
  what bare draws), so `skins.test.ts` keeps one token list.
- `bare` is kept as a test skin (it anchors `css.test.ts`'s P1 assertions); `sleek` and `sample` are
  retired (call C-24). The Skin select leaves the menu; it stays reachable in ⌘K under
  "Skin: …" for builders only when more than one skin ships.

### 3.2 Colour

Names in **bold** are new tokens; the rest keep their 0.6 names and meaning.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--paper` | `#f4f2ec` | `#121412` | page, sidebar |
| `--raised` | `#fdfcf9` | `#1a1d1b` | surfaces: lists, cards, nodes, inputs, tray |
| **`--pop`** | `#fdfcf9` | `#1f2321` | menus, palette, sheets, popovers (dark lightens with height) |
| **`--sunken`** | `#efede6` | `#0e100f` | wells (payload, "this screen writes"), map canvas, board columns, group rows, door totals |
| `--wash` | `#ebe8e0` | `#232725` | hover fill, address chip, mention, kind tile, current nav item |
| **`--wash-strong`** | `#e2ded4` | `#2c312e` | address chip hover, avatar fill. **Ink text only** on it |
| `--rule` | `#e2dfd6` | `#2b2f2c` | hairlines (decoration; never the only edge of a control) |
| **`--rule-strong`** | `#d6d2c7` | `#3a3f3b` | secondary-button and chip outline, node outline, tree connectors, meter track (decoration: the control is identified by its label and fill) |
| `--edge` | `#827e73` | `#727771` | boundary that identifies a control: inputs, checkboxes, radio, composer; map edges |
| `--ink` | `#1c1d1a` | `#ecebe5` | text, icons on hover/current |
| `--mute` | `#57554e` | `#aeaca3` | secondary text, icons |
| `--faint` | `#6b685f` | `#9a978e` | tertiary text: ages, counts, eyebrows, column heads, placeholders |
| `--accent` (moss) | `#2e5c4a` | `#8fc2a6` | selection, staged, yours, the selected map path, value moving |
| `--accent-soft` | `#e2ebe4` | `#1b2b23` | selected row/node ring, "you" mention, executed outcome strip |
| **`--on-accent`** | `#ffffff` | `#0e1a13` | text on moss or clay fills (tray count, bottom-bar badge, node tag) |
| `--attn` (clay) | `#a8452a` | `#e8916a` | needs you, failed, stale, overdue, invalid |
| **`--attn-soft`** | `#f6e5dc` | `#33231b` | attention tile, stale op row, warn address, failed outcome strip |
| `--solid` | `#1c1d1a` | `#ecebe5` | the primary button, today, done timeline steps, view-as band |
| `--on-solid` | `#fdfcf9` | `#121412` | text on `--solid` |
| `--focus` | `#2e5c4a` | `#8fc2a6` | focus ring |
| **`--map-dot`** | `#d9d5ca` | `#262a27` | the dot grid behind maps (decoration) |
| `--row-hover` | `var(--wash)` | | |
| `--nav-ink` | `var(--mute)` | | |
| `--nav-on-bg` | `var(--wash)` | | |
| `--input-fill` | `var(--raised)` | | |
| `--input-edge` | `var(--edge)` | | |
| `--block-bg` | `var(--raised)` | | |

Shadows and scrim:

| Token | Light | Dark |
|---|---|---|
| `--shadow-card` | `0 1px 0 rgba(28,29,26,.03), 0 1px 3px rgba(28,29,26,.05)` | `0 1px 0 rgba(0,0,0,.25)` |
| **`--shadow-raise`** | `0 1px 0 rgba(28,29,26,.03), 0 10px 28px -14px rgba(28,29,26,.28)` | `0 1px 0 rgba(0,0,0,.25), 0 12px 30px -14px rgba(0,0,0,.75)` |
| `--shadow-pop` | `0 0 0 1px rgba(28,29,26,.06), 0 18px 44px -14px rgba(28,29,26,.30), 0 4px 10px -4px rgba(28,29,26,.08)` | `0 0 0 1px rgba(236,235,229,.07), 0 22px 50px -14px rgba(0,0,0,.8)` |
| **`--scrim`** | `rgba(28,29,26,.32)` | `rgba(0,0,0,.55)` |

Every raised surface keeps `border: 1px solid transparent` (or its `--rule` border) under the shadow,
so forced-colours mode still draws an edge.

**Measured contrast (WCAG 2.x relative luminance; computed from these exact hex values).** Text needs
4.5:1 (1.4.3); control boundaries, focus and meaningful graphics 3:1 (1.4.11).

| Light | paper | raised/pop | sunken | wash | wash-strong | accent-soft | attn-soft |
|---|---|---|---|---|---|---|---|
| ink | 15.13 | 16.51 | 14.46 | 13.83 | 12.61 | 13.90 | 13.84 |
| mute | 6.66 | 7.27 | 6.37 | 6.09 | *5.55* | 6.12 | 6.10 |
| faint | 4.98 | 5.43 | 4.75 | 4.55 | *4.15 ✗* | 4.57 | 4.55 |
| accent (as text) | 6.83 | 7.45 | 6.53 | 6.25 | 5.69 | 6.28 | 6.25 |
| attn (as text) | 5.28 | 5.77 | 5.05 | 4.83 | 4.40 | 4.86 | 4.83 |
| edge (UI, 3:1) | 3.62 | 3.95 | 3.46 | 3.31 | *3.02* | — | — |
| focus (UI, 3:1) | 6.83 | 7.45 | 6.53 | 6.25 | 5.69 | — | — |

| Dark | paper | raised | pop | sunken | wash | wash-strong | accent-soft | attn-soft |
|---|---|---|---|---|---|---|---|---|
| ink | 15.50 | 14.23 | 13.31 | 15.99 | 12.66 | 11.09 | 12.41 | 12.59 |
| mute | 8.14 | 7.47 | 6.99 | 8.39 | 6.65 | 5.82 | 6.52 | 6.61 |
| faint | 6.34 | 5.82 | 5.45 | 6.54 | 5.18 | 4.53 | 5.08 | 5.15 |
| accent | 9.20 | 8.45 | 7.90 | 9.49 | 7.52 | 6.58 | 7.37 | 7.47 |
| attn | 7.66 | 7.03 | 6.58 | 7.90 | 6.26 | 5.48 | 6.13 | 6.22 |
| edge (UI) | 4.05 | 3.72 | 3.48 | 4.18 | 3.31 | *2.90 ✗* | — | — |
| focus (UI) | 9.20 | 8.45 | 7.90 | 9.49 | 7.52 | 6.58 | — | — |

Fills: `--on-solid` on `--solid` 16.51 / 15.50; `--on-accent` on `--accent` 7.65 / 8.87; `--on-accent` on
`--attn` 5.92 / 7.39.

**Rules that keep those numbers true:**
1. Only `--ink` text sits on `--wash-strong` (the ✗ cells are pairs the set never draws). `--edge` never
   bounds a control drawn on `--wash-strong`.
2. `--rule` and `--rule-strong` are decoration (1.30 and 1.47 against `--raised`). Nothing a person must
   find is bounded only by them: a secondary button is identified by its label and its fill, an input
   by `--edge`.
3. Moss and clay differ from each other by hue, not lightness (1.29:1 light, 1.20:1 dark). Neither is
   ever the only carrier of meaning: every use is paired with a shape and a word (§6.1).
4. The contrast test's surface list grows by `--pop`, `--sunken`, `--attn-soft`; its text list by
   `--accent` (moss is used as text: "staged", "you approved"); its UI list stays
   `--edge --accent --focus --input-edge`. `--wash-strong` is listed as a surface for `--ink` only.

**One colour, one meaning.** Moss = selected, staged, yours, value moving/moved, executed. Clay = needs
you, failed, stale, overdue, invalid. Ink fill = the one primary action, *done* steps, today, the
*view as* band. Nothing else is coloured: kinds, chains, roles and Systems are neutral.

### 3.3 Type

Families (all OFL; **the build self-hosts the three variable WOFF2 files**, no third-party font request
— call C-25):

```css
--display: "Fraunces", "Iowan Old Style", Georgia, serif;          /* opsz 9–144, wght 300–600, SOFT 0–100, roman + italic */
--sans: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;   /* 400, 500, 600 */
--mono: "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace;  /* 400, 500 */
```

`font-optical-sizing: auto` everywhere (no hard-coded `opsz`). Fraunces carries
`font-variation-settings: "SOFT" var(--soft)` with `--soft: 50` (80 on the door hero, 60 on door
section heads). Root `-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale`.
Sizes are `rem` (root 16px).

**The scale** (size / line height / weight / tracking):

| Token | Size | LH | Family · weight | Tracking | Used for |
|---|---|---|---|---|---|
| `--fs-micro` | .6875rem (11) | 1 | Mono 500, uppercase | `--ls-eyebrow` .08em | eyebrows, kbd, edge labels, node kind |
| `--fs-tiny` | .75rem (12) | 1.2 | Sans 500 | 0 | chips, status words, ages, counts |
| `--fs-label` | .75rem (12) | 1.3 | Sans 500 | 0 | column heads, field labels (sentence case) |
| `--fs-code` | .78125rem (12.5) | 1.2 | Mono 400/500 | 0 | addresses, amounts, ids, hashes, nonces in rows |
| `--fs-meta` | .8125rem (13) | `--lh-row` 1.35 | Sans 400 | 0 | second line of a row, captions, notes |
| `--fs-ui` | .8125rem (13) | 1 | Sans 500 | 0 | buttons, tabs, menu items |
| `--fs-body` | .875rem (14) | `--lh-body` 1.5 | Sans 400; row titles 500 | `--ls-name` −.005em on titles | interface text |
| `--fs-sub` | 1rem (16) | `--lh-prose` 1.65 | Sans 400 | 0 | page prose, inspector title (600), dialog title |
| `--fs-title` | 1.5rem (24) | `--lh-title` 1.25 | Sans 600 | `--ls-title` −.015em | page and record titles, `text-wrap: balance` |
| `--fs-greet` | 1.75rem (28) | 1.15 | Display 400 | −.015em | Home's line ("Three things wait on you.") |
| `--fs-page` | 2rem (32) | 1.15 | Display 400 | −.02em | a workspace page's title in the editor |
| `--fs-amount` | 2rem (32) | 1 | Display 350, lining tabular | −.02em | a large amount on the members' side (treasury) |
| `--fs-d-hero` | clamp(2.5rem, 1.25rem + 4.2vw, 4.75rem) (40→76) | `--lh-d-hero` 1.02 | Display 350, SOFT 80 | `--ls-display` −.025em | door hero |
| `--fs-d-sec` | clamp(1.75rem, 1.4rem + 1.2vw, 2.25rem) (28→36) | `--lh-d-sec` 1.1 | Display 350, SOFT 60 | `--ls-d-sec` −.02em | door section heads |
| `--fs-d-card` | 1.5rem (24) | 1.2 | Display 400 | −.01em | door card titles, map plate title |
| `--fs-d-lead` | clamp(1.1875rem, 1.05rem + .5vw, 1.375rem) (19→22) | `--lh-d-lead` 1.45 | Display 400 | 0 | door section lead, max 34em |
| `--fs-d-body` | 1.0625rem (17) | 1.6 | Sans 400 | 0 | door body, max 68ch |
| `--fs-d-fig` | clamp(2.25rem, 1.8rem + 1.6vw, 2.75rem) (36→44) | 1 | Display 350, lining | −.02em | door pool figures |
| `--fs-d-fact` | 1.625rem (26) | 1 | Display 400, lining | 0 | door hero facts |

Weights: `--fw-regular 400`, `--fw-medium 500`, `--fw-strong 600`, `--fw-display 350` (Fraunces only, and
only at 28px and up). Nothing under 18px is lighter than 400.

**Figures and text details.** `font-variant-numeric: tabular-nums` on every number that changes or sits
in a column; Mono adds `slashed-zero`. Proportional figures in prose. Typographic punctuation in all
copy (’ “ ” – — … and a non-breaking space before units). `text-wrap: balance` on titles,
`pretty` on paragraphs. Long ids and addresses `overflow-wrap: anywhere` where shown in full. Inputs
are 16px under 760px (iOS zoom). Interface text is `text-align: start`; `lang` and `dir` set on `<html>`;
mixed-direction values in `<bdi>`.

**Where Fraunces appears on the members' side — only here** (call C-4): Home's line, a page's title in
the editor, a large amount, the Safe at the centre of a map, the sign-in title. Everything else on the
members' side is Geist.

### 3.4 Space

`--sp-1 … --sp-18` = 1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40, 56, **72, 96, 128** px (16–18 new,
door rhythm only). Rules: the gap between groups is at least twice the gap within one; one step per
nesting level; the page gutter is `--sp-13` (32) on desktop, `--sp-10` (16) under 760px; sections on
Home are `--sp-14` (40) apart; door sections `--sp-17` (96) above, `--sp-15` (56) below.

The board canvas geometry stays in code (`boards/layout.ts`); the README's warning about `--sp-11` and
card widths holds. `house` changes `--sp-11` from 16 to 20: L4 checks `/b/*` canvas boards for touching
cards in its screenshot tests and, if needed, reads the gap from the token (the README's own suggested fix).

### 3.5 Corners

`--radius-xs 4` (kbd, mention), **`--radius-sm 6`** (address chip, kind tile), `--radius-ctl 7` (buttons,
segments), `--radius-input 7`, `--radius 10` (surfaces, map nodes, cards), **`--radius-pop 12`** (menus;
items inside are 8 with 4 padding, so outer = inner + padding), **`--radius-lg 16`** (map box, editor,
canvas), **`--radius-plate 22`** (door map plate), `--radius-chip 999px`, `--radius-step 50%`.

### 3.6 Depth

Four levels, never more on one screen: **flat** (hairline only: rows inside a surface), **card**
(`--raised` + `--rule` border + `--shadow-card`: lists, panels), **raise** (`--shadow-raise`: map nodes,
the house frame on the door, a lifted board card), **pop** (`--pop` + `--shadow-pop`: menus, palette,
sheets, tooltips). In dark, height also lightens the surface (`--raised` → `--pop`).

### 3.7 Motion

| Token | Value | For |
|---|---|---|
| `--dur-1` | 120ms | hover fills, row and tab changes, colour only |
| `--dur-press` | 150ms | press: `scale: var(--press-scale)` = .96, `ease-out`; never on disabled |
| `--dur-2` | 200ms | menu, palette, tray open; enter = opacity + 4px translate; exit 150ms opacity only |
| `--dur-3` | 320ms | sheet, inspector, map camera fit |
| `--dur-flow` | 1100ms | one run of value along an edge; **3 runs, then the path stays moss** |
| `--ease` | `cubic-bezier(.2,0,0,1)` | everything above except press |

- Transitions name their properties (never `all`); interactive state uses transitions, not keyframes.
- **Reduced motion** (`prefers-reduced-motion: reduce`): no translate, scale, blur or travelling dash.
  Menus and sheets cross-fade 120ms; value flow is replaced by the still moss path and a polite
  announcement; the attention ring does not run; spinners become a static ¾ ring with the word.
- **Nothing moves longer than 5 seconds** (2.2.2): the attention ring runs twice (4.8s) on first
  appearance, then the dot stays still; value flow ends after 3.3s; skeletons breathe only while a
  first load is pending.
- The theme switch suppresses all transitions for one frame.
- Loading skeletons: `--wash` bars, opacity 1 → .55, 1.4s alternate.

### 3.8 Structure

`--w-nav 240`, **`--w-rail 56`**, `--w-inspector 360`, `--w-palette 640`, **`--w-content 1040`** (page
column max), **`--w-prose 68ch`**, **`--w-door 1120`**, `--w-node 200` (max), **`--w-node-min 148`**,
`--w-kcol 280`; **`--h-topbar 52`**, **`--h-row 56`** (two-line row), **`--h-row-1 40`** (table row),
**`--h-tray 56`**, **`--h-bottombar 60`** (+ safe area), **`--h-ctl 32`**, **`--h-ctl-touch 44`**,
**`--h-input 36`**, **`--h-chip 22`**, **`--h-addr 24`**. Opacity: `--o-disabled .45`, **`--o-dim .38`**.

Breakpoints (the content's, not devices'): the frame reads its own width — **≥1100** sidebar
expanded, **760–1099** rail, **<760** phone. Elements use container queries on their own width:
rows drop columns <760, table→cards <600, board→grouped list <600, calendar→agenda <600, map→three
columns <680, wizard rail→top line <560, door→one column <900, prepared-transaction card stacks <520,
field rows stack <420.

### 3.9 Icons

One stroke set on a 24 grid, 1.5px stroke (matching 400–500 text), `currentColor`, round caps and
joins; 16px in rows and nav, 14px in buttons and chips, 13px inside address chips, 20px in the bottom bar.
Outline by default; the current nav item recolours (ink), it does not fill. Base set: **Lucide**
(MIT) — call C-27 — with house-drawn glyphs where Lucide has none that reads right at 14px: **hat**
(crown + band + brim), **Safe** (vault with dial), **grant pool** (arrow into water lines). Kind glyphs:
safe → vault, hats-tree/hat → hat, snapshot-space → ballot box, gardens-community → sprout,
gardens-pool → pool, link → link, wallet → wallet, proposal → pull-request (two nodes and a return
arrow), page → file, meeting → people, task → check. Under `dir="rtl"` only arrows and chevrons mirror.

## 4. The two doors' voices

| | Members' side | Public door |
|---|---|---|
| Type | Geist; Fraunces only per §3.3 | Fraunces for heads, leads, figures; Geist for body and meta; Mono for addresses |
| Density | dense but airy: 56px rows, 40px between sections | generous: 96px between sections, 68ch body, 34em leads |
| Words | precise, short, verbs on actions ("Propose", "Open in Safe", "Keep mine") | plain language, the org's own words: "Who holds what", "What we fund", "Treasury", "Decisions" |
| Numbers | exact, Mono, with their read age | rounded display figures (exact Mono value on the record page) and their read age |
| Names | handles and roles | hats, never wearers' names unless a person marked theirs public (rule 9) |

Copy rules for both: sentence case; no exclamation marks; say what happened and what to do next
("Couldn’t read the Garden. Showing the read from 2 h ago."); never imply the house signed
("prepared", "waits for signatures", "read back" — never "sent", "executed by", "transaction submitted").

## 5. The frame

### 5.1 Layout

A grid of sidebar + main. Main is a grid of named areas: `top` (top bar, 52px), `band` (the *view as*
band when previewing, else empty), `scroll` (the page, its own scroll container,
`overscroll-behavior: contain`, `scroll-padding-top` = top bar), `tray` (the Changes tray dock). Under
760px: `top` (48px phone bar), `band`, `scroll`, `tray`, `bbar` (bottom bar). The page column is
centred, max `--w-content`, gutter `--sp-13`.

### 5.2 Sidebar (≥1100px)

From the top:
1. **Org switcher** — the org's mark (from the org's records; a neutral seal when none) on `--solid`,
   the name in Sans 600, an up-down chevron. Opens a menu: the org's public door ↗, switch org (if
   the server hosts several), Appearance (System / Light / Dark).
2. **Search or jump** — a field-shaped button (`--raised`, `--rule-strong`) with ⌘K kbd; opens the palette.
3. **Sections**, in house-spec order, 32px rows, icon + label + trailing count:
   Home · Needs you (count in clay, 500) · Proposals (open count) · Systems (count) · Roles · Treasury ·
   Workspace · Library · Changes (staged-op count in moss, 500). Counts are of what the viewer may see
   (rule 7); a zero shows nothing.
4. **Workspace expands** under itself into its collections and pinned pages (28px, indented 34px):
   Meetings, Tasks, Projects, Knowledge, then any other collection the viewer may see, then pinned pages.
   It shows when Workspace or a child is current, or when the member pinned it open.
5. **Instance** group (collapsed by default, only when non-empty): the 0.6 org-os boards that are not
   DAO sections — Crew, Fleet, Modules, Sources, Activity, All records, Boards (call C-8).
6. **Foot**: Public door ↗ (opens the door in a new tab); the signed-in identity: hat glyph in a 24px
   `--wash` circle, the hat's name (Sans 500 13), the short address and hat id (Mono 11, faint). It
   opens a menu: hats worn, copy address, *View as…*, sign out.

Current item: `--nav-on-bg` fill, ink, 500, icon ink. Hover (hover-capable pointers only): `--wash`.
`aria-current="page"` on the current link. The sidebar is a `<nav aria-label="House">`.

### 5.3 Rail (760–1099px, or ⌘\ / `[` at any width ≥760)

56px wide; icons only (40×40 targets), counts as 10px superscripts in the corner, labels as the links'
accessible names and as tooltips on hover/focus. Search becomes a 40px icon button. The identity is
the hat glyph alone. Expanding from the rail on 760–1099 overlays the expanded sidebar over the page
(scrim, Esc closes, focus returns to the toggle).

### 5.4 Phone (<760px)

- **Top bar** 48px: org seal, the page title (Sans 600 14), then *view as* (eye) and search icon
  buttons (44px targets).
- **Bottom bar** `--h-bottombar` + `env(safe-area-inset-bottom)` (viewport meta has
  `viewport-fit=cover`): five equal items, 20px icon over an 11px label — **Home, Needs you (clay badge
  with count, `--on-accent` text), Proposals, Workspace, More**. Current item ink, others mute.
- **More** opens a bottom sheet (`--pop`, 16px top corners, grab handle, scrim): Systems, Roles,
  Treasury, Library, Changes, Public door, View as…, then the identity. 44px rows, 16px labels.
  It is a modal dialog: focus moves in, Esc or a drag down closes, focus returns to More.
- The tray becomes a floating card above the bottom bar (§5.6).

### 5.5 Top bar (≥760px)

Leading: rail toggle (ghost icon button), then the path: ancestors in mute, `/` in `--rule-strong`,
the current item in ink 500, truncating from the middle ancestors first. Trailing: **View as** control,
notifications (comment glyph; a moss dot when unread mentions exist — conversation is L6, the dot is
drawn from fixtures in L4).

### 5.6 The Changes tray

**Docked** in the `tray` area under the page, never over it (the prototype's floating pill covered
rows — call C-6). Hidden when nothing is staged.
- Collapsed, 56px, `--raised`, top hairline: moss count square (22px, radius 6, `--on-accent` 600 12),
  then "N staged change(s)" (500 13) over a one-line summary of the last op and the rule that decides
  it (12 mute, truncated), then **Review** (secondary) and the primary action: **Propose** when a rule
  needs more than the author, **Apply** when direct.
- **Stale** (an op changed on the trunk): the count square turns clay with "!", the line reads
  "1 op changed on the trunk — choose what stands", the only action is **Review** (primary).
- **Applying / proposing**: spinner + "Applying…" + the rule; actions hidden; `aria-busy`.
- Expanded (**Review**, `g c`, or the sidebar's Changes): opens upward as a panel up to 60% of the
  frame's height over the page with a scrim, or as a page at `/changes` on phone. Head: "Your change",
  "3 ops · 2 records", **Discard all** (ghost; confirms). One block per op: kind tile, record name,
  `field  old (struck, Mono faint) → new (Mono)`, remove × (ghost icon). A stale op is an
  `--attn-soft` block with "changed on the trunk", "trunk now: …", **Keep mine** / **Take theirs**.
  Foot (`--sunken`): the rule sentence ("Council consent decides this · 4 of 8"), **Show diff**,
  primary.
- Phone: a card with 8px margin above the bottom bar, radius 12, `--shadow-pop`, count + "N staged" +
  the primary only; Review is a tap on the card.
- Keyboard: `g c` opens; Esc closes and returns focus; ops are a list; × buttons are labelled
  "Remove op: <field> on <record>". The tray is a `region` labelled "Changes"; its count changes are
  announced politely ("2 staged changes").

### 5.7 ⌘K / Ctrl-K palette

- Opens from anywhere (⌘K, Ctrl-K, the sidebar search, the phone search icon). A modal dialog
  (`<dialog>` + `showModal()`), 640px wide at 12vh from the top over `--scrim`; on phone a full-height
  sheet from the top.
- Input 52px, 16px text, search glyph, a **scope chip** (All · a section · "in this page"; Tab cycles
  scopes). Results are a listbox driven by `aria-activedescendant` (focus stays in the input): groups
  **Jump to** (sections and boards, with their `g` keys), **Records** (glyph, name with the match in
  600 ink, kind and context in faint), **Actions** (every operation the viewer can perform: "Propose a
  treasury transfer", "Open Treasury on the map", "View as Public"), **Views** (saved views).
  40px rows, `--wash` on the active row.
- Foot: ↑↓ move · ↵ open · ⌘↵ open in the inspector · esc close.
- **Absence (rule 7):** results, groups and counts include only what the viewer may see. No
  "N hidden" line, no greyed rows. The empty state is one line: "Nothing matches “hatt”. Try a section
  name, a record id or an address."
- An address pasted into the palette finds the System, hat or member record that holds it (if visible).

### 5.8 Keys

`?` shows the key map (a dialog with the table below). Single-letter keys never fire while an input,
textarea or editor has focus.

| Keys | Does | Keys | Does |
|---|---|---|---|
| `g h` | Home | `g w` | Workspace |
| `g n` | Needs you | `g l` | Library |
| `g p` | Proposals | `g c` | Changes |
| `g s` | Systems | `g d` | the public door (new tab) |
| `g r` | Roles | ⌘K / Ctrl-K | palette |
| `g t` | Treasury | ⌘\ or `[` | fold / unfold the sidebar |
| `j` / `k`, ↓ / ↑ | next / previous row in any list | `v` | List · Map |
| ↵ | open the row | Space | preview the row in the inspector |
| Esc | close the top panel (panels machine's stack) | `c` | comment on the current page/record (L6) |

Every list is a roving-tabindex composite (one tab stop, arrows inside). `g` waits 900ms for its second key.

### 5.9 View as

- **Control:** in the top bar (eye glyph + "View as: you" + chevron, 28px, `--raised`, `--rule-strong`);
  on phone the eye icon. Menu: *You* (default), *Public*, *Members*, then each hat in the tree by name
  and id. Available to whoever may see the house's visibility settings (L5 decides who; L4 shows it
  to every member on fixtures). Also in ⌘K ("View as Public").
- **Previewing:** the `band` area shows a full-width strip in `--solid` / `--on-solid`, eye glyph,
  "**Previewing as Public.** Only what anyone can read is shown. Nothing can be changed here." and an
  outlined **Exit preview** button. The control reads "View as: Public" with a globe glyph. Every write
  action (buttons, inline edit, tray, composer) is hidden — not disabled — while previewing; the tray
  hides. The filter applies everywhere at once: lists, counts, sidebar counts, palette, map, mentions.
- Esc does not exit a preview (it closes panels); Exit preview or the menu does. The band is a
  `role="status"` announced once on entry.

### 5.10 Inspector

A right panel (`--w-inspector` 360, `--raised`, start hairline) beside a list or the map on ≥1200px of
frame width; an overlay sheet from the right with scrim on 760–1199; a bottom sheet (max 88% height)
on phone. Head: kind tile, eyebrow (kind), name (Sans 600 16), close ×. Body: the small map (§8.6),
field rows, actions (Open record, link-out). Opened by Space on a row/node or ⌘↵ in the palette;
Esc closes and returns focus to the row. The panels machine owns it (0.6 P4 §4.5).

### 5.11 Route changes

On every route change: `document.title` = "<page> · <org>", focus moves to the page's `<h1>`, the
scroll area resets to the top, and the skip link ("Skip to content", first focusable) targets `<main>`.

## 6. States

### 6.1 The marks (one vocabulary everywhere)

0.6's marks keep their derivation (`marksOf`) and gain the house's shapes. Every mark is a shape **and**
a word; the shape is `aria-hidden`, the word is the accessible text.

| Mark | Shape (8px) | Colour | Default word |
|---|---|---|---|
| needs | filled circle | clay | "Needs you" / the specific need |
| staged | filled square r2 | moss | "Staged" |
| stale | hollow square 1.5px | clay | "Changed since staged" |
| draft (not deployed) | dashed square | moss | "Not yet deployed" |
| open | hollow circle | mute | "Open" |
| ok | filled circle | mute | "Up to date" |
| done | check | mute | "Decided" / "Executed" / "Added" |
| running / reading | ¾ ring, spinning (still under reduced motion) | mute | "Reading…" |
| failed | 9×2 bar | clay | "Couldn’t read" / "Failed" |
| closed | 9×2 bar | faint (text faint) | "Withdrawn" / "Rejected" / "Expired" / "Built in" |
| aged | dashed circle | faint | "Old read" |
| selected | row/node treatment, no glyph | moss | announced by `aria-selected` |
| faint | `--o-dim` on the whole item | — | "not in this list" (0.6 word) |

### 6.2 State treatments (every element uses these, not its own)

| State | Treatment |
|---|---|
| **empty** | A `note-block`: dashed `--rule-strong` box, one 500 ink line ("No tasks yet."), one faint line of what fills it, at most one action. Lists inside a section use the one-line `note` (dashed-circle glyph, faint). |
| **loading** | First load only: skeleton rows matching the element's shape (`--wash` bars, the row's real height so nothing jumps), `aria-busy` on the region and "Loading <thing>" for screen readers. Never a full-page spinner. Lists and navigation render from cache instantly; only driver reads may be pending, and those show their reading state, not a skeleton. |
| **fresh read** | The fact, plus "read 4 min ago" (`age`, 12 faint). |
| **aged read** (0.6 `aged`: past the reader's TTL) | Value in mute, a clock glyph and "read 38 min ago" in mute; on map nodes the clock leads the meta line. No attention. |
| **failed read** | Last good value kept (mute) + "couldn’t read · last 2 h ago" in clay with the alert glyph; a Needs you item; the node gets the clay dot. With no last good value: "—" and "not read yet · couldn’t read". |
| **reading** | spinning ring + "reading…" in place of the age. |
| **unknown** | "not read yet" (faint). |
| **restricted** | See §6.3. |
| **staged** | Moss: the staged mark; on a field, a 2px moss inline-start bar, old value struck (Mono faint) beside the new; on a node, moss 1.5px border and a moss "staged" tag; on a board card or calendar event, a 2px moss inline-start bar. |
| **stale** | As staged, in clay, with "now <value> on the trunk". |
| **error** (a request failed) | `note.error`: clay alert glyph + what failed + **Try again** (underlined ink link). Inside a form: `aria-invalid`, clay border, message under the field linked by `aria-describedby`, focus to the first invalid field on submit. |
| **attention** | Clay: the needs mark, the clay tile on Needs you rows, the clay dot on nodes, the clay count in the sidebar/bottom bar. |
| **disabled** | `--o-disabled`, no press. Prefer `aria-disabled` + a reason in a tooltip or beside it when the person needs to know why ("Only the author can withdraw"). |
| **selected** | `--accent-soft` fill + 2px moss inline-start bar (rows), moss border + 3px `--accent-soft` ring (nodes, cards). |
| **hover** | `--wash` fill (hover-capable pointers only, `@media (hover: hover)`), 120ms. |
| **focus** | 2px `--focus` outline, 2px offset (inset −2px on full-width rows), never removed. |
| **pressed** | scale .96, 150ms. |

### 6.3 Restricted — three renderings, and absence

1. **Absent** (rule 7) — in lists, tables, boards, calendars, search, ⌘K, backlinks, the map, counts,
   sidebar counts, notifications and the mention picker's records: the item is not drawn and not
   counted. No placeholder, no gap.
2. **A restricted field of a visible record** (rule 3): the label keeps a lock glyph; the value reads
   "<hat> only" in faint ("Ops only"). Schema is not secret; the value is.
3. **"Members only" slot** (rule 6): on the public door, wherever a public page embeds something
   non-public — a dashed `--rule-strong` box, lock glyph, "Members only", faint, no title, no kind, no
   count. On the members' side, an embed in a page the reader may not see renders the same slot
   reading "Not visible to you" (call C-20, see §18).
4. **Governance about restricted data** (rule 8): the proposal row and page show "A change to a
   restricted collection" + the rule that decided it; the diff and record list are replaced by the
   members-only slot for those who cannot see the data.

## 7. Elements: controls and atoms

Each element below lists anatomy → states → keyboard and screen reader. Sizes are tokens (§3).

### 7.1 Button

- **Primary**: `--solid` fill, `--on-solid` 500 13, 32px (44 on coarse pointers), padding 0 12, radius 7.
  One per view. **Secondary**: `--raised`, `--rule-strong` outline, `--shadow-card`, ink. **Ghost**:
  transparent, mute; hover `--wash` + ink. **Icon**: 32×32 (44 coarse), always `aria-label`. Leading
  icon 14px with 2px less leading padding. **Small** (26px, 12px) only inside dense rows and cards.
- States: default · hover (primary .88 opacity; others `--wash`) · focus ring · pressed .96 ·
  busy (spinner replaces the leading icon, label becomes the -ing form, `aria-busy`, still focusable) ·
  disabled · `aria-disabled` with reason.
- Destructive actions (Discard, Delete, Remove) are primary/secondary ink buttons followed by a
  confirmation that names exactly what goes (call C-3). Never red.
- Links that look like buttons are `<a>` (Open in Safe ↗ carries "(opens in a new tab)" in its name).

### 7.2 Inputs

Text, number, date, select, YAML (0.6's five) and textarea: 36px, `--input-fill`, 1px `--edge`, radius 7,
14px (16 under 760), padding 0 10. Label above (12/500 mute), hint under (12 faint). Focus: border and
2px ring in `--focus`. Invalid: clay border + message with alert glyph. Mono variant for addresses,
amounts and ids. **Staged field**: the label carries the staged mark; the previous value sits under it
struck. Stepper (threshold): − input + with the "of N" after it. Checkbox 16px, `--edge`, moss when on;
radio 16px ring, moss 5px border when on; choice cards (wizard) get the moss border + soft ring.

### 7.3 Segmented control, tabs, menu, tooltip, kbd

- **Segmented** (List · Map; Appearance): `--wash` track radius 9, 2px inset; segment 26px, 12/500;
  on = `--raised` + `--shadow-card` + ink. A `group` of toggle buttons with `aria-pressed`; arrows
  move within.
- **Tabs** (view switcher, Proposals / Decided / Rules): 36px, 13/500, mute; selected ink with a 2px ink
  underline on the hairline; count after the label in faint. APG tabs: arrows move, Home/End,
  automatic activation. Overflow scrolls horizontally inside the bar only.
- **Menu**: `--pop`, radius 12, padding 4, `--shadow-pop`; items 32px radius 8, glyph 15 mute, label,
  trailing hint/kbd/check (moss); separator hairline; header eyebrow. Radio items use
  `menuitemradio` + `aria-checked`. An unavailable item stays visible (`aria-disabled`) with its reason
  ("you don’t wear it") — except when the item itself would reveal something the viewer may not see,
  in which case it is absent.
- **Tooltip**: `--solid` / `--on-solid`, 12/500, radius 6, max 32ch; on hover and focus after 400ms,
  Esc dismisses; never the only place essential information lives.
- **kbd**: 18px, 11/500 faint, `--raised`, `--rule-strong` with a 2px bottom.

### 7.4 Note

The one line for empty, loading, error, unavailable and not-yet (0.6's `Note`): glyph + 13px text, colour
per §6.2. Inline actions are underlined ink links.

### 7.5 Address chip

- Anatomy: 24px, `--wash`, radius 6, Mono 12.5 ink, **`0x` + first 4 … last 4** in checksummed case
  (`0x6AFF…343a`), copy glyph 13 faint. Named variant: the name (ENS or the System's own) in Sans 500
  12 instead of hex. Full variant (record pages, door treasury): the whole address, `overflow-wrap: anywhere`.
- **Click copies the plain `0x` address** (what a signer pastes). The CAIP-10 id
  (`eip155:42220:0x…`) is the chip's `title` and tooltip, and **Copy CAIP-10** is in the chip's
  context menu (right-click / long-press / Shift+F10) (call C-9).
- States: default · hover (`--wash-strong`) · focus · **copied** (the glyph cross-fades to a moss check:
  scale .25→1, opacity, blur 4→0, 300ms; reverts after 1.6s; a polite "Copied 0x…" announcement) ·
  **warn** (`--attn-soft`, clay, alert glyph; e.g. the zero address, or not a contract where one is
  expected) · inside an outcome strip (`--raised` fill).
- It is a `<button>`; accessible name "Copy address 0x6AFF…343a" (the full address is in the
  description). It is never a link to a block explorer (explorers are brand surfaces; the System's
  own "Open in …" is the link-out).

### 7.6 Chain chip

22px pill, 1px `--rule-strong`, `--raised`, 12/500 mute; a 7px hollow circle glyph (faint). **Never a
brand logo or brand colour.** Variants: one chain ("Celo"); **several** ("7 chains", glyph of three
stacked bars; hover/focus opens a popover listing the chains); **test network** (dashed outline,
"Sepolia · test"); **disagree** (clay outline and text, "6 of 7 agree" — a multi-chain Safe whose
chains read differently; also a Needs you item). Names from CAIP-2 via a fixed table
(eip155:1 Ethereum, :10 Optimism, :42161 Arbitrum, :100 Gnosis, :137 Polygon, :8453 Base, :42220 Celo,
:11155111 Sepolia); an unknown chain shows its CAIP-2 id in Mono.

### 7.7 Amount

Mono 500 12.5 tabular, slashed zero, value then the unit in 400 mute after a narrow gap
(`1,271.00 USDGLO`). Body size 14 in cards and transaction calls. Outgoing uses a true minus (−).
**From an aged read**: mute. **Not read**: "—" + "not read yet". **Large** (members' side treasury):
Fraunces 350 32 lining tabular with the unit in Mono 12 mute. Decimals: as many as the token's
display precision, max 2 for stablecoins, grouped by the viewer's locale for separators; the copied
value is the exact on-chain amount.

### 7.8 Status

§6.1's marks at 12/500 in the mark's colour. A status column holds one mark; a record header may hold
the state mark and one need.

### 7.9 Read age

12 faint "read 4 min ago" → aged (clock, mute) → failed (alert, clay, "couldn’t read · last 2 h ago")
→ reading (spinner) → unknown ("not read yet"). Relative under 24h ("4 min ago", "2 h ago"), then
"28 Oct", then "28 Oct 2025" across years; full ISO time in `title`. A `<time datetime>`.

### 7.10 Visibility marker

Glyph 14 + word 12/500 mute: **Public** (globe), **Members** (two people), **Hat: Ops** (hat + hat name).
As a control (page editor bar, record header for those who may change it): a 26px outlined button with
a chevron opening the visibility menu — choices stricter than now say "applies now"; looser say
"propose" and stage a *publication*-class change (rule 5); hats the actor does not wear are listed
`aria-disabled` "you don’t wear it". A widening in flight reads "Members → Public, proposed" with the
target in moss. A stricter-than-parent page shows the parent's level in its menu's header.

### 7.11 Mention

Inline, inherits the text size: `--wash` pill radius 4, 0 3px padding, ink 500, `@` in faint. Variants:
person (role/handle), **you** (`--accent-soft`, moss), **record** (kind glyph 13 + name/id), **page**
(file glyph + title). A mention of something the reader may not see renders the "Members only"/"Not
visible to you" dashed inline form (no title). Mentions are links (person → member record, record →
record page).

### 7.12 Presence

Monograms, never pictures or identicons: 24px circles, `--wash-strong`, Sans 600 10 ink, two letters
from the member's handle; a 2px `--paper` ring; stacked with −4px overlap, first on top; more than 3
→ "+N" (outlined). **Editing** adds a 12px `--solid` badge with a pen. The stack is a single element
with an accessible name ("Ops lead is editing; Steward B is reading"). Shown only for people who may
see the thing (it is conversation, gated by visibility).

### 7.13 Meter

Segments for counts up to 12: 12×4 pills, gap 3, radius 2; done = ink, remaining = `--rule-strong`,
**yours = moss** (the segment your approval or signature filled — call C-12). Over 12: a 96×4 bar with
an ink fill. Always followed by its words ("2 of 4 approved", "3 of 4 · you approved"); the meter
itself is `aria-hidden`.

### 7.14 Kind tile

28px (`--radius-sm`), `--wash`, kind glyph 16 mute. 32px on Needs you, 40px on record headers.
Attention tile: `--attn-soft` + clay glyph. Moss tile (`--accent-soft`): a done/added outcome.

## 8. The map

### 8.1 Where it appears

Every collection and the Systems list has **List · Map** (`v`). Systems' map is the DAO map. The public
door leads with it (read-only, public records only). Every record page carries a small map (§8.6). The
compose canvas is the map, editable (§8.7).

### 8.2 Layout rule

Layered, top to bottom by authority, computed in code (the skin cannot move nodes — README "What a
skin cannot change"). The builder picks the layout library inside §18 of the house spec; ELK's layered
algorithm fits.

1. **Layer 0 — who decides**: vote venues (Snapshot spaces) and the top governing hats (councils).
2. **Layer 1 — roles that act**: hats whose wearers sign or operate (signer hats, operations), and
   wallets they hold.
3. **Layer 2 — treasuries**: Safes. The DAO's main Safe (the System in `organization/treasury`, or the
   one most edges point at) is centred and drawn **big**.
4. **Layer 3 — what treasuries feed**: grant pools, Gardens communities, other Safes they administer.
5. **Linked** Systems (`link` kind, not read) sit in a dashed group to the start side of layers 2–3,
   labelled "Linked" (members' side) / "Also on" (door).
- Within a layer, order follows edges to minimise crossings; ties break by name. Gap between layers
  64px (52 on phone), between columns 16px. Edges leave a node's bottom centre and enter the next
  node's top centre as a vertical cubic; same-layer edges run side to side as straight lines.
- **Phone / narrow (<680px of map width):** the same layers on a three-column grid; nodes drop their
  glyph and shorten facts; the linked group becomes a two-column row under layer 3. The map stays a
  map at 390; List is one tap away.
- Fit-to-view on first paint and on "Fit" (⌘0); zoom (⌘+/⌘−, pinch, ctrl-wheel) 50–200%; pan by drag on
  the canvas, arrows when the canvas has focus. Node positions are never stored for the DAO map (it is
  computed); the compose canvas stores them (§8.7).

### 8.3 Node anatomy

`<button>` (or `<a>` on the door), `--raised`, 1px `--rule-strong`, radius 10, `--shadow-raise`,
padding 10 12, width 148–200:
- line 1: kind glyph 14 mute + name (Sans 500 13 ink, truncate);
- line 2: one line of facts in Mono 11 mute (`hat 13.1 · 8 wear it`, `4 of 8 · 7 chains`,
  `1,271 USDGLO`), truncate;
- **big** (the main Safe): eyebrow "SAFE" (Mono 10, .08em, faint), name in Fraunces 17, `--edge` outline,
  max 236.

| State | Treatment |
|---|---|
| default / hover | as above / outline `--edge` |
| selected | moss outline + 3px `--accent-soft` ring; edges on its path moss 1.75; others dim .3 |
| needs you | 10px clay dot at the top-end corner with a 2.5px canvas-coloured ring; a 1.25px clay ring grows from it twice on first appearance, then stops |
| staged | moss 1.5px outline + a moss "staged" tag (18px pill, `--on-accent`) on the top edge |
| aged read | facts lead with a clock glyph and the age |
| failed read | facts in clay with the alert glyph ("couldn’t read · 2 h"); clay dot |
| reading | facts replaced by spinner + "reading…" |
| linked, not read | transparent, dashed `--rule-strong`, no shadow, link glyph; facts end with ↗ |
| empty hat | transparent, dashed, name mute, "no wearer"; clay dot |
| composed, not deployed | dashed moss 1.5px, "not deployed" dashed tag; deployment order badge (18px `--solid` circle, Mono 10) |
| dimmed (off the selected path) | `--o-dim` |
| restricted | absent (§6.3) — and its edges with it |

Accessible name: name, kind, the facts line, then "needs you: <need>" / "staged" / "couldn’t read"
(0.6 `nodeName` + `cardName`).

### 8.4 Edges

1.25px `--edge` (3:1 against the canvas — the relation is information, 1.4.11); on the selected path
1.75px moss; off-path .3 opacity; **invalid** (compose) clay dashed 4 4. Labels: Mono 11 mute on a
canvas-coloured pill (3px 5px, radius 4), centred on the edge, the relation in plain words (*elects,
appoints, includes, holds, signs 4 of 8, admin, pool*). A label is dropped when its edge is shorter
than the label plus 16px (the relation stays in the nodes' accessible descriptions).

### 8.5 Attention and value on the map

- **Attention** matches Needs you one to one: every Needs you item names the node(s) it concerns; those
  nodes carry the clay dot. Clicking the dot (or Space on the node) opens the inspector at the need.
- **Value moving:** when a transaction is **prepared** and again when it is **read back executed**, a
  3px moss travelling dash (`stroke-dasharray .1 11`, round caps) runs along every edge the
  transaction touches (from → to Safe → pools), three runs of 1.1s, then the edges stay moss 1.75
  ("the path"). A polite announcement says what moved ("Transaction 18 prepared. It moves 3,100 USDGLO
  from the two pools to the Treasury."). Reduced motion: no dash, the still path and the announcement.
- **Caption** under the map (the prototype's): kind tile, name, kind facts in Mono, and one plain
  sentence about the selected node; a polite live region.
- **Text alternative:** the map has a "List" twin one key away (`v`) and the canvas is a `group`
  labelled "<n> Systems, as a map"; each node's description lists its edges ("signs 4 of 8 for
  Treasury"). Tab enters the map at the selected node; arrows move along edges to the nearest node in
  that direction; Enter opens; Space inspects; Esc leaves the map.

### 8.6 Small map (record pages and the inspector)

The record (outlined ink, 600) and up to six one-hop neighbours, placed on a fixed radial template
(above-left, above-right, below-left, below-right, start, end), 188px tall (220 on the record page),
`--sunken` with the dot grid. Neighbour nodes are 12px pills with a 12px glyph; attention as an 8px
clay dot. Straight `--edge` lines. More than six: "+N on the map" link. "Open on the map" opens the full
map with this record selected.

### 8.7 Compose canvas

The map, editable (L7 wires the writes; L4 builds the element on fixtures).
- Three columns: **Place** shelf (200px: the kinds the library offers — Safe, Hats tree, Hat, Snapshot
  space, Gardens…, Link — 34px items with a grip), the **canvas** (`--sunken`, dot grid), the
  **inspector** of the selected node (fields: name, wearers, owners, threshold stepper, chain, "signs
  for" via Hats Signer Gate). Under 820px the shelf becomes a wrapping row above, the inspector a
  section below.
- Nodes are **composed, not deployed** (dashed moss) until read back; each shows its **deployment order**
  badge. The selected node shows four connection handles (9px, moss ring) at its sides.
- Placing: drag from the shelf, or select a shelf item and press Enter (placed at the canvas centre,
  then arrows move it 8px, Shift+arrows 40px — the single-pointer alternative, 2.5.7). Connecting:
  drag from a handle, or `c` on the selected node then arrows to pick the target and Enter. Delete
  removes (staged). Every action stages ops; nothing writes.
- **Invalid connection**: the edge draws clay dashed and a `--pop` note with a clay alert glyph says
  why and what fits ("A link can’t sign for a Safe. Connect a hat or addresses."); the note is
  announced (`role="alert"` once).
- Foot: "Staged · not yet deployed" (draft mark), "5 prepared transactions, in order · Sepolia",
  **Review order** (secondary), **Propose** (primary).

## 9. Elements: records and governance

### 9.1 Record header

- **System**: 40px kind tile; eyebrow (kind · System); title (Sans 600 24); facts line — chain chip,
  address chip, the governing fact ("4 of 8 signers"), read age; trailing: Read now (icon), the
  System's own link-out ("Open in Safe ↗"). Under 560px the actions wrap under the title.
- **Proposal / any record**: top line — id (Mono 12 mute), the state mark, the route pill
  ("T3 · Council consent"), the visibility marker; title (Sans 600 24, balance); meta — opened date and
  the hat it was opened under, closing date, presence; actions — the one primary for this viewer now
  (Approve / Propose / Ratify / Open in Safe), secondary actions, a More menu.
- Page and meeting records use the page editor header (§10.1).

### 9.2 Data row

The house's list row (Quiet's): 56px min, padding 10 16, hairline between rows inside a `--raised`
surface radius 10. Grid: kind tile (28) · main (title 14/500, second line 13 mute with inline chips and
facts) · trailing columns. States per §6.2: default, hover, focus (inset ring), selected (soft fill +
moss bar), staged (mark trailing, old value struck in the second line), stale, needs you (clay tile +
mark), reading, closed/faint (`--o-dim`), skeleton. Restricted: absent.

**Systems row** columns: kind tile · name/kind · chain chip · address (chip, or a Mono id such as
`42220 / 13`, or the host such as `snapshot.box`) · state (one mark: "1 to sign", "3 empty hats", "Up to
date", "Couldn’t read", "Return proposed", "Linked, not read") · read age (end-aligned). Under 760px the
chain moves into the second line and address and age drop (they are on the record page).

### 9.3 Field rows

A two-column `<dl>`: label 96–132px (13 mute) · value (14). Hairline between pairs. Value kinds: text,
Mono, address chips (+N more), amount with age, marks, links. States: read · edit in place (the input
replaces the value; Esc cancels; Enter/blur stages) · staged (moss bar, old struck) · stale (clay bar,
"now X on the trunk") · restricted (lock + "Ops only") · error (note.error). Under 420px labels stack
above values.

### 9.4 Attention item (Needs you)

72px min, grid 32px tile · main · trailing. Tile `--attn-soft` + clay glyph for the kind of need
(proposal, signature, empty hat, failed read, chain disagreement, overdue). Title 14/500 (two lines max);
meta 13 mute: id (Mono), route or chain chip, **meter + words**, context. Trailing: the deadline ("Closes
in 5 days", clay when past: "Closed 2 days ago"), or the link-out ("Open in Safe ↗"), or "Look →".
- States: **waiting on you** (clay tile) · **waiting on others** (you acted: neutral tile with check,
  "you approved" moss segment, trailing "Waiting on others"; it stays until the thing completes, then
  leaves for Recently) · **overdue** · **failed read** · **chains disagree** · loading (two skeleton
  rows) · error · **empty**: "Nothing waits on you." + "9 Systems read 4 min ago, none failing." centred
  in a dashed block.
- Order: overdue, then waiting on you by deadline, then failed reads, then waiting on others.
- The whole row is one link (`<a>`); the link-out variant is the row's primary link with "(opens the
  Safe app in a new tab)".

### 9.5 Proposal timeline

Vertical, in the proposal page's aside: **Proposed → <route> approvals → Decided → Transaction
prepared → Signed in the Safe → Read back**. 22px markers joined by a 1px line (ink once passed).
Step states: **done** (ink disc, on-solid check) · **current** (ink ring with ink centre) · **waiting**
(`--rule-strong` ring, text mute 400) · **yours** (moss disc — the step you completed, e.g. your
approval) · **failed** (clay ring + ×, text clay: "Read back: replaced — nonce 18 was used by another
transaction. Prepare again.") · **not needed** (dashed ring, "No transaction needed — this decision
changes records only"). Each step's second line holds its meter, date, actor-as-hat, or reference
(`DECISIONS.md#dr-2026-010` in Mono). The signed step always says "signers sign in the Safe app, never
here". An `<ol>` with each step's state in its text.
**Compact** form for rows and the door: 10px dots joined by 14px lines + one phrase ("Signing · 2 of 4").

### 9.6 Prepared-transaction card

A `--raised` card, radius 10, `--shadow-card`, its own container:
1. **Head**: kind tile (layers glyph), "Prepared transaction" (14/500), "Treasury Safe · nonce 18"
   (Mono for the nonce); trailing chain chip and the signature meter + words.
2. **Calls**: numbered (22px `--wash` square, Mono), title in plain words ("Return Network Projects
   to the Safe"), "from <address chip> to <address chip>", amount at the end.
3. **Total** (`--sunken`): the plain-language sum ("Back to the treasury · 3,100.00 USDGLO").
4. **Payload** (`<details>`, closed by default): a `--sunken` well, Mono 12/1.6, `dt`/`dd` pairs —
   to (with the contract's name), value, operation, data (wrapped), safeTxHash.
5. **Foot**: key glyph + **"The house never signs. Signers review and sign this in the Safe app."**
   (always present, in every state), **Copy payload** (ghost), **Open in Safe ↗** (primary).
6. **Outcome strip** after read back.

| State | Head / strip |
|---|---|
| preparing | spinner, "Reading the nonce from the Safe…" |
| prepared, unsigned | "0 of 4 signed" |
| partly signed | meter "2 of 4 signed" |
| ready to execute | "4 of 4 signed · any signer can execute it in the Safe"; mark *open* "Not executed" |
| executed and read back | moss tile with check, "matched what was prepared"; moss strip "Executed on Celo · block 31,204,118 · read back 2 min ago" + tx hash chip |
| executed, mismatch | clay strip: what differs from what was prepared |
| replaced / nonce used | clay tile, "Nonce 18 was used by another transaction. Nothing from this proposal ran." **Prepare again** |
| stale (proposal revised) | clay clock tile, "The proposal changed after this was prepared. Rev 3 is current; this payload is from rev 2." stale mark |
| failed read of the Safe | the card keeps its last state; the head's meter is mute with the failed age |

Under 520px: head actions wrap under the title, amounts move under each call, foot buttons go full width.

### 9.7 Role tree (Hats)

An APG tree (`role="tree"`, `treeitem`, `aria-level`, `aria-expanded`): rows 44px, chevron toggle 18,
26px hat disc (`--raised`, `--rule-strong`), name (14/500) + hat id (Mono 12 faint), trailing wearers:
up to 3 monograms + "+N" and the count ("8 wear it"), or a single address chip, plus what the hat does
("signs 4 of 8", "top hat · held by the Safe"). Connectors: 1px `--rule-strong` verticals and 9px
elbows. **Empty hat**: dashed disc, name mute, "No wearer" needs mark (attention). **Yours** (a hat you
wear): moss disc outline, "· you". Selected: soft fill. Restricted wearers (wallet↔person links are
*hat: Ops*, rule 9): wearers show as addresses or a count, never names, unless the person made theirs
public. Keys: ↑↓ move, → open / to first child, ← close / to parent, Home/End, Enter opens the hat,
Space inspects, type-ahead. Under 520px wearers move under the name.

### 9.8 Fund flow

Where value went in a window (default 90 days), read from the Systems: sources (start) → the Safe
(centre, big) → destinations (end). Bands are `--rule-strong` cubic paths, width 2–14px by each flow's
share of value moved in the window (one unit per chart; a mixed-unit window draws equal-width bands and
labels each amount — call C-31); **proposed or prepared** flows are moss at .5 opacity; executed flows
neutral. Nodes are 52px rounded boxes with name (Sans) and amount (Mono). It is an `img` with a full
text `<title>` sentence; under 600px it becomes a list of "From → To · amount · status" rows.

## 10. Workspace elements

### 10.1 Page editor chrome

- **Bar** (48px): path (ancestors collapse first) · save state · presence · visibility control ·
  comments toggle (count).
- **Save state** (12, glyph + words): "Saved · direct" (check, faint) · "Saving…" (spinner) · "Staged ·
  needs approval" (moss staged mark — the tree was raised to needs-approval; the save went to the tray)
  · "Someone saved a newer version" (clay, **Compare** — 0.6's conflict path) · "Offline · kept on this
  device" (clay).
- **Body**: max `--w-prose` + gutters, centred; meta line (12 faint: "Edited 4 min ago by Ops lead ·
  Workspace write · saves directly · 3 backlinks"); title in Fraunces 32 (§3.3); prose Geist 16/1.65.
  Headings H2 Sans 600 20, H3 Sans 600 16. Lists, links (underlined, `--edge` underline colour,
  from-font thickness). **Callout**: `--sunken`, radius 10, glyph, 14px. **Embedded record**: a bordered
  block with an eyebrow head (glyph, kind, read age) and data rows. **Embedded view**: the view's
  element inside the same block with its tabs. **Not visible to you** slot (§6.3).
- **Editing affordances**: the current block has a 2px `--focus` inline-start rule; selected text in
  `--accent-soft`; commented text underlined clay on `--attn-soft`; a floating **selection toolbar**
  (`--pop`, radius 10: bold, italic, heading · link, mention, comment; toggles with `aria-pressed`); a
  **slash menu** ("Insert · /": view of a collection, record, callout, task, table, divider) as a
  listbox. These are drawn by L4; the editor engine and persistence are L6.
- Phone: bar keeps path end, save glyph, presence, visibility; title 26px; body padding 16.

### 10.2 Collection views

One header for every view: **view tabs** (Table, Board, Calendar, List, Map — icon + label; saved views
after them), then **filter chips** (`--wash` pills "Status is not done ×"; "+ Filter" dashed),
sort, and the one primary ("New task"). Views never change records; edits inside a view are workspace
writes (or staged, for governed collections) and show the staged/saving state in the cell.

| View | Anatomy | States | Narrow (<600px of view) |
|---|---|---|---|
| **Table** | 36px sticky header (12/500 faint; sorted column ink with chevron), 40px rows, checkbox column on hover/selection, Mono end-aligned numbers and dates, group rows (`--sunken`, name + count), inline edit (input fills the cell) | hover, selected (soft + moss bar), staged cell (2px moss underline + "Saving"/"Staged"), overdue date clay, empty, filtered-empty, loading, error | **cards**: data rows with title + "project · owner · due" + status |
| **Board** | columns 240–280 on `--sunken` radius 10: head (mark, name, count, + New in column); cards (`--raised`, radius 8): title, two facts, presence | lifted card (pop shadow, −1° rotate), ghost in origin (dashed, dim), drop target (moss dashed on `--accent-soft`), staged move (moss bar + "Staged move"), refused drop (announced with its reason) | **grouped list** with a "Move to…" menu per card |
| **Calendar** | month grid, weeks start Monday, 7 columns separated by 1px `--rule`; day cell min 96; date 22px circle; events 20px pills (glyph + truncated title) | today (ink disc), outside month (`--sunken`, faint date), overdue task (clay pill), staged (moss bar), "+N more" (opens the day) | **agenda**: day headings ("Today · Thu 29 Oct" in ink) and data rows |
| **List** | data rows (§9.2) | as rows | same |
| **Map** | §8 | §8 | §8 three-column |

Keyboard: table cells are a grid (arrows, Enter edits, Esc cancels); board cards: Space lifts, arrows
move between columns/positions, Space drops, Esc cancels, each step announced; calendar: arrows by day,
Page Up/Down by month, Enter opens the day.

### 10.3 Comment thread

Beside a page or record (a panel at ≥1200, a sheet below). Head: "Comments · 2 open" + the thing's
visibility marker (comments follow it). A comment: 28px monogram, handle (13/500), time (12 faint), body
14/1.5, actions (Reply · Resolve · Turn into a task — a workspace write). Replies indent 54px. States:
**sending** (body mute, "Sending…"), **not sent** (clay "Not sent", **Retry** / Discard), **resolved**
(collapsed line "Resolved by Ops lead · 3 replies · Show"), anchored (the commented text is marked in
the page; selecting the comment scrolls to it). Composer: monogram + a box with `--edge`, focus ring,
hint "Only people who can see this page are offered.", primary **Comment** (⌘↵).

### 10.4 Mention picker

A listbox popover under the caret after `@`: people (monogram, name, their hat) and roles (hat glyph,
"8 people"). **Only people who may see the thing are mentionable**; members who may not see it but
whom the author may otherwise address appear `aria-disabled` with "can’t see this page" (call C-21);
records and pages the author may not see are absent.

### 10.5 Presence and visibility in the workspace

Presence per §7.12 in the editor bar and on rows of pages others have open (a 20px stack at the row's
end). Visibility per §7.10 in the editor bar, record header, and as a column in collection views when a
collection holds mixed levels.

### 10.6 The three kinds of write, made visible

| Kind | What the person sees |
|---|---|
| Governed record | edits stage → the tray (§5.6) → Propose/Apply |
| Workspace write, direct | "Saved · direct" in the save state; no tray |
| Workspace write, needs approval | "Staged · needs approval"; the tray gains the op |
| Conversation | no save state; "Sending…/Not sent" on the comment itself |

## 11. Library, wizards, sign-in

### 11.1 Library entry card

`--raised` card radius 10, min 172px: eyebrow (kind: DAO template, System kind, Rule set, Board, Wizard),
title (Sans 600 15), summary (13 mute, 2 lines clamped, full text in the preview), foot: shelf · version
(Mono) · state mark (**Not added** open · **Added** done · **Needs a Garden** needs · **Built in**
closed). Hover outline `--rule-strong`; selected (the one in preview): moss outline + ring. Grid
`auto-fill minmax(260px, 1fr)`, gap 12. The card is a link to `/library/:id`.

### 11.2 Library preview

Two columns (one under 680px): main — eyebrow "<kind> · preview" + id@version (Mono), title, the
promise line ("Adding stages one change. The org’s rules decide it. Nothing is written by this
preview."), **It would create N records** (a bordered list: glyph, name, `registry:id` Mono, change class
and who decides, faint; an id clash row in `--attn-soft` "id taken · would be treasury-2"; for remove,
records edited since the add in the same clay row with "edited since added — asks before taking it"),
actions (**Add — stage a change** primary; Close). Side (`--sunken`): **Needs** (check list, missing in
clay), **Would reach, read only** (hosts in Mono), **Who decides** (the rule in words). Receipt (after
add, L1): "Added by DR-… on <date> · created 6 records · Remove".

### 11.3 Wizard steps

0.6's wizard machine, redrawn: a step rail (220px, `--sunken`, numbered 20px circles: done = ink disc
with check, current = ink ring + 500 ink label, ahead = `--rule-strong` ring), the body (eyebrow "Compose
a DAO · 3 of 5", question as H (Sans 600 20), one sentence of why, choice cards or fields, **This screen
writes** well in Mono, foot: Save and leave (ghost) · Back · Continue (primary)). One decision per
screen. Review screen: answers as field rows + every file it writes. **Running**: lines of progress with
spinner/check. **Done**: moss tile, "Staged as one change", what decides it, next actions. **Failed**:
clay tile, "Nothing was written", why, Try again / Back to review. Under 560px the rail becomes a top
line "Signers · step 3 of 5" and the foot buttons go full width.

### 11.4 Sign-in

A card (max 420): eyebrow "<DAO> · members", title in Fraunces 24 "Sign in with your wallet", the
sentence "You’ll sign a message to prove you hold an address. Nothing is sent on chain and nothing is
spent. Your role is the hat you wear in tree #13.", a full-width 40px primary **Sign in with Ethereum**,
hint "EIP-4361 · read-only for anyone without a hat". States: **waiting** (spinner, "Waiting for your
wallet to sign…", Cancel) · **signed in** (hat disc, hats worn, short address · N hats) · **not a member**
("This address wears no hat in Example DAO’s tree. You can still read the public door.", Read the public
door) · **refused / failed** (clay note, Try again). The words "connect wallet" and "login" never appear.

## 12. The public door

Built from *public* records only (rule 6). Container `--w-door` 1120, gutter 32 (16 under 900).

1. **Top** (76px): wordmark — the org's mark (from its records) on a 26px `--solid` rounded square +
   the name in Fraunces 500 19; nav in Sans 13 mute (*Who holds what · What we fund · Treasury ·
   Decisions*), then **Members** (secondary button → sign-in). Under 900: nav folds into a Menu
   icon button opening a sheet; Members stays.
2. **Hero** (72px top, 40 bottom; two columns 1.25 : 1, bottom-aligned): eyebrow (Mono, "A network
   society · since 2022"), H1 in `--fs-d-hero` with **one italic moss phrase** (from the org's own
   tagline; `<em>`), then the description (17/1.6 mute, 42ch) and **facts** (Fraunces 26 figure over a
   12 mute label: "4 of 8 — signers move funds", "7 — chains, one treasury", "2 — grant pools"), each
   computed from records.
3. **The map plate**: `--raised`, radius 22, `--shadow-raise`, head "How the DAO is arranged" (Fraunces
   24) and "Read from its own records · 4 min ago" (eyebrow), the DAO map (§8; nodes are links to the
   door's record pages; no attention dots — attention is members' business; staged and draft states
   never appear on the door).
4. **Numbered sections**: a 240px label column (number in Mono 12 faint, the section name in
   `--fs-d-sec`, sticky at 24px) and the content column: a **lead** in Fraunces (`--fs-d-lead`, 34em),
   then the section's elements. Sections, in order, each present only if it has public content:
   - **01 Who holds what** — a flat tree of hats (Fraunces 18 names, indented by level, "8 wear it ·
     elected by vote", "open" for an empty hat); never wearers' names unless public.
   - **02 What we fund** — grant pool cards (radius 18): eyebrow "Grant pool · Celo", Fraunces 24 name,
     the balance in `--fs-d-fig` with the unit in Mono, purpose + address chip; under the grid a note
     about open decisions touching the pools ("Open" pill + one sentence + the decision id).
   - **03 Treasury** — two panels: signers (20px moss dots, filled for the threshold: "Any 4 of 8",
     "Signers are whoever wears the Treasury signer hat.") and the address in full Mono + chain chips
     + "balances read 4 min ago".
   - **04 Decisions** — a ledger: id (Mono faint, 120px) · title (Fraunces 19) over route and date ·
     state pill (Open; Executed in moss soft). 
   - **05 Writing** — published pages as a ledger of titles and dates.
   - A non-public embed anywhere renders the "Members only" slot (§6.3).
5. **Foot**: "Also on Snapshot · Karma GAP · Gitcoin" (link Systems), the daoURI in Mono with
   "EIP-4824", "A DAO-OS house".

Door copy is the org's: section names may be renamed per org; the defaults above are DAO-OS's. The door
has light and dark, following the reader's system setting, with no toggle in the bar (call C-29).

## 13. Responsive and accessibility rules (whole house)

**Responsive**
- No horizontal page scroll at 390px (or 320px, 1.4.10) on any route; tabs and the palette's scope
  chips may scroll inside their own bar. Wide tables never scroll sideways: they become cards.
- Every text container sizes by `min-height`/`max-width`, never fixed height; grid tracks are
  `minmax(0, 1fr)`; flex children holding text have `min-width: 0`.
- Logical properties throughout (`inset-inline-start`, `padding-inline`, `text-align: start`); the house
  mirrors under `dir="rtl"`.
- `100dvh` for full-height panes; safe-area insets on the bottom bar and sheets.
- Hover styling only under `@media (hover: hover)`; targets 44px on coarse pointers, 24px minimum
  everywhere (2.5.8).

**Accessibility (WCAG 2.2 AA)**
- Native elements first (`<button>`, `<a href>`, `<dialog>`, `<details>`, `<table>`, `<dl>`, `<ol>`).
- One `<main>`, a skip link, landmarks: sidebar `nav`, top bar `header`, tray `region`, inspector
  `complementary`.
- Focus is always visible (2px `--focus`, never removed); focus never hides under the top bar, tray or
  bottom bar (`scroll-padding`); overlays trap and restore focus; route changes move focus to `<h1>`.
- Meaning is never colour alone (§6.1); every icon-only button has a name; the meter, shapes and
  decorative glyphs are `aria-hidden` with the words beside them.
- One polite live region (0.6's `LiveRegion`) for: staged count, copied, read results, value moved,
  board moves; `role="alert"` only for the compose canvas's invalid connection and a failed apply.
- Every drag has a keyboard and single-pointer path (board, compose canvas, block arrange).
- Text resizes to 200% without loss; nothing the person needs runs on a timer; motion per §3.7.
- Forced colours: borders under shadows (§3.2), focus uses `Highlight`, marks keep their shapes.

## 14. Mapping: every existing page and part → the new element(s)

Source: `packages/admin/app/src` at `36e1923`.

### 14.1 Pages and routes

| 0.6 page / route | Becomes | Elements |
|---|---|---|
| `/` → board `home` (`boards/home.yaml`) | **Home** | page frame; Home line (Fraunces); **Needs you** list (attention items + meters) replacing the `needs` list block; **Systems** (data rows, List · Map); **Recently** (data rows from decisions and executed reads). The `projects`, `crew`, `operations` blocks move to Workspace (projects) and the Instance group (crew, operations) |
| `Shell` + `Nav` + `NavGroup/NavItem` | **the frame** | sidebar (§5.2), rail (§5.3), phone bar + bottom bar + More sheet (§5.4), top bar (§5.5) |
| `/b/:id` `BoardPage` (sections and boards) | a **section page** or a **collection** with views | page frame + record header for the board; each block → its element (§14.3); Arrange mode keeps 0.6's machine, redrawn with grips and the inspector for settings |
| `/b/treasury` | **Treasury** section | System record header for the main Safe; balances table by chain; pending prepared-transaction cards; fund flow; decisions that moved money (data rows) |
| `/b/outside-systems`, `/b/sources` | **Systems** section | data rows (Systems row), List · Map (DAO map) |
| `/b/organization`, `/b/systems`, `/maps/:map` (map boards) | **Map view** of Workspace / of Systems | map (§8) |
| `/b/projects`, `/b/people`, `/b/funding`, `/b/partners`, `/b/ideas`, `/b/meetings` | **Workspace collections** | collection view header + table/board/calendar/list/map (§10.2); People's private fields per rule 3 |
| `/b/crew`, `/b/modules`, `/b/fleet`, `/activity`, `/all`, `/all/:registry`, `/boards` | **Instance** group pages | data rows / table view; `Activity` → list view of events; `AllRecords` → list of collections; `RegistryList` → table view; `Boards` → list of boards (library-card style for built-ins) |
| `/governance/proposals` (+ `/governance` redirect) | **Proposals** section, tab *Open* / *Decided* / *Rules* | tabs; proposal rows (data row + compact timeline + meter); Rules tab: rule sentences as field rows + the source YAML in a well |
| `/governance/decisions` | Proposals → *Decided* | ledger-style data rows (id Mono, title, route, outcome mark) |
| `/governance/rules` | Proposals → *Rules* | field rows (rule → sentence), well with `governance.yaml` |
| `/governance/proposals/:id` `ProposalPage` | **Proposal page** | record header; body (prose); calls (the prepared-tx card's calls); approvals meter; **proposal timeline** aside; route/touches/record field rows aside; small map; **prepared-transaction card** (System section, prepare/attach/check); Changes section → field change rows (struck old → new; stale rows in clay with Keep mine / Take theirs); diff in a well; events → comment-thread-styled event list (approvals, objections, votes, system readings); Actions → primary per viewer + vote radio group |
| `/r/:kind/:id` `RecordPage` | **Record page** | record header (System or record variant); field rows (read/edit/staged/stale/restricted); small map ("Touches"); links (data rows); history (list view of events); Source (YAML well); Operations (buttons + confirm dialog + job log well) |
| `/new/:registry` `NewRecord` | **New record** | record header ("New <kind>"); field rows in edit; stages into the tray |
| `/library`, `/library/:id` `Library` | **Library** | shelf segmented control + search field; library entry cards; preview (§11.2) |
| `/wizards/:id` `WizardPage` (claim-handle, open-instance) | **Wizard** | wizard steps (§11.3) |
| `/parts` `PartsPage` | **/parts — the element gallery in the app** | every element in every state from fixtures (this gallery is its blueprint); the machine diagrams kept below |
| `NotFound` | not-found page | note-block ("No page at /x.") + ⌘K hint |
| `ReadOnly` notice (actor unknown) | the **band** (§5.9 style, `--solid`), "Read only: your git address is not a member’s. Claim your handle →" | band |
| `SkinPicker` | Appearance menu (System / Light / Dark) in the org switcher; skins only in ⌘K for builders | menu |
| `syncShare.tsx` (Sync and Share) | tray foot line + confirm dialog | note, confirm, tray |
| `jobs.tsx` | Running status + job log | status mark (running), well |

### 14.2 Parts and primitives

| 0.6 part / primitive | New element |
|---|---|
| `design/Button`, `ButtonLink` | button (§7.1) |
| `design/inputs/*` (Text, Number, Date, Select, Yaml), `record/FieldInput`, `YamlField`, `SchemaFields` | inputs (§7.2) inside field rows (§9.3) |
| `design/Seg` | segmented control |
| `design/Tabs` | tabs |
| `design/Menu` | menu |
| `design/Note`, `Empty`, `Absent`, `EmptyWhen` | note / note-block (§7.4, §6.2) |
| `design/Mark`, `StatusMark`, `parts/marks.ts` | marks and status (§6.1, §7.8) — `marksOf` unchanged, shapes redrawn, `draft`, `open`, `ok`, `closed` added |
| `design/KindLabel` | kind tile + eyebrow |
| `design/NavIcon` | icon set (§3.9) |
| `design/PageHead` | record header (§9.1) |
| `design/Section` | section head ("Needs you 3 · end link") |
| `design/FieldRow`, `FieldTable` | field rows |
| `design/Rows`, `design/Scroll` | data rows (§9.2) and table view (§10.2); `Scroll`'s sideways region is replaced by the narrow card form |
| `design/MapNode`, `PortalNode` | map node (§8.3); portal node → linked node variant with "↗ on <board>" |
| `design/Shell` | frame |
| `parts/Card` densities `row` / `tile` / `node` / `chip` / `full` | data row / board card / map node / mention (record) / field rows in a record body |
| `parts/EventLog` | list view of events (history, proposal events) |
| `parts/RuleStatus` | rule sentence + meter |
| `parts/MachineDiagram` | stays on /parts, drawn with map nodes and edges |
| `parts/panels` (`PanelProvider`, slots right/bottom/overlay) | inspector, tray, palette/confirm/sheets — same machine |
| `parts/live` `LiveRegion` | the one polite region |
| `parts/SyncParts` | tray foot line |
| `blocks/BlockFrame` | section head + body + foot inside a surface |
| `blocks/list` (+ `RecordsMap`) | list / table view with List · Map |
| `blocks/kanban` | board view |
| `blocks/map` | map view |
| `blocks/record` | field rows (full card) |
| `blocks/metric` | amount (large) + label + read age |
| `blocks/system`, `systems/DriverView` | System record header + driver sections as field rows/tables with read ages |
| `blocks/note`, `blocks/markdown` | page prose / callout |
| `blocks/proposals` | proposal rows (attention-item style for open ones) |
| `boards/Board`, `Arrange`, `ArrangeCell`, `BlockSettings` | section page; arrange mode (grips, drop targets in moss, settings in the inspector) |
| `changes/Tray`, `ProposePanel`, `rows` | Changes tray (§5.6); Propose sheet = the tray's foot step with title + rationale fields |
| `inspector/Inspector` | inspector (§5.10) |
| `library/EntryCard`, `EntryPreview` | library entry card, preview |
| `map/MapCanvas`, `flow`, `layout` | map view (layout rule §8.2 replaces the current layout for Systems; Organization keeps its graph layout redrawn) |
| `palette/Palette`, `Escape` | command palette (§5.7); Escape stack unchanged |
| `record/ConfirmBox` | confirm dialog |
| `record/JobLog` | Mono well with status mark |
| `record/Links` | data rows |
| `record/MiniMap` | small map (§8.6) |
| `record/OpButtons`, `Operations` | buttons + confirm + plan well |
| `record/SourceEdit` | YAML well, edit in place |
| `wizards/WizardFrame`, `ClaimHandle`, `OpenInstance`, `Fields` | wizard steps (§11.3) |

### 14.3 New elements with no 0.6 ancestor

address chip, chain chip, amount, read age (a component, not just text), visibility marker,
"members only" slot, mention, presence, meter, attention item, proposal timeline, prepared-transaction
card (0.6 has its data, not the element), role tree, fund flow, compose canvas, collection view header
with filter chips, calendar view, page editor chrome, comment thread, mention picker, sign-in card,
view-as control and band, bottom bar, More sheet, rail, key map dialog, the public door's elements
(top, hero, facts, map plate, numbered section, pool card, signer dots, ledger, door foot).

### 14.4 0.6 tests L4 deliberately replaces (to say in its report)

- `css.test.ts` "collapses the nav to a top menu below 760px" → a bottom bar under 760px.
- `css.test.ts` "gives every mark a shape" → extended to the new marks.
- `e2e:parts` stored images → regenerated from the new /parts.
- `skins.test.ts`/`contrast.test.ts` for `sleek` and `sample` → removed with those skins; `house` added
  with the measured pairs of §3.2.

## 15. How L4 is accepted

1. `/parts` renders every element in every state of this document from fixtures, light and dark.
2. Screenshot tests (0.6 `e2e:parts` and `e2e:reflow` habits) of `/parts` and of every route in §14.1
   at 1440 and 390, light and dark; a reflow test asserts `scrollWidth <= innerWidth` at 390 and 320 on
   every route.
3. The raw-value guard and the contrast test pass with `house` as default.
4. An axe run on every route: no violations at AA.
5. A keyboard walk of the golden paths (Home → Needs you → proposal → approve → tray → propose;
   Systems → Map → node → inspector; ⌘K to a record; view as Public) with no mouse.
6. The operator compares the routes with the gallery and the prototypes and approves.

## 16. Calls made (taste choices the approved spec and prototypes left open)

| # | Call |
|---|---|
| C-1 | **Palette**: Living structure's warm paper neutrals (not Quiet's cool greys), retuned so every text pair passes AA on every surface it sits on (§3.2). |
| C-2 | **Primary buttons are ink**, not moss. Moss never fills a button; it fills only the staged-count square and node tags. |
| C-3 | **Destructive actions are ink with a confirmation**, never red/clay — clay means "needs you", not "danger". |
| C-4 | **Fraunces on the members' side only** for Home's line, a page title, a large amount, the map's central Safe and the sign-in title. Record and section titles are Geist 600 24. |
| C-5 | **Amounts are Geist Mono** wherever copyable; the door's big figures are Fraunces (rounded), with the exact Mono value on the record page. |
| C-6 | **The tray docks** under the page (not a floating pill that covers rows); on phone it floats above the bottom bar as a card. |
| C-7 | **Bottom bar**: Home, Needs you, Proposals, Workspace, More. |
| C-8 | **Sidebar**: Workspace expands into its collections; 0.6's org-os boards (Crew, Fleet, Modules, Sources, Activity, All records, Boards) live in a collapsed **Instance** group, shown only when non-empty. |
| C-9 | **Address chip copies the plain 0x address**; CAIP-10 is in the tooltip and the chip's context menu. Shortened as `0x` + 4 … 4. Never linked to a block explorer. |
| C-10 | **Chain chips** are neutral with a hollow-dot glyph; several chains = stacked glyph + count; test networks dashed; disagreement in clay. Names from a fixed CAIP-2 table. |
| C-11 | **Mark shapes** as §6.1 (circle, square, hollow square, dashed square, hollow/filled circle, check, bar, dashed circle, ring). |
| C-12 | **Your contribution is moss** in meters and timelines ("you approved"). |
| C-13 | **Aged** = 0.6's reader `aged` (past the TTL); no new threshold. |
| C-14 | **Attention ring runs twice, then still**; value flow runs three times, then the path stays moss (WCAG 2.2.2). |
| C-15 | **Map edges in `--edge`** (3:1), 1.25px, with plain-word Mono labels dropped when they do not fit. |
| C-16 | **Map layout**: four authority layers + a Linked group, computed in code (ELK layered suggested); the main Safe drawn big at the centre. |
| C-17 | **The map stays a map at 390** (three columns), with List one key/tap away. |
| C-18 | **Calendar weeks start Monday**; under 600px every view has a narrow form (cards, grouped list, agenda) — no sideways scrolling anywhere. |
| C-19 | **Kinds are told by glyph, never hue** (Living structure's per-kind colours dropped, per Q12). |
| C-20 | **A non-visible embed inside a page** shows a titleless "Not visible to you" slot on the members' side, mirroring rule 6's "members only" on the door (see §18-2). |
| C-21 | **Mention picker** lists members who cannot see the page as disabled ("can’t see this page") rather than hiding them. |
| C-22 | **Presence is monograms** from handles — no pictures, no identicons. |
| C-23 | **View as** is a solid ink band across the main column; write controls are hidden (not disabled) while previewing; Esc does not exit it. |
| C-24 | **Skins**: `house` is the default and fallback; `bare` stays as a test skin; `sleek` and `sample` are retired. |
| C-25 | **Fonts are self-hosted** (OFL WOFF2) — no request to Google from a DAO's house. The gallery uses Google Fonts only because it is a single file. |
| C-26 | **Phone inputs are 16px**; touch targets 44px. |
| C-27 | **Icons: Lucide** at 1.5px stroke, plus house-drawn hat, Safe and grant-pool glyphs. |
| C-28 | **Dates**: "29 Oct", 24-hour times, relative ages under 24h, ISO in `title`. |
| C-29 | **The door follows the reader's light/dark setting**, with no toggle in its bar. |
| C-30 | **Dark mode**: no pure black; surfaces lighten with height (`--raised` → `--pop`); moss and clay lifted to pastel so they keep AA. |
| C-31 | **Fund flow** widths are relative within one unit; a mixed-unit window draws equal widths and labels each amount. |
| C-32 | **The door shows no attention, staged or draft states** on its map — those are members' business. |

## 17. Fixtures

All fixtures use roles and invented placeholders ("Council steward", "Steward A/B", "Ops lead",
"Treasury steward"; monograms SA, SB, OL, TS, CS), invented addresses for wearers and signers
(`0x9C1f…a04E` style, generated, not real), and Example DAO's public Systems as listed in house spec §7
(Safe `0x6AFF…343a` on 7 chains, `exampledao.eth`, Hats tree #13 on Celo, the Garden and its two pools).
Balances and dates are fixture values and say so on `/parts`. No fixture added by L4 holds a real
person's name (house spec §14).

## 18. Only the operator can decide

1. **The look itself**: approve the gallery (or name what is wrong) before L4's plan is written.
2. **Rule 7 inside pages (C-20)**: on the members' side, should an embed the reader may not see leave a
   titleless "Not visible to you" slot (reveals that *something* is there, as rule 6 does on the door),
   or vanish entirely (strict absence; surrounding prose may then read oddly)?
3. **Mention picker (C-21)**: show members who cannot see the page as disabled (tells the author who
   cannot see it), or hide them?
4. **The org's mark on the door and in the sidebar**: use the DAO's own logo from its records (Example DAO's
   mark, locally, during the pilot), or a neutral seal until the Council has seen the door?
5. **Instance group (C-8)**: keep org-os's operational boards (Crew, Fleet, Modules…) in a DAO house at
   all, or hide them in the DAO-OS distribution?

**Answered by the operator, 2026-10-29 (Q32–Q36):**
1. **The look is approved** ("this is beautiful! finally").
2. **Members' side: content the reader may not see vanishes entirely** (strict rule 7). The public
   door keeps its "Members only" slot (spec §11 rule 6).
3. **Mention picker:** members who cannot see the page are shown **disabled, with "can't see this
   page"**.
4. **A neutral seal** in the framework, the distribution, fixtures and screenshots. A DAO's own mark
   comes only from that instance's configuration; Example DAO's mark lives only in its local pilot
   instance.
5. **Instance group:** org-os's operational boards stay in a **collapsed "Instance" group** at the
   bottom of the sidebar.
