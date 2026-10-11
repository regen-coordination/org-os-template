---
id: site-tight
title: "The org-os site, tightened (Design)"
status: design written 2026-10-11; build in progress on the steward's branch; awaiting the operator's look
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
most, each with what it does in the words of `docs/COMMANDS.md` and a link to its page. A test
holds every command on the panel to the repository: an `npm run` name must be a script in the
root `package.json`, a `/command` must have a file in `.claude/commands/`. Below: the six
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
sentence at most forty, its links at most two; each command on the home panel exists in the
repository. `npm run build`, `npm test` and `npm run drift` run at each commit.

No dependency is added or upgraded. The Inter font package, installed and never imported, is
left in `package.json`: removing it is a dependency change and the operator's to approve.

## 7. What nobody has seen

All of it. The steward cannot open a browser. The checks prove the pages build, the links
resolve, the tokens contrast and the rules above hold; they do not prove the pages look right.
Layout at phone width, the wrap of the home panel, the density of the modules list, the map on
the plain background and both themes all wait for the operator's eye (plan 3, task 2).
