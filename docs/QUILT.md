# org-os · QUILT

> A [QUILT-protocol](https://wibandwob.com/quiltprotocol/) visualization of the org-os
> system as **one organism** — modules, integrations, and federation as nested
> containers, shaded by live status.
>
> Woven **2026-07-19** · framework **v3.5** · branch `v0.5` · hand-crafted (Phase A);
> `scripts/generate-quilt.mjs` (Phase B) will re-weave this from `data/*.yaml`.

## Legend

```
containment ╔═╗ organism · ┏━┓ organ · ╭─╮ patch (size = vitality) · (pod) small/asleep
status      █ live · ▓ moving · ▒ forming · ░ latent · ☓ needs attention
stitches    → flow · ↔ sync · ⊕ promotion · ≡ correspondence · ∴ therefore
            » points-to-next · ◉ hub · ✓ verified · ∅ never · ~ ambient
```

Status is mapped from each registry's native vocabulary: instance maturity
(`production/beta/alpha`), package `lifecycle_status`, skill `promotion_status`,
project stage (`Develop/Discovery`), and drift flags. A thing earns its pixels:
live patches get room, dormant things shrink to pods.

## The organism

```
╔═ ORG-OS · framework v3.5 · branch v0.5 · woven 2026-07-19 ══════════════════════════╗
║ ┏━ CORE · nucleus ━━━━━━━━━━━━━━━━━━━┓ ┏━ DATA ≡ SCHEMAS ━━━━━━━━━━━━━━━━━━━━━━━━━━┓ ║
║ ┃ ╭─HEARTBEAT █──────╮ ╭─MEMORY █─╮  ┃ ┃ ╭─data/*.yaml █──╮ ╭─.well-known █─╮      ┃ ║
║ ┃ │ 36 open · 0 crit │ │ 3d ago   │  ┃ ┃ │ ×16 registries │ │ EIP-4824 ×12  │      ┃ ║
║ ┃ ╰──────────────────╯ ╰──────────╯  ┃ ┃ ╰────────────────╯ ╰───────────────╯      ┃ ║
║ ┃ █ spine ─ (SOUL) (IDENTITY) (USER) ┃ ┃ ≡ generate ⇄ validate ✓ · 3d ago          ┃ ║
║ ┃           (TOOLS)                  ┃ ┃   yaml is truth, schema is face           ┃ ║
║ ┃ ▓ MASTERPLAN · the mandate         ┃ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ ║
║ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛                                               ║
║                   ∴ the nucleus writes truth · truth becomes face                    ║
║ ┏━ INTERFACES · doors ━━━━━━━━━━━━━━━━━━┓ ┏━ INTEGRATIONS · edges ━━━━━━━━━━━━━━━━━┓ ║
║ ┃ in ─ (claude-code █) (obsidian █ hub) ┃ ┃ out ─ (github █) (notion █)            ┃ ║
║ ┃      (zed/acp ▓) (opencode ▓)         ┃ ┃       (koi ▓ mcp) (hermes ▓)           ┃ ║
║ ┃      (hermes ▓) (canvas ▒)            ┃ ┃       (opal ░ » rollout)               ┃ ║
║ ┃      (web-dash ░)                     ┃ ┃       (eip-4824 ≡ █)                   ┃ ║
║ ┃ ~ many doors, one house               ┃ ┃ ~ where the world plugs in             ┃ ║
║ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ ║
║                                          ↕                                           ║
║ ┏━ AUTOMATION · metabolism · scripts ×24 + hooks ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ ║
║ ┃ loop ─ (initialize » dashboard) (generate ⇄ validate) (sync-upstream ↔ spokes)   ┃ ║
║ ┃        (analyze » drift-report) (clone-framework » birth)                        ┃ ║
║ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ ║
║           ↔ the membrane breathes: sync-upstream out, promotion ⊕ back in            ║
║ ┏━ FEDERATION · the membrane · ◉ hub ↔ 7 · 2 networks ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ ║
║ ┃ ╭─refi-bcn █───────────╮ ╭─refi-dao █───────────╮ ╭─regen-coord ▓─────────╮      ┃ ║
║ ┃ │ LocalNode·production │ │ DAO·production·hub   │ │ Hub·beta · pkgs ×12   │      ┃ ║
║ ┃ │ pkgs ×4 · +2 skills  │ │ pkgs ×9 · governance │ │ paperclip fork ☓      │      ┃ ║
║ ┃ │ sync 03-19 · drift ✓ │ │ sync 03-06 · drift ✓ │ │ sync 04-24 · drift ☓3 │      ┃ ║
║ ┃ ╰──────────────────────╯ ╰──────────────────────╯ ╰───────────────────────╯      ┃ ║
║ ┃ ╭─dao-os ▓─────────────────╮ ╭─refi-med ▒────────────╮ ╭─bread-coop ▒─────────╮  ┃ ║
║ ┃ │ module forge · skills ⊕5 │ │ alpha · bootstrap TBD │ │ born of clone ✓ test │  ┃ ║
║ ┃ │ sync 04-02 · ☓ no mplan  │ │ sync 04-28            │ │ sync 05-16           │  ┃ ║
║ ┃ ╰──────────────────────────╯ ╰───────────────────────╯ ╰──────────────────────╯  ┃ ║
║ ┃ ▒☓ substrate ─ (openclaw · agent runtime · sync ∅ · stub identity)               ┃ ║
║ ┃ ledger: bread 2mo » rgc·med 3mo » dao-os 3.5 » bcn 4 » dao 4.5 » claw ∅ · ☓7     ┃ ║
║ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ ║
║                                          ⊕                                           ║
║ ┏━ PACKAGES · travelers · matrix ×23 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ ║
║ ┃ ╭─toolkit █─╮ ╭─kms █───╮ ╭─fed-map █────╮ ╭─operations █─╮ ╭─regen-agents █─╮   ┃ ║
║ ┃ │ 100/100 ✓ │ │ 44/44 ✓ │ │ the torch·d3 │ │ bcn·dao      │ │ bcn·dao        │   ┃ ║
║ ┃ ╰───────────╯ ╰─────────╯ ╰──────────────╯ ╰──────────────╯ ╰────────────────╯   ┃ ║
║ ┃ ╭─webapps █─╮ ╭─hermes ▓───────╮ ╭─opencode ▓─────╮ ╭─paperclip ☓──────╮         ┃ ║
║ ┃ │ bcn·dao   │ │ page auto-tool │ │ 2 tools·5 cmds │ │ rgc fork AHEAD   │         ┃ ║
║ ┃ ╰───────────╯ ╰────────────────╯ ╰────────────────╯ │ backport pending │         ┃ ║
║ ┃                                                     ╰──────────────────╯         ┃ ║
║ ┃ ╭─dashboard ⊕───╮                                                                ┃ ║
║ ┃ │ bcn+dao       │                                                                ┃ ║
║ ┃ │ » fw template │                                                                ┃ ║
║ ┃ ╰───────────────╯                                                                ┃ ║
║ ┃ ░ sleeping ─ (agents-app) (egregore-core) (koi-bridge) (koi-opal)                ┃ ║
║ ┃              (opal » rollout)                                                    ┃ ║
║ ┃ ~ away, instance-owned ─ (governance ▓) (coordination ▓) (connectors·core)       ┃ ║
║ ┃                          (maps) (hub) (coop) (regen-toolkit)                     ┃ ║
║ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ ║
║                                          ⊕                                           ║
║ ┏━ SKILLS · the garden · matrix ×40 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ ║
║ ┃ ╭─PIPELINE ⊕─────────────╮ ╭─DAO WAVE ▒⊕──────────╮ ╭─▓ evaluating───╮           ┃ ║
║ ┃ │ ▒×5 → ▓×2 → █×31       │ │ safe·hats·gardens    │ │ capital-flow   │           ┃ ║
║ ┃ │ promotion is the pulse │ │ karma·eip4824 » next │ │ skills-curator │           ┃ ║
║ ┃ ╰────────────────────────╯ ╰──────────────────────╯ ╰────────────────╯           ┃ ║
║ ┃ █ lifecycle ─ (initialize) (org-os-init) (bootstrap-interviewer) (commands)      ┃ ║
║ ┃ █ discipline ─ (superpowers ×9 · tdd·debug·plans·worktrees·reviews)              ┃ ║
║ ┃ █ org-ops ─ (heartbeat) (meetings) (funding) (ideas)                             ┃ ║
║ ┃ █ knowledge ─ (curator) (research) (web-browsing) (notion-cli) (canvas)          ┃ ║
║ ┃ █ builders ─ (skill-creator) (mcp) (frontend) (artifacts) (schema-gen)           ┃ ║
║ ┃ █ mentors ─ (feynman) (karpathy) (workspace) (transcription)                     ┃ ║
║ ┃ ▒ local color ─ (notion-sync·bcn) (symbient·bcn)                                 ┃ ║
║ ┃                 — stays local until it proves general                            ┃ ║
║ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ ║
║                                          »                                           ║
║ ┏━ PROJECTS · the field · ×11 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ ║
║ ┃ ╭─v2-stab ▓─────────╮ ╭─federation ▓─────╮ ╭─orchestration ▓─╮ ╭─skill-promo ▓─╮ ┃ ║
║ ┃ │ v3 tag local only │ │ e2e sync queued  │ │ drift 27»0 ✓    │ │ v0.5 wave ✓   │ ┃ ║
║ ┃ │ changelog pending │ │ » autopoiesis p2 │ │ backports ×3    │ │ dao-wave next │ ┃ ║
║ ┃ ╰───────────────────╯ ╰──────────────────╯ ╰─────────────────╯ ╰───────────────╯ ┃ ║
║ ┃ ▒ discovery ─ (onboarding) (pkg-integration·multica) (reliability) (bootstrap)   ┃ ║
║ ┃               (opal) (operator-interfaces) (evolution » autopoiesis)             ┃ ║
║ ┃ ╭─QUEUE ░──────────────────────────────────────────────────────────────╮         ┃ ║
║ ┃ │ » autopoiesis-p2 (12-task TDD) · multica ×25 · e2e sync · scoping ×4 │         ┃ ║
║ ┃ ╰──────────────────────────────────────────────────────────────────────╯         ┃ ║
║ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ ║
╚══════════════════════════════════════════════════════════════════════════════════════╝
```

#orgos-organism · one membrane ∴ organs breathe · patches earn size · pods sleep ░ · hub ↔ spokes ⊕

---

*Sources: `data/instances.yaml`, `data/packages-matrix.yaml`, `data/skills-matrix.yaml`,*
*`data/projects.yaml`, `federation.yaml`, `HEARTBEAT.md`. Re-weave on state change until*
*Phase B automates it.*
