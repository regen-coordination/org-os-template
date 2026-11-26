---
id: site-tight
title: "The org-os site, tightened (Design)"
status: built 2026-10-11 on the steward's branch; reviewed (PASS with findings, fixed the same day); seen only in headless pictures; awaiting the operator's look
type: feature-spec
created: 2026-10-11
author: website steward (crew seat `website`)
builds_on: 2026-10-10-site-docs-v2-design.md
---

# The org-os site, tightened

> The operator asked for "a new polished/tight version of website, taking inspiration from
> https://herdr.dev/". This is what changes, what is cut, and the scale everything is held to.
> Nothing about what the site publishes changes: 46 pages, the manifest, search, the redirects,
> two themes and every check stay.

## 1. What makes herdr.dev feel tight

Read on 2026-10-11 from its page and its two stylesheets, as text; not seen in a browser.
Inspiration means its discipline. No text, image, font or code of it is used.

| What | On herdr.dev | On our site before this |
|---|---|---|
| The first screen | A three-word label, a six-word headline, about 37 words under it, and **one action: a command to copy**. Then the product itself, shown. | A headline up to 104px, 26 words, three buttons of equal weight, a status line. No command. |
| How much a page says | About 650 words in all. Five numbered cards of 30 to 45 words, each with a snippet of real output. | Six cards, a section holding one sentence, a section holding a map, a closing paragraph, each 96px apart. |
| Type | Small and few: labels of 10 to 12px in monospace, body near 15px at a line height of 1.6 to 1.7, a headline with tight tracking. | Eleven sizes, the largest fluid up to 104px. |
| Measure | Text blocks are capped in characters (56 to 74ch). | 68ch for prose; cards uncapped. |
| Surface | Flat. Five shadows in 124 KB of CSS, three radii, hairlines. | Four layers behind and over the page (grid, aura, grain, drifting motes), a light that follows the pointer on every card, iridescent edges, a sheen on buttons, a glow on the headline. |
| Navigation | Four words. The footer repeats them. | Three words, search, theme. Already tight. |

The principle taken: **every element on a screen either says something or is a way to act**.
Decoration that does neither is cut, and the space it held is given back.

## 2. What changes

**Home.** The first screen says what org-os is, who the page is for, and what to do next:
a label (`org-os · v<version> · docs for operators`), the headline, one sentence, two links
(Operator guide, All docs) and, beside them, a panel of the three commands an operator runs
most, each with what it does in the words of `docs/COMMANDS.md` and a link to its page. Each
command is printed under the place it is run. A test (`site/test/command-where.test.mjs`) holds
every command to that place: one shown for an instance must be in what an instance receives
(`tests/clone-manifest.txt`), with the file it runs and everything that file loads. The first
version of this test read only the framework's root `package.json` and passed `npm run doctor`
for an instance, where it exits 2. Below: the six
sections as one ruled grid (title, one line, four links, "+ n more"); then one strip with the
release on the left and the federation on the right (the operational count with its definition,
the small map); then the newcomer paragraph. Four blocks, 64px apart.

**The docs frame.** Sidebar 14rem, article capped at 72ch, contents 12rem, 32px between them.
The page title drops from 48px to 32px; `h2` is 24px with a hairline above it, so a long page
shows its structure when scrolled fast; `h3` 20px. Sidebar links are 13px on a 4px rhythm; the
current page is marked by colour and a 2px rule, without a wash. The sidebar's section names
stop being headings that come before the page's `h1` (an open item of plan 1): they become
labelled lists. Code blocks and tables are 13px. The pager is two flat ruled boxes. The stamp,
the edit link and the feedback links share one line where there is room.

**Modules.** Twenty cards become one table-like list: id, name, what it is, status, link. One
row per module, grouped under no headings, with the count of each status above it. A reader
compares twenty statuses in one screen and a half, where the cards took four.

**Federation.** A plain title ("Federation") and one sentence, the map, then the registered
instances as the ruled list Part A introduced. No slogan.

**Docs index.** Unchanged in structure (it was already a ruled list); it takes the new scale.

