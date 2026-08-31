# TOOLS.md — Local Tool Notes

_Skills define how tools work. This file is for your specifics — the setup unique to this node. Never put credentials here — reference where they're stored._

---

## API Endpoints

_(Self-hosted or custom services)_

```markdown
### Safe Transaction Service

- Gnosis Chain: https://safe-transaction-gnosis.gateway.gnosis.io
- Ethereum: https://safe-transaction-mainnet.gnosis.io

### RPC Nodes

- Gnosis Chain: https://rpc.gnosis.gateway.fm
- Ethereum: https://eth.llamarpc.com
```

---

## Communication Channels

_(Channel IDs, group names, bot handles — no tokens here)_

```markdown
### Telegram

- Council group: @[council_group_handle]
- Public group: @[public_group_handle]
- Bot handle: @[bot_username]

### GitHub

- Org: github.com/[org-name]
- Hub: github.com/regen-coordination/hub

### Buzz

- Relay: `https://luizfernando.communities.buzz.xyz` (operator's hosted Buzz community, HTTP
  REST — graduated 2026-08-29, DECISIONS.md "Buzz lane graduated"). The local compose relay
  (`http://localhost:3000`, `~/tools/buzz/deploy/compose/run.sh`) is the dev sandbox; its
  channel `3344f08a-5f68-4c7e-8499-bcbe0bfb22ff` holds the lane's day-one archive log.
- Channel: `org-os-dev` → UUID `5f255182-b310-4516-aef0-3b3c67a232ef` (the CLI takes the UUID,
  never the name; resolve via `buzz channels list`)
- Agent npub: `npub16pl9y5zxuq5fujfqan6n34m42x5qarl8emkea3nvytm97egjdduqy39kdn`, display name
  `org-os`. The private key never goes here — only in `.env` as `BUZZ_PRIVATE_KEY`.
- Hosted community members (2026-08-29): the operator
  (`npub1xand5ypq4sas58fp5036qma4p00ue6k9am6cjg3x3npc64tuvw2s6ujpnr`, owner) + this agent +
  the hub agent `lf-hub` (`npub1xly7vdccs5ranvn09t7l5py4unnw6xdk3shx9gyul69336k55vxsuvxdz2`),
  both added via the community Members → "add directly" dialog (invite links don't work for
  headless agents — see the runbook).
- Verification trail: `packages/buzz-integration/VERIFIED.md` (status: **VERIFIED**, 2026-08-29 —
  the CLI surface in `lib/buzz.mjs` was reconciled against the real `buzz` binary and a live
  local relay)
```

---

## On-Chain Addresses

_(Quick reference — canonical source is IDENTITY.md)_

```markdown
### Gnosis Safe

- Primary: 0x... (Gnosis Chain, 2-of-3)
- Operational: 0x... (Ethereum mainnet)

### Governance

- Hats Tree: [tree-id]
- Gardens DAO: 0x...
```

---

## Node Infrastructure

_(Where this node runs — no passwords, just references)_

```markdown
### Agent Runtime

- Runtime: openclaw | cursor | none
- Host: depin | vps | local
- Workspace path: /opt/[org]/workspace

### Monitoring

- Uptime check: [URL or note]
```

---

## Notion Integration

_(Configure Notion API for richer dashboard data in `/initialize`)_

```markdown
### Configuration

- API Key env var: NOTION_API_KEY
- Workspace URL: https://notion.so/[workspace-name]

### Database IDs

- Projects: [32-char-database-id]
- Tasks: [32-char-database-id]
- Meetings: [32-char-database-id]
- Members: [32-char-database-id]

### Page URLs

- Dashboard: https://notion.so/[page-id]
- Heartbeat: https://notion.so/[page-id]
```

_Set `NOTION_API_KEY` as an environment variable (never in this file). Database IDs are found in Notion URLs: `notion.so/workspace/[database-id]?v=...`. The `/initialize` command uses these to fetch live data from Notion and merge it with local YAML/markdown files._

---

## Funding Platform Accounts

_(Which platforms we have active presence on)_

```markdown
### Active Platforms

- Artisan: [profile URL]
- Octant: [project URL]
- Superfluid: [campaign URL]
- Karma Gap: [project URL]
```

---

_Skills are shared across deployments. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure._
