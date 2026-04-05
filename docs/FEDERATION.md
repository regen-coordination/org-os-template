# FEDERATION.md — Federation Protocol Specification

Version: 3.0

## Overview

Federation enables org-os instances to form networks — sharing knowledge, skills, and coordination across organizational boundaries. A federation is a set of org-os instances (nodes) that declare each other as peers, agree on shared domains, and exchange data through structured protocols.

The federation substrate is **Git**. Every org-os instance is a Git repository. Peers discover each other through `federation.yaml`, exchange knowledge through Git-based mechanisms (PRs, submodules, direct reads), and publish machine-readable schemas in `.well-known/`. For real-time synchronization, instances can optionally layer **koi-net** on top of the Git substrate.

Federation is opt-in, additive, and sovereignty-preserving. Each organization owns its data. Federation adds visibility, not control.

---

## federation.yaml v3.0 Specification

The federation manifest is the root configuration file for every org-os instance. It lives at the repository root as `federation.yaml`. All federation behavior derives from this file.

```yaml
version: "3.0"
spec: "organizational-os/3.0"
```

The `version` and `spec` fields must be present. Parsers use `spec` to determine which schema to validate against.

---

### identity

Declares who this instance is.

```yaml
identity:
  name: "ReFi DAO"
  type: "DAO"
  emoji: ""
  daoURI: "https://refidao.com/.well-known/dao.json"
  chain: "eip155:1"
  safe: "0x..."
  hats: null
  gardens: ""
  onchain_registration:
    enabled: false
    chain: ""
    contract_address: ""
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Human-readable organization name |
| `type` | enum | yes | One of: `DAO`, `Cooperative`, `Foundation`, `Project`, `LocalNode`, `Hub` |
| `emoji` | string | no | Visual identifier for dashboards and canvas layouts |
| `daoURI` | URL | recommended | Points to the EIP-4824 `dao.json` in `.well-known/` |
| `chain` | CAIP-2 | no | Primary chain identifier (e.g., `eip155:1` for Ethereum mainnet, `eip155:42220` for Celo) |
| `safe` | address | no | Gnosis Safe treasury address |
| `hats` | integer | no | Hats Protocol tree ID for role management |
| `gardens` | string | no | Gardens DAO contract address or status |
| `onchain_registration` | object | no | On-chain org registration (chain, contract address, enabled flag) |

The `type` field determines how other nodes interpret this instance. A `Hub` aggregates peers. A `LocalNode` operates within a geographic scope. A `DAO` or `Cooperative` has governance on-chain. A `Project` is a focused initiative. A `Foundation` is a supporting entity.

---

### Federation Network

Declares this instance's position in the network topology.

```yaml
network: "regen-coordination"
hub: "github.com/regen-coordination/hub"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `network` | string | recommended | Name of the federation network this instance belongs to |
| `hub` | URL | recommended | URL of the hub repository that aggregates network data |

---

### peers

Lists the other org-os instances this node knows about.

```yaml
peers:
  - name: "ReFi Barcelona"
    repo: "03 Libraries/ReFi-Barcelona"
    url: "https://github.com/org/repo"
    trust: "read"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Human-readable peer name |
| `repo` | string | yes | Path or slug to the peer repository (relative to workspace or GitHub) |
| `url` | URL | yes | Public URL of the peer |
| `trust` | enum | yes | One of: `full`, `read`, `none` |

**Trust levels:**

- `full` — Bidirectional sync. This node can push knowledge to the peer, and the peer can push back. Used between tightly coupled organizations.
- `read` — This node can read the peer's published data but does not push to it. The default for most federations.
- `none` — Peer is listed for reference but no automated exchange occurs.

---

### upstream

Declares the template or framework repository this instance inherits from.

```yaml
upstream:
  - type: "template"
    repository: "organizational-os-template"
    url: "https://github.com/regen-coordination/organizational-os-template"
    relationship: "fork"
    last_sync: "2026-03-06"
    sync_frequency: "monthly"
    remote_name: "upstream"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | enum | yes | `template` (inherits structure) or `framework` (inherits code + structure) |
| `repository` | string | yes | Repository name or path |
| `url` | URL | yes | Public URL |
| `relationship` | enum | yes | `fork` (direct descendant) or `reference` (uses as guide) |
| `last_sync` | date | no | ISO date of last upstream merge |
| `sync_frequency` | string | no | How often to sync: `weekly`, `monthly`, `quarterly` |
| `remote_name` | string | yes | Git remote name (typically `upstream`) |