**Nav and footer.** The nav is 48px high with a plain hairline. The footer is one block: the
name and one line, the links in two short columns, the licence and version. 64px above it,
where there were 128.

## 3. What is cut

- The four atmospheric layers: the blueprint grid, the aura, the film grain, and `Drift.astro`
  (the canvas of motes) with its script.
- The pointer-following light (`.lit`) and its script in `Layout.astro`; the lift and glow of
  cards on hover; the corner ticks (`.ticked`); the veiled card surface.
- The iridescent gradient everywhere it appeared: under the nav, under links, around pills,
  the search field and the theme switch. Hover is a change of colour or of rule.
- The button's sheen and lift; the headline's glow; the staggered rise of the hero on load;
  the pulsing dot of the status line, and the status line.
- Every shadow but one: the search dialog keeps one, because it sits over the page.
- From the themes: the tokens that fed the above (`--aura-*`, `--grain-*`, `--color-glow`,
  `--gradient-iris`, `--surface-veil`, `--color-grid`, `--shadow-1`).

Kept on purpose: the `~/org-os` mark and its cursor, the warm paper and the regen green, the
monospace voice for labels and headings, the prompt bar of key hints (restyled flat), the copy
button, the heading anchors, the scroll-spy. The identity is the palette and the type, and both
stay.

## 4. The scale

**Type.** Eight fixed steps and one fluid one. Every `font-size` in `site/src` is one of these
tokens, or an `em` value relative to its parent; a test fails on a raw size.

| Token | Size | Used for |
|---|---|---|
| `--text-2xs` | 11px | labels, badges |
| `--text-xs` | 12px | metadata, the stamp |
| `--text-sm` | 13px | sidebar, tables, code, UI |
| `--text-base` | 15px | body, line height 1.65 |
| `--text-md` | 17px | the lead sentence |
| `--text-lg` | 20px | `h3` |
| `--text-xl` | 24px | `h2` |
| `--text-2xl` | 32px | `h1` of a page |
| `--text-display` | 36 to 56px, fluid | the home headline only |

**Space.** A 4px base, eleven steps: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, and nothing larger.
`--space-20`, `--space-24` and `--space-32` are removed; a test fails if one returns. Blocks of
a page are 64px apart, parts of a block 24 or 32, lines of a list 8 or 12.

**Measure and width.** Prose 72ch. The page container 1080px (was 1180); the docs container
1280px (was 1380).

**Shape.** Two radii (4px, 2px) and the pill. Hairlines of 1px in two strengths. One shadow.

**Motion.** Colour and rule changes at 140ms. Nothing moves on load. `prefers-reduced-motion`
still zeroes the durations.

Both are read by `site/test/design-tight.test.mjs` since the closing review (2026-10-11): a radius
is one of the three tokens or 50%, and the one animation is the cursor of the `~/org-os` mark,
kept on purpose (§3) and stopped by `prefers-reduced-motion`.

## 5. Both themes

The palettes are unchanged, so `theme-contrast.test.mjs` holds exactly what it held: every text
colour at 4.5:1 on every surface, the faint colour at 3:1, the theme switch's knob at 3:1 on its
track, and the two themes defining the same variables. Removing the decorative tokens removes
them from both files at once, or that last test fails. The theme switch's hover no longer
replaces its edge with a gradient, which closes the open note in plan 3 that the edge lost its
guaranteed contrast while hovered: the edge now only darkens to `--color-ink`.

One honest limit: the contrast test reads token pairs, not rendered pages. With the aura and
the veiled surfaces gone, text now sits on the plain surface tokens the test measures, which
makes the test a closer description of the page than it was. It is still not a look.

## 6. How it is held

