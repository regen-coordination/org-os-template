---
title: PUBLICATION-POLICY-CORE — what makes a knowledge-commons object public, for any instance
status: proposed — core publication policy for instances; each instance names its own gate
builds on: ../src/publishable.mjs (the floor) · review.md · csis-safeguards.md
lifted from: ReFi DAO's instance, refi-dao-os docs/kms/PUBLICATION-POLICY.md (2026-09-22)
---

# Publication policy — core

The framework ships a **floor** (`../src/publishable.mjs`): a publishable type, a publishable `public_use`, and a
maturity that is not `held`. Every instance adds its own **gate** on top. An object is public only when it passes
both. This file states what an instance gate must guarantee; an instance's own policy names the functions and
tests that do it.

## 1 · Properties every instance gate must have

1. **Fail closed.** Anything the gate cannot resolve — a missing type, a missing or unresolvable provenance, a
   malformed value — is refused, with a reason.
2. **Never-rendered records are refused by shape, not only by label.** Boundary and source-system records are
   recognised by their fields (`tier`; `what_it_curates` / `reuse_conditions`), because stored records often carry
   no type or a domain word instead.
3. **A risk flag's absence means unassessed, not safe.** Any value other than an explicit false blocks.
4. **Consent binds every source an object drew on,** including sources inherited through a merge.
5. **One document, one key.** A source recorded under several spellings (URL, repository path, archive path)
   canonicalises to one key before any consent lookup; where several boundaries bind one document, the strictest wins.
6. **Internal sources are a floor that context can only add to.** A hard-coded list of internal sources is unioned
   with whatever the context marks internal; an empty context never makes the gate more permissive. Matching may
   over-block; it never under-blocks.
7. **Review is required** — a reviewed maturity, or an explicit, auditable operator flag.

## 2 · Pages never say more than the API

Every rendered page is built from the same projection the API publishes (`publicView`), so private fields
(`PRIVATE_FIELDS`) never render. An instance renders only what passes both the floor and its gate — a page for an
object the floor refuses is a page the API does not back. Watch the asymmetries: a field that is public on one type may be private on its
neighbour under another name. The one thing a page may add is provenance — it cites every source the gate checked.
After publication, re-check the published mirror against the store: an object since demoted or newly
consent-blocked fails the suite.

## 3 · Consent

A consent boundary records that the people the material came from have not agreed to its publication. A reviewer
cannot waive it on their behalf: an approved object under a blocking boundary stays unpublished until consent is
recorded. An aggregate page that would carry the protected material's names or titles (an episode hub, a
contributor list) is withheld too.

## 4 · Disclosures that ship with the content

Standing lines are part of what was approved, so they live in the renderer, not in theme copy:

- a notice on claims that the commons records what a source said and has not verified it;
- a public caveat under the text it qualifies, where one was approved;
- an authorship line on any section drafted with AI assistance and not checked against the source.
  **Label, don't drop:** removing the section loses the most useful reading; publishing it unlabelled puts the
  commons' reading in the source's mouth.

## 5 · What is never published

- **Identity, as a published type.** The framework refuses `person` as publishable (`publishableTypes`). Whether
  identity may sit in the store at all, unpublished, is an instance decision; an instance that keeps it out
  entirely states that as a delta (ReFi DAO does, in its ADR-0002).
- **Internal sources**, which may be named as Sources without counts.
- **The held classes** from review ([`methodology-core.md`](methodology-core.md) §3).
- **Boundary and source-system records** themselves; an instance may publish its own single self-card.

## 6 · Links

A URL renders as a live link only when an audit found it alive. A host later hijacked is de-linked **in the
projection**, keeping the link text — the archived source is never edited. Test the output, not the rewrite:
fail the suite if a published page still carries a denied URL, or if a publishable object's own URL is on a
denied host.

## 7 · Gates between the store and the public

Each is a separate go, and none implies the next: push the store · push the rendered commons · draft deploy,
with every route probed anonymously against the access gate · production. Approving a draft is not the
production go. A UI change and a content change never share a deploy, so a regression can be attributed.

## 8 · Policy and editorial

Policy decides whether an object may be public; an instance's editorial guide decides how it speaks when it is.
Keep them in separate documents, so that neither is changed by accident when the other is edited.
