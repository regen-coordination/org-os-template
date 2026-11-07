# org-os 0.6: how it was built

0.6 adds the house: `packages/admin`, a web app over an instance's records, rules, proposals and
systems, with the framework pieces it needs (canonical records, governance rules, the proposals
ledger, and the migrations from 0.5).

## The design that ships with the template

These four specs describe what 0.6 is. Code comments, the admin README and `DECISIONS.md` cite
them, and one test reads an example from the proposals spec.

- [`2026-10-16-org-os-0.6-platform-architecture-design.md`](../specs/2026-10-16-org-os-0.6-platform-architecture-design.md):
  the architecture. Records, members, changes, proposals, rules, decisions, systems, modules.
- [`2026-10-15-platform-board-design.md`](../specs/2026-10-15-platform-board-design.md):
  the server the platform keeps.
- [`2026-10-18-org-os-0.6-p2-proposals-design.md`](../specs/2026-10-18-org-os-0.6-p2-proposals-design.md):
  proposals and the rule evaluator.
- [`2026-10-29-dao-os-l4-element-set-design.md`](../specs/2026-10-29-dao-os-l4-element-set-design.md):
  the element set the house is drawn with. The gallery is `docs/design/dao-os-element-gallery.html`.

## The process records

0.6 was built in tracks and lanes, each with its own spec, plan, rulings log and review rounds. Those
working records (implementation plans, rulings, lane logs, and the track specs listed below) are not
part of the template. They were written against one team's instance and data, and the team that built
0.6 keeps them in its own archive. Where a kept spec links to one of them, the link points here.

Track specs kept in that archive: the platform stock-take (2026-10-11); F1 canonical records, P1
platform (2026-10-16); P4 machines, parts and boards (2026-10-17); F2 governance (2026-10-18); and the
dao-os lane specs for sign-in and visibility (L5), standards (L8), the workspace (L6), compose and
deploy (L7), door hosting (L9), and empty boards and new records (2026-11-04).

## Screenshots

The house's committed visual record (`docs/design/house-record/`) and the gallery comparison shots
(`docs/design/gallery-shots/`) are re-shot from the example fixtures and come back in a later release.
Until then the record-weight check in `packages/admin/tests/e2e/shoot.test.ts` skips. The release that
brings the record back makes it required again: that test says how.
