# Network N0 — acceptance record (2026-11-06)

Branch `feat/network`. Counts and states only. Instances were read, never written.

## 1. Real instances, read-only

`node scripts/validate-identity.mjs <instance>` for each of five instances. Each printed section "4. federation links".
`git status --porcelain` was identical before and after every run (nothing written).

Re-run on 2026-11-07 after the final fix wave (the nested `federation:` block is read, vault-relative paths such as
`03 Libraries/…` are found, a hub or `join.where` that won't be published is warned about). The first run had
miscounted lf-work-os (it has 5 peers, not 3) and refi-dao-os (8 peers, not 6: two URL-only peers print nothing).

| Instance | Exit | Peers read | Networks read | Link states | Other section 4 warnings |
|---|---|---|---|---|---|
| lf-work-os | 1 | 5 | 1 | 2 mutual (local sibling instances), 3 claimed | its hub is a local path, so it won't be published |
| refi-bcn-os | 1 | 8 | 2 (from the nested block) | 6 a repo, not an instance; 2 claimed (an instance in `repos/` and one found by its vault path) | 3 "move it to the top level", 1 "network and hub are ignored" |
| refi-dao-os | 1 | 8 | 1 | 2 claimed (both found by vault path), 3 a repo, not an instance, 1 no folder, 2 URL-only (not checked, not printed) | none |
| refi-med-os | 1 | 4 | 2 (from the nested block) | 1 a repo, not an instance; 3 `owner/repo` with no local folder (not checked, not printed) | 3 "move it to the top level", 1 "network and hub are ignored" |
| regen-coordination-os | 1 | 0 | 1 (its `github.com/…` hub now reads as public) | none: "nothing to flag" | none |

Before the fix, refi-bcn-os and refi-med-os read no networks at all, and vault-path peers read "no folder": 2 in
refi-bcn-os and 4 in refi-dao-os are now found (one vault-path peer of refi-dao-os really has no folder).

The exit 1 in each case comes from the older sections 1 to 3 of the check (failed counts: 105, 1787, 2851, 1, 973). Federation links only produced warnings (4, 13, 7, 5, 41 warnings in total per instance). The instances were not touched or repaired.

## 2. federation.json in a temp copy (lf-work-os)

lf-work-os has an `identity.daoURI`, so `federation.json` was generated (copy of `federation.yaml`, `IDENTITY.md`, `data/` only). It holds 3 peers, all `https:` and public. No local-only or private peer appears, and no notes, contact or local paths. The temp copy was removed; lf-work-os status was unchanged.

## 3. Full suites (one at a time)

First run: root 986 of 996 passed, admin 7355 passed, 2 skipped, 1 failed. Four failures were expected-output tests that N0 changed on purpose (federation.json in the output list, `repos-manifest` in the generate script, `mount` and `purpose` in the systems skeleton, six new files in the clone manifest). They were updated, and the clone manifest was regenerated (adds `scripts/repos-manifest.mjs`, `tests/repos-manifest.test.mjs`, `tests/validate-identity-federation.test.mjs`). The seven buzz tests passed when run alone, so they were load timeouts.

Final run:
- Root `npm test`: 996 tests, 996 passed, 0 failed (branch point: 984).
- Admin `npm run test:admin`: 7355 passed, 2 skipped, 1 failed (branch point: 7305 passed, 1 skipped). The one failure was `tests/server/git.test.ts` (a merge-abort test, "Entry not uptodate") under heavy machine load. It passed in the first admin run and passed alone on re-run (66 of 66), so it is load flakiness and no N0 path touches it.

Status: green apart from that one load flake.

After the final fix wave (2026-11-07), one at a time:
- Root `npm test`: 1007 tests, 1007 passed, 0 failed (11 new). A first run had 1 failure: the standards
  `--strict` test in `tests/scripts/validate-identity.test.mjs` used a nested `federation:` fixture, which now warns.
  The fixture was moved to the top-level shape `clone-framework` writes, and the re-run was green.
- Admin `npm run test:admin`: 7369 passed, 2 skipped, 0 failed (13 new). `tsc --noEmit` in packages/admin: 0 errors.

Status: green.
