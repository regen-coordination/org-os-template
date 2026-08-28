# DECISIONS.md — instance-b

_Append-only log. Most recent at top._

## Conventions

Each entry has a `Status`, a `Decision`, and a `Why`. Non-dated sections like this
one are boilerplate, not decisions — a `recentDecisions` reader must not count them
as one of the dated entries below.

## 2026-08-02 · Join test-net as a real-shape fixture

**Status:** active
**Decision** — instance-b models the root-level `peers:`/`upstream:` federation
shape used by real instances, as opposed to instance-a's nested `federation:` shape.
**Why** — coverage for both shapes `loadFederation` supports.

## 2026-08-04 · Keep DECISIONS.md messy on purpose

**Status:** active
**Decision** — leave the `## Conventions` boilerplate section above the dated
entries, instead of trimming it.
**Why** — real `DECISIONS.md` files open with non-dated sections; a "last 5
`## `-delimited sections" reader needs a fixture that exercises the sweep.
