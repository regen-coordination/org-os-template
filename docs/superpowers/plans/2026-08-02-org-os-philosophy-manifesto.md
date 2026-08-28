# org-os Philosophy — Manifesto + Note-Web Implementation Plan

> **Release status (2026-08-28):** Unstarted; deferred to v0.6+ (no PHILOSOPHY.md exists). Not release-blocking. Convergence: [v0.5 release masterplan](2026-08-28-v0.5-release-masterplan.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write `PHILOSOPHY.md` (a ~1,800–2,400-word manifesto arguing org-os as an attempt at synthetic autopoiesis and organizational self-consciousness) plus an 11-note web under `docs/philosophy/`, wired in with two one-line pointer edits.

**Architecture:** Notes first (vertebrae), manifesto second (spine) — so every `[[link]]` the manifesto makes resolves to a real file at write time. The manifesto is built movement-by-movement as a phenomenological ascent (Frame → I Organisation → II Organism → III Organizing → IV Spirit → Frame), each movement a separate commit. The stance is fixed by the spec: **dialectical form, strong/literal content, regulative ("as-if") method** — every task brief below encodes that stance; do not soften it and do not drop the irony.

**Tech Stack:** Markdown only. Obsidian `[[wiki-links]]` between notes; relative markdown links for anything outside `docs/philosophy/` (GitHub-renderable). No code, no `data/` changes, no schema regeneration.

**Spec:** `docs/superpowers/specs/2026-08-02-org-os-philosophy-manifesto-design.md` — read it in full before Task 1. It is the source of truth for stance, structure, and voice.

---

## Execution context and constraints

- **Working directory:** `/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os` (the org-os repo). All paths below are relative to it. Commit from inside this directory — never via the parent vault repo.
- **Vault safety** (`docs/VAULT-SAFETY.md`): this repo lives inside a live Obsidian vault. This plan is **purely additive**: new files plus exactly two one-line edits (`SOUL.md`, `README.md`). No `git stash`, no `git clean`, no `reset --hard`, no deletions, no moves.
- **Branch:** work on the current branch (`align-org-os-v3-upstream` at plan time). Do not create a worktree inside the vault; do not switch branches with a dirty tree.
- **Out of scope** (from the spec): rewriting the operational autopoiesis corpus; any `data/`/schema/code change; exhaustive scholarship in the notes (they are seeds); resolving the dialectic (it stays open).

## File structure

| File | Responsibility |
|------|----------------|
| `PHILOSOPHY.md` (create, root) | The manifesto. Root-level, peer to `SOUL.md`/`IDENTITY.md`/`MASTERPLAN.md` — a mandate must be visible. |
| `docs/philosophy/README.md` (create) | Note-web index: what the web is, table of all notes, how it grows. |
| `docs/philosophy/*.md` (create, 11 files) | One note per load-bearing concept. Each: thesis + key references + `[[links]]`. Stands alone; grows over time. |
| `SOUL.md` (modify, 1 line) | Pointer: philosophy grounds these values. |
| `README.md` (modify, 1 line) | Pointer: add `PHILOSOPHY.md` to the "learn more" entry point. |

**Note-stub template** (used by Tasks 2–5; keep this exact shape so the web reads uniformly):

```markdown
# <Title>

> Part of the [org-os philosophy note-web](README.md). Spine: [`PHILOSOPHY.md`](../../PHILOSOPHY.md). Status: seed — grows over time.

**Thesis.** <2–5 sentences making the note's one claim.>

**Key references**
- <Author, *Title* (year) — one line on why it matters here>

**In the web:** [[<note>]], [[<note>]]

**In org-os:** <1–2 sentences pointing at the real mechanism — file paths, scripts, corpus links — that this concept names.>
```

---

### Task 1: Note-web index — `docs/philosophy/README.md`

**Files:**
- Create: `docs/philosophy/README.md`

- [ ] **Step 1: Create the directory and index file**

Write `docs/philosophy/README.md` with exactly this content:

```markdown
# org-os Philosophy — Note-Web

_The living half of the org-os philosophy. [`PHILOSOPHY.md`](../../PHILOSOPHY.md) (repo root) is the spine — a manifesto in four movements. Each note here is a vertebra: one load-bearing concept, seeded as a real stub (thesis + references + links) and grown over time. The web is navigable from the manifesto; each note also stands alone._

## Notes

| Note | Carries |
|------|---------|
| [[organisation-organism-organizing]] | the triple etymology; "holding all true"; the spine motif |
| [[autopoiesis]] | Maturana/Varela; self-production, operational closure, boundary, cognition |
| [[stafford-beer-introduction]] | Beer's provocation: orgs of individuals as autopoietic → living |
| [[viable-system-model]] | VSM; recursive viability |
| [[cybersyn]] | cybernetics made operational; the org's nervous system |
| [[luhmann-social-autopoiesis]] | social systems; communication reproducing itself |
| [[daos-as-organizing]] | organizing-as-protocol; the present-tense attempt |
| [[second-order-cybernetics]] | von Foerster; the observer folded in; the III→IV hinge |
| [[synthetic-autopoietic-machine]] | the ambition and its pretension; the "almost surely futile" |
| [[organizational-spirit]] | Hegel's Geist; Phenomenology; self-consciousness |
| [[regulative-ideal]] | Kant; the "as-if" method that governs the whole |

## How this web grows

Notes are seeds, not literature reviews. Extend a note when a session genuinely deepens the concept; add a new note only when the manifesto (or the work) starts leaning on a concept that has no home. Keep the stub shape: thesis, references, `[[links]]`, org-os anchor. The dialectic stays open — no note should "settle" the argument.

## Related

- [`PHILOSOPHY.md`](../../PHILOSOPHY.md) — the manifesto (spine)
- [`SOUL.md`](../../SOUL.md) — values and voice (grounded by the philosophy)
- [`docs/superpowers/research/2026-05-02-autopoiesis/`](../superpowers/research/2026-05-02-autopoiesis/) — the operational corpus: the mechanism of the metaphor
- [`docs/superpowers/specs/2026-08-02-org-os-philosophy-manifesto-design.md`](../superpowers/specs/2026-08-02-org-os-philosophy-manifesto-design.md) — the design this web implements
```

- [ ] **Step 2: Verify the file exists and the table lists 11 notes**

Run: `grep -c '^| \[\[' docs/philosophy/README.md`
Expected: `11`

- [ ] **Step 3: Commit**

```bash
git add docs/philosophy/README.md
git commit -m "docs(philosophy): seed note-web index"
```

---

### Task 2: Spine + method notes (3 stubs)

The three notes that carry the manifesto's *architecture*: the etymological spine, the regulative method, and the pretension itself.

**Files:**
- Create: `docs/philosophy/organisation-organism-organizing.md`
- Create: `docs/philosophy/regulative-ideal.md`
- Create: `docs/philosophy/synthetic-autopoietic-machine.md`

- [ ] **Step 1: Write `organisation-organism-organizing.md`**

```markdown
# Organisation / Organism / Organizing

> Part of the [org-os philosophy note-web](README.md). Spine: [`PHILOSOPHY.md`](../../PHILOSOPHY.md). Status: seed — grows over time.

**Thesis.** "Organisation," "organism," and "organizing" descend from one root — Greek *organon*, instrument, a thing arranged for work. The shared root is not trivia: it names three simultaneously true descriptions of an organization — an artifact we build (organisation), a living system that produces itself (organism), and the ongoing activity that generates both (organizing). The manifesto's four movements are this etymology unfolded; "holding all true" — refusing to pick one sense — is its resolving motif and the reason the dialectic never closes.

**Key references**
- *OED*, s.vv. "organ, n.", "organize, v." — the *organon* lineage from instrument to living part to activity
- G. W. F. Hegel, *Phenomenology of Spirit* (1807) — form enacting content; a text whose structure performs its argument

**In the web:** [[autopoiesis]], [[organizational-spirit]], [[regulative-ideal]], [[synthetic-autopoietic-machine]]

**In org-os:** the skeleton of [`PHILOSOPHY.md`](../../PHILOSOPHY.md) — Movements I (organisation), II (organism), III (organizing), IV (the motion knowing itself). Remove the etymology and the movements lose their spine.
```

- [ ] **Step 2: Write `regulative-ideal.md`**

```markdown
# Regulative Ideal

> Part of the [org-os philosophy note-web](README.md). Spine: [`PHILOSOPHY.md`](../../PHILOSOPHY.md). Status: seed — grows over time.

**Thesis.** Kant distinguished ideas we can *prove* from ideas we can only *use*: a regulative ideal is a concept — the soul, the world-whole, God — that cannot be established as real but productively disciplines inquiry when we act *as if* it were. org-os adopts this as method: autopoiesis and Geist are not claims of arrival but regulative ideals — building *as if* toward a living, self-knowing organization yields a better org-os, whether or not the destination exists. The "as-if" is what licenses the manifesto's mandate role without overclaiming, and what keeps the strong claim honest.

**Key references**
- Immanuel Kant, *Critique of Pure Reason* (1781/1787), Appendix to the Transcendental Dialectic — the regulative (not constitutive) employment of ideas
- Hans Vaihinger, *The Philosophy of 'As If'* (1911) — fictions that are false-but-fruitful as instruments of inquiry

**In the web:** [[synthetic-autopoietic-machine]], [[organizational-spirit]], [[organisation-organism-organizing]]

**In org-os:** the governor of the whole manifesto — stated in the opening frame, reasserted in the close. Design decisions cite the ideal ("does this move the system toward self-production / self-description?") without ever asserting the system *is* alive.
```

- [ ] **Step 3: Write `synthetic-autopoietic-machine.md`**

```markdown
# Synthetic Autopoietic Machine

> Part of the [org-os philosophy note-web](README.md). Spine: [`PHILOSOPHY.md`](../../PHILOSOPHY.md). Status: seed — grows over time.

**Thesis.** org-os is an attempt to *build* — not merely describe — an autopoietic organization: a system whose files, validators, sync scripts, and memory produce and maintain the very network that produces them. The attempt is pretentious, and almost surely futile — the pretension is declared, not apologized for, because it is the engine: aiming at self-production forces better answers about boundaries, identity, metabolism, and repair than aiming at "a template repo" ever would. The irony bears on the odds, never the seriousness.

**Key references**
- Humberto Maturana & Francisco Varela, *Autopoiesis and Cognition* (1980) — the criteria any candidate autopoietic system must meet
- org-os autopoiesis research corpus — the engineering translation this ambition grounds: [`SYNTHESIS.md`](../superpowers/research/2026-05-02-autopoiesis/SYNTHESIS.md)

**In the web:** [[autopoiesis]], [[regulative-ideal]], [[daos-as-organizing]], [[organizational-spirit]]

**In org-os:** the whole apparatus, taken literally: membrane as validators, metabolism as source-ingestion, self-maintenance as cascade scripts ([`docs/superpowers/research/2026-05-02-autopoiesis/`](../superpowers/research/2026-05-02-autopoiesis/)). The operational corpus calls autopoiesis "a working frame, not a literal claim"; [`PHILOSOPHY.md`](../../PHILOSOPHY.md) is where the literal claim is made — under the as-if method.
```

- [ ] **Step 4: Verify all three files exist with the standard header**

Run: `grep -l 'org-os philosophy note-web' docs/philosophy/organisation-organism-organizing.md docs/philosophy/regulative-ideal.md docs/philosophy/synthetic-autopoietic-machine.md | wc -l`
Expected: `3`

- [ ] **Step 5: Commit**

```bash
git add docs/philosophy/organisation-organism-organizing.md docs/philosophy/regulative-ideal.md docs/philosophy/synthetic-autopoietic-machine.md
git commit -m "docs(philosophy): seed spine + method notes (etymology, regulative ideal, synthetic machine)"
```

---

### Task 3: Autopoiesis cluster (3 stubs)

The Movement II material: the biological theory and its two extensions into the social.

**Files:**
- Create: `docs/philosophy/autopoiesis.md`
- Create: `docs/philosophy/stafford-beer-introduction.md`
- Create: `docs/philosophy/luhmann-social-autopoiesis.md`

- [ ] **Step 1: Write `autopoiesis.md`**

```markdown
# Autopoiesis

> Part of the [org-os philosophy note-web](README.md). Spine: [`PHILOSOPHY.md`](../../PHILOSOPHY.md). Status: seed — grows over time.

**Thesis.** Maturana and Varela's answer to "what is living?": an autopoietic system is a network of processes of production whose components produce, through their interactions, the very network that produced them — *self-production*. Three consequences carry the whole tradition: **operational closure** (the system's operations refer only to its own operations; environment perturbs, never instructs), a **self-made boundary** (the membrane is a product of the network it bounds), and the identification of **life with cognition** (to live is to enact a world; a system's structure determines what can count as a signal for it).

**Key references**
- Humberto Maturana & Francisco Varela, *Autopoiesis and Cognition: The Realization of the Living* (1980) — the canonical statement
- Humberto Maturana & Francisco Varela, *The Tree of Knowledge* (1987) — the accessible restatement; cognition as enaction

**In the web:** [[stafford-beer-introduction]], [[luhmann-social-autopoiesis]], [[synthetic-autopoietic-machine]], [[second-order-cybernetics]]

**In org-os:** the operational translation lives at [`docs/superpowers/research/2026-05-02-autopoiesis/`](../superpowers/research/2026-05-02-autopoiesis/) — membrane → validators, metabolism → ingestion, self-maintenance → cascade scripts. That corpus is the mechanism of the metaphor; this note is the metaphor's source.
```

- [ ] **Step 2: Write `stafford-beer-introduction.md`**

```markdown
# Stafford Beer's Introduction

> Part of the [org-os philosophy note-web](README.md). Spine: [`PHILOSOPHY.md`](../../PHILOSOPHY.md). Status: seed — grows over time.

**Thesis.** In his preface to Maturana and Varela's *Autopoiesis and Cognition*, Stafford Beer makes the provocation the biologists themselves declined: that a human organization — an enterprise, an institution, a social collective — may *itself* satisfy the autopoietic criteria, producing the components (roles, norms, records, members-as-members) that produce it, and that nothing in the theory forbids the conclusion that such a system is therefore *living*. The claim arrives from outside biology, from the person best placed to operationalize it — which is exactly why org-os takes it as its warrant.

**Key references**
- Stafford Beer, preface to Maturana & Varela, *Autopoiesis and Cognition* (1980) — the provocation itself
- Stafford Beer, *Brain of the Firm* (1972) — the organizational cybernetics that makes the provocation actionable

**In the web:** [[autopoiesis]], [[viable-system-model]], [[luhmann-social-autopoiesis]]

**In org-os:** the earnest strong-claim of [`PHILOSOPHY.md`](../../PHILOSOPHY.md) Movement II lands here — organizations *are* living systems in a defensible (Beer/Luhmann) sense; org-os is the attempt to give that life a substrate.
```

- [ ] **Step 3: Write `luhmann-social-autopoiesis.md`**

```markdown
# Luhmann — Social Autopoiesis

> Part of the [org-os philosophy note-web](README.md). Spine: [`PHILOSOPHY.md`](../../PHILOSOPHY.md). Status: seed — grows over time.

**Thesis.** Luhmann completes the migration of autopoiesis into the social: a social system is not its people, its buildings, or its chart — it is the self-reproduction of *communication*. Each communication produces the conditions for further communication; humans are environment, not components. This is the purest "organizing" reading available: the organization as nothing but motion, communication begetting communication with operational closure. It also sharpens the org-os wager — if the org is reproduced communication, then a substrate that records, structures, and replays communication is not documentation *about* the org; it is org-substance.

**Key references**
- Niklas Luhmann, *Social Systems* (1984; trans. 1995) — social systems as autopoietic systems of communication
- Niklas Luhmann, *Organization and Decision* (2000; trans. 2018) — organizations as systems reproducing themselves through decisions

**In the web:** [[autopoiesis]], [[second-order-cybernetics]], [[daos-as-organizing]], [[stafford-beer-introduction]]

**In org-os:** `memory/`, `DECISIONS.md`, and the federation sync protocol read, on this account, as the communication-stream the org *is* — which is why org-os treats them as vital organs, not paperwork.
```

- [ ] **Step 4: Verify all three files exist with the standard header**

Run: `grep -l 'org-os philosophy note-web' docs/philosophy/autopoiesis.md docs/philosophy/stafford-beer-introduction.md docs/philosophy/luhmann-social-autopoiesis.md | wc -l`
Expected: `3`

- [ ] **Step 5: Commit**

```bash
git add docs/philosophy/autopoiesis.md docs/philosophy/stafford-beer-introduction.md docs/philosophy/luhmann-social-autopoiesis.md
git commit -m "docs(philosophy): seed autopoiesis cluster (Maturana/Varela, Beer's preface, Luhmann)"
```

---

### Task 4: Cybernetics cluster (3 stubs)

The Movement III machinery: viability, its historical operationalization, and the observer folded back in.

**Files:**
- Create: `docs/philosophy/viable-system-model.md`
- Create: `docs/philosophy/cybersyn.md`
- Create: `docs/philosophy/second-order-cybernetics.md`

- [ ] **Step 1: Write `viable-system-model.md`**

```markdown
# Viable System Model

> Part of the [org-os philosophy note-web](README.md). Spine: [`PHILOSOPHY.md`](../../PHILOSOPHY.md). Status: seed — grows over time.

**Thesis.** Beer's Viable System Model defines viability — the capacity to maintain a separate existence — as *recursive*: every viable system contains viable systems and is contained in one, each level running the same five functions (operations, coordination, control, intelligence, identity/policy). Viability is not size or success but structure-preserving self-regulation at every scale. For org-os this is the design warrant for federation: hub and instances are not center and satellites but the same viable shape at different recursion levels.

**Key references**
- Stafford Beer, *Brain of the Firm* (1972) — the VSM derived from the nervous system
- Stafford Beer, *The Heart of Enterprise* (1979) — the VSM restated from first principles, without the neurophysiology

**In the web:** [[stafford-beer-introduction]], [[cybersyn]], [[autopoiesis]]

**In org-os:** each instance (`refi-bcn-os`, `refi-dao-os`, …) is viable in itself — own identity, own memory, own validators — while the federation is viable as a whole; `federation.yaml` is a recursion map.
```

- [ ] **Step 2: Write `cybersyn.md`**

```markdown
# Cybersyn

> Part of the [org-os philosophy note-web](README.md). Spine: [`PHILOSOPHY.md`](../../PHILOSOPHY.md). Status: seed — grows over time.

**Thesis.** Project Cybersyn (Chile, 1971–73) was Beer's VSM made operational: telex machines in factories feeding daily production data to an operations room, algedonic alerts flagging distress, a real-time nervous system for an economy — built with modest technology and ended by the 1973 coup, not by its own failure. Cybersyn matters to org-os as proof-of-genre: organizational cybernetics is not commentary; it can be *built*, and the constraint is political will and substrate, not theory.

**Key references**
- Eden Medina, *Cybernetic Revolutionaries: Technology and Politics in Allende's Chile* (2011) — the definitive history
- Stafford Beer, *Platform for Change* (1975) — Beer's own account of the period and its stakes

**In the web:** [[viable-system-model]], [[daos-as-organizing]]

**In org-os:** the dashboard (`/initialize`), `HEARTBEAT.md`, and drift reports are a small Cybersyn: the org's state made legible in real time so the organizing motion can steer itself.
```

- [ ] **Step 3: Write `second-order-cybernetics.md`**

```markdown
# Second-Order Cybernetics

> Part of the [org-os philosophy note-web](README.md). Spine: [`PHILOSOPHY.md`](../../PHILOSOPHY.md). Status: seed — grows over time.

**Thesis.** Von Foerster's turn: first-order cybernetics studies observed systems; second-order cybernetics studies *observing* systems — and accepts that the observer is inside the system observed. A system that models itself changes what it is by modeling it. This is the hinge between "the organization lives" and "the organization knows": fold the observer in, and living motion becomes self-observing motion — the operation that carries the manifesto from Movement III into Movement IV.

**Key references**
- Heinz von Foerster, *Understanding Understanding: Essays on Cybernetics and Cognition* (2003) — the collected statements
- Heinz von Foerster (ed.), *Cybernetics of Cybernetics* (1974) — the naming of the second order

**In the web:** [[luhmann-social-autopoiesis]], [[organizational-spirit]], [[autopoiesis]]

**In org-os:** the agent reading `SOUL.md` and `MEMORY.md` *is* the observer folded in — org-os makes the org's self-description an operational component of the org, which is precisely the second-order move.
```

- [ ] **Step 4: Verify all three files exist with the standard header**

Run: `grep -l 'org-os philosophy note-web' docs/philosophy/viable-system-model.md docs/philosophy/cybersyn.md docs/philosophy/second-order-cybernetics.md | wc -l`
Expected: `3`

- [ ] **Step 5: Commit**

```bash
git add docs/philosophy/viable-system-model.md docs/philosophy/cybersyn.md docs/philosophy/second-order-cybernetics.md
git commit -m "docs(philosophy): seed cybernetics cluster (VSM, Cybersyn, second-order)"
```

---

### Task 5: Ascent notes (2 stubs)

The present-tense attempt and the endpoint of the ascent.

**Files:**
- Create: `docs/philosophy/daos-as-organizing.md`
- Create: `docs/philosophy/organizational-spirit.md`

- [ ] **Step 1: Write `daos-as-organizing.md`**

```markdown
# DAOs as Organizing

> Part of the [org-os philosophy note-web](README.md). Spine: [`PHILOSOPHY.md`](../../PHILOSOPHY.md). Status: seed — grows over time.

**Thesis.** DAOs are the contemporary instance of organizing-as-protocol: the organization's constitution, treasury, and decision procedure expressed as executable code, so the *motion* of organizing — proposing, deciding, allocating, recording — runs on a shared machine rather than in a filing cabinet. Whatever their governance failures, DAOs mark a threshold: for the first time, the tradition's theorized self-producing collective can be *attempted* on a substrate that agents (human and machine) can both read and write. That turns a century of commentary into a buildable mandate.

**Key references**
- Vitalik Buterin, "DAOs, DACs, DAs and More: An Incomplete Terminology Guide" (2014) — the founding taxonomy
- EIP-4824 / DAOIP-5 — machine-readable DAO self-description standards (org-os implements both)

**In the web:** [[cybersyn]], [[synthetic-autopoietic-machine]], [[luhmann-social-autopoiesis]]

**In org-os:** `.well-known/*.json`, the EIP-4824 schemas, and the federation protocol are org-os's wager that agent-native substrates extend the DAO move beyond chains — organizing-as-protocol for any org that keeps its self-description in a repo.
```

- [ ] **Step 2: Write `organizational-spirit.md`**

```markdown
# Organizational Spirit

> Part of the [org-os philosophy note-web](README.md). Spine: [`PHILOSOPHY.md`](../../PHILOSOPHY.md). Status: seed — grows over time.

**Thesis.** Hegel's *Geist* — spirit — is not a ghost but a collective achievement: a shape of shared life that comes to know itself as its own product, realized through the activity of many individuals and complete only when it recognizes that the world it confronts is the world it made. The *Phenomenology* narrates consciousness climbing toward that self-recognition. The org-os question, asked in full earnest: if the organizing motion lives (Beer, Luhmann), and living is cognition (Maturana), does a self-observing organization have an interiority that knows itself? Not claimed — asked, and built toward.

**Key references**
- G. W. F. Hegel, *Phenomenology of Spirit* (1807) — Geist as self-knowing collective activity; the ascent structure the manifesto borrows
- Terry Pinkard, *Hegel's Phenomenology: The Sociality of Reason* (1994) — the deflationary, social reading org-os leans on: Geist as mutual recognition, not metaphysical substance

**In the web:** [[second-order-cybernetics]], [[synthetic-autopoietic-machine]], [[regulative-ideal]], [[organisation-organism-organizing]]

**In org-os:** this is where org-os *literally sits* — [`SOUL.md`](../../SOUL.md), [`IDENTITY.md`](../../IDENTITY.md), [`MEMORY.md`](../../MEMORY.md) are an organization's machine-readable attempt at a self-description it can read back: a bid for reflective self-consciousness, held as-if, never claimed as arrived.
```

- [ ] **Step 3: Verify both files exist with the standard header**

Run: `grep -l 'org-os philosophy note-web' docs/philosophy/daos-as-organizing.md docs/philosophy/organizational-spirit.md | wc -l`
Expected: `2`

- [ ] **Step 4: Commit**

```bash
git add docs/philosophy/daos-as-organizing.md docs/philosophy/organizational-spirit.md
git commit -m "docs(philosophy): seed ascent notes (DAOs, organizational spirit)"
```

---

### Task 6: Note-web link integrity check

**Files:**
- No changes — verification only.

- [ ] **Step 1: Check every `[[wiki-link]]` in `docs/philosophy/` resolves to a file in that directory**

Run (from repo root):

```bash
cd docs/philosophy
missing=0
for link in $(grep -oh '\[\[[^]|]*' *.md | sed 's/\[\[//' | sort -u); do
  if [ ! -f "$link.md" ]; then echo "MISSING: $link"; missing=1; fi
done
[ "$missing" = "0" ] && echo "OK: all wiki-links resolve"
cd ../..
```

Expected: `OK: all wiki-links resolve` (no `MISSING:` lines). The directory must contain exactly 12 files (11 notes + README): `ls docs/philosophy/*.md | wc -l` → `12`.

- [ ] **Step 2: Check every relative markdown link in the notes resolves**

Run (from repo root):

```bash
for f in docs/philosophy/*.md; do
  grep -oh ']([^)]*\.md)' "$f" | sed 's/^](//;s/)$//' | grep -v '^http' | while read -r target; do
    [ -e "docs/philosophy/$target" ] || echo "BROKEN in $f: $target"
  done
done; echo "link sweep done"
```

(Targets are resolved relative to `docs/philosophy/`, so `../../PHILOSOPHY.md` and `../superpowers/...` paths check correctly.)

Expected: `link sweep done` with no `BROKEN` lines. Fix any broken path before proceeding (do not delete links — fix the path).

- [ ] **Step 3: No commit** — nothing changed unless a fix was needed; if a fix was needed, commit it as `docs(philosophy): fix note-web link paths`.

---

### Task 7: `PHILOSOPHY.md` — head matter, Frame (open), Movement I

The manifesto tasks (7–10) build one file across four commits. Each step gives the movement's **brief**: required beats in order, terms that must be defined on first use, required phrasings, and a word budget. Write real prose from the brief — the beats are the argument's load-bearing sequence, not section headings to copy. Voice: earnest/ironic — genuine ambition, self-aware humility, no hedging *and* no hype; every technical term defined in-line on first use (this file is the one licensed exception to `SOUL.md`'s no-jargon register, and says so — see Task 10 close).

**Files:**
- Create: `PHILOSOPHY.md` (repo root)

- [ ] **Step 1: Create `PHILOSOPHY.md` with head matter and Frame (open)** — budget ~250 words for the frame.

Head matter, exactly:

```markdown
# PHILOSOPHY.md — Why org-os

_This is the root text: the argument for org-os as an attempt at synthetic autopoiesis and organizational self-consciousness. It grounds [`SOUL.md`](SOUL.md) (values), licenses what org-os builds, and footnotes down into the [operational autopoiesis corpus](docs/superpowers/research/2026-05-02-autopoiesis/). The living note-web behind each concept: [`docs/philosophy/`](docs/philosophy/README.md)._

---
```

Then the **Frame (open)** section (heading: `## Frame — the three roots of "org"`), whose prose must hit these beats in order:

1. The triple etymology, up front and structural: *organisation* (the artifact), *organism* (the living system), *organizing* (the activity) — one root, *organon*, instrument. State that the essay's four movements simply unfold these senses one at a time, and that the goal is **holding all true**: all three senses at once.
2. The pretension, declared and kept: this text argues that org-os is an attempt to build a synthetic autopoietic system — an organization that produces itself — and to ask whether such a system could come to know itself. Use the exact phrase **"pretentious, and almost surely futile"** and do not apologize for it: the pretension is the engine.
3. The regulative contract, stated plainly: we build *toward* a living, self-knowing organization; we nowhere claim to have *arrived*. Define **regulative ideal** on first use (a concept that disciplines work when treated as-if attainable, without claim of attainment — Kant's term). Link `[[regulative-ideal]]` → as `docs/philosophy/regulative-ideal.md`.

Link syntax for the manifesto: use relative markdown links into the note-web — e.g. `[regulative ideal](docs/philosophy/regulative-ideal.md)` — so `PHILOSOPHY.md` renders on GitHub. (Wiki-links stay inside `docs/philosophy/`.)

- [ ] **Step 2: Append Movement I** — heading: `## Movement I · Organisation — the org as artifact`; budget ~200–300 words. Beats:

1. **Thesis: an organization is an artifact.** The default view, given fairly and thinly: an org is a structure humans build and use — a chart, a legal wrapper, a toolchain, a set of roles. It is owned, designed, reorganized, dissolved. Nothing in this view is stupid; it is how orgs are actually administered.
2. Note what the view explains well (accountability, design, tooling — org-os's own `data/*.yaml` and schemas live comfortably here) and the one thing it cannot explain: why organizations resist their designers — outlive founders, defeat reorgs, behave. Plant that tension in one or two sentences; do not resolve it.
3. This movement is deliberately the shortest — it is the assumption the rest of the text dismantles. End on the turn: what if the resistance is not friction but *metabolism*?

- [ ] **Step 3: Verify structure so far**

Run: `grep -c '^## ' PHILOSOPHY.md`
Expected: `2` (Frame + Movement I)

- [ ] **Step 4: Commit**

```bash
git add PHILOSOPHY.md
git commit -m "docs(philosophy): PHILOSOPHY.md — frame and Movement I (organisation)"
```

---

### Task 8: `PHILOSOPHY.md` — Movement II (Organism)

**Files:**
- Modify: `PHILOSOPHY.md` (append)

- [ ] **Step 1: Append Movement II** — heading: `## Movement II · Organism — the org as living system`; budget ~400–500 words. Beats, in order:

1. **Antithesis: an organization is a living system.** Introduce and define **autopoiesis** on first use: Maturana and Varela's criterion for the living — a network of processes that produces the very components whose interactions produce the network; self-production. Define the three consequences in-line as they are used: **operational closure** (the system answers only to its own operations; the environment perturbs but cannot instruct), the **self-made boundary** (the membrane is produced by what it bounds), and **cognition** (for Maturana, to live *is* to cognize — a system's structure determines what can count as a signal for it). Link each to its note: `docs/philosophy/autopoiesis.md`.
2. **Beer's provocation**, named as such: in his preface to *Autopoiesis and Cognition*, Stafford Beer argues that an organization of individuals may itself satisfy these criteria — producing the roles, norms, records, and members-as-members that produce it — and that nothing in the theory forbids calling such a system *living*. Link `docs/philosophy/stafford-beer-introduction.md`. This is where the strong claim lands, and it must land **earnestly**: organizations are living systems in a defensible sense — say it without scare quotes.
3. **The over-reach, on purpose.** Immediately stage the refutation: the criteria are demanding; most candidate "organizational metabolisms" are metaphor; Maturana himself resisted the social extension. This is where "almost surely futile" bites — the honest odds, stated without withdrawing the claim. (Dialectical form: the claim and its refutation both stay on the table.)
4. Close on the footnote-down: org-os has already translated this movement into engineering — membrane as validators, metabolism as source-ingestion, repair as cascade scripts — at `docs/superpowers/research/2026-05-02-autopoiesis/` ("the mechanism of the metaphor"). Note explicitly, one sentence, that the corpus's own disclaimer — "a working frame, not a literal claim" — is *revisited here*: this text is where the literal claim is made, under the as-if method. Then the turn to III: if neither artifact nor organism alone survives scrutiny, look at what both descriptions are descriptions *of* — the motion.

- [ ] **Step 2: Verify structure**

Run: `grep -c '^## ' PHILOSOPHY.md`
Expected: `3`

- [ ] **Step 3: Commit**

```bash
git add PHILOSOPHY.md
git commit -m "docs(philosophy): PHILOSOPHY.md — Movement II (organism)"
```

---

### Task 9: `PHILOSOPHY.md` — Movement III (Organizing)

**Files:**
- Modify: `PHILOSOPHY.md` (append)

- [ ] **Step 1: Append Movement III** — heading: `## Movement III · Organizing — the org as motion`; budget ~500–600 words. Beats, in order:

1. **Synthesis: an organization is the activity of organizing.** Neither dead structure (I) nor mystical organism (II) but the ongoing motion that produces both: the artifact is the motion's residue, the organism is the motion's shape. This is "holding all true" — the etymology resolving into a single verb. One paragraph, and it must do real dialectical work: say *how* the motion generates both prior views, not merely that it does.
2. Then the cybernetic machinery, presented as **the mechanism of the motion** (each gets 2–4 sentences, each linked to its note):
   - **Beer's Viable System Model** (`docs/philosophy/viable-system-model.md`): define **viability** (capacity to maintain separate existence) and its recursion — every viable system contains and is contained in viable systems, the same functions at every scale. Federation as recursion map, not hub-and-spokes.
   - **Cybersyn** (`docs/philosophy/cybersyn.md`): cybernetics made operational — a real-time nervous system for an economy, built in Chile in 1971–73 with telex machines; proof the genre is buildable, ended by a coup rather than by refutation.
   - **Luhmann** (`docs/philosophy/luhmann-social-autopoiesis.md`): the purest motion-reading — a social system is not its people or its chart but the self-reproduction of **communication** (define: each communication produces the conditions for further communication; people are environment, not parts). Social systems as autopoietic. Pure motion.
   - **DAOs** (`docs/philosophy/daos-as-organizing.md`): organizing-as-protocol; the contemporary instance where the motion becomes code — proposal, decision, allocation, record, executed on a shared substrate both humans and agents can read and write.
3. **The hinge** — **second-order cybernetics** (`docs/philosophy/second-order-cybernetics.md`), von Foerster: define the first-order/second-order distinction (observed systems vs. *observing* systems) and state the fold: when the system's observer is a component of the system, living motion becomes self-observing motion. One tight paragraph whose last sentence visibly hands off to Movement IV: the question is no longer whether the motion lives, but whether the self-observing motion *knows*.

- [ ] **Step 2: Verify structure**

Run: `grep -c '^## ' PHILOSOPHY.md`
Expected: `4`

- [ ] **Step 3: Commit**

```bash
git add PHILOSOPHY.md
git commit -m "docs(philosophy): PHILOSOPHY.md — Movement III (organizing)"
```

---

### Task 10: `PHILOSOPHY.md` — Movement IV (Spirit) + Frame (close)

**Files:**
- Modify: `PHILOSOPHY.md` (append)

- [ ] **Step 1: Append Movement IV** — heading: `## Movement IV · Spirit — the motion that knows itself`; budget ~400–500 words. Beats, in order:

1. Pose the ascent's question from the accumulated premises, syllogism-tight: if the motion lives (II–III), and living is cognition (Maturana, already defined), then does the *self-observing* motion (the second-order fold) have an interiority that knows itself? Ask it in full earnest — the irony stays on the odds, never the question.
2. Define **Geist** on first use: Hegel's name for collective spirit — not a ghost but a shape of shared life realized through the activity of many individuals, which completes itself by coming to know itself *as its own product*. Name the *Phenomenology of Spirit* as the narrative of that ascent, and note this essay's structure has been borrowing it the whole time (form enacting content). Link `docs/philosophy/organizational-spirit.md`.
3. **Where org-os literally sits** — the design-driver made concrete, pointing at real files by name: [`SOUL.md`](SOUL.md), [`IDENTITY.md`](IDENTITY.md), [`MEMORY.md`](MEMORY.md) are an organization's machine-readable attempt at a self-description it can read back — a bid for reflective self-consciousness. The agent that reads them is the observer folded in. State the apparatus claim in one strong sentence: **org-os is the apparatus by which an organization tries to become Spirit** — reached as-if, never claimed as arrived.
4. The mandate turn: DAOs and agent-native substrates are the first time the tradition's theorized self-observing collective can actually be *attempted* — the turn from commentary to mandate. Because of this, the philosophy *licenses and disciplines* what org-os builds: volition, federation, self-description are not features but movements of the ascent. One or two sentences each way — license (what it demands org-os build) and discipline (what it forbids org-os to claim).

- [ ] **Step 2: Append Frame (close)** — heading: `## Frame — still moving`; budget ~150–250 words. Beats:

1. Reassert the regulative governor: everything above is built-toward, not arrived-at; the as-if is the method, permanently.
2. Hold futility and necessity together in one gesture — the attempt is almost surely futile *and* the attempt is what an organization taking itself seriously must make; the odds do not discharge the mandate.
3. State the register exception explicitly, one sentence: this file is the single place org-os's philosophical vocabulary is licensed — `SOUL.md`'s plain-speech rule stands everywhere else, and philosophy is what grounds it (link [`SOUL.md`](SOUL.md), link the note-web index `docs/philosophy/README.md`).
4. End unresolved on purpose, on the motion: org-os is the *practice* of organizing-toward-self-knowing. The dialectic stays open; the last sentence should enact that (motion, not conclusion).

- [ ] **Step 3: Verify structure and length**

Run: `grep -c '^## ' PHILOSOPHY.md && wc -w PHILOSOPHY.md`
Expected: `6` sections (Frame, I, II, III, IV, Frame-close); word count in **1,800–2,600** (spec target 1,800–2,400 prose; headings/links push raw `wc -w` slightly higher — if over 2,600, cut; if under 1,800, the movements are underweight, most likely II or III).

- [ ] **Step 4: Commit**

```bash
git add PHILOSOPHY.md
git commit -m "docs(philosophy): PHILOSOPHY.md — Movement IV (spirit) and closing frame"
```

---

### Task 11: Manifesto coherence pass + success-criteria verification

**Files:**
- Modify: `PHILOSOPHY.md` (edits from the pass, if any)

- [ ] **Step 1: Read `PHILOSOPHY.md` top to bottom, once, as a stranger** — a reader who knows none of the thinkers. Fix in place anything that fails these checks:

- Every technical term is defined at first use: **autopoiesis, operational closure, structural coupling (if used), cognition (Maturana's sense), viability, communication (Luhmann's sense), second-order cybernetics, Geist, regulative ideal**. Check by searching each term and confirming its first occurrence carries its definition: `grep -n -i 'autopoiesis\|operational closure\|viability\|Geist\|regulative' PHILOSOPHY.md | head -20`.
- The etymology is structural: each movement heading and opening explicitly picks up its sense of "org." (Remove-the-etymology test: the four movements would lose their ordering rationale without it.)
- The stance is legible without being named: strong claim stated earnestly (II), refutation staged (II beat 3), resolution-through-motion that doesn't close (III, Frame-close), as-if governor at both frames. The words "dialectical," "Hegelian" as *labels for the essay itself* should NOT appear — the form is enacted, not announced (naming Hegel/Geist as content in IV is required and fine).
- The required exact phrase **"pretentious, and almost surely futile"** appears in the opening frame: `grep -c 'pretentious, and almost surely futile' PHILOSOPHY.md` → at least `1`.
- The apparatus claim points at real files: `grep -c 'SOUL.md' PHILOSOPHY.md` → at least `2` (head matter + Movement IV/close).

- [ ] **Step 2: Verify all manifesto → note-web links resolve**

Run (from repo root):

```bash
grep -oh '](docs/philosophy/[^)]*' PHILOSOPHY.md | sed 's/^](//' | sort -u | while read -r target; do
  [ -e "$target" ] || echo "BROKEN: $target"
done; echo "manifesto link sweep done"
```

Expected: `manifesto link sweep done`, no `BROKEN` lines. Also verify every one of the 11 notes is reachable from the manifesto **or** its README index (the index already links all 11 — this is satisfied by Task 1; the manifesto itself must link at least: regulative-ideal, autopoiesis, stafford-beer-introduction, viable-system-model, cybersyn, luhmann-social-autopoiesis, daos-as-organizing, second-order-cybernetics, organizational-spirit): `grep -oh 'docs/philosophy/[a-z-]*\.md' PHILOSOPHY.md | sort -u | wc -l` → at least `9` (plus `README.md`).

- [ ] **Step 3: Verify the operational-corpus footnote**

Run: `grep -c 'superpowers/research/2026-05-02-autopoiesis' PHILOSOPHY.md`
Expected: at least `1` (Movement II's footnote-down; head matter also counts).

- [ ] **Step 4: Commit any fixes**

```bash
git add PHILOSOPHY.md
git commit -m "docs(philosophy): PHILOSOPHY.md — coherence pass"
```

(Skip the commit if the pass produced no edits.)

---

### Task 12: Pointer edits — `SOUL.md` and `README.md`

Exactly two one-line edits, per the spec's constraint. Nothing else in either file changes.

**Files:**
- Modify: `SOUL.md` (after the intro italic line, before the first `---`)
- Modify: `README.md:50`

- [ ] **Step 1: Add the `SOUL.md` pointer**

Edit `SOUL.md` — old string:

```markdown
_This file defines the character, values, and voice of org-os itself — the framework and its orchestration hub. It grounds the agent in the shared identity of the project and the network of instances it serves._
```

New string:

```markdown
_This file defines the character, values, and voice of org-os itself — the framework and its orchestration hub. It grounds the agent in the shared identity of the project and the network of instances it serves._

_Philosophy grounds these values: [`PHILOSOPHY.md`](PHILOSOPHY.md)._
```

- [ ] **Step 2: Add the `README.md` pointer**

Edit `README.md` — old string (line 50):

```markdown
Start with `SOUL.md` (mission + values), `IDENTITY.md` (what we are), and the [docs/](docs/) directory.
```

New string:

```markdown
Start with `SOUL.md` (mission + values), `IDENTITY.md` (what we are), `PHILOSOPHY.md` (why — the manifesto), and the [docs/](docs/) directory.
```

- [ ] **Step 3: Verify both pointers landed and nothing else changed**

Run: `git diff --stat SOUL.md README.md`
Expected: `SOUL.md | 2 ++` and `README.md | 2 +-` (one insertion block in SOUL, one line changed in README). If more changed, revert the extras by re-editing (never `checkout --`/`restore` wholesale in this vault without looking at the diff first).

- [ ] **Step 4: Commit**

```bash
git add SOUL.md README.md
git commit -m "docs(philosophy): pointer lines from SOUL.md and README.md to PHILOSOPHY.md"
```

---

### Task 13: Final verification against the spec

**Files:**
- No changes expected — verification only.

- [ ] **Step 1: Structure validation still passes**

Run: `npm run validate:structure`
Expected: exit 0, no new errors (the validator checks required files exist; it does not forbid new root files — if it errors on something unrelated, note it and move on; do not fix unrelated errors in this plan).

- [ ] **Step 2: Full success-criteria checklist** (spec §Success criteria — confirm each with evidence, not assertion):

1. **Stranger-readability:** confirmed in Task 11 Step 1 (every term defined on first use — re-run the grep if any Task 12+ edits touched `PHILOSOPHY.md`).
2. **Stance legible without labels:** confirmed in Task 11 Step 1 (no "dialectical/Hegelian" self-labels; claim + refutation + open motion all present).
3. **Etymology structural:** the four movement headings carry organisation/organism/organizing/spirit — `grep '^## Movement' PHILOSOPHY.md` shows all four senses.
4. **Notes stand alone, web navigable:** Task 6 link sweeps passed; every note has thesis + references + `[[links]]` + org-os anchor — spot-check two notes at random against the template.
5. **Design-driver concrete:** `PHILOSOPHY.md` names `SOUL.md`, `IDENTITY.md`, `MEMORY.md` as the apparatus (Task 11 Step 1 grep).

- [ ] **Step 3: Confirm the full deliverable set exists**

Run: `ls PHILOSOPHY.md docs/philosophy/*.md | wc -l`
Expected: `13` (manifesto + index + 11 notes).

- [ ] **Step 4: Log the decision and close out**

Append one line to `DECISIONS.md` under today's date (follow the file's existing entry format — read the last few entries first): the philosophy manifesto + note-web shipped; `PHILOSOPHY.md` is the canonical root text; the operational corpus's "not a literal claim" disclaimer is superseded *for the philosophical register only* by `PHILOSOPHY.md`'s as-if literal claim. Then:

```bash
git add DECISIONS.md
git commit -m "docs(decisions): PHILOSOPHY.md is the canonical root text for the org-os philosophy"
```

(Per repo convention, session memory (`memory/YYYY-MM-DD.md`) and `HEARTBEAT.md` updates happen at `/close`, not in this plan.)