To sync from upstream:

```bash
npm run sync:upstream
# or manually:
git fetch upstream && git merge upstream/main --no-commit
```

The `customizations` section (below) controls which files are preserved during upstream sync.

---

### downstream

Lists repositories that this instance feeds into. This includes hatched project repos that federate back to the parent organization.

```yaml
downstream:
  - name: "Regenerant Catalunya"
    repo: "03 Libraries/Regenerant-Catalunya"
    url: "https://regenerant.refibcn.cat"
    type: "hatched-project"
  - name: "Grants OS"
    repo: "luizfernandosg/grants-os"
    url: "https://github.com/luizfernandosg/grants-os"
    type: "tool"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Human-readable name |
| `repo` | string | yes | Repository path |
| `url` | URL | no | Public URL |
| `type` | string | no | Relationship type: `hatched-project`, `tool`, `node`, `fork` |

When an idea on the ideation board progresses to `project` status and gets its own repository, that repo should appear in `downstream` with `type: "hatched-project"`.

---

### agent

Configures the AI agent that operates this workspace.

```yaml
agent:
  runtime: "cursor"
  workspace: "."
  skills:
    - meeting-processor
    - funding-scout
    - knowledge-curator
    - capital-flow
    - schema-generator
    - heartbeat-monitor
    - ideation-curator
    - aggregator-indexer
    - system-canvas
  channels:
    - telegram
    - github
    - email
  proactive: true
  heartbeat_interval: "1h"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `runtime` | enum | yes | `openclaw`, `cursor`, `claude-code`, `custom`, `none` |
| `workspace` | path | yes | Root directory for the agent (`.` for repo root) |
| `skills` | list | yes | Skill identifiers available to this agent. Corresponds to files in `skills/` |
| `channels` | list | no | Communication channels the agent can use (telegram, github, email, google-meet, forum) |
| `proactive` | boolean | no | Whether the agent can initiate actions without being prompted |
| `heartbeat_interval` | duration | no | How often the agent checks `HEARTBEAT.md` and runs health checks |

Skills listed here must exist in the instance's `skills/` directory or be resolvable from the upstream template. See `docs/SKILL-SPECIFICATION.md` for the skill file format.

---

### knowledge-commons

Controls knowledge sharing with the federation network.

```yaml
knowledge-commons:
  enabled: true
  shared-domains:
    - "regenerative-finance"
    - "local-governance"
    - "bioregional-finance"
  sync-protocol: "git"
  publish:
    meetings: true
    projects: true
    funding: true
    knowledge: true
  subscribe:
    - "regen-coordination"
    - "refi-dao"
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enabled` | boolean | yes | Master switch for knowledge commons participation |
| `shared-domains` | list | yes | Topic domains this instance participates in |
| `sync-protocol` | enum | yes | `git` (pull-based via PRs/reads), `koi-net` (real-time push), `manual` (human-mediated) |
| `publish` | object | yes | What data types this instance makes available to peers |
| `subscribe` | list | yes | Peer names (matching `peers[].name` slugified) whose published data this instance consumes |

**Publish fields:**

- `meetings` — Meeting notes and summaries from `data/meetings.yaml`
- `projects` — Project status and descriptions from `data/projects.yaml`
- `funding` — Funding rounds and grant data from `data/funding.yaml`
- `knowledge` — Curated knowledge pages from `knowledge/`

When `enabled: true`, the knowledge-exchange package reads this config to determine what to publish (generate `.well-known/knowledge.json`) and what to pull from peers.

---

### integrations

Declares external repositories and tools this instance integrates with.

```yaml
integrations:
  agent_runtimes:
    - name: "openclaw"
      repo: "organizational-os/openclaw-source"
      url: "https://github.com/organizational-os/openclaw-source"
      role: "primary-runtime"
  knowledge_infrastructure:
    - name: "koi-net"
      repo: "organizational-os/koi-net"
      url: "https://github.com/organizational-os/koi-net"
      role: "real-time-sync"
    - name: "koi-net-integration"
      repo: "organizational-os/koi-net-integration"
      url: "https://github.com/organizational-os/koi-net-integration"
      role: "typescript-bridge"
  publishing:
    - name: "quartz-refi-template"
      repo: "organizational-os/quartz-refi-template"
      url: "https://github.com/organizational-os/quartz-refi-template"
      role: "documentation-site"
  grants:
    - name: "grants-os"
      repo: "luizfernandosg/grants-os"
      url: "https://github.com/luizfernandosg/grants-os"
      role: "grants-platform"
```

