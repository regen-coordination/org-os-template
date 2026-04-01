# Organizational OS Template

**GitHub-based operational workspace template with EIP-4824 compliance**

> This repository is a standalone mirror of `packages/template` in the canonical [organizational-os monorepo](https://github.com/regen-coordination/organizational-os). For active development, use the monorepo.

Transform your GitHub repository into a complete operational workspace for your organization (DAO, cooperative, nonprofit, project). Built on EIP-4824/DAOstar standards for organizational identity and interoperability.

---

## Quick Start

### 1. Fork This Template

```bash
# Fork this repository on GitHub, then clone
git clone https://github.com/your-org/your-repo.git
cd your-repo
```

### 2. Run Setup

```bash
npm install
npm run setup
```

The setup script will:
- Collect organizational identity information
- Configure EIP-4824 schemas
- Let you select operational packages
- Generate initial `.well-known/` schemas
- Set up Cursor rules

### 3. Deploy

```bash
git add .
git commit -m "Initial Organizational OS setup"
git push origin main
```

GitHub Actions will automatically deploy to GitHub Pages.

---

## Local clone workspace (visible `repos/` folder)

To clone/update linked ecosystem repositories into a visible local `repos/` directory:

```bash
pnpm run clone:repos
```

If you prefer npm:

```bash
npm run clone:repos
```

Bootstrap local setup (clone repos + install dependencies):

```bash
pnpm run bootstrap:local
```

Dry run preview:

```bash
node scripts/clone-linked-repos.mjs --dry-run
```

Linked repositories are defined in `repos.manifest.json`.

---

## Features

### Organizational Identity (EIP-4824)

- **daoURI**: Main organizational identity document
- **membersURI**: Membership registry
- **proposalsURI**: Governance proposals
- **governanceURI**: Governance documentation
- **contractsURI**: Smart contract registry
- **Extended schemas**: Meetings, Projects, Finances

### Operational Packages

- **Meetings**: Meeting management, notes, action items
- **Projects**: Project tracking with IDEA framework
- **Finances**: Budget and expense tracking
- **Coordination**: Multi-organization coordination tools

### Knowledge Base

- **Quartz-based**: Markdown documentation system
- **Searchable**: Full-text search
- **Linked**: Internal linking and cross-references
- **Publishable**: Deploy to GitHub Pages

### Interactive Webapps

- **Task Manager**: View and manage tasks
- **Budget Calculator**: Financial planning tools
- **Stakeholder Map**: Relationship visualization
- **Timeline Planner**: Project timeline visualization

---

## Documentation

- **[Setup Guide](03%20Libraries/org-os/docs/SETUP.md)** - Complete setup instructions
- **[Operator Guidebook](docs/OPERATOR-GUIDEBOOK.md)** - How to operate your workspace
- **[EIP-4824 Guide](03%20Libraries/org-os/docs/EIP4824-GUIDE.md)** - Standards compliance guide
- **[Packages](docs/PACKAGES.md)** - Package documentation

---

## Framework Reference

This template implements the **[Organizational OS Framework](../organizational-os/packages/framework/)**:

- Standards and patterns: [`../organizational-os/packages/framework/docs/`](../organizational-os/packages/framework/docs/)
- Schema definitions: [`../organizational-os/packages/framework/schemas/`](../organizational-os/packages/framework/schemas/)
- Case studies: [`../organizational-os/packages/framework/docs/06-case-studies/`](../organizational-os/packages/framework/docs/06-case-studies/)

---

## Requirements

- Node.js v22+
- npm v10.9.2+
- Git
- GitHub account

---

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

*Built with 💚 by the Regen Coordination community*
