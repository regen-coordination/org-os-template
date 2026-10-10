---
title: ONTOLOGY-CORE — the object types of a knowledge-commons instance, and how they bind
status: core — lifted 2026-10 from ReFi DAO's instance
extends: ontology-posture.md (the two layers and align-and-map — not restated here)
---

# Ontology — core

`ontology-posture.md` says *what the kernel is*: a frozen interoperable core, extensions that map back to it,
crosswalks instead of an adopted root. This file says *how an instance binds to it*: which types it stores, what
a page may show, where an object lives. An instance's own ONTOLOGY inherits this and states only its deltas: its
types, its fields, its lanes, its rulings.

Every rule an instance adopts should end in a pointer: **enforced** (a function or test holds it), **ruled**
(a dated decision holds it), or **practice — not enforced**. Counts, release tags and commit hashes belong in
the instance's dated state box, never in a rule ([`methodology-core.md`](../process/methodology-core.md) §5).

## 1 · Inheritance

An instance adopts the posture in [`ontology-posture.md`](ontology-posture.md) unchanged and takes the schemas
(`../schemas/*.yaml`) from the framework release it vendors, **unedited**. The vendored copy is never edited in
place: the next refresh overwrites it, and an edit made there is a fork nobody declared.

What an instance writes down is its **bindings** (which types it stores, where each renders), its **deltas**
(each field it adds, with the reason and where it renders), and which release it vendors, refreshed when.

## 2 · Stored types

An instance declares, in one table, **which framework types it stores, what each is for, and which of them
publish**. A type it stores and never publishes is listed as such, with the rule that refuses it.

- The set it may publish is the framework's (`PUBLISHABLE_TYPES`, plus the opt-in types of `optInTypes()`:
  `source-system`, `public-use-boundary` and every registered extension pack's types, in
  `../src/publishable.mjs`). An instance narrows that set; it does not widen it.
- A type outside the framework's set is **proposed upstream first** (§7), and held to
  [`type-tag-discipline.md`](type-tag-discipline.md): a type only where it changes structure, otherwise a tag.
- Refuse by shape as well as by name. Real records arrive untyped or mistyped, so a gate that reads only `type`
  lets a never-published record through. Name the fields that mark each never-published type and test on them.
- Type from the **body** of the material, never its title. Where two types sit close, write the test between them.
- For each stored type, list its public and its private fields. The private ones are the framework's (§3);
  an instance does not keep a second list.

## 3 · A page never says more than the API

Every page body is built from `publicView(obj)`, the same projection the instance's API publishes, so no page can
carry a field the API withholds. `publicView` drops `PRIVATE_FIELDS` and `provenance.surfaced_by`
(`../src/publishable.mjs`; test *"publicView strips editorial internals, keeps everything else, does not mutate"*).

- **Read `PRIVATE_FIELDS` from the constant**, never from a copy in a document.
- **Two fields can hold the same idea with opposite visibility.** An `encyclopedia-entry`'s `known_tensions` is
  public; a `concept-lineage`'s `tensions` is private. Copying text from a private field into its public
  neighbour is publishing, and goes through review.
- **One exception runs the other way:** a page cites every source the gate checked, including
  `additional_provenance`, which the API view omits. A page must not understate its own provenance.
- **Pages and the API pass the same gates.** A page built on the instance gate alone publishes what the framework
  floor refuses. Close that gap or state it ([`publication-policy-core.md`](../process/publication-policy-core.md)).

## 4 · Where an object lives

**One home per object.** Every published object resolves to exactly one place a reader finds it: its own page,
or a named role on another object's page. The set of places is closed: an object that resolves to none stops the
export, is not dropped, and gets no catch-all place made for it. Hold this with a test on the real store.

- **A lane is an instance choice.** How places are grouped for readers (sections, collections, navigation) is
  the instance's, and is ruled there. An object shown inside another keeps its own address.
- **A missing parent is a data defect.** Where placement depends on provenance, an object whose provenance is too
  thin to place is fixed in the store.
- **No join is derived that no review approved.** Linking two objects because they share a source asserts a
  relatedness nobody checked.
- **The record key is the object's id.** Where an instance also writes each object as a record on another plane,
  the collection comes from the type (`nsidFor` in `../src/lexicon.mjs`) and the key is the minted id, never a slug.
  Ids are minted only for objects that pass both gates. Where page and record diverge, the instance says so.

## 5 · The twin rule

An `encyclopedia-entry` and a `concept-lineage` may share a slug and route to the same address. **One page per
address: the entry holds it, and the lineage is held** until a renderer merges a lineage's fields into its entry's
page. The two are complements (summary and tensions; traditions and distinctions), so dropping either is a loss
and the merge renderer is the real fix. The same rule covers any two types an instance routes to one address.

Two guards hold it. The export **throws** rather than let one page overwrite another, and never picks a winner
itself: which twin becomes the page is an editorial decision. And a test on the store fails when two published
objects would render to the same file, before any export runs.

The second guard exists because "no twin can collide" is a claim about a past store, and a review picker that
is not twin-aware will approve the second twin ([`methodology-core.md`](../process/methodology-core.md) §3).

## 6 · Identity is outside the ontology

**A knowledge store holds no people.** People, wallets and contributions belong to an instance's records, under
their own consent and access rules; the knowledge store refers to organizations and projects. The framework
refuses to let `person` be configured as publishable (enforced: `publishableTypes` throws on `person` in
`../src/publishable.mjs`; test *"default set is 10 schemas, never person"* in `../test/publishable.test.mjs`).

Keeping identity out of the store is the stronger line, and an instance holds it at ingest. A per-object gate
decides whether a record leaves; it does not undo the record having been made, copied and indexed.

The `resource` schema lists "person" among the things a resource can describe. An instance holding this core
does not use that: a guest, an author or a person mentioned is never a resource; their organization or project
may be. An instance that decides otherwise states it as a delta, with the consent rule that carries it.

## 7 · Changing the ontology

Follow [`../process/ontology-change-process.md`](../process/ontology-change-process.md). A change to a type,
field or predicate is proposed upstream, never made in the vendored copy.
