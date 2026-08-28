# Organizational OS Architecture

**Version:** 3.1  
**Date:** 2026-03-21  
**Status:** Production-Ready

---

## Complete System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ORGANIZATIONAL OS v3.1                               │
│              Complete Architecture — Knowledge Commons at Heart             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    KNOWLEDGE COMMONS LAYER                           │   │
│  │                    (The Memory & Nervous System)                     │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                      │   │
│  │  CAPTURE          STRUCTURE           DISTRIBUTE                       │   │
│  │  ┌──────┐        ┌──────────┐       ┌──────────┐                    │   │
│  │  │ OPAL │───────►│          │───────►│   KOI    │──► Network        │   │
│  │  │(omni)│        │knowledge/│       │(BlockSci)│                    │   │
│  │  └──────┘        │          │       └──────────┘                    │   │
│  │       │          ├──────────┤            ▲                          │   │
│  │       │          │domains/  │            │                          │   │
│  │  ┌────▼───┐      │patterns/ │      ┌────┴────┐                     │   │
│  │  │Egregore│──────►│insights/ │◄─────│Hub Sync │                     │   │
│  │  │(Curve) │        │entities/ │      │(weekly) │                     │   │
│  │  └────────┘      └──────────┘      └─────────┘                     │   │
│  │       │               ▲                                            │   │
│  │       └───────────────┴────────────────────────────────────────    │   │
│  │                       Human Review (critical decisions)               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              ↓                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    OPERATIONAL LAYER                               │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                      │   │
│  │  GOVERNANCE        OPERATIONS           COORDINATION                 │   │
│  │  ┌──────────┐     ┌──────────┐         ┌──────────┐                 │   │
│  │  │EIP-4824  │     │ Projects │         │ Meetings │                 │   │
│  │  │Stewards  │     │ (IDEA)   │         │  ( sync) │                 │   │
│  │  │Council   │     │ Funding  │         │ Council  │                 │   │
│  │  │ Elections│     │ Finances │         │  Calls   │                 │   │
│  │  └──────────┘     └──────────┘         └──────────┘                 │   │
│  │       │                │                     │                        │   │
│  │       └────────────────┴─────────────────────┘                        │   │
│  │                       ↓                                              │   │
│  │              ┌──────────────────┐                                    │   │
│  │              │ data/*.yaml     │  ← Single source of truth            │   │
│  │              │ members/         │                                    │   │
│  │              │ projects/        │                                    │   │
│  │              │ meetings/        │                                    │   │
│  │              └──────────────────┘                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              ↓                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    AGENT LAYER                                       │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                      │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │   │
│  │  │  Specialists │  │   Generalist │  │   Council    │             │   │
│  │  │   (4 Regen)  │  │  (super-agent)│  │   (coordinator)│             │   │
│  │  │              │  │              │  │              │             │   │
│  │  │• Agriculture│  │• Strategy   │  │• Facilitates │             │   │
│  │  │• Commons    │  │• Research   │  │• Decisions   │             │   │
│  │  │• Impact     │  │• Operations │  │• Alignment   │             │   │
│  │  │• Bioregional│  │• Creative   │  │              │             │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘             │   │
│  │                                                                      │   │
│  │  RUNTIMES: openclaw (DePIN) | cursor | claude | opencode            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              ↓                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    FEDERATION LAYER                                  │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                      │   │
│  │     HUB (regen-coordination-os)                                      │   │
│  │         │                                                            │   │
│  │    ┌────┴────────────────────────────────────────────────────────┐   │   │
│  │    ↓                                                              │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────┐│   │   │
│  │  │ refi-dao-os │  │ refi-bcn-os   │  │    NYC      │  │ Bloom││   │   │
│  │  │ (global)    │  │ (local)       │  │  (booting)  │  │(boot)││   │   │
│  │  │ Stewards    │  │ ESS bridge    │  │             │  │      ││   │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └──────┘│   │   │
│  │         ▲                │                                      │   │   │
│  │         └────────────────┘ (peer sync: DAO ↔ BCN)              │   │   │
│  │                                                                      │   │
│  │  SYNC FLOWS:                                                         │   │
│  │  • Skills: Hub → Nodes (Mondays)                                    │   │
│  │  • Knowledge: Nodes → Hub (Mondays 6am UTC)                         │   │
│  │  • Council: All nodes (Fridays 2pm UTC)                               │   │
│  │  • Peer: ReFi DAO ↔ ReFi BCN (bidirectional)                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              ↓                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    INTEGRATION LAYER                                 │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                      │   │
│  │  KNOWLEDGE      BLOCKCHAIN       COMMUNICATION      DEV             │   │
│  │  ┌──────────┐   ┌──────────┐    ┌──────────┐     ┌──────────┐     │   │
│  │  │ OPAL     │   │ Gardens  │    │ Telegram │     │ GitHub   │     │   │
│  │  │ Egregore │   │ Hats     │    │ Discord  │     │ Actions  │     │   │
│  │  │ KOI      │   │ Safe     │    │ Notion   │     │ TypeScript│     │   │
│  │  │          │   │ Celo     │    │          │     │ Node.js  │     │   │
│  │  └──────────┘   └──────────┘    └──────────┘     └──────────┘     │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  KEY PRINCIPLE:                                                     │   │
│  │                                                                       │   │
│  │  Knowledge Commons is the CENTER — everything flows through it:      │   │
│  │                                                                       │   │
│  │  • Decisions are captured → stored → distributed                       │   │
│  │  • Patterns are extracted → curated → shared                          │   │
│  │  • Agent learnings are reflected → aggregated → trained               │   │
│  │  • Cross-instance sync is knowledge-first                             │   │
│  │                                                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Layer Descriptions

### 1. Knowledge Commons Layer (Center)

**Purpose:** The memory and nervous system of the organization

**Components:**
- **Capture:** OPAL (omniharmonic), Egregore (Curve Labs), KOI (BlockScience)
- **Structure:** `knowledge/` directory with domains, patterns, insights, entities
- **Distribute:** KOI network for cross-instance sharing

**Flow:**
```
Content → AI Extraction → Human Review → Structured Storage → Network Distribution
```

---

### 2. Operational Layer

**Purpose:** Day-to-day organizational functions

**Components:**
- **Governance:** EIP-4824 compliance, Stewards Council elections
- **Operations:** Projects (IDEA framework), Funding, Finances
- **Coordination:** Meetings, Council calls

**Data:** All stored in `data/*.yaml` as single source of truth

---

### 3. Agent Layer

**Purpose:** AI assistance for organizational functions

**Components:**
- **Specialists (4 Regen):** Agriculture, Commons, Impact, Bioregional
- **Generalist (Super-Agent):** Strategy, Research, Operations, Creative
- **Council Coordinator:** Facilitates, decides, aligns

**Runtimes:** openclaw (DePIN), cursor, claude, opencode

---

### 4. Federation Layer

**Purpose:** Multi-instance coordination

**Topology:**
- **Hub:** regen-coordination-os (skill distribution, knowledge aggregation)
- **Nodes:** 9 pilot instances (refi-dao, refi-bcn, NYC, Bloom, etc.)
- **Peer Sync:** Bidirectional between ReFi DAO and ReFi BCN

**Sync Schedule:**
- Mondays: Skills distribution + Knowledge aggregation
- Fridays 2pm UTC: Council coordination

---

### 5. Integration Layer

**Purpose:** External tool connections

**Categories:**
- **Knowledge:** OPAL, Egregore, KOI
- **Blockchain:** Gardens DAO, Hats Protocol, Safe, Celo
- **Communication:** Telegram, Discord, Notion
- **Development:** GitHub Actions, TypeScript, Node.js

---

## Key Design Principles

1. **Knowledge-First:** All organizational learning flows through knowledge commons
2. **Human-in-the-Loop:** Critical decisions require human approval
3. **Git-Native:** Everything versioned, auditable, forkable
4. **Federated:** Local autonomy + network coordination
5. **AI-Augmented:** Agents handle routine, humans handle judgment

---

## File References

- Core: `federation.yaml`, `SOUL.md`, `AGENTS.md`
- Knowledge: `knowledge/INDEX.md`, `docs/integrations/*.md`
- Agents: `AGENTS.md`, `MASTERPLAN.md`, `skills/*/SKILL.md`
- Federation: `MEMBERS.md`, `docs/FEDERATION.md`

---

*Organizational OS v3.1 — Knowledge commons at the heart of regenerative coordination*
