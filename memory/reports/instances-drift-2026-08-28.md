# Instance Drift Report — 2026-08-28

**Generated:** 2026-08-28T23:14:26.523Z
**Framework version:** 0.5.0

## Summary

- Instances tracked: 7
- Cloned locally: 7
- Production: 2
- Total drift items: 22
- Unmapped skills (not in skills-matrix): concurrent-safe-edit, deploy-verify, handoff, no-ai-slop, request-routing, telegram-crm-intake, voronoi-motif
- Unmapped packages (not in packages-matrix): knowledge-commons

## ReFi Barcelona (`refi-bcn-os`)

- Type: LocalNode
- Maturity: production
- Skills: 27 (artifacts-builder, bootstrap-interviewer, capital-flow, commands, concurrent-safe-edit, deploy-verify, frontend-design, funding-scout, handoff, heartbeat-monitor, idea-scout, knowledge-curator, mcp-builder, meeting-processor, no-ai-slop, notion-cli, notion-sync, org-os-init, request-routing, research, schema-generator, skill-creator, symbient, telegram-crm-intake, voronoi-motif, web-browsing, workspace-improver)
- Packages: 6 (dashboard, maps, operations, org-os-kms, toolkit-framework, webapps)
- Data registries: 21
- MASTERPLAN: yes
- federation.yaml: yes (v3.0)

**Drift (16):**
- ⚠ undeclared_skill:concurrent-safe-edit
- ⚠ unmapped_skill:concurrent-safe-edit
- ⚠ undeclared_skill:deploy-verify
- ⚠ unmapped_skill:deploy-verify
- ⚠ undeclared_skill:handoff
- ⚠ unmapped_skill:handoff
- ⚠ undeclared_skill:no-ai-slop
- ⚠ unmapped_skill:no-ai-slop
- ⚠ undeclared_skill:request-routing
- ⚠ unmapped_skill:request-routing
- ⚠ undeclared_skill:telegram-crm-intake
- ⚠ unmapped_skill:telegram-crm-intake
- ⚠ undeclared_skill:voronoi-motif
- ⚠ unmapped_skill:voronoi-motif
- ⚠ undeclared_data_registry:crm
- ⚠ undeclared_data_registry:deferred

## ReFi DAO (`refi-dao-os`)

- Type: DAO
- Maturity: production
- Skills: 14 (bootstrap-interviewer, capital-flow, funding-scout, heartbeat-monitor, idea-scout, karpathy-guidelines, knowledge-curator, meeting-notes-transcription-fixer, meeting-processor, org-os-init, research, schema-generator, working-with-obsidian-canvas, workspace-improver)
- Packages: 10 (coordination, dashboard, governance, hub, knowledge-commons, operations, org-os-kms, regen-agents, toolkit-framework, webapps)
- Data registries: 24
- MASTERPLAN: yes
- federation.yaml: yes (v3.0)

**Drift (6):**
- ⚠ unmapped_package:knowledge-commons
- ⚠ undeclared_data_registry:access-grants
- ⚠ undeclared_data_registry:brand
- ⚠ undeclared_data_registry:commons-access
- ⚠ undeclared_data_registry:ecosystem
- ⚠ undeclared_data_registry:surfaces

## DAO OS (`dao-os`)

- Type: Project
- Maturity: beta
- Skills: 5 (eip4824-identity, gardens-governance, hats-governance, karma-reputation, safe-treasury)
- Packages: 2 (connectors, core)
- Data registries: 0
- MASTERPLAN: no
- federation.yaml: yes (v3.0)

**Drift:** none ✓

## openclaw (`openclaw`)

- Type: AgentRuntime
- Maturity: alpha
- Skills: 0 (—)
- Packages: 0 (—)
- Data registries: 0
- MASTERPLAN: no
- federation.yaml: no

**Drift:** none ✓

## Regen Coordination (`regen-coordination-os`)

- Type: Hub
- Maturity: beta
- Skills: 28 (artifacts-builder, bootstrap-interviewer, capital-flow, expert-feynman, funding-scout, heartbeat-monitor, idea-scout, initialize, karpathy-guidelines, knowledge-curator, mcp-builder, meeting-notes-transcription-fixer, meeting-processor, org-os-init, research, schema-generator, skill-creator, skills-curator, superpowers-brainstorming, superpowers-executing-plans, superpowers-finishing-a-development-branch, superpowers-requesting-code-review, superpowers-subagent-driven-development, superpowers-systematic-debugging, superpowers-test-driven-development, superpowers-using-git-worktrees, superpowers-writing-plans, workspace-improver)
- Packages: 12 (agents-app, coop, dashboard, egregore-core, koi-bridge, koi-opal-bridge, opal-bridge, operations, paperclip-agents-app, regen-agents, regen-toolkit, webapps)
- Data registries: 17
- MASTERPLAN: yes
- federation.yaml: yes (v3.0)

**Drift:** none ✓

## ReFi Mediterranean (`refi-med-os`)

- Type: LocalNode
- Maturity: alpha
- Skills: 4 (bootstrap-interviewer, initialize, org-os-init, schema-generator)
- Packages: 0 (—)
- Data registries: 14
- MASTERPLAN: yes
- federation.yaml: yes (v3.0)

**Drift:** none ✓

## Bread Cooperative (`bread-coop-os`)

- Type: Cooperative
- Maturity: alpha
- Skills: 16 (bootstrap-interviewer, capital-flow, funding-scout, heartbeat-monitor, initialize, knowledge-curator, meeting-notes-transcription-fixer, meeting-processor, org-os-init, schema-generator, skill-creator, skills-curator, superpowers-brainstorming, superpowers-executing-plans, superpowers-writing-plans, workspace-improver)
- Packages: 1 (operations)
- Data registries: 13
- MASTERPLAN: yes
- federation.yaml: yes (v3.5)

**Drift:** none ✓
