# Funding registry — `data/funding.yaml` → `.well-known/funding.json`

An instance that runs pools, gives money or has open calls can publish them about itself.
`npm run generate:schemas` writes `.well-known/funding.json` when `data/funding.yaml` exists.

```yaml
org: { id: refi-bcn, name: ReFi Barcelona }
pools:
  - { id: local-round-1, name: Local Round 1, rule: direct, started: 2026-09-01 }
flows:
  - id: grant-001
    type: contribution          # or pledge
    pool: local-round-1
    to: { name: Project A, url: https://example.org, addresses: ["0x…"] }
    amount_usd: 1500
    date: 2026-09-20
    evidence: https://example.org/tx/…
calls:
  - { id: open-1, title: Local regen grants, url: https://…, closes: 2026-11-30, call_type: philanthropic }
```

Only these fields are published. Never list individual donors: the generator does not copy them.
co-fund reads the file and shows the records as self-published by the instance.

Entries that would make the file invalid are skipped, with a `⚠` warning naming each: a flow needs
`id`, `type` (`contribution` or `pledge`), `date` and `to.name`; a pool needs `id` and `name` (and
`rule`, if given, is one of `matching`, `direct`, `retro`, `stream`, `other`); a call needs `id`,
`title` and `call_type` (`web3`, `public`, `philanthropic`, `civic`). With no org id and name (in
the file or in `federation.yaml` identity) nothing is written.

An instance needs `scripts/lib/funding-registry.mjs` alongside `scripts/generate-all-schemas.mjs`.
