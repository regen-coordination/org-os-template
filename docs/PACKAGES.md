# Organizational OS Package Registry

> **Deprecated.** The conceptual package registry below is superseded by
> [`docs/MODULES.md`](MODULES.md) — the v0.5 module catalog — and by the module system design in
> [`2026-08-02-org-os-v5-modularization-design.md`](superpowers/specs/2026-08-02-org-os-v5-modularization-design.md).
> Kept for reference until the v5 tranche has manifests. For the *lifecycle* of npm packages
> (which is a different thing from modules), see [`PACKAGE-LIFECYCLE.md`](PACKAGE-LIFECYCLE.md).

**Version:** 1.0.0  
**Date:** 2026-03-21  
**Applies to:** org-os v3.1+

---

## Available Packages

| Package | Status | Purpose | AI-Enhanced | Complexity |
|---------|--------|---------|-------------|------------|
| **knowledge_base** | ✅ Enabled by default | Core documentation and memory | Optional | Low |
| **meetings** | 🆓 Optional | Meeting management, action items | Recommended | Low |
| **projects** | 🆓 Optional | Project tracking with IDEA framework | Recommended | Medium |
| **finances** | 🆓 Optional | Budget and expense tracking | Optional | Medium |
| **coordination** | 🆓 Optional | Multi-org coordination tools | Recommended | Medium |
| **webapps** | 🆓 Optional | Interactive operational tools | Optional | High |
| **web3** | 🆓 Optional | Blockchain features (Safe, Hats, etc.) | Optional | High |
| **egregore** | 🆓 Optional | AI memory layer for team coordination | ✅ Required | Medium |

Legend: ✅ = required for function, 🆓 = optional, ❌ = not available

---

## Package Details

### knowledge_base

**Status:** ✅ Enabled by default  
**Type:** Core

**What it provides:**
- Base directory structure (`docs/`, `knowledge/`, `memory/`)
- Template files (SOUL.md, IDENTITY.md, AGENTS.md)
- Schema infrastructure (EIP-4824)
- Git-based versioning

**Cannot be disabled** — This is the foundation of org-os.

**Files:**
- `SOUL.md` — Mission, values, voice
- `IDENTITY.md` — Organization identity
- `AGENTS.md` — Agent runtime contract
- `MEMORY.md` — Long-term organizational memory
- `HEARTBEAT.md` — Active tasks and health checks
- `docs/` — Documentation directory
- `knowledge/` — Knowledge base directory
- `memory/` — Daily log directory
- `.well-known/` — EIP-4824 schemas

---

### meetings

**Status:** 🆓 Optional  
**Type:** Operational

**What it provides:**
- Meeting note templates
- Action item tracking
- Attendee management
- Decision logging
- `meetings.json` schema output

**Enable with:**
```bash
npm run setup
# → Select "meetings" from packages
```

Or manual:
```yaml
# federation.yaml
packages:
  meetings: true
```

**Files added:**
- `packages/operations/meetings/` — Templates and workflows
- `data/meetings.yaml` — Meeting registry
- `.well-known/meetings.json` — Schema output

**AI Enhancement:**
- Agents can parse meeting notes
- Auto-extract action items
- Auto-generate `meetings.json`

---

### projects

**Status:** 🆓 Optional  
**Type:** Operational

**What it provides:**
- Project tracking with IDEA framework
- Status workflows (IDEA: Initiate → Develop → Execute → Assess)
- Budget allocation
- Team assignment
- `projects.json` schema output

**Enable with:**
```bash
npm run setup
# → Select "projects" from packages
```

Or manual:
```yaml
# federation.yaml
packages:
  projects: true
```

**Files added:**
- `packages/operations/projects/` — Templates
- `data/projects.yaml` — Project registry
- `.well-known/projects.json` — Schema output

**AI Enhancement:**
- Agents track project status
- Auto-generate status reports
- Cross-reference with meetings

---

### finances

**Status:** 🆓 Optional  
**Type:** Operational

**What it provides:**
- Budget tracking
- Expense logging
- Treasury overview
- Payout management
- `finances.json` schema output

**Enable with:**
```bash
npm run setup
# → Select "finances" from packages
```

Or manual:
```yaml
# federation.yaml
packages:
  finances: true
```

**Files added:**
- `packages/operations/finances/` — Templates
- `data/finances.yaml` — Financial registry
- `.well-known/finances.json` — Schema output

**Security Note:**
- Financial data is sensitive — consider repo privacy
- On-chain treasuries tracked separately (see web3 package)

---

### coordination

**Status:** 🆓 Optional  
**Type:** Network

**What it provides:**
- Multi-organization coordination
- Federation tools
- Cross-org task tracking
- Council governance support
- Network topology management

**Enable with:**
```bash
npm run setup
# → Select "coordination" from packages
```

Or manual:
```yaml
# federation.yaml
packages:
  coordination: true
```

**Files added:**
- `packages/operations/coordination/` — Templates
- Enhanced `federation.yaml` features
- Network-specific schemas

**Use Cases:**
- Hub-and-spoke networks (e.g., Regen Coordination)
- Consortium governance
- Cross-DAO collaboration

---

### webapps

**Status:** 🆓 Optional  
**Type:** Interface

**What it provides:**
- Interactive operational tools
- Web-based dashboards
- API endpoints for data
- Real-time collaboration features

**Enable with:**
```bash
npm run setup
# → Select "webapps" from packages
```

Or manual:
```yaml
# federation.yaml
packages:
  webapps: true
```

**Files added:**
- `packages/webapps/` — Web application code
- Deployment configurations
- API schemas

**Technical:**
- React/Vue-based interfaces (configurable)
- Fastify/Express backends
- WebSocket support for real-time

