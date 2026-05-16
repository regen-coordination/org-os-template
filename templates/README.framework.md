# {{ org.name }}{{#if org.tagline }} — {{ org.tagline }}{{/if}}

> {{ org.short_description }}

**Type:** Framework + orchestration hub · **Version:** {{ org.version }} · **Status:** {{ org.status }}

---

## What this is

`{{ org.name }}` is the canonical template + standards + orchestration hub for a federation of org-os instances. Downstream instances fork or sync from this repo. The framework itself is also an org-os instance (self-hosting since {{ org.bootstrap_date }}).

## Quick navigation

- **Operators:** `BOOTSTRAP.md` → guided onboarding for a new instance
- **Agents:** `AGENTS.md` → workspace startup protocol + memory model
- **Contributors:** `docs/FILE-STRUCTURE.md`, `docs/DATA-MODEL.md`, `docs/SKILL-PROMOTION.md`, `docs/PACKAGE-LIFECYCLE.md`
- **Operators of downstream instances:** `docs/OPERATOR-GUIDE.md`
- **Reliability + safety:** `docs/RELIABILITY.md`, `docs/VAULT-SAFETY.md`

## Who are you?

### You're an **operator** spinning up a new org

```bash
# Recommended: use the cloning engine (lands P10 of v3.5)
node scripts/clone-framework.mjs --target ../my-new-org --config config.yaml

# Or: interactive guided interview
npm run setup
```

See `BOOTSTRAP.md` for the full first-run sequence.

### You're a **contributor** to the framework

```bash
git clone <this-repo> && cd <repo>
npm install
npm run install:hooks    # pre-commit + advisory hooks
npm run selftest         # full reliability check
```

### You're an **agent** opening a session

Read `MASTERPLAN.md`, `SOUL.md`, `IDENTITY.md`, then run `/initialize`. See `AGENTS.md` for the deterministic startup sequence.

### You're a **visitor** evaluating org-os

Start with `SOUL.md` (mission + values), `IDENTITY.md` (what we are), and the [docs/](docs/) directory.

---

## Active downstream instances

{{#if federation.downstream}}
{{#each federation.downstream}}
- **{{ name }}** ({{ type }}) — {{ status }}
{{/each}}
{{/if}}

See `data/instances.yaml` for the authoritative registry. `npm run analyze:instances` for current drift state.

## Skills and packages

{{> cheatsheet }}

- **Skills:** {{ counts.skills }} total — see `SKILLS.md` and `data/skills-matrix.yaml`
- **Packages:** {{ counts.packages }} total — see `data/packages-matrix.yaml` + `docs/PACKAGE-LIFECYCLE.md`

## Documentation

{{#each docs}}
- [{{ title }}]({{ path }}) — {{ blurb }}
{{/each}}

## Requirements

- Node ≥22
- npm ≥10.9.2
- git

## License

MIT
