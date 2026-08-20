# VERSION.md — org-os Version Tracking

This document tracks the semantic version of the organizational OS framework and deployed instances.

---

## Current Version

**Framework Version:** `1.0.0`  
**Released:** 2026-04-02  
**Status:** Stable

---

## Version Format

This project uses **Semantic Versioning 2.0.0** ([semver.org](https://semver.org/)):

```
MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]
```

- **MAJOR**: Breaking changes to core architecture, schemas, or data structures
- **MINOR**: New features, new skills, non-breaking enhancements
- **PATCH**: Bug fixes, documentation updates, minor improvements
- **PRERELEASE**: Alpha/beta versions (e.g., `1.1.0-alpha.1`)
- **BUILD**: Instance-specific metadata (e.g., `+local-deployment-2026-04-02`)

---

## What Triggers Version Changes

### MAJOR Changes (e.g., 1.0.0 → 2.0.0)

- Breaking changes to `IDENTITY.md`, `SOUL.md`, or `AGENTS.md` structure
- Changes to EIP-4824 schema compatibility
- Significant federation protocol changes
- Memory system or data structure overhauls

### MINOR Changes (e.g., 1.0.0 → 1.1.0)

- New skills added to `skills/`
- New operational workflows in `packages/operations/`
- New agent coordination patterns
- New federation capabilities
- Non-breaking enhancements to agent instructions

### PATCH Changes (e.g., 1.0.0 → 1.0.1)

- Bug fixes in scripts, agent behavior, or workflows
- Documentation improvements
- Performance optimizations
- Security patches

---

## Instance Versioning

Each deployed instance tracks:

1. **Framework Version**: Which org-os version it's based on
2. **Instance Version**: Local customizations and deployments (format: `framework-version+instance-tag`)

Example instance versions:

- `1.0.0+refi-bcn-2026-04-01` — ReFi BCN node running framework 1.0.0
- `1.0.1+regen-hub-2026-04-02` — Regen Hub with patch applied

---

## Release Schedule

- **Stable releases**: Monthly or as-needed for significant features
- **Patch releases**: As-needed for critical fixes
- **Pre-releases**: Available in branches for testing

---

## Version History

| Version | Date       | Type   | Notes                                            |
| ------- | ---------- | ------ | ------------------------------------------------ |
| 1.0.0   | 2026-04-02 | Stable | Initial framework release with core architecture |

---

## How to Update Your Instance Version

### Option 1: Manual Update

Edit `package.json` and `VERSION.md` to reflect your version:

```bash
# Update framework version in package.json
npm version minor  # or patch, major

# Add entry to CHANGELOG.md
# Update this VERSION.md
```

### Option 2: Automated Script (coming)

```bash
npm run version:update -- minor --instance-tag=my-instance
```

### Option 3: Add Build Metadata

To track a specific deployment without changing version numbers:

```bash
# In your instance, add build metadata
# (Keep original version, add instance tag)
git tag -a v1.0.0+my-deployment-2026-04-02
```

---

## Viewing Version Info

From any org-os instance:

```bash
# See framework version
cat package.json | grep '"version"'

# See instance version (if set in memory/IDENTITY.md)
cat IDENTITY.md | grep -i version

# See all releases
git tag -l
```

---

## Downstream Instances

If you've forked org-os:

1. **Keep `VERSION.md`** — Track your instance against framework
2. **Update `package.json` version** — Reflect your customizations
3. **Log in `CHANGELOG.md`** — Document your local changes
4. **Sync with upstream** — Reference parent framework version in `federation.yaml`

Example:

```yaml
# federation.yaml
upstream:
  org-os-framework:
    version: "1.0.0"
    repository: "https://github.com/organizational-os/organizational-os-template"
    last_sync: "2026-04-02"
```

---

## Breaking Changes

Breaking changes are documented clearly:

1. Added to **CHANGELOG.md** under "Breaking Changes"
2. Include **migration guide** in the same section
3. Published in **release notes** for new MAJOR versions
4. Announced on `federation.yaml` update

---

_This file is maintained by operators and agents to track framework and instance versions. Update VERSION.md when releasing new versions._
