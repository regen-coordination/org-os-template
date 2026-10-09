---
title: METHODOLOGY-CORE — how a knowledge-commons instance makes and reviews objects
status: proposed — core methodology for instances; each instance states its deltas
extends: review.md (review types and workflows — not restated here)
lifted from: ReFi DAO's instance, refi-dao-os docs/kms/METHODOLOGY.md (2026-09-22) — the parts that hold for any corpus and any operator
---

# Methodology — core

`review.md` says *what kinds* of review exist and when review must be stronger. This file says *how* an instance
runs review so that what publishes is exactly what a person approved. An instance's own METHODOLOGY inherits
this and states only its deltas: its tools, its Sources, its rulings.

Every rule an instance adopts should end in a pointer: **enforced** (a function or test holds it), **ruled**
(a dated decision holds it), or **practice — not enforced**. A rule with none of the three is an aspiration;
label it as one.

## 1 · The pipeline and its two human decisions

```
Source ─► work order ─► decompose ─► accept ─► store (raw) ─► triage ─► worksheet ─► ◆ TICK ─► apply
                                                                                               │
          public ◄─ ◆ each deploy gate ◄─ export ◄─ gate (instance gate ∧ framework floor) ◄───┘
```

A person decides at the diamonds: the **tick** on each object, and **each deploy gate**, each its own go.
Everything between is scripted; a script that writes the store should prove it wrote only what it meant to.

## 2 · Ingest

The method is `../skills/ingest` and `../skills/capture-and-route`; the born-rules are enforced at accept
(`acceptWorkOrder`: raw, `ai_assisted: true`, `provenance.origin`, schema-valid, invariants). What an instance
learns running it, and should keep:

- **Ingested is not Published.** An ingest run's acceptance test is that the published set did not move.
- **Deep intake:** one document → several small typed objects, typed from the body, never from the title; no
  quota.
- **One brief, then addenda.** Each new Source gets an addendum that reads the brief first and states only what
  differs; the addendum wins for its Source.
- **Append, never re-emit, once anything is reviewed.** A store that merges on a title collision lets a re-emitted
  object change a reviewed one without review. Check type + slug against the store before every `store`.
- **Consent follows the lineage string.** A boundary covers only the lineage forms the gate canonicalises; emit it
  under the form the new objects carry.
- **Record what was left out** (`assessed-but-excluded`, categories and counts) in a field that survives
  re-serialisation, not a comment.
- **Human-written text** is not marked AI-assisted: a candidate may carry `ai_assisted: false` when it declares
  `provenance.authorship: human-authored` (accept born-rule; proposed in regen-coordination/org-os-template#6).

How people appear in the store beyond the floor is an instance decision ([`publication-policy-core.md`](publication-policy-core.md) §5).

## 3 · Review

**The unit of review is the object as it will publish** — its public projection (`publicView`) plus every line
that ships with it — never the raw record. A reviewer who approves a record approves fields the reader never sees
and misses the disclosures the reader does see.

**The worksheet lives in the file the reviewer has open.** Build review as a tick-box list in a document, grouped
in that document. Quote what publishes on each line; add a short read by the preparer; check links live when the
sheet is built, because stored link states go stale. Groups that exist only in a chat are skipped.

**Apply only ticked lines, and prove it.** The apply step parses ticks, makes targeted edits, then re-reads the
store and proves only the intended fields of the ticked objects changed. Rehearse with a dry run first. A sheet
generator refuses to overwrite a sheet that may hold ticks.

**A tick is not a publication.** The gate has rules the review does not touch — consent, internal sources,
unresolvable provenance. After applying, run the gate's tests, not only a list check. Keep an exact list of
what may publish as a test (never a floor), and extend it in the same change as the review.

**The picker is gate-aware.** Whatever chooses objects for a sheet re-runs the gate as if the review were already
applied, and sets aside anything a second rule would still block, with its reason — the reviewer is never asked
to read what cannot publish. Where two types render to the same address, the picker is also **twin-aware**:
it never offers both, and the export refuses to let one page overwrite another rather than choosing a winner.

**Split risk by what it can do.**
- *Could be wrong* (figures, measurements, market or governance facts): reviewable in ordinary sheets; clearing
  the risk flag is part of the tick on that one object, never automatic, never in bulk.
- *Could hurt someone* (identifiable people, cultural or Indigenous knowledge, criticism of a named party,
  legal exposure): read one object at a time, one cause at a time, **by readers, not regexes** — a pattern screen
  sorts by names and misses the sentence that matters.
- *Unknown* is not safe: screen it, then place it in one of the two.

**Hold, don't offer.** Some items get no tick-box — only a held line with the reason: a named individual or their
finances, criticism of a named party, sovereignty or political-status phrasing, a speaker's "don't quote me",
health or legal exposure, a private location, a link to a hijacked or missing page. A held line records that the
item was read and why it stopped.

**The qualifier is part of what is approved.** Where a reader needs a qualifier the private notes admit, draft a
public caveat on the sheet line; the reviewer approves text + caveat as one unit, and the caveat is applied
verbatim. Draft one only where a reader needs it. (Needs a public `caveat` field — not yet in the kernel; propose
it through `ontology-change-process.md`.)

**Fix the Source, don't publish housekeeping.** Observations about the corpus's own typos or mismatches are
fixed in the Source. A dead link is repaired to a verified replacement where one exists.

## 4 · Working in a shared checkout

Several agents in one working tree share one git index. Commit by path, never by staging everything; commit new
files through a temporary index with a compare-and-swap ref update; treat any test that runs a real export as a
write. Every subagent carries the repository's git-safety rules and an allow-list of what it may run.

## 5 · Counts are derived, never quoted

A number in a handoff is a claim about a past run. Re-read counts from a real run; pin the ones that matter in a
test that fails when they move; keep them out of rules and in a dated state box. Check a claim ("no two objects
can collide") the way you would check a count — against the store, by a test.
