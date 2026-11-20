# org-os-needs-offers

An org-os-kms extension pack (needs kms >= 0.2.0). Two types, `need` and `offer`, each with a **required** `visibility`:
`private`, `matching-only` or `public`. Only `public` can ever be published; `matching-only` stays in the private canon
(the floor lives in kms core, `src/visibility.mjs`; this pack only declares data).

- `pack.yaml` — `visibility_gated: true`, `publish_requires`, `public_fields`, `shared_lexicon` (Task 6).
- The field list is a **placeholder**, redone when the shared lexicon is agreed (kms plan Task 6, Step 6).
- Opt in: `kms.yaml` `extensions: [org-os-needs-offers]` and `publish.types_opt_in: [need, offer]`.
- Test: `node --test` in this directory.
