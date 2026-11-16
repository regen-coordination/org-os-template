# org-os 0.7: how it was built

0.7 adds the workspace to the house: pages, collections and their views, tasks, imports from Notion and Fileverse,
the Sources page and conversation. It also adds the knowledge commons' pages (kms-admin, local only) and compose and
deploy (DAO-OS L7): a DAO's Safe, Hats tree and space composed as records, a deployment prepared step by step, and a
read-back that stages what the chain holds. The house never signs. The work was built on its own branch over 0.6.0,
then replayed as one change over 0.6.2 and reconciled with 0.6.1's hosting and 0.6.2's portal.

## The design that ships with the template

0.7 adds no spec to `docs/superpowers/specs/`. The four specs the 0.6 note lists still describe the house, and the
element-set spec (`2026-10-29-dao-os-l4-element-set-design.md`) now uses the portal's words. What 0.7 adds is
described where its code is:

- `packages/admin/README.md`: the workspace (pages, collections, conversation and presence, imports, Sources and the
  source editor, Council memory, moving into the repository), compose and deploy, and the read-only switch's classes.
- `docs/DATA-MODEL.md`: composed and deployed Systems, and the library receipts' `modified`.
- The schemas in `packages/admin/schemas/` (`collections`, `tasks`, `imports` are new) and `schemas/change-classes.json`.
- `docs/design/kms-house-gallery.html`: the house interface of the knowledge tools, kept because the federation map's
  layout cites it for its lengths.

## The process records

0.7 was built in lanes, as 0.6 was: the workspace (L6), compose and deploy (L7), the knowledge commons' house
interface and kms-admin, then the integration of those lanes and their walk, and last the reconcile with 0.6.1 and
0.6.2. Each had its own spec, plan, ledger or rulings log and review rounds. Those working records are not part of the
template. They were written against one team's instance and data, and the team that built 0.7 keeps them in its own
archive, beside 0.6's. Where shipped code or a kept document cited one of them, it now points here.

Kept in that archive:

- the track specs: the workspace (L6, 2026-10-30), compose and deploy (L7, 2026-10-30), the kms house interface
  (2026-10-29) and kms-admin (2026-10-31);
- the plans: the L6 and L7 implementation plans, the kms house interface plan, and the plan that brought the work into
  0.7;
- the ledgers and rulings logs: L6's and L7's rulings logs, the kms house interface and kms-admin ledgers, the
  integration ledgers, and the 0.7 ledger.

Code comments still cite rulings by number (`PF-R…` from the integration, `PR7-R…` from the reconcile). The numbers
are those ledgers' entries.

## Screenshots

0.7's own screenshots were left out, as 0.6's were: the kms-admin shots, and the kms gallery's comparison shots
(`docs/design/kms-gallery-shots/`, which `kms-house-gallery.html` still points at). They come back in a later release,
re-shot from the example fixtures. `kms-admin-gallery.html` and the fonts only it used are out with them.

The house record (`docs/design/house-record/`) ships: its door shot is replaced by `portal-1440-light.webp`, re-shot
from the example fixtures, and the record-weight check stays required.