---

### web3

**Status:** 🆓 Optional  
**Type:** Infrastructure

**What it provides:**
- Blockchain integration (Safe, Hats, Gardens, etc.)
- On-chain identity (EIP-4824)
- Treasury management
- Smart contract interaction

**Enable with:**
```bash
npm run setup
# → Select "web3" from packages
```

Or manual:
```yaml
# federation.yaml
packages:
  web3: true
```

**Files added:**
- `packages/web3/` — Web3 utilities
- Contract ABIs and addresses
- Transaction templates

**Security Note:**
- Private keys stored in `TOOLS.md` (gitignored)
- Multi-sig preferred for treasuries
- Test on testnets first

**Chains Supported:**
- Ethereum mainnet
- Gnosis Chain
- Celo
- Polygon
- Others via configuration

---

### egregore

**Status:** 🆓 Optional  
**Type:** AI Memory Layer

**What it provides:**
- Shared AI memory across sessions and team members
- Git-based knowledge persistence
- `/reflect`, `/handoff`, `/quest` commands
- Works with Claude Code (native) and OpenCode (via adapter)

**Enable with:**
```bash
npm run setup
# → Choose path: "Egregore-assisted" (auto-enables)
# Or manually select "egregore" from packages
```

Or manual:
```yaml
# federation.yaml
packages:
  egregore: true

# Add submodule
git submodule add https://github.com/Curve-Labs/egregore-core.git packages/egregore-core
```

**Files added:**
- `packages/egregore-core/` — Egregore submodule
- `packages/egregore-core/opencode-adapter/` — OpenCode compatibility
- `egregore-memory/` — Git repo for AI memory (gitignored)

**Runtimes Supported:**
| Runtime | Support | Command Style |
|---------|---------|---------------|
| Claude Code | ✅ Native | `/reflect`, `/handoff` |
| OpenCode | ✅ Via adapter | `/ask "Reflect: ..."` |
| Cursor | ⚠️ Partial | File-based only |
| OpenClaw | ✅ Compatible | Git-based memory |

**See Also:**
- `docs/SETUP-PATHS.md` — Path selection guide
- `packages/egregore-core/README.md` — Egregore details
- `packages/egregore-core/opencode-adapter/README.md` — OpenCode setup

---

## Package Combinations

### Minimal Setup
```yaml
packages:
  knowledge_base: true  # Always enabled
  meetings: false
  projects: false
  finances: false
  coordination: false
  webapps: false
  web3: false
  egregore: false
```
**Use case:** Documentation-only, simple governance

### Standard Operations
```yaml
packages:
  knowledge_base: true
  meetings: true
  projects: true
  finances: true
  coordination: false
  webapps: false
  web3: false
  egregore: false
```
**Use case:** Most organizations, human-operated

### AI-Enhanced Team
```yaml
packages:
  knowledge_base: true
  meetings: true
  projects: true
  finances: true
  coordination: true
  webapps: false
  web3: false
  egregore: true
```
**Use case:** Teams using AI assistants, async-heavy

### Full Stack (DAO)
```yaml
packages:
  knowledge_base: true
  meetings: true
  projects: true
  finances: true
  coordination: true
  webapps: true
  web3: true
  egregore: true
```
**Use case:** Full DAO infrastructure, high complexity

---

## Adding Custom Packages

### Package Structure

To add a custom package:

1. **Create package directory:**
```bash
mkdir packages/your-package
```

2. **Add package.yaml metadata:**
```yaml
# packages/your-package/package.yaml
name: "your-package"
version: "1.0.0"
description: "What this package does"
type: "custom"  # operational | interface | infrastructure | custom
dependencies: []  # Other packages required
ai_enhanced: false  # Does this require AI to function?

files:
  - path: "templates/"
    description: "Templates directory"
  - path: "README.md"
    description: "Package documentation"

installation:
  script: "./install.sh"  # Optional install script
  post_setup: "echo 'Package installed'"
```

3. **Enable in federation.yaml:**
```yaml
packages:
  your-package: true
```

4. **Document in this file** (PR to org-os if widely useful)

---

## Package Versioning

### Versioning Scheme

Packages follow semantic versioning:
- **Major:** Breaking changes (e.g., schema format change)
- **Minor:** New features, backward compatible
- **Patch:** Bug fixes, documentation updates

### Updating Packages

```bash
# Check for updates
npm run check:updates

# Update a specific package
npm run update:package egregore

# Update all packages
npm run update:packages
```

### Pinning Versions

To pin a package version:
```yaml
# federation.yaml
packages:
  egregore: "1.2.3"  # Pin to specific version
```

---

## Troubleshooting

### "Package not found after setup"
- Check: `cat federation.yaml | grep <package>`
- Check: Does the package directory exist? `ls packages/`
- Fix: Re-run `npm run setup` and select the package

### "Schema generation failing for package"
- Check: Is the package properly installed?
- Check: Run `npm run validate:schemas` for errors
- Fix: Check package documentation for dependencies

### "Want to disable a package"
```yaml
# Edit federation.yaml
packages:
  meetings: false  # Was: true
```
Or re-run `npm run setup`.

### "Package dependencies missing"
Some packages require others:
- `web3` often needs `finances` for treasury tracking
- `coordination` benefits from `meetings` for council calls

Check package documentation for dependency notes.

---

## References

- **Setup Script:** `scripts/setup-org-os.mjs`
- **Federation Spec:** `federation.yaml`
- **Setup Paths:** `docs/SETUP-PATHS.md`
- **Egregore Package:** `packages/egregore-core/README.md`

---

*Choose your packages. Build your stack.*
