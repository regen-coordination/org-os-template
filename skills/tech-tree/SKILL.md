---
name: tech-tree
version: 1.0.0
description: Operate the org-os tech tree — the dialectical development graph. Add nodes, promote statuses (routing ref-backed changes to their source registries), connect edges, audit coverage, render the graph. Editing the tree is the planning act; keep it honest as things ship.
triggers:
  - "tech tree"
  - "development graph"
  - "add to the tree"
  - "promote node"
  - "tree audit"
  - "frontier"
inputs:
  - data/tech-tree.yaml (graph structure + native statuses)
  - data/packages-matrix.yaml, data/skills-matrix.yaml, data/ideas.yaml (ref-backed statuses)
  - site/src/data/tech-tree.resolved.json (last resolved output, for moved-diff)
outputs:
  - data/tech-tree.yaml (edits)
  - source-registry edits (for ref-backed status changes)
  - site/src/data/tech-tree.resolved.json (via npm run resolve:tech-tree)
---

# Tech Tree Operations

The tree is the **overlay registry** `data/tech-tree.yaml` (spec:
`docs/superpowers/specs/2026-07-19-tech-tree-design.md`, doc: `docs/TECH-TREE.md`).
Structure and native-node statuses live in the tree; ref-backed statuses live in
the source registries. Never duplicate status onto a ref-backed node.

After ANY edit: `npm run validate:tech-tree && npm run resolve:tech-tree`.

## add — place something new

1. Choose type (`capability | module | skill | integration | standard | idea`) and id prefix (`cap- mod- skl- int- std- idea-`).
2. Modules/skills/ideas MUST use `ref:` to their registry entry (create the registry entry first if missing).
3. Native nodes (capability/integration/standard) declare `status` directly.
4. Add exactly one `part-of` edge to the parent capability, plus any `depends-on`/`enables` edges.
5. Validate + resolve.

## promote — move a status

- **Native node:** edit `status` in `data/tech-tree.yaml`.
- **Ref-backed node:** edit the SOURCE registry instead — `lifecycle_status`
  (packages), `promotion_status` (skills), `status` (ideas). The tree picks it
  up at resolve time. Then run `npm run generate:schemas` if the registry feeds
  `.well-known/`.
- Validate + resolve; report the `moved` diff to the operator.

## connect — edit edges

Add/remove edges (`part-of | depends-on | enables | supersedes`). `part-of`
must stay acyclic and every node should stay reachable from the root.

## audit — coverage + integrity

Run `npm run validate:tech-tree`. For every coverage warning, propose a
placement (node + parent) to the operator. For gap notes in the resolved
`frontier` block, surface them as candidate next plans.

## render — see it

`npm run resolve:tech-tree`, then `cd site && npm run dev` →
`http://localhost:4321/tech-tree` (views: hybrid, constellation, techtree, tree).
