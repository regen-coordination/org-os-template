# Setup Guide

**Complete guide to setting up your Organizational OS workspace**

## Prerequisites

- Node.js v22 or higher
- npm v10.9.2 or higher
- Git
- GitHub account

## Step 1: Fork the Template

1. Go to the `organizational-os-template` repository
2. Click **Fork** to create your own copy
3. Clone your repository locally:

```bash
git clone https://github.com/your-org/your-repo.git
cd your-repo
```

### Optional: Set Up Upstream Sync

```bash
git remote add upstream https://github.com/organizational-os/organizational-os-template.git
git remote -v
```

## Step 2: Run Setup Script

```bash
npm install
npm run setup
```

The setup script will:
- Ask for organizational type (DAO, Cooperative, Project, etc.)
- Collect organizational identity information
- Let you select operational packages
- Configure federation manifest
- Generate initial `.well-known/` schemas
- Set up Cursor rules

## Step 3: Configure Organizational Identity

Edit `federation.yaml` to ensure all information is correct:

```yaml
identity:
  daoURI: "https://your-org.com/.well-known/dao.json"
  type: "Organization"
  name: "Your Organization Name"
```

## Step 4: Add Members

Edit `data/members.yaml` to add organization members:

```yaml
members:
  - id: "eip155:1:0x1234abcd"
    name: "Member Name"
    role: "member"
    joined: "2026-01-01"
```

## Step 5: Generate Schemas

```bash
npm run generate:schemas
```

This generates all EIP-4824 compliant schemas in `.well-known/` directory.

## Step 6: Configure Deployment

### GitHub Pages (Default)

1. Go to repository Settings → Pages
2. Select source: GitHub Actions
3. Save

### Custom Domain (Optional)

1. Create `quartz/static/CNAME` file:
   ```
   yourdomain.com
   ```
2. Configure DNS:
   - Add CNAME record: `yourdomain.com` → `your-org.github.io`

## Step 7: Deploy

```bash
git add .
git commit -m "Initial Organizational OS setup"
git push origin main
```

GitHub Actions will automatically build and deploy your workspace.

## Step 8: Verify

1. Visit your deployed site
2. Check `.well-known/dao.json` is accessible
3. Verify all schema URIs work
4. Test task manager webapp (if enabled)

## Post-Setup Configuration

### Enable Operational Packages

Edit `federation.yaml` to enable packages:

```yaml
packages:
  meetings: true
  projects: true
  finances: true
  coordination: true
  webapps: true
```

### Set Up GitHub Actions

The template includes GitHub Actions workflows:
- **Deploy**: Automatically deploys on push to main
- **Generate Schemas**: Auto-generates schemas on data changes

### Configure Cursor Rules

```bash
npm run setup:cursor
```

This generates Cursor rules for AI-assisted development.

## Troubleshooting

### Build Errors

- Check Node.js version: `node --version` (should be v22+)
- Clear cache: `rm -rf .quartz-cache node_modules`
- Reinstall: `npm install`

### Schema Generation Errors

- Ensure data files exist: `data/members.yaml`, `data/projects.yaml`, etc.
- Check YAML syntax is valid
- Run validation: `npm run validate:schemas`

### Deployment Issues

- Check GitHub Actions logs
- Verify `baseUrl` in `federation.yaml` matches your domain
- Ensure GitHub Pages is enabled

## Next Steps

- **Read Operator Guidebook**: [`OPERATOR-GUIDEBOOK.md`](OPERATOR-GUIDEBOOK.md)
- **Explore Packages**: [`PACKAGES.md`](PACKAGES.md)
- **Understand EIP-4824**: [`EIP4824-GUIDE.md`](03%20Libraries/org-os/docs/EIP4824-GUIDE.md)
- **See Framework**: [`../../organizational-os/packages/framework/`](../../organizational-os/packages/framework/)

## Getting Help

- Check [GitHub Issues](https://github.com/organizational-os/organizational-os-template/issues)
- Ask in [Discussions](https://github.com/organizational-os/organizational-os-template/discussions)
- Review [Framework Documentation](../../organizational-os/packages/framework/docs/)
