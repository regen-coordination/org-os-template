# org-os · QUILT

> A [QUILT-protocol](https://wibandwob.com/quiltprotocol/) visualization of the org-os
> system as **one organism** — modules, integrations, and federation as nested
> containers, shaded by live status.
>
> Woven **2026-07-19** by `npm run generate:quilt` from `data/*.yaml` — do not edit by
> hand. Edit prose in the generator `scripts/generate-quilt.mjs` (organ layout/taglines)
> or per-entry detail in `scripts/lib/quilt-view.mjs` (PKG_DETAIL, GARDEN_GROUPS, …).

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
╔═ ORG-OS · framework v0.5 · woven 2026-07-19 ═════════════════════════════════════════╗
║ ┏━ CORE · nucleus ━━━━━━━━━━━━━━━━━━━┓ ┏━ DATA ≡ SCHEMAS ━━━━━━━━━━━━━━━━━━━━━━━━━━┓ ║
║ ┃ ╭─HEARTBEAT █─╮ ╭─MEMORY █─╮       ┃ ┃ ╭─data/*.yaml █──╮ ╭─.well-known █─╮      ┃ ║
║ ┃ │ 36 open     │ │ 4d ago   │       ┃ ┃ │ ×17 registries │ │ EIP-4824 ×11  │      ┃ ║
║ ┃ ╰─────────────╯ ╰──────────╯       ┃ ┃ ╰────────────────╯ ╰───────────────╯      ┃ ║
║ ┃ █ spine ─ (SOUL) (IDENTITY) (USER) ┃ ┃ ≡ generate ⇄ validate ✓                   ┃ ║
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
║ ┏━ AUTOMATION · metabolism · scripts ×30 + hooks ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ ║
║ ┃ loop ─ (initialize » dashboard) (generate ⇄ validate) (sync-upstream ↔ spokes)   ┃ ║
║ ┃        (analyze » drift-report) (clone-framework » birth)                        ┃ ║
║ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ ║
║           ↔ the membrane breathes: sync-upstream out, promotion ⊕ back in            ║
║ ┏━ FEDERATION · the membrane · ◉ hub ↔ 7 · 2 networks ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ ║
║ ┃ ╭─refi-bcn █───────────╮ ╭─refi-dao █───────────╮ ╭─dao ▓─────────────────╮      ┃ ║
║ ┃ │ LocalNode·production │ │ DAO·production·hub   │ │ Project·beta          │      ┃ ║
║ ┃ │ pkgs ×4 · +2 skills  │ │ pkgs ×9              │ │ sync 04-02 · drift ☓1 │      ┃ ║
║ ┃ │ sync 03-19 · drift ✓ │ │ sync 03-06 · drift ✓ │ ╰───────────────────────╯      ┃ ║
║ ┃ ╰──────────────────────╯ ╰──────────────────────╯                                ┃ ║
║ ┃ ╭─regen-coord ▓─────────╮ ╭─refi-med ▒──────╮ ╭─bread-coop ▒──────╮              ┃ ║
║ ┃ │ Hub·beta·hub          │ │ LocalNode·alpha │ │ Cooperative·alpha │              ┃ ║
║ ┃ │ sync 04-24 · drift ☓3 │ │ sync 04-28      │ │ sync 05-16        │              ┃ ║
║ ┃ ╰───────────────────────╯ ╰─────────────────╯ ╰───────────────────╯              ┃ ║
║ ┃ ▒☓ substrate ─ (openclaw · agent runtime · sync ∅ · 3 drift)                     ┃ ║
║ ┃ ledger: bread-coop 2mo » refi-med 2.5mo » regen-coord 3mo » dao 3.5mo            ┃ ║
║ ┃   refi-bcn 4mo » refi-dao 4.5mo » openclaw ∅ · ☓7                                ┃ ║
║ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ ║
║                                          ⊕                                           ║
║ ┏━ PACKAGES · travelers · matrix ×23 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ ║
║ ┃ ╭─toolkit █─╮ ╭─kms █───╮ ╭─fed-map █────╮ ╭─operations █─╮ ╭─paperclip ☓──────╮ ┃ ║
║ ┃ │ 100/100 ✓ │ │ 44/44 ✓ │ │ the torch·d3 │ │ bcn·dao      │ │ rgc fork AHEAD   │ ┃ ║
║ ┃ ╰───────────╯ ╰─────────╯ ╰──────────────╯ ╰──────────────╯ │ backport pending │ ┃ ║
║ ┃                                                             ╰──────────────────╯ ┃ ║
║ ┃ ╭─regen-agents █─╮ ╭─webapps █─╮ ╭─hermes ▓───────╮ ╭─opencode ▓─────╮           ┃ ║
║ ┃ │ bcn·dao        │ │ bcn·dao   │ │ page auto-tool │ │ 2 tools·5 cmds │           ┃ ║
║ ┃ ╰────────────────╯ ╰───────────╯ ╰────────────────╯ ╰────────────────╯           ┃ ║
║ ┃ ╭─dashboard ⊕───╮                                                                ┃ ║
║ ┃ │ bcn+dao       │                                                                ┃ ║
║ ┃ │ » fw template │                                                                ┃ ║
║ ┃ ╰───────────────╯                                                                ┃ ║
║ ┃ ░ sleeping ─ (agents-app) (egregore-core) (koi-bridge) (koi-opal-bridge)         ┃ ║
║ ┃              (opal-bridge » planned)                                             ┃ ║
║ ┃ ~ away, instance-owned ─ (governance ▓) (coordination ▓) (connectors) (core)     ┃ ║
║ ┃                          (maps) (hub) (coop) (regen-toolkit)                     ┃ ║
║ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ ║
║                                          ⊕                                           ║
║ ┏━ SKILLS · the garden · matrix ×40 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ ║
║ ┃ ╭─PIPELINE ⊕─────────────╮ ╭─DAO WAVE ▒⊕──────────╮                              ┃ ║
║ ┃ │ ▒×5 → ▓×2 → █×31       │ │ safe·hats·gardens    │                              ┃ ║
║ ┃ │ promotion is the pulse │ │ karma·eip4824 » next │                              ┃ ║
║ ┃ ╰────────────────────────╯ ╰──────────────────────╯                              ┃ ║
║ ┃ █ lifecycle ─ (initialize) (org-os-init) (bootstrap-interviewer) (commands)      ┃ ║
║ ┃ █ discipline ─ (superpowers ×9 · tdd·debug·plans·worktrees·reviews)              ┃ ║
║ ┃ █ org-ops ─ (heartbeat) (meetings) (funding) (ideas)                             ┃ ║
║ ┃ █ knowledge ─ (curator) (research) (web-browsing) (notion-cli) (canvas)          ┃ ║
║ ┃ █ builders ─ (skill-creator) (mcp) (frontend) (artifacts) (schema-gen)           ┃ ║
║ ┃ █ mentors ─ (feynman) (karpathy) (workspace) (transcription)                     ┃ ║
║ ┃ ▒ local color ─ (instance-specific ×2) — stays local until it proves general     ┃ ║
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
*`data/projects.yaml`, `federation.yaml`, `HEARTBEAT.md`. Regenerate: `npm run generate:quilt`.*
