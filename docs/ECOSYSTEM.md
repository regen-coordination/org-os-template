# Organizational OS Ecosystem Registry

**Complete registry of linked repositories with types, relationships, and descriptions.**

This document is machine-readable for agents navigating the ecosystem. See [ECOSYSTEM-MAP.md](https://github.com/luizfernandosg/Zettelkasten/blob/main/03%20Libraries/ECOSYSTEM-MAP.md) in the Zettelkasten vault for the aggregated overview.

---

## Standards Layer

| Repo | Type | Relationship | Description |
|------|------|--------------|-------------|
| [organizational-os-framework](https://github.com/luizfernandosg/organizational-os-framework) | Standards | This repo | Defines workspace file system, skills, agents, federation protocol, schemas |

---

## Template Layer

| Repo | Type | Relationship | Description |
|------|------|--------------|-------------|
| [organizational-os-template](https://github.com/luizfernandosg/organizational-os-template) | Template | Primary implementation | Fork + run setup; operational workspace with skills, memory, EIP-4824 |
| [quartz-refi-template](../../quartz-refi-template/) | Template | Documentation base | Quartz-based site template; upstream for ReFi websites |

---

## Agent Runtimes

| Repo | Type | Relationship | Description |
|------|------|--------------|-------------|
| [openclaw-source](../../openclaw-source/) | Runtime | Primary | Agent runtime for org-os workspaces; AgentSkills-compatible |
| [regen_eliza-refi_dao](../../regen_eliza-refi_dao/) | Runtime | Alternative | ElizaOS-based ReFi agent ecosystem |

---

## DAO Layer

| Repo | Type | Relationship | Description |
|------|------|--------------|-------------|
| [dao-os](https://github.com/luizfernandosg/dao-os) | Framework | Extends template | Visual DAO composer, on-chain modules (Safe, Hats, Gardens) |
| [grants-os](https://github.com/luizfernandosg/grants-os) | Platform | Peer to dao-os | Multi-stakeholder grants management |
| [ecosystem-canvas](https://github.com/luizfernandosg/ecosystem-canvas) | Library | Shared dependency | React Flow visualization; used by dao-os, grants-os |

---

## Knowledge Infrastructure

| Repo | Type | Relationship | Description |
|------|------|--------------|-------------|
| [koi-net](../../koi-net/) | Protocol | Python package | KOI-NET protocol implementation |
| [koi-net-integration](../../koi-net-integration/) | Bridge | TypeScript + Python | Integration layer for real-time knowledge sync in federation |

---

## Federation Hub

| Repo | Type | Relationship | Description |
|------|------|--------------|-------------|
| [regen-coordination-hub](../../regen-coordination-hub/) | Hub | Coordinates nodes | Federation hub for Regen Coordination network |

---

## Implementation Nodes

| Repo | Type | Relationship | Description |
|------|------|--------------|-------------|
| [Regenerant-Catalunya](../../Regenerant-Catalunya/) | Program Node | Downstream of hub | Bioregional funding program; ReFi BCN |
| [Local-ReFi-Toolkit](../../Local-ReFi-Toolkit/) | Resource Node | Downstream of hub | Playbooks, case studies, frameworks for local ReFi nodes |
| [ReFi-BCN-Website](../../ReFi-BCN-Website/) | Website Node | Quartz site | ReFi Barcelona public presence |
| [ReFi-DAO-Website](../../ReFi-DAO-Website/) | Website Node | Quartz site | ReFi DAO public presence |
| [ReFi-Mediterranean](../../ReFi-Mediterranean/) | Website Node | Quartz site | ReFi Mediterranean network |
| [ReFi-Barcelona](../../ReFi-Barcelona/) | Website | Quartz site | ReFi Barcelona knowledge base |

---

## Content and Tools

| Repo | Type | Relationship | Description |
|------|------|--------------|-------------|
| [regen-toolkit](../../regen-toolkit/) | Content | Educational | Interconnected ReFi knowledge |
| [regen-toolkit-interface](../../regen-toolkit-interface/) | App | Depends on regen-toolkit | React interface for regen toolkit |
| [becoming-constellations](../../becoming-constellations/) | Knowledge Garden | Quartz | Philosophical knowledge garden |
| [refi-vision-forum-posts](../../refi-vision-forum-posts/) | Content | Comms | Strategic vision posts for ReFi DAO, Regen Coordination |

---

## Integration Patterns

### Framework → Template → Node

```
organizational-os-framework (defines standards)
    → organizational-os-template (implements standards)
        → Regenerant-Catalunya, Local-ReFi-Toolkit, [node workspaces]
```

### Agent Runtime on Workspace

```
organizational-os-template (workspace)
    ← openclaw-source (runs on workspace)
```

### Federation Coordination

```
regen-coordination-hub (hub)
    ← Regenerant-Catalunya, Local-ReFi-Toolkit, ReFi BCN (nodes)
```

### Knowledge Sync

```
koi-net (protocol) → koi-net-integration (bridge) → regen-coordination-hub (sync)
```
