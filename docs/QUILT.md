# org-os · QUILT

> A [QUILT-protocol](https://wibandwob.com/quiltprotocol/) visualization of the org-os system —
> modules, integrations, and federation, shaded by live status.
>
> Woven **2026-07-19** · framework **v3.5** · branch `v0.5` · hand-crafted (Phase A);
> `scripts/generate-quilt.mjs` (Phase B) will re-weave this from `data/*.yaml`.

## Legend

```
status   █ live · ▓ moving · ▒ forming · ░ latent · ☓ needs attention
stitches → flow · ↔ sync · ⊕ promotion · ≡ correspondence · ∴ therefore
         » points-to-next · ◉ hub · ✓ verified · ∅ never · ? open question
```

Status is mapped from each registry's native vocabulary: instance maturity
(`production/beta/alpha`), package `lifecycle_status`, skill `promotion_status`,
project stage (`Develop/Discovery`), and drift flags from `data/instances.yaml`.

## Master — the loom

```
╭─ CORE █ ─────────────────╮ ╭─ DATA ≡ SCHEMAS ─────────╮ ╭─ SKILLS ─────────────────╮
│ MASTERPLAN ▓ mandate     │ │ data/*.yaml ×16 █        │ │ skills/ ×33 dirs         │
│  ├ SOUL      █ values    │ │  projects instances      │ │ █ ×31 canonical          │
│  ├ IDENTITY  █ org       │ │  skills-matrix pkgs …    │ │ ▓ ×2  evaluating         │
│  ├ USER      █ operator  │ │    │ generate:schemas    │ │ ▒ ×5  candidates ⊕       │
│  ├ MEMORY    █ decisions │ │    ▼ validate ✓          │ │ + 2 instance-owned       │
│  ├ HEARTBEAT █ 36 open   │ │ .well-known/ EIP-4824 █  │ │ promote: ▒ → ▓ → █       │
│  └ TOOLS     █ endpoints │ │ yaml is the truth,       │ │ skills are the verbs     │
│ memory/ ▓ last 3d ago    │ │ schemas are the face     │ │                          │
│ the spine of the agent   │ │                          │ │                          │
╰──────────────────────────╯ ╰──────────────────────────╯ ╰──────────────────────────╯
              ∴                            ↕                            ⊕
╭─ AUTOMATION █ ───────────╮ ╭─ FEDERATION ◉ ───────────╮ ╭─ PACKAGES ───────────────╮
│ scripts/ ×24 mjs · hooks │ │    bcn █       dao █     │ │ packages/ ×13 · matrix 22│
│ initialize → dashboard   │ │       ╲         ╱        │ │ █ kms stack · 144 ✓      │
│ generate ⇄ validate      │ │ med ▒ ─── ◉ ─── rgc ▓    │ │ █ operations trio        │
│ sync-upstream ↔ spokes   │ │       ╱         ╲        │ │ ▓ hermes · opencode      │
│ analyze → drift report   │ │ bread ▒        dao-os ▓  │ │ ░ koi/opal bridges ×3    │
│ clone-framework → birth  │ │      openclaw ▒          │ │ ☓ paperclip fork ahead   │
│ the metabolic loop       │ │ hub ↔ 7 · drift ☓7       │ │ ▒⊕ dashboard governance  │
│                          │ │ 2 networks · v3.5 core   │ │                          │
╰──────────────────────────╯ ╰──────────────────────────╯ ╰──────────────────────────╯
              ↑                            ↔                            »
╭─ INTERFACES ─────────────╮ ╭─ INTEGRATIONS ───────────╮ ╭─ PROJECTS ───────────────╮
│ claude-code CLI █        │ │ github █ sync · clone    │ │ ×11 active workstreams   │
│ obsidian vault █ (hub)   │ │ notion █ cli + sync      │ │ ▓ ×4 develop:            │
│ zed/acp ▓ · hermes ▓     │ │ koi ▓ regen-koi mcp      │ │  v2-stab · federation    │
│ opencode plugin ▓        │ │ hermes ▓ runtime         │ │  orchestr · skill-promo  │
│ web dashboard ░ scoped   │ │ opal ░ rollout planned   │ │ ▒ ×7 discovery:          │
│ canvas ▒ · non-tech ▒    │ │ eip-4824 ≡ dao.json █    │ │  onboard pkgs reliab     │
│ many doors, one house    │ │ where the world plugs in │ │  bootstrap opal ifaces   │
│                          │ │                          │ │  evolution » autopoiesis │
╰──────────────────────────╯ ╰──────────────────────────╯ ╰──────────────────────────╯
```

#orgos-loom · yaml-truth ≡ schema-face · skills⊕packages travel hub↔spokes ∴ autopoietic weave

## Federation — the web

```
╭─ REFI-BCN █ ─────────────╮ ╭─ REFI-DAO █ ─────────────╮ ╭─ REGEN-COORD ▓ ──────────╮
│ LocalNode · production   │ │ DAO · production         │ │ Hub · beta               │
│ net refi-dao · spoke     │ │ net regen-coord · hub    │ │ net regen-coord          │
│ pkgs ×4 · skills +2      │ │ pkgs ×9 · governance █   │ │ pkgs ×12 · koi/opal      │
│ initialize.mjs +800 ⊕?   │ │ gardens + karma wired    │ │ paperclip fork ahead ☓   │
│ sync 2026-03-19          │ │ sync 2026-03-06          │ │ sync 2026-04-24          │
│ drift ✓ none             │ │ drift ✓ none             │ │ drift ☓3 structural      │
│ coop-in-formation, bcn   │ │ global refi coordination │ │ regen ecosystem ops      │
╰──────────────────────────╯ ╰──────────────────────────╯ ╰──────────────────────────╯
╭─ REFI-MED ▒ ─────────────╮ ╭─ ORG-OS ◉ HUB ───────────╮ ╭─ DAO-OS ▓ ───────────────╮
│ LocalNode · alpha        │ │ framework v3.5 · v0.5    │ │ Project · beta           │
│ net refi-dao · spoke     │ │   bcn ─╮      ╭─ dao     │ │ dev-platform, not org    │
│ scaffolded from v3.0     │ │   med ─┼─ ◉ ─┼─ rgc      │ │ DAO-module skills ⊕5     │
│ identity stubs · TBD     │ │ bread ─╯      ╰─ dao-os  │ │ safe hats gardens karma  │
│ sync 2026-04-28          │ │      openclaw ~          │ │ sync 2026-04-02          │
│ drift ✓ none             │ │ sync-upstream ↔ analyze  │ │ drift ☓ no masterplan    │
│ bootstrap pending        │ │ template + standards     │ │ the module forge         │
╰──────────────────────────╯ ╰──────────────────────────╯ ╰──────────────────────────╯
╭─ BREAD-COOP ▒ ───────────╮ ╭─ OPENCLAW ▒ ─────────────╮ ╭─ SYNC LEDGER ────────────╮
│ Cooperative · alpha      │ │ AgentRuntime · alpha     │ │ last contact → 07-19     │
│ net regen-coord · spoke  │ │ not a data instance —    │ │ bread   2mo  ▓           │
│ acceptance-test instance │ │ the agent substrate      │ │ rgc     3mo  ▓           │
│ born of clone-framework  │ │ other instances invoke   │ │ med     3mo  ▓           │
│ sync 2026-05-16          │ │ sync ∅ never             │ │ dao-os  3.5mo ▒          │
│ drift ✓ · no remote yet  │ │ drift ☓3 stub identity   │ │ bcn     4mo  ▒           │
│ proof the loom works     │ │ a body without an org    │ │ dao     4.5mo ▒          │
│                          │ │                          │ │ claw    ∅    ░           │
╰──────────────────────────╯ ╰──────────────────────────╯ ╰──────────────────────────╯
```

#federation-web · 2 production anchors ↔ hub · 3 forming ▒ · drift ☓7 watched, not feared

## Packages — the travelers

```
╭─ KMS STACK █ ────────────╮ ╭─ OPS TRIO █ ─────────────╮ ╭─ HOST HOOKS ▓ ───────────╮
│ toolkit-framework █      │ │ operations █             │ │ hermes-integration ▓     │
│  semantic kernel         │ │ regen-agents █           │ │  org_os_page auto-tool   │
│  22 schemas · 100/100 ✓  │ │ webapps █                │ │ opencode-integration ▓   │
│ org-os-kms █ 44/44 ✓     │ │ active in bcn + dao —    │ │  2 tools · 5 commands    │
│  binds toolkit → org-os  │ │ the working muscle of    │ │ evaluating — awaiting    │
│ regen-toolkit uses it,   │ │ both production nodes    │ │ instance adoption signal │
│ refi-dao adopting        │ │                          │ │                          │
╰──────────────────────────╯ ╰──────────────────────────╯ ╰──────────────────────────╯
╭─ BRIDGES ░ ──────────────╮ ╭─ MATRIX ×22 ─────────────╮ ╭─ PAPERCLIP ☓ ────────────╮
│ koi-bridge ░ dormant     │ │ lifecycle:               │ │ paperclip-agents-app     │
│ koi-opal-bridge ░        │ │  █ active   15           │ │ rgc fork is AHEAD:       │
│ opal-bridge ░ planned    │ │  ░ dormant   5           │ │  org-os-bridge subpkg    │
│  » opal-rollout project  │ │  ░ planned   2           │ │  memory/skill syncers    │
│ wired, not yet warm      │ │ promotion:               │ │  sqlite migrations       │
│                          │ │  canonical 13 · eval 4   │ │ backport review pending  │
│                          │ │  ⊕ candidate 1 · local 4 │ │ the student outran us    │
│                          │ │ owner: fw 13 · inst 9    │ │                          │
╰──────────────────────────╯ ╰──────────────────────────╯ ╰──────────────────────────╯
╭─ CANDIDATES ⊕ ───────────╮ ╭─ DAO-OS FORGE ───────────╮ ╭─ HOMEBOUND ──────────────╮
│ dashboard ⊕ bcn+dao      │ │ connectors · core        │ │ maps · bcn geo-view      │
│  » fw-dashboard-templ    │ │ safe hats gardens        │ │ hub · dao public bridge  │
│ governance ▓ dao         │ │ karma eip-4824           │ │ coop · rgc capture pwa   │
│ coordination ▓ dao       │ │ platform-specific —      │ │ regen-toolkit · content  │
│ promotion is how the     │ │ its SKILLS promote ⊕,    │ │ patterns promote,        │
│ federation learns        │ │ not its code             │ │ products stay home       │
╰──────────────────────────╯ ╰──────────────────────────╯ ╰──────────────────────────╯
```

#package-loom · kms spine tested ✓ · bridges sleep ░ · paperclip fork ☓ teaches upstream

## Skills — the garden

```
╭─ LIFECYCLE █ ────────────╮ ╭─ SUPERPOWERS █ ──────────╮ ╭─ ORG-OPS █ ──────────────╮
│ initialize █ dashboard   │ │ ×9 vendored █            │ │ heartbeat-monitor █      │
│ org-os-init █ protocol   │ │ brainstorm · plans ×2    │ │ meeting-processor █      │
│ bootstrap-interviewer █  │ │ tdd · debugging          │ │ funding-scout █          │
│ commands █ (generated)   │ │ worktrees · reviews      │ │ idea-scout █             │
│ open ∴ work ∴ close      │ │ subagent-driven dev      │ │ capital-flow ▓ eval      │
│                          │ │ discipline as skill      │ │ the org daily verbs      │
╰──────────────────────────╯ ╰──────────────────────────╯ ╰──────────────────────────╯
╭─ KNOWLEDGE █ ────────────╮ ╭─ PIPELINE ⊕ ─────────────╮ ╭─ BUILDERS █ ─────────────╮
│ knowledge-curator █      │ │ skills-matrix ×40        │ │ skill-creator █          │
│ research █ (reconciled   │ │ instance-local  ×2       │ │ mcp-builder █            │
│  from 3 instance forks)  │ │   ▼ candidate   ×5       │ │ frontend-design █        │
│ web-browsing █           │ │   ▼ evaluating  ×2       │ │ artifacts-builder █      │
│ notion-cli █ · canvas █  │ │   ▼ canonical   ×31      │ │ schema-generator █       │
│ memory into commons      │ │ promotion is the pulse   │ │ tools that make tools    │
│                          │ │ ▒ → ▓ → █                │ │                          │
╰──────────────────────────╯ ╰──────────────────────────╯ ╰──────────────────────────╯
╭─ MENTORS █ ──────────────╮ ╭─ DAO MODULES ▒ ──────────╮ ╭─ LOCAL COLOR ▒ ──────────╮
│ expert-feynman █         │ │ from the dao-os forge:   │ │ notion-sync · bcn        │
│ karpathy-guidelines █    │ │ safe-treasury ▒          │ │ symbient · bcn           │
│ workspace-improver █     │ │ hats-governance ▒        │ │ local color stays local  │
│ skills-curator ▓         │ │ gardens-governance ▒     │ │ until it proves general  │
│ transcription-fixer █    │ │ karma-reputation ▒       │ │                          │
│ taste, encoded           │ │ eip4824-identity ▒       │ │                          │
│                          │ │ next wave upstream ⊕     │ │                          │
╰──────────────────────────╯ ╰──────────────────────────╯ ╰──────────────────────────╯
```

#skill-garden · 31 canonical █ · dao-module wave ▒⊕5 rising · discipline vendored ∴ taste encoded

## Projects — the field

```
╭─ V2-STAB ▓ ──────────────╮ ╭─ FED-PROTOCOL ▓ ─────────╮ ╭─ ORCHESTRATION ▓ ────────╮
│ stage develop            │ │ stage develop            │ │ stage develop            │
│ v3.0.0 tag local only    │ │ e2e sync test queued     │ │ weekly analyze runs      │
│ changelog stub pending   │ │ waits on sync-upstream   │ │ drift 27→0 consolidated  │
│ migrations v2→v3 ready   │ │ (autopoiesis phase 2)    │ │ backports queued ×3      │
╰──────────────────────────╯ ╰──────────────────────────╯ ╰──────────────────────────╯
╭─ SKILL-PROMO ▓ ──────────╮ ╭─ ONBOARDING ▒ ───────────╮ ╭─ PKG-INTEGRATION ▒ ──────╮
│ stage develop            │ │ stage discovery          │ │ stage discovery          │
│ v0.5 wave promoted ✓     │ │ web UI + GHA glue        │ │ multica pilot · 25-task  │
│ dao-module ▒5 next       │ │ over bootstrap engine    │ │ plan ready · deferred    │
│ matrix is the ledger     │ │ scoping to finalize      │ │ inventory audit next     │
╰──────────────────────────╯ ╰──────────────────────────╯ ╰──────────────────────────╯
╭─ RELIABILITY ▒ ──────────╮ ╭─ BOOTSTRAP ▒ ────────────╮ ╭─ OPAL ▒ ─────────────────╮
│ stage discovery          │ │ stage discovery          │ │ stage discovery          │
│ inventory infra first    │ │ cloning mechanism ?      │ │ opal-bridge ░ waits      │
│ absorbs phase-3          │ │ bread-coop proved v3.5   │ │ meeting transcripts →    │
│ integrity findings       │ │ engine for onboarding    │ │ knowledge pipeline       │
╰──────────────────────────╯ ╰──────────────────────────╯ ╰──────────────────────────╯
╭─ INTERFACES ▒ ───────────╮ ╭─ EVOLUTION ▒ ────────────╮ ╭─ QUEUE ░ ────────────────╮
│ stage discovery          │ │ stage discovery          │ │ docs/agent-plans/QUEUE   │
│ obsidian primary ?       │ │ autopoiesis research     │ │ » autopoiesis-p2 next    │
│ canvas overview ?        │ │ phase 2 » 12-task TDD    │ │ multica ×25 · e2e sync   │
│ dashboard template ?     │ │ system studies itself    │ │ future-instance-specs    │
│                          │ │                          │ │ scoping ×4 to finalize   │
╰──────────────────────────╯ ╰──────────────────────────╯ ╰──────────────────────────╯
```

#workstream-field · 4 develop ▓ pushing · 7 discovery ▒ forming · queue » autopoiesis phase 2

---

*Sources: `data/instances.yaml`, `data/packages-matrix.yaml`, `data/skills-matrix.yaml`,*
*`data/projects.yaml`, `federation.yaml`, `HEARTBEAT.md`. Re-weave on state change until*
*Phase B automates it.*
