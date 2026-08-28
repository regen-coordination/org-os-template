# Organizational OS Commands

**Quick reference for all org-os commands**

---

## 🚀 Core Commands

### `/initialize` — Set Up Your Organization

**Purpose**: Initial setup of your Organizational OS instance

```bash
npm run setup
```

**What it does**:

- Guides you through organization setup (interactive)
- Collects organizational identity information
- Asks for organization type (DAO, Cooperative, Project, etc.)
- Lets you select operational packages (meetings, projects, finances, etc.)
- Generates EIP-4824 compliant schemas
- Sets up Cursor AI rules (optional)

**When to use**: First time setting up your org-os instance

**Tips**:

- Read `SOUL.md` and `IDENTITY.md` before running if you have organizational docs ready
- You can re-run setup anytime to update configuration

---

### `/sync` — Sync Local Changes to GitHub

**Purpose**: Synchronize your local workspace with GitHub without needing git knowledge

```bash
# Interactive menu (default)
npm run sync

# Specific commands
npm run sync -- status    # Check what changed
npm run sync -- pull      # Get latest from GitHub
npm run sync -- push      # Commit and push your changes
npm run sync -- full      # Full sync (pull → status → commit → push)
npm run sync -- help      # Show command help
```

#### What Each Option Does

**Status** - See what has changed

```bash
npm run sync -- status
```

Shows:

- Modified files
- New files awaiting commit
- Files ready to push

**Pull** - Get latest changes from GitHub

```bash
npm run sync -- pull
```

Use this when:

- Someone else made updates to the repository
- You're starting your work day
- You want the latest version before making changes

**Push** - Commit and send your changes

```bash
npm run sync -- push
```

Process:

1. Shows you what changed
2. Asks permission to stage all changes
3. Asks for a commit message
4. Sends changes to GitHub

**Full Sync** - Complete synchronization workflow

```bash
npm run sync -- full
```

Best for end-of-day or before starting work:

1. ⬇️ Pulls latest changes from GitHub
2. 📊 Shows what you've changed locally
3. 💾 Asks if you want to commit & push
4. 🚀 Sends everything to GitHub

#### Interactive Mode (Default)

```bash
npm run sync
```

Presents a menu:

```
What would you like to do?
  📊 Check status
  ⬇️  Pull changes
  🚀 Push changes
  🔄 Full Sync
  📚 Help
```

#### Common Workflows

**Starting work**:

```bash
npm run sync -- pull      # Get latest changes
npm run sync -- status    # See current state
```

**Ending work**:

```bash
npm run sync -- full      # Pull, see status, commit, push
```

**Quick push**:

```bash
npm run sync -- push      # Stage, commit, push
```

**Just checking**:

```bash
npm run sync -- status    # What changed locally?
```

---

### `/generate:schemas` — Generate EIP-4824 Schemas

**Purpose**: Create organizational identity schemas from data files

```bash
npm run generate:schemas
```

**What it does**:

- Reads your `data/members.yaml`, `data/projects.yaml`, etc.
- Generates EIP-4824 compliant `.well-known/` schemas
- Creates `dao.json`, `members.json`, `proposals.json`, etc.

**When to use**: After updating any `data/` files

**Tips**:

- Run this before pushing changes to GitHub
- Check that schemas are valid before deployment

---

### `/validate:schemas` — Check Schema Compliance

**Purpose**: Verify your organization schemas are valid

```bash
npm run validate:schemas
```

**What it checks**:

- Schema format compliance
- Required fields
- Data type validation
- EIP-4824 standard conformance

**When to use**: Before deploying or publishing schemas

---

## 🔄 Additional Commands

### `/sync:upstream` — Sync with Template Updates

```bash
npm run sync:upstream
```

Pulls latest updates from the organizational-os template repository.

Use when:

- New template features are released
- You want upstream improvements
- Template bug fixes are available

---

### `/clone:repos` — Clone Linked Repositories

```bash
npm run clone:repos
```

Clones repositories defined in `repos.manifest.json`.

**Options**:

```bash
npm run clone:repos                    # Clone all repos
node scripts/clone-linked-repos.mjs --dry-run  # Preview without cloning
```

---

### `/bootstrap:local` — Full Local Setup

```bash
npm run bootstrap:local
```

Complete bootstrap: clones repos + installs all dependencies.

Use when setting up for the first time or after major updates.

---

## 📋 Helper Commands

### Check Code Quality

```bash
npm run check              # Type check and format check
npm run format             # Auto-format all code
```

---

### Build Documentation

```bash
npm run docs               # Build and serve Quartz docs locally
```

Access at `http://localhost:3000` after running.

---

### Paperclip Integration

```bash
npm run paperclip          # Run Paperclip app dev server
npm run paperclip:server   # Run Paperclip backend server
npm run paperclip:build    # Build Paperclip UI
```

---

## 💡 Usage Tips

### For GitHub Beginners

If you're new to git and GitHub, use these commands:

```bash
# At start of day
npm run sync -- full

# Throughout day
npm run sync -- status

# At end of day
npm run sync -- push      # or: npm run sync -- full
```

### Commit Message Guidelines

Use clear, descriptive messages:

- ✅ Good: `"Add new team members and update meeting notes"`
- ✅ Good: `"Update project status and deliverables"`
- ❌ Vague: `"Update files"`
- ❌ Vague: `"Changes"`

### If Something Goes Wrong

1. **Lost in git state?**

   ```bash
   npm run sync -- status    # Check what's happening
   ```

2. **Conflicting changes?**

   ```bash
   npm run sync -- pull      # Get latest
   # Manually resolve conflicts in your editor
   npm run sync -- push      # Re-commit after fixing
   ```

3. **Need to undo?**
   ```bash
   npm run sync -- help      # Review what you're about to do
   ```

---

## 🔗 See Also

- **Setup Guide**: [`SETUP.md`](SETUP.md)
- **Operator Guide**: [`OPERATOR-GUIDEBOOK.md`](OPERATOR-GUIDEBOOK.md)
- **EIP-4824 Standard**: [`EIP4824-GUIDE.md`](EIP4824-GUIDE.md)
- **Package Guide**: [`PACKAGES.md`](PACKAGES.md)

---

## Getting Help

- Review command help: `npm run sync -- help`
- Check GitHub Issues: https://github.com/organizational-os/organizational-os-template/issues
- Ask in Discussions: https://github.com/organizational-os/organizational-os-template/discussions