A new test file, `site/test/design-tight.test.mjs`, written before the styles: the cut tokens
and classes appear nowhere under `site/src`; `Drift.astro` is gone; every `font-size` is a token
or an `em`; no spacing token above `--space-16` exists or is used; `box-shadow` appears only for
the focus ring and the search dialog; the home page's headline is at most eight words, its
sentence at most forty, its links at most two. The same file reads the rules in their other spellings: no inline
`style` attribute, no `font` shorthand but `inherit`, no gradient but one, no `drop-shadow`, no
`translate(x, -n)`, and nothing moved by a `:hover` rule. The one gradient is the theme switch's
knob in dark, a crescent drawn by a hard-edged `radial-gradient` of two palette colours: a shape,
not a wash. `site/test/command-where.test.mjs` holds each command on the home panel to the place
it is run. `npm run build`, `npm test` and `npm run drift` run at each commit.

No dependency is added or upgraded. The Inter font package, installed and never imported, is
left in `package.json`: removing it is a dependency change and the operator's to approve.

## 7. What has been seen, and what has not

Three kinds of evidence, kept apart: **seen** is a still picture someone read; **measured** is a
number read from a running page through Chrome's DevTools protocol; **not seen** is neither.
Every picture came from a headless Chrome on a throwaway profile (no window, no tab in anyone's
browser).

**Seen by the steward (build, 2026-10-11).** The home page in both themes at 1280px and 500px; a
docs page in both themes at 1360px and 500px; the modules page at 1280px and 500px; the
federation page at 1280px. One thing was changed on that evidence: the newcomer paragraph moved
under the release note, where the first layout left a column empty.

**Seen and measured by the reviewer (review of `461cbe2`, 2026-10-11).** Twenty captures: home,
`/docs/commands`, `/docs`, modules and federation, at 1280px and at 375px, light and dark.

- No page scrolls sideways at either width (`documentElement.scrollWidth == innerWidth` on all
  twenty). At 375px the nav wraps to two rows and works; the docs show a "Documentation menu" and
  an "On this page" disclosure; the modules list becomes stacked rows.
- Focus: 30 Tab stops on the home page (light) and 30 on `/docs/commands` (dark), each with a
  2px outline in the accent colour. Nothing sets `outline: none`.
- Landmarks and headings in document order on home, a docs page, modules and federation: no
  level skipped. The sidebar's six lists each point at a label that exists.
- `prefers-reduced-motion: reduce` stops the cursor's animation and sets `--t-fast` to 0ms.
- The search dialog opens on the home page.
- Two things were wrong at 375px. A wide docs table was cut with nothing to say so and could not
  be scrolled by keyboard: fixed, see below. The federation map's labels are printed over each
  other at 1280px ("organizational-os-framework" over "Regen Coordination", "DAO-OS" over "ReFi
  Barcelona") and cannot be read at 375px: open, and it is the map package's
  (`packages/org-os-federation-map`), handed to `engineer`.

**Seen and measured by the steward after the review (2026-10-11).**

- The home panel as it now reads, at 1280px in both themes and at 375px: each command under the
  place it is run. The longest, `npm run doctor -- --dir ../my-instance`, fits on one line at 375px.
- `/docs/commands` at 375px in both themes. Of its eight tables one is wider than the column
  (396px in 339px). It carries `role="region"`, the name "Table: Command, What it does" and
  `tabindex="0"`; the line "more columns: scroll sideways →" is printed above it and its right
  edge is ruled. Focused, twelve presses of the right arrow moved it 57px, to its end, and the
  line changed to "← more columns: scroll sideways". The seven tables that fit are not Tab stops.
  At 1280px none of the eight is a Tab stop and no line is printed.

**Not seen by anyone.** Hover states; the theme switch being pressed; the keyboard path through
search results; the federation map being used; a page with script off (the table regions are in
the built HTML, which the verifier checks, but no picture was taken); Safari and Firefox; a real
phone; greyscale. A still picture is not the operator's look (plan 3, task 2), which stands.

**As built, where it differs from §2.** The home page has three blocks under the first screen,
not four: the newcomer paragraph sits inside the release block. The home headline wraps to three
lines at 1280px and at 375px. The command panel's title is "Three commands, and where to run
each", and each command is printed under its place ("to your agent", "in your instance", "in the
framework checkout"), because one of the three, the doctor, is not run in an instance.
