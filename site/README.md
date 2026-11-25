# org-os site

The org-os framework website + docs + live federation — one static Astro site.

## Run

The site needs two installs, in this order (the order CI runs them). Each
installs from its lockfile; `--ignore-scripts` may be added to any of them.

```bash
(cd .. && npm ci)                                   # the repository root: packages/org-os-kms loads js-yaml from here
npm ci                                              # the site itself
```

With one missing, `npm run build` and `npm run dev` stop with a sentence naming
it and the command that fixes it (`scripts/installs.mjs`).

```bash
npm run dev        # aggregates federation.json, then http://localhost:4321/org-os-template/
npm run build      # aggregate → astro build → pagefind → verify  (static site → dist/)
npm test           # unit tests (manifest, links, themes, search, feedback, federation, modules)
npm run drift      # which pages cover a file that changed since the page was verified
npm run widths     # after a build: every page, in headless Chrome, at 375 and 320px
```

`npm run widths` (`scripts/page-widths.mjs`) fails, naming the page, its width and the element
that reaches past the edge, when a built page scrolls sideways at a phone's width. It needs
Chrome or Chromium on the machine (`CHROME=/path/to/chrome` to point at one) and uses no
package: it serves `dist/` on a local port and starts Chrome headless on a profile it makes in
the temp directory and removes. It is not part of `npm run build`, because a browser in the
build would be a new dependency; run it before a release and after a change to a layout. What
every `npm test` holds is the rule that fixed the pages it found
(`test/page-width.test.mjs`: inline code in a doc may break inside a word).

Requires Node ≥22. Build/dev must run from this directory (`site/`).

The site is served under the `/org-os-template` base path (GitHub Pages project
page — see `base.config.mjs`), in dev as well as production, so the plain
`http://localhost:4321` root shows Astro's 404. Internal links go through
`withBase()` from `src/lib/base.ts`; `scripts/verify-build.mjs` fails the build
on any link that skips (or doubles) the prefix.

## How it works

- **Docs** are published from one manifest, `src/data/docs-manifest.mjs`: each entry names a markdown file anywhere in the repository, its address, title, section, order, summary and the commit it was checked against. Nothing is copied into `site/`. A file that is not in the manifest is not on the site.
- **Links between docs** are written as file links (`[x](FEDERATION.md)`), as the repository needs. `src/lib/remark-doc-links.mjs` turns a link to a published page into its site address and a link to any other repo file into its GitHub address at the commit being built. A link that resolves to nothing fails the build.
- **Search** is Pagefind: `npm run build` indexes `dist/` after Astro builds it, and the index loads when the viewer first opens search. It does not exist under `npm run dev`, where Search falls back to the docs index — use `npm run build && npm run preview` to try it.
- **Federation**: `scripts/aggregate-federation.mjs` reads `../data/instances.yaml` and writes `src/data/federation.json` (gitignored, regenerated each build) with three fields per listed instance — name, type, repository (`PUBLIC_FIELDS` in `scripts/federation-aggregate.mjs`) — and two counts: registered, and operational (maturity `production`). An entry the registry marks `listed: false` is not written and is in neither count (`isListed`; only the literal `false` unlists). A `listed` that is neither `true` nor `false` (`"false"`, `no`, `0`, empty) stops the build with a sentence naming the entry (`listedProblems`): as written it would publish an entry meant to be hidden, and the repository's own test of the field does not run in the workflow that deploys the site. `test/listed-stop.test.mjs` runs both commands on a scratch registry and reads the exit code and the sentence. `registryView` in the same file is the one rule the aggregator writes by and the verifier checks by. The registry's other fields, its `notes` above all, are the maintainer's working record and are not published; see "The registry guard" below. The same script writes `map.json` from `packages/org-os-kms` (`buildMap`), dropping the `live: false` flag of nodes whose checkout was not present (`quietMap`), then the unlisted entries, what was reached only through them, and every `url` or `repo` that is not a public, owned `https` address (`publicMap` in `scripts/map-addresses.mjs`). It does not copy org-os's own `.well-known/` (operator decision 3, 2026-11-07), and removes a `public/.well-known/` an earlier build left.
- **Themes**: light and dark, both loaded (`src/styles/theme.css`); `<html data-theme>` chooses, set before first paint by `src/lib/theme-boot.mjs` from the viewer's saved choice or the system setting. Palette/fonts/radius live in `src/styles/themes/`; structural tokens in `tokens.css`. `test/theme-contrast.test.mjs` holds both to WCAG AA.
- **Design**: flat and tight — one short type scale and one spacing scale in `src/styles/tokens.css`, hairlines, one shadow (the search dialog). `test/design-tight.test.mjs` fails on a raw `font-size`, a spacing step above 64px, a stray shadow, or decoration that was cut; it reads the same rules in their other spellings (an inline `style`, the `font` shorthand, a gradient, `drop-shadow`, movement on hover), and holds the home page's first screen to its lengths. Spec: `../docs/superpowers/specs/2026-10-11-site-tight-design.md`.
- **Commands on the home page** are each printed under the place they are run: to the agent, in the instance, or in the framework checkout. `scripts/command-where.mjs` says whether a command is present there, by reading what an instance receives (`../tests/clone-manifest.txt`) and following the script to every file it loads; `test/command-where.test.mjs` holds the page to it. It proves a command is present, not that it passes.
- **Tables** in the docs are built inside a scroll region that can be focused and is named after its columns (`src/lib/table-scroll.mjs`, a rehype plugin), so a table wider than a phone can be scrolled by keyboard and with script off. The page's script prints a line above a table that does not fit and takes one that fits out of the Tab order.
- **Feedback** is a link to a prefilled GitHub issue under the `docs-feedback` label (`src/lib/feedback.mjs`). No backend, no script.
- **Graph**: the federation network on `/` and `/federation` is the `<federation-map>` web component.
- **Machine layer**: `/llms.txt` (generated from the manifest), `/federation.json`, and the surfaced `/.well-known/` EIP-4824 schemas.
- **Build checks**: `scripts/verify-build.mjs` fails the build on an invalid manifest, a page that did not build, a broken or unprefixed internal link on any page, a relative link left in the output, a redirect that does not land, a docs table outside a scroll region, or registry text outside the public fields in any built file (next section).

