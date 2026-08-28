# WS-H Acceptance — 2026-08-28

**Verdict: acceptance FAILED. The `v0.5.0` tag was not cut.**

WS-H exists to prove the release's reliability claim on real instances *before*
WS-G publishes it. It did its job: the claim does not hold as designed, and the
reason is architectural rather than a bug.

Per the masterplan's own instruction — *"If any acceptance step fails, stop
before tagging and report honestly — do not ship"* — execution stopped here.

---

## The blocking finding

**`scripts/sync-upstream.mjs` cannot sync any instance in the fleet, because no
instance shares git history with the framework.**

Its stage 5 runs `git pull --rebase upstream main`. That assumes the instance is
a *fork* of the framework. Every real instance is a *scaffold* — a file-level
copy with its own `git init` and its own root commit:

| Instance | Root commit | Shares history with framework? |
|---|---|---|
| framework (`org-os`) | `af8941a273a7` | — |
| `refi-bcn-os` | `d4487627f49f` | no |
| `refi-dao-os` | `2c2ee7fd20e0` | no |
| `regen-coordination-os` | `5f09862126e4` | no |
| `refi-med-os` | `0b2075f58d66` | no |
| `bread-coop-os` | `2f36a4d8d38c` | no |
| `dao-os` | `2c94bece6f18` | no |

Six for six. The rebase therefore tries to replay the instance's entire history
onto the framework's, conflicting on essentially every shared filename, and
leaves the repository mid-rebase.

Notably, `bread-coop-os`'s `genesis_commit` **is** `af8941a273a7` — the
framework's root. The lineage stamp records the correct provenance. It is the
only link between framework and instance; git itself has none. The stamp was
right and the sync strategy was wrong.

### What it did to refi-med-os

The rebase conflicted, and then `git rebase --abort` **also failed**, because an
untracked file in the working tree (the doctor's own sync receipt) blocked the
checkout back. The instance was left on a detached HEAD pointing at a *framework*
commit, with a conflicted index.

**Fully recovered.** Nothing was lost:

- `refs/heads/main` never moved from `4326c16`, and `ORIG_HEAD` agreed.
- The doctor had written 8 `refs/snapshots/*` refs across the attempts.
- Recovery: preserve the blocking receipt to the scratchpad, then
  `git rebase --abort`. Result: `main @ 4326c16`, clean tree, rebase state gone,
  original root commit `0b2075f` intact.

The instance now carries five commits from this session: one operator preference
that had been sitting uncommitted, three (redundant) machinery installs from the
repeated attempts, and the declared-upstream repair. They are local and unpushed.
The three duplicate machinery commits are noise I introduced; I have deliberately
**not** rewritten that history, since the release policy is no-history-rewrite and
it is not my repository to tidy unasked.

### Why containment did not save this one

B9's abort-on-first-failure worked at every stage the doctor owns — nothing was
re-stamped, later stages were skipped, the receipt named the failing stage. But
containment cannot undo what a *called program* did to the working tree.
`sync-upstream.mjs` left a conflicted rebase behind, and the doctor has no
rollback for that.

The snapshot ref makes it recoverable. It does not make it automatic.

---

## Four defects found and fixed along the way

All four were invisible to unit tests and are now covered by regression tests
(`692fb42`, 389 tests green):

1. **The doctor's own repair broke the next stage.** `inject-machinery` writes
   files, and `sync-upstream` refuses on a dirty tree — so the repair guaranteed
   the failure. Machinery is now committed as its own commit, explicit paths only.
2. **Same class, second instance.** `ensure-upstream` fixed the git remote but not
   `federation.yaml`'s declaration — and `sync-upstream` reads the declaration.
   refi-med-os declared `repository:` with no `url:` at all, so the sync stopped
   at stage 3 every time. Now reconciled on raw text and committed.
3. **A previous aborted run blocked its own retry**, because its debris counted as
   a dirty tree. The check now ignores doctor-owned paths, reads git fresh, and
   passes `-uall` so git does not collapse an untracked directory into an entry
   that matches no file path.
4. **A porcelain parsing bug.** `io.git` trims its output, eating the leading
   space of the two-character status column — but only on the first line. A fixed
   `slice(3)` cut one character off exactly one path per run, and the doctor read
   its own file as an operator's work.

None of these would have surfaced without running against something real. That is
the argument for WS-H gating WS-G, and it paid for itself.

---

## What the fleet looks like right now

`doctor assess` is unaffected by any of this and works on all six (read-only,
run repeatedly today):

| Instance | Blockers | Warnings |
|---|---:|---:|
| `refi-med-os` | 2 | 12 |
| `bread-coop-os` | 8 | 9 |
| `regen-coordination-os` | 9 | 11 |
| `refi-bcn-os` | 4 | 9 |
| `refi-dao-os` | 4 | 13 |
| `dao-os` | 3 | 11 |
| framework itself | 0 | 7 |

The framework self-assesses clean; it did not this morning (3 blockers), and the
fixes came from taking its own report seriously.

**H2, H3 and H4 were not attempted.** H2 and H3 both call `doctor sync`, which
hits the same wall; running them would corrupt two more repositories to learn
what H1 already established. The assess-only half of H4 is effectively done (the
table above) and the `--dry-run` half is safe, but publishing partial acceptance
as if it were the article would misrepresent it.

---

## What has to happen before v0.5.0 can be tagged

The reliability claim as written — *"assess + sync proven on three real
instances"* — cannot be met by a git-history-based sync. The options, ranked:

1. **Replace the sync strategy with a file-level overlay.** Stop trying to merge
   histories. Copy framework-owned paths into the instance, leave instance-owned
   paths alone, and let the lineage stamp record which framework commit was
   applied. This is what `sync-packages.mjs` already does for packages, what the
   2026-04-24 regen-coordination-os "full overlay" sync did by hand, and what the
   `genesis_commit` design implies. It is the honest primitive for a scaffolded
   instance. Largest change; makes the claim true.
2. **Narrow the claim to `assess`, and ship `sync` as `--dry-run` only.** The
   assessment half is genuinely proven across six real instances and is the more
   valuable half — it is what found every defect in this report. `doctor sync`
   ships documented as unproven, gated behind an explicit flag, with propagation
   staying v0.6 Active-1 where it already sits. Smallest change; keeps the tag
   close; the release copy must not say "sync is proven".
3. **Delay the tag** until option 1 lands and WS-H is re-run in full.

My recommendation is **2 now, 1 for v0.5.1** — the fleet is not being synced
before v0.6 anyway (that is Active-1, already gated on the kms data-loss items),
so shipping an unproven sync verb behind an honest label costs nothing real,
while shipping it *described as proven* would be exactly the kind of confident
untruth this release set out to remove.

Either way, WS-G stays blocked until the operator chooses.