Each integration entry has `name`, `repo`, `url`, and `role`. Group them by function:

| Group | Purpose |
|-------|---------|
| `agent_runtimes` | AI agent backends (openclaw, eliza, etc.) |
| `knowledge_infrastructure` | Sync and indexing layers (koi-net) |
| `publishing` | Public-facing sites and documentation (quartz, websites) |
| `grants` | Grant tracking and management platforms |

Integrations are informational and used by the aggregator and system-canvas packages to render the full ecosystem map.

---

### packages

Declares which operational packages are enabled for this instance.

```yaml
packages:
  knowledge_base: true
  meetings: true
  projects: true
  finances: true
  coordination: true
  webapps: true
  web3: true
  # v2.0.0 packages
  ideation_board: true
  aggregator: true
  system_canvas: true
  knowledge_exchange: true
```

| Package | Description |
|---------|-------------|
| `knowledge_base` | Core knowledge management (data/*.yaml, .well-known/) |
| `meetings` | Meeting processing and schema generation |
| `projects` | Project tracking |
| `finances` | Treasury and financial data |
| `coordination` | Multi-org coordination workflows |
| `webapps` | Web application deployment |
| `web3` | On-chain integrations (Safe, Hats, Gardens) |
| `ideation_board` | Community idea submission and lifecycle (v2.0.0) |
| `aggregator` | Cross-repo data aggregation from peers (v2.0.0) |
| `system_canvas` | Visual system map / Obsidian canvas generation (v2.0.0) |
| `knowledge_exchange` | Structured knowledge publishing and consumption (v2.0.0) |

Set a package to `false` to disable it. The setup wizard (`npm run setup`) toggles these interactively.

---

### customizations

Lists files and directories that should be preserved when syncing from upstream.

```yaml
customizations:
  - path: "SOUL.md"
    reason: "Organization-specific values and mission"
    type: "addition"
    maintain_on_sync: true
  - path: "data/"
    reason: "Operational data"
    type: "addition"
    maintain_on_sync: true
  - path: "skills/"
    reason: "Organization-specific skills"
    type: "addition"
    maintain_on_sync: true
```

| Field | Type | Description |
|-------|------|-------------|
| `path` | string | File or directory path relative to repo root |
| `reason` | string | Why this customization exists |
| `type` | enum | `addition` (new file not in upstream), `override` (replaces upstream file), `modification` (extends upstream file) |
| `maintain_on_sync` | boolean | If `true`, `npm run sync:upstream` will not overwrite this path |

This is critical for upstream sync safety. Without customizations entries, an upstream merge could overwrite organization-specific files.

---

### governance

Describes how decisions are made for this instance.

```yaml
governance:
  maintainers:
    - name: "Core Stewards"
      role: "owner"
    - name: "Giulio Quarta"
      role: "maintainer"
  decision_model: "consensus"
  proposal_threshold: "Consent-based with objection window"
```

| Field | Type | Description |
|-------|------|-------------|
| `maintainers` | list | People or groups with `owner` or `maintainer` role |
| `decision_model` | enum | `consensus`, `voting`, `hierarchical`, `delegated` |
| `proposal_threshold` | string | Human-readable description of what's required to approve changes |

The governance section is informational. It tells agents and operators who has authority over the instance and how changes should be proposed.

---

### platforms

Where this instance is hosted and deployed.

```yaml
platforms:
  primary: "github"
  deployment: "github-pages"
  domain: "refibcn.cat"
  mirrors:
    - "https://regenerant.refibcn.cat"
```

| Field | Type | Description |
|-------|------|-------------|
| `primary` | string | Primary platform: `github`, `gitlab`, `gitea` |
| `deployment` | string | Deployment target: `github-pages`, `railway`, `vercel`, `self-hosted` |
| `domain` | string | Primary domain |
| `mirrors` | list | Additional URLs where this instance's content is published |

---

### metadata

Timestamps and version tracking.

```yaml
metadata:
  created: "2026-03-06"
  last_updated: "2026-03-06"
  framework_version: "3.0"
```

| Field | Type | Description |
|-------|------|-------------|
| `created` | date | When this federation manifest was first created |
| `last_updated` | date | Last modification date |
| `framework_version` | string | org-os framework version this manifest conforms to |

---

## Federation Roles

Instances in a federation network take on different roles based on their `identity.type` and position in the network topology.

### Hub

The hub is the aggregation point for a federation network. It maintains a registry of all nodes, collects published data from peers, and serves as the coordination surface.

Responsibilities:
- Maintains `nodes.yaml` — a registry of all known nodes with their status, type, and federation URLs
- Runs the aggregator package to index data from all peers
- Publishes a unified `.well-known/` surface covering the entire network
- Coordinates cross-org initiatives

A federation has exactly one hub. The hub URL is declared in every peer's `federation.yaml` under the `hub` field.

### Peer / Node

A standard org-os instance that participates in a network. Most instances are peers. A peer:
- Declares the hub in its `federation.yaml`
- Lists other peers it exchanges knowledge with
- Publishes its own `.well-known/` schemas
- Subscribes to relevant domains from other peers

### Resource Library

A specialized node (`type: "Foundation"` or similar) that curates knowledge for consumption by other instances. A resource library:
- Focuses on the `knowledge_exchange` package
- Publishes structured knowledge pages in `knowledge/` organized by domain
- Has a rich `knowledge-manifest.yaml` with collections and export configuration
- Other instances' aggregators pull from it

### Downstream / Hatched Project

When an idea on an instance's ideation board progresses to its own repository, that repo becomes a downstream node. It:
- Has its own `federation.yaml` with `upstream` pointing to the parent org
- Appears in the parent's `downstream` list
- Can federate back knowledge and status to the parent
- May be lightweight (fewer packages enabled)

---

## Knowledge Exchange Protocol

Knowledge exchange is the primary value of federation. It allows organizations to share curated knowledge across boundaries while maintaining data sovereignty.

### Publishing (producer side)

1. **Create knowledge pages.** Write Markdown files in `knowledge/<domain>/`, where `<domain>` matches a `shared-domains` entry. Example:

   ```
   knowledge/
     regenerative-finance/
       token-engineering-patterns.md
       impact-measurement-frameworks.md
     local-governance/
       cooperative-bylaws-template.md
   ```

2. **Declare in knowledge-manifest.yaml.** The manifest in `data/knowledge-manifest.yaml` lists collections, their sources, and export configuration:

   ```yaml
   knowledge-commons:
     name: "ReFi DAO Knowledge Commons"
     domains:
       - regenerative-finance
       - network-coordination
     collections:
       - id: "blog-articles"
         source: "data/blog-articles.yaml"
         count: 12
         last_processed: "2026-04-01"
       - id: "podcast-episodes"
         source: "data/podcast-episodes.yaml"
         count: 8
         last_processed: "2026-04-01"
     exports:
       - domain: "regenerative-finance"
         subscribers:
           - "regen-coordination"
           - "refi-bcn"
         format: "markdown+yaml"
         frequency: "weekly"
   ```

3. **Generate the .well-known/knowledge.json schema.** The knowledge-exchange package reads `knowledge/` and `data/knowledge-manifest.yaml` to produce `.well-known/knowledge.json`:

   ```json
   {
     "@context": "https://www.daostar.org/schemas",
     "type": "KnowledgeCommons",
     "publisher": "ReFi DAO",
     "domains": ["regenerative-finance", "network-coordination"],
     "collections": [
       { "domain": "regenerative-finance", "pages": 11 }
     ],
     "generated": "2026-04-04T23:15:30.214Z"
   }
   ```

### Subscribing (consumer side)

1. **Declare subscriptions.** In `federation.yaml`, list peer names under `knowledge-commons.subscribe`.

2. **Resolve peer repos.** The federation-sync module resolves subscription names to peer repository paths using the `peers` list:

   ```js
   // federation-sync.mjs resolves subscriber → peer repo
   subscribers: kc.subscribe.map(sub => ({
     name: sub,
     repo: peers.find(p => p.name.toLowerCase().includes(sub))?.repo
   }))
   ```

3. **Pull knowledge.** Depending on `sync-protocol`:
   - **git**: Read the peer's `knowledge/` directory and `.well-known/knowledge.json` directly (if repos share a workspace) or via Git submodule / clone.
   - **koi-net**: Subscribe to the peer's koi-net node for real-time knowledge events. The koi-net integration translates org-os knowledge into KOI protocol RIDs.
   - **manual**: Human-mediated — operator reviews peer knowledge and copies relevant pages.

### Sync mechanisms in detail

**Git-based sync (default)**

The simplest approach. Works when instances share a Git workspace (monorepo), are submodules, or can be cloned alongside each other.

```bash
# If peer is in same workspace:
ls ../refi-dao-os/knowledge/regenerative-finance/

# If peer is a separate repo:
git clone https://github.com/org/peer-os /tmp/peer-os
cp /tmp/peer-os/knowledge/regenerative-finance/*.md knowledge/incoming/
```

The aggregator package automates this: it reads `federation.yaml`, resolves peer paths, and indexes their published content.

**koi-net sync (real-time)**

For organizations that need real-time knowledge propagation. Requires deploying a koi-net node alongside the org-os instance.

```yaml
# In federation.yaml
knowledge-commons:
  sync-protocol: "koi-net"
```

The koi-net integration package (`packages/knowledge-exchange/`) bridges org-os data to koi-net RIDs. When a knowledge page is created or updated, it emits a koi-net event. Subscribing nodes receive the event and update their local index.

Federation members in koi-net have trust levels (`core`, `trusted`, `public`) that determine access:

| Trust Level | Can Read | Can Write | Rate Limits |
|-------------|----------|-----------|-------------|
| `core` | public + federated data | public + federated data | 1000 queries/min |
| `trusted` | public data | public data | 100 queries/min |
| `public` | public data | nothing | 10 queries/min |

See `koi-net-integration/network/federation.yaml` for the full koi-net federation configuration including sharing policies, data sovereignty rules, and security settings.

---

## Skill Sharing Protocol

Skills are operational capabilities defined as files in `skills/`. Federation enables skill propagation across the network.

### How skills flow

1. **Framework to instance (upstream sync).** The org-os template defines base skills (meeting-processor, funding-scout, knowledge-curator, etc.). When an instance syncs from upstream, it receives new or updated skills unless the `skills/` path is in `customizations` with `maintain_on_sync: true`.

2. **Hub to peers (skill broadcast).** The hub can publish new skills. Peers discover them by reading the hub's `skills/` directory during aggregation. Operators decide whether to adopt the skill by adding it to their `agent.skills` list.

3. **Peer to peer (manual sharing).** An organization develops a custom skill (e.g., `cooperative-ops` for ReFi BCN). Other peers can copy it into their own `skills/` directory and add it to their `agent.skills` list.

### Skill discovery

Skills are listed in `federation.yaml` under `agent.skills`. The aggregator indexes all peer skill lists to build a network-wide skill catalog. This appears in the system canvas as a visual skill map.

### Adding a shared skill

```bash
# 1. Copy skill from peer
cp ../refi-bcn-os/skills/cooperative-ops.md skills/

# 2. Add to federation.yaml
# agent:
#   skills:
#     - cooperative-ops

# 3. Validate
npm run validate:schemas
```

---

## .well-known/ Discovery Convention

Every org-os instance publishes machine-readable JSON schemas in `.well-known/` at the repository root. This follows the EIP-4824 convention for DAO URIs and extends it to cover all org-os data types.

### Standard schemas

| File | Description | Source |
|------|-------------|--------|
| `dao.json` | EIP-4824 DAO URI — identity, governance, proposals | `data/members.yaml`, `data/governance.yaml` |
| `members.json` | Member registry | `data/members.yaml` |
| `meetings.json` | Meeting records | `data/meetings.yaml` |
| `projects.json` | Project registry | `data/projects.yaml` |
| `finances.json` | Treasury and financial data | `data/finances.yaml` |
| `proposals.json` | Governance proposals | `data/governance.yaml` |
| `contracts.json` | Smart contract addresses | `data/contracts.yaml` |
| `activities.json` | Activity feed | Aggregated from other schemas |

### v2.0.0 schemas

| File | Description | Source |
|------|-------------|--------|
| `ideas.json` | Ideation board — ideas, proposals, projects | `data/ideas.yaml` |
| `knowledge.json` | Knowledge commons manifest | `knowledge/`, `data/knowledge-manifest.yaml` |

### Discovery flow

1. An instance declares its `daoURI` in `identity.daoURI` (e.g., `https://refidao.com/.well-known/dao.json`).
2. A peer or external tool fetches that URL to discover the organization.
3. The `dao.json` links to other schemas. The peer can then fetch `members.json`, `projects.json`, etc.
4. For federation specifically, a peer reads `knowledge.json` to discover what knowledge domains are available and how many pages exist.

### Generating schemas

```bash
npm run generate:schemas    # Reads data/*.yaml, writes .well-known/*.json
npm run validate:schemas    # Validates all generated schemas
```

Templates for schemas live in `.well-known/*.json.template`. The schema generator fills them with data from `data/*.yaml` files.

### Schema format

All schemas follow the DAOstar context:

```json
{
  "@context": "https://www.daostar.org/schemas",
  "type": "SchemaType",
  ...
  "generated": "2026-04-04T23:15:30.214Z"
}
```

---

## Hatched Repo Federation

The ideation board package manages an idea lifecycle: `idea` -> `proposal` -> `project` -> `archived`. When an idea reaches `project` status and warrants its own repository, it becomes a **hatched repo**.

### Hatching process

1. An idea in `data/ideas.yaml` reaches `project` status with `linked_project` pointing to a project ID.
2. The operator creates a new repository for the project. This can be a fresh org-os instance (run `npm run setup`) or a lightweight repo.
3. The new repo's `federation.yaml` lists the parent org as `upstream`:

   ```yaml
   upstream:
     - type: "template"
       repository: "refi-dao-os"
       url: "https://github.com/org/refi-dao-os"
       relationship: "fork"
       remote_name: "parent"
   ```

4. The parent org adds the new repo to its `downstream` list:

   ```yaml
   downstream:
     - name: "Regenerant Catalunya"
       repo: "03 Libraries/Regenerant-Catalunya"
       type: "hatched-project"
   ```

5. The hatched repo's `.well-known/` schemas are indexed by the parent's aggregator, keeping the parent org informed of the project's progress.

### Federation back to parent

A hatched repo can publish knowledge back to its parent through the standard knowledge exchange protocol. If the parent subscribes to the hatched repo (listed in `knowledge-commons.subscribe`), knowledge flows bidirectionally.

This creates a virtuous cycle: the parent org generates ideas, the best ones hatch into projects, and those projects feed knowledge back into the parent's commons.

---

## Configuration Walkthrough

To set up federation for a new org-os instance from scratch:

### 1. Run the setup wizard

```bash
npm run setup
```

This interactively configures `federation.yaml` with your identity, network, and package selections.

### 2. Declare your identity

Fill in the `identity` section. At minimum, set `name` and `type`. If you have on-chain governance, add `chain`, `safe`, and `daoURI`.

### 3. Join a network

Set `network` to the federation network name and `hub` to the hub URL. Ask the hub maintainer to add your instance to their `nodes.yaml`.

### 4. Add peers

List the org-os instances you want to exchange data with under `peers`. Set `trust: "read"` for standard read access.

### 5. Configure knowledge commons

Enable knowledge commons and list your shared domains. Set `publish` flags for the data types you want to share. Add peer names to `subscribe` for data you want to consume.

### 6. Enable packages

Turn on the packages you need. The v2.0.0 packages (`ideation_board`, `aggregator`, `system_canvas`, `knowledge_exchange`) require additional setup — see the package-specific READMEs.

### 7. Generate and validate

```bash
npm run generate:schemas
npm run validate:schemas
```

### 8. Commit and push

Your instance is now federated. Peers can discover you through your `.well-known/` schemas, and you can start exchanging knowledge.

---

## Reference: Minimal federation.yaml

A minimal valid federation manifest for a new instance joining an existing network:

```yaml
version: "3.0"
spec: "organizational-os/3.0"

identity:
  name: "My Organization"
  type: "Project"

network: "regen-coordination"
hub: "github.com/regen-coordination/hub"

peers:
  - name: "Hub"
    repo: "regen-coordination/hub"
    url: "https://github.com/regen-coordination/hub"
    trust: "read"

upstream:
  - type: "template"
    repository: "organizational-os-template"
    url: "https://github.com/regen-coordination/organizational-os-template"
    relationship: "fork"
    remote_name: "upstream"

downstream: []

agent:
  runtime: "none"
  workspace: "."
  skills:
    - meeting-processor
    - schema-generator
  channels: []
  proactive: false
  heartbeat_interval: "1h"

knowledge-commons:
  enabled: false
  shared-domains: []
  sync-protocol: "git"
  publish:
    meetings: false
    projects: false
    funding: false
  subscribe: []

packages:
  knowledge_base: true
  meetings: false
  projects: false
  finances: false
  coordination: false
  webapps: false
  web3: false

customizations:
  - path: "SOUL.md"
    reason: "Organization-specific values"
    type: "addition"
    maintain_on_sync: true
  - path: "data/"
    reason: "Operational data"
    type: "addition"
    maintain_on_sync: true

governance:
  maintainers:
    - name: "Team"
      role: "owner"
  decision_model: "consensus"
  proposal_threshold: "Consensus required"

platforms:
  primary: "github"
  deployment: "github-pages"
  domain: ""
  mirrors: []

metadata:
  created: ""
  last_updated: ""
  framework_version: "3.0"
```

From here, enable features incrementally as needed.