## The registry guard

`scripts/verify-build.mjs` (step 3e) reads every text file in `dist/` and fails the build when it finds something from a field of `data/instances.yaml` that is not in `PUBLIC_FIELDS`. The rules are in `scripts/registry-leaks.mjs` and held by `test/registry-leaks.test.mjs`.

What it looks for:

- **A sentence** of a field's free text, whole (16 characters or more), whatever its case and its spacing: the letters and the punctuation must be the note's, in order.
- **An excerpt**: any 40 letters and digits in a row of a note (`RUN_LENGTH`), whatever stands between them. This is what a note cut short for a card or a description leaves. Spaces, punctuation and case are ignored.
- **A flag or a local path**: a one-word value of 8 characters or more with a `_` or a `/` in it. Today these are the `drift` flags (`no_masterplan`) and the `local_path` values (`../refi-bcn-os`).

Each file is read twice, as written and with its markup removed, so text held in an attribute and text with tags between its words are both seen. HTML entities and the escapes of scripts and JSON (`\uXXXX`, `\xNN`, `\n`, `\"`) are decoded first; curly quotes, long dashes and the other hyphens (U+2010 to U+2012, the non-breaking hyphen among them) count as the plain ones; and the characters that take no room are removed before anything is compared: the soft hyphen, the zero-width space, joiner and non-joiner, the word joiner and the byte-order mark.

What it does not look for, and why:

- **One-word values that are ordinary words**: `maturity` (`production`), `federation_role` (`hub`), `federation_network`, and the names in `packages`, `skills_extra`, `data_registries_extra` and `agent_runtime`. The framework's documents use these words on their own account, so finding one on a page proves nothing.
- **Dates, versions and booleans**: `last_sync`, `framework_version`, `masterplan_version`, `cloned`. A date on a page is anyone's date.
- **An excerpt shorter than 40 letters** that is not a whole sentence. The length is set from two measurements (2026-10-11): the longest run any built file shares with a note is 32 letters, the path of a public file that `docs/ECOSYSTEM.md` cites; and the longest single name inside a note is 36 letters, which a document may cite without quoting the note. 40 is that name and one joining word. `npm run build` prints the first number each time; `test/registry-leaks.test.mjs` fails when the second moves.
- **A letter written as another that looks like it** (a Cyrillic "о" for a Latin "o"), or a sentence with a word changed. Short sentences are still matched by their letters.
- **A paraphrase**, and text in a file that is not text (the search index's compressed fragments, which are built from the pages that are read).

For these the guard is the shape of what is printed, not the words: `federation.json` may carry only the public fields (step 3a), and each instance's line on the federation page may be only its name, type and link (step 3b). The same steps fail the build, naming the entry, when one marked `listed: false` is in `federation.json` or in the page's list, and when a count a page prints (marked `data-registered-count` or `data-operational-count`) is not the registry's. The map follows the same rule (step 3c): it is drawn from `federation.yaml`, which has no `listed`, so the aggregator leaves out the unlisted entries by id and the verifier fails the build if `map.json` draws one, a node reached only through one, or an address `scripts/map-addresses.mjs` refuses.

There is no list of exceptions. When a framework document quotes the registry, the document changes.

## Pages

`/` · `/docs` (+ `/docs/<slug>`) · `/modules` (+ `/modules/rad-org-os`) · `/federation`

`/get-started` and `/about` are redirects (`src/data/redirects.mjs`).

## Adding a doc to the site

1. Write or pick the markdown file. It can live anywhere in the repository.
2. Check it against the code and note the commit you checked at.
3. Add an entry to `src/data/docs-manifest.mjs`.
4. `npm run build`. The build tells you if a link in it goes nowhere.

## The generator seam

`src/styles` + `src/components` + `src/lib` + `scripts/` are the reusable core; `src/data/` is org-os's own content (home copy, module mirror, docs manifest, redirects). This split is the basis for the future `org-os-website-generator` module — any instance would swap the data, keep the core.

## Deployment

Live at <https://regen-coordination.github.io/org-os-template/> — locked by the
v0.5 release masterplan (WS-D, operator decision 2026-08-28). Origin and base
path live in `base.config.mjs` (the single source of truth, consumed by
`astro.config.mjs`, `verify-build.mjs`, and the root README render);
`.github/workflows/deploy-pages.yml` deploys on every push to `main`.

## Open decisions

A custom domain would be a new decision, made by changing `base.config.mjs`.
Specs: `../docs/superpowers/specs/2026-06-17-org-os-website-design.md` (the first
version), `../docs/superpowers/specs/2026-10-10-site-docs-v2-design.md` (the docs site)
and `../docs/superpowers/specs/2026-10-11-site-tight-design.md` (its look).

Built by the org-os framework. MIT.
