# generate-quilt.mjs Implementation Plan (QUILT Phase B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-weave `docs/QUILT.md` (the organic organism visualization) deterministically from `data/*.yaml`, so status shading, counts, and dates never go stale.

**Architecture:** Three units. `scripts/lib/quilt-compose.mjs` is pure geometry (patch/pack/pods/organ/organism — the recursive containment renderer, throws on width overflow). `scripts/lib/quilt-view.mjs` maps registry data → patch/pod specs (shade rules, tiering rules, hand-authored taglines live here as template constants — prose is creative residue, data is live). `scripts/generate-quilt.mjs` is the CLI that reads the repo, weaves, and writes `docs/QUILT.md`.

**Tech Stack:** Node ≥22 ESM, `js-yaml` (already a dep), `node:test` runner (`npm test` = `node --test "tests/**/*.test.mjs"`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-19-quilt-visualization-design.md` (revision 2026-07-19b — organic containment). Reference render: `docs/QUILT.md` at commit `910ea3a`.

**Design decisions locked here:**
- Containment tiers: organism `╔═╗` (inner width **84**) ⊃ organ `┏━┓` ⊃ patch `╭─╮` ⊃ pod `(…)`.
- Data-driven: shades, counts, sync dates/ages, drift flags, patch-vs-pod tiering, HEARTBEAT open count, memory age. Template constants: organ titles, taglines, stitch lines, per-id detail overrides, skill garden groups, header/legend/footer prose.
- Tiering rules (no hand lists of ids): instances with `federation_role: "agent-runtime"` → substrate pod, all others → patch (production 3 content lines, else 2). Packages: `in_framework && lifecycle_status === "active"` → patch; `in_framework && (dormant|planned)` → `░ sleeping` pod; `!in_framework` → `~ away` pod; notes matching `/AHEAD|⚠/` force shade `☓`. Projects: `Develop` → patch, `Discovery` → pod.
- Shade maps: instance maturity `{production:█, beta:▓, alpha:▒}`; package `{canonical+active:█, evaluating:▓, candidate:⊕}`; project `{Develop:▓, Discovery:▒}`.
- Unknown ids appearing in data but absent from override/group constants must still render (with derived defaults) — the generator never crashes on new registry entries; it `console.warn`s instead.

---

### Task 1: Composer geometry — `patch` and `pack`

**Files:**
- Create: `scripts/lib/quilt-compose.mjs`
- Test: `tests/quilt-compose.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// tests/quilt-compose.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { len, patch, pack } from "../scripts/lib/quilt-compose.mjs";

test("patch sizes itself to its widest content line", () => {
  const p = patch("kms █", [" 44/44 ✓ "]);
  assert.equal(p[0], "╭─kms █───╮");
  assert.equal(p[1], "│ 44/44 ✓ │");
  assert.equal(p[2], "╰─────────╯");
  // rectangle: every line same display width
  assert.ok(p.every((l) => len(l) === len(p[0])));
});

test("patch title wider than content stretches the body", () => {
  const p = patch("operations █", [" bcn "]);
  assert.ok(p.every((l) => len(l) === len(p[0])));
  assert.ok(len(p[0]) >= [..."operations █"].length + 4);
});

test("pack wraps blocks into rows and preserves ragged bottoms", () => {
  const a = patch("a", [" x "]); // height 3
  const b = patch("b", [" y ", " z "]); // height 4
  const lines = pack([a, b], 40, 1);
  // one row, height 4: 'a' padded with spaces below its bottom border
  assert.equal(lines.length, 4);
  assert.match(lines[0], /╭─a─+╮ ╭─b─+╮/);
  assert.match(lines[3], /^\s+│ z │$/); // a contributes nothing on line 4
});

test("pack starts a new row when width is exceeded", () => {
  const blocks = [patch("one", [" .. "]), patch("two", [" .. "])];
  const lines = pack(blocks, 12, 1); // too narrow for both side by side
  assert.equal(lines.length, 6); // two stacked 3-line rows
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/quilt-compose.test.mjs`
Expected: FAIL — `Cannot find module '.../scripts/lib/quilt-compose.mjs'`

> **Erratum (2026-07-19, post-implementation):** the Step 1 snippet's last assertion
> `assert.match(lines[3], /^\s+│ z │$/)` is wrong — for the 2-content-line patch `b`,
> `" z "` renders at line index 2 and the closing border `╰───╯` at index 3. The shipped
> test asserts `/^\s+╰─+╯$/` instead (same intent: "a contributes nothing on line 4").
> Verified by spec + code-quality review at commit `ca93b122`.

- [ ] **Step 3: Implement `len`, `pad`, `patch`, `pack`**

```js
// scripts/lib/quilt-compose.mjs
/**
 * QUILT organic composer — pure geometry, no I/O.
 * Containment tiers: organism ╔═╗ ⊃ organ ┏━┓ ⊃ patch ╭─╮ ⊃ pod (…).
 * Spec: docs/superpowers/specs/2026-07-19-quilt-visualization-design.md (rev b).
 */

export const len = (s) => [...s].length;
export const pad = (s, w) => s + " ".repeat(Math.max(0, w - len(s)));

/** Small bordered box sized to its content. Returns array of lines. */
export function patch(title, lines) {
  const w = Math.max(len(title) + 4, ...lines.map((l) => len(l) + 2), 6);
  const out = ["╭─" + title + "─".repeat(w - 3 - len(title)) + "╮"];
  for (const l of lines) out.push("│" + pad(l, w - 2) + "│");
  out.push("╰" + "─".repeat(w - 2) + "╯");
  return out;
}

/**
 * Greedy row-packer. Blocks are arrays of lines; rows wrap at `width`,
 * shorter blocks in a row are padded with blank space below (ragged
 * bottoms are intentional — organic, not squared off).
 */
export function pack(blocks, width, gap = 1) {
  const rows = [];
  let row = [], used = 0;
  for (const b of blocks) {
    const w = Math.max(...b.map(len));
    if (row.length && used + gap + w > width) { rows.push(row); row = []; used = 0; }
    used += (row.length ? gap : 0) + w;
    row.push(b.map((l) => pad(l, w)));
  }
  if (row.length) rows.push(row);
  const lines = [];
  for (const r of rows) {
    const h = Math.max(...r.map((b) => b.length));
    for (let i = 0; i < h; i++)
      lines.push(
        r.map((b) => b[i] ?? " ".repeat(len(b[0]))).join(" ".repeat(gap)).replace(/\s+$/, ""),
      );
  }
  return lines;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/quilt-compose.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/quilt-compose.mjs tests/quilt-compose.test.mjs
git commit -m "feat(quilt): composer geometry — patch + greedy ragged packer"
```

---

### Task 2: Composer containers — `pods`, `organ`, `organism`, `stitch`

**Files:**
- Modify: `scripts/lib/quilt-compose.mjs` (append)
- Test: `tests/quilt-compose.test.mjs` (append)

- [ ] **Step 1: Write the failing tests**

```js
// append to tests/quilt-compose.test.mjs
import { pods, organ, organism, stitch, ORGANISM_INNER } from "../scripts/lib/quilt-compose.mjs";

test("pods wraps tokens under a hanging label indent", () => {
  const lines = pods("░ sleeping", ["(a)", "(b)", "(c)"], 20);
  assert.equal(lines[0], "░ sleeping ─ (a) (b)");
  assert.equal(lines[1], "             (c)");
});

test("organ borders content and throws on overflow", () => {
  const o = organ("CORE", ["hello"], 20);
  assert.equal(o[0].length === undefined, false); // array of strings
  assert.ok(o.every((l) => len(l) === 20));
  assert.match(o[0], /^┏━ CORE ━+┓$/);
  assert.match(o[1], /^┃ hello\s+┃$/);
  assert.throws(() => organ("X", ["y".repeat(17)], 20), /overflow/);
});

test("organism packs organs side by side and throws on overflow", () => {
  const a = organ("A", ["1"], 40);
  const b = organ("B", ["2"], 43); // 40+1+43 = 84 = ORGANISM_INNER
  const body = organism("TEST", [[a, b], stitch("∴ flow")]);
  const lines = body.split("\n");
  assert.ok(lines.every((l) => len(l) === ORGANISM_INNER + 4));
  assert.match(lines[0], /^╔═ TEST ═+═╗$/);
  assert.match(lines[1], /┏━ A ━+┓ ┏━ B ━+┓/);
  assert.ok(body.includes("∴ flow"));
  assert.throws(() => organism("T", ["x".repeat(85)]), /overflow/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/quilt-compose.test.mjs`
Expected: FAIL — `pods is not exported` (SyntaxError on import)

- [ ] **Step 3: Implement `pods`, `organ`, `organism`, `stitch`**

```js
// append to scripts/lib/quilt-compose.mjs

export const ORGANISM_INNER = 84;

/** Single-breath tokens wrapped under a hanging label: `label ─ (a) (b)…` */
export function pods(label, tokens, inner) {
  const lines = [];
  let cur = label + " ─";
  const indent = " ".repeat(len(label) + 2);
  for (const t of tokens) {
    if (len(cur) + 1 + len(t) > inner) { lines.push(cur); cur = indent; }
    cur += " " + t;
  }
  lines.push(cur);
  return lines;
}

> **Erratum (2026-07-19, post-review):** the shipped `organ`/`organism` also THROW on
> title overflow (when the dash budget `< 1`), matching the content-overflow contract —
> the `Math.max(1, …)` shown below would instead silently emit an over-width header.
> See commit `fix(quilt): throw on title overflow`.

/** Heavy-bordered subsystem container. Every output line is exactly `width`. */
export function organ(title, contentLines, width) {
  const inner = width - 4;
  const out = ["┏━ " + title + " " + "━".repeat(Math.max(1, width - 6 - len(title))) + "━┓"];
  for (const l of contentLines) {
    if (len(l) > inner) throw new Error(`organ "${title}" overflow (${len(l)}>${inner}): ${l}`);
    out.push("┃ " + pad(l, inner) + " ┃");
  }
  out.push("┗" + "━".repeat(width - 2) + "┛");
  return out;
}

/** Center a stitch/narration line within the organism. */
export const stitch = (s) =>
  " ".repeat(Math.max(0, Math.floor((ORGANISM_INNER - len(s)) / 2))) + s;

/**
 * Outer membrane. `rows` entries are either an array of organ blocks
 * (packed side by side with the same packer patches use) or a raw string.
 * Returns the full quilt as one string.
 */
export function organism(title, rows) {
  const OW = ORGANISM_INNER;
  // total output width is OW+4 (║ + space + OW + space + ║); header must match it.
  const out = ["╔═ " + title + " " + "═".repeat(Math.max(1, OW - 2 - len(title))) + "═╗"];
  for (const r of rows) {
    const lines = Array.isArray(r) ? pack(r, OW, 1) : [r];
    for (const l of lines) {
      if (len(l) > OW) throw new Error(`organism overflow (${len(l)}>${OW}): ${l}`);
      out.push("║ " + pad(l, OW) + " ║");
    }
  }
  out.push("╚" + "═".repeat(OW + 2) + "╝");
  return out.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/quilt-compose.test.mjs`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/quilt-compose.mjs tests/quilt-compose.test.mjs
git commit -m "feat(quilt): pods, organ, organism, stitch — recursive containment"
```

---

### Task 3: View model — shades, ages, federation organ spec

**Files:**
- Create: `scripts/lib/quilt-view.mjs`
- Test: `tests/quilt-view.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// tests/quilt-view.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  instanceShade, monthsAgo, fmtAge, instancePatch, syncLedger,
} from "../scripts/lib/quilt-view.mjs";

const NOW = new Date("2026-07-19");

test("instanceShade maps maturity to shade", () => {
  assert.equal(instanceShade("production"), "█");
  assert.equal(instanceShade("beta"), "▓");
  assert.equal(instanceShade("alpha"), "▒");
  assert.equal(instanceShade("unheard-of"), "▒"); // unknown → forming, warn elsewhere
});

test("monthsAgo and fmtAge", () => {
  assert.equal(fmtAge(monthsAgo("2026-05-16", NOW)), "2mo");
  assert.equal(fmtAge(monthsAgo("2026-04-02", NOW)), "3.5mo");
  assert.equal(fmtAge(monthsAgo(null, NOW)), "∅");
});

test("instancePatch — production gets 3 content lines, alpha gets 2", () => {
  const prod = instancePatch({
    id: "refi-bcn-os", type: "LocalNode", maturity: "production",
    federation_role: "spoke", packages: ["a", "b"], skills_extra: ["s", "t"],
    last_sync: "2026-03-19", drift: [],
  });
  assert.equal(prod.title, "refi-bcn █");
  assert.equal(prod.lines.length, 3);
  assert.equal(prod.lines[0], " LocalNode·production ");
  assert.equal(prod.lines[1], " pkgs ×2 · +2 skills ");
  assert.equal(prod.lines[2], " sync 03-19 · drift ✓ ");

  const alpha = instancePatch({
    id: "refi-med-os", type: "LocalNode", maturity: "alpha",
    federation_role: "spoke", packages: [], skills_extra: [],
    last_sync: "2026-04-28", drift: [],
  });
  assert.equal(alpha.lines.length, 2);
  assert.equal(alpha.lines[1], " sync 04-28 ");
});

test("instancePatch — drift flags render as ☓n, hub role is marked", () => {
  const p = instancePatch({
    id: "regen-coordination-os", type: "Hub", maturity: "beta",
    federation_role: "hub", packages: Array(12).fill("x"), skills_extra: [],
    last_sync: "2026-04-24", drift: ["a", "b", "c"],
  });
  assert.equal(p.title, "regen-coord ▓");
  assert.equal(p.lines[0], " Hub·beta·hub ");
  assert.equal(p.lines.at(-1), " sync 04-24 · drift ☓3 ");
});

test("syncLedger orders by freshness, null last", () => {
  const line = syncLedger([
    { id: "a-os", last_sync: "2026-03-19" },
    { id: "b-os", last_sync: "2026-05-16" },
    { id: "c-os", last_sync: null },
  ], NOW);
  assert.equal(line, "ledger: b 2mo » a 4mo » c ∅");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/quilt-view.test.mjs`
Expected: FAIL — `Cannot find module '.../scripts/lib/quilt-view.mjs'`

- [ ] **Step 3: Implement the federation half of the view module**

```js
// scripts/lib/quilt-view.mjs
/**
 * QUILT view model — maps registry data to patch/pod specs.
 * Hand-authored prose (taglines, overrides, garden groups) lives HERE as
 * template constants; everything numeric/status comes from data.
 */

export const SHADE_MATURITY = { production: "█", beta: "▓", alpha: "▒" };
export const SHADE_PROJECT = { Develop: "▓", Discovery: "▒" };

export function instanceShade(maturity) {
  const s = SHADE_MATURITY[maturity];
  if (!s) console.warn(`quilt: unknown maturity "${maturity}" — rendering ▒`);
  return s ?? "▒";
}

/** Short display id: strip -os suffix, refi-/regen- prefixes kept readable. */
export const shortId = (id) =>
  id.replace(/-os$/, "").replace(/^regen-coordination$/, "regen-coord");

export function monthsAgo(iso, now) {
  if (!iso) return null;
  return (now - new Date(iso)) / (30 * 86400000);
}

/** Round to nearest half month: 2mo, 3.5mo; null → ∅ */
export function fmtAge(months) {
  if (months == null) return "∅";
  const h = Math.round(months * 2) / 2;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}mo`;
}

const mmdd = (iso) => iso.slice(5);

/** One federation patch spec {title, lines} from an instances.yaml entry. */
export function instancePatch(inst) {
  const shade = instanceShade(inst.maturity);
  const head =
    ` ${inst.type}·${inst.maturity}` +
    (inst.federation_role === "hub" ? "·hub" : "") + " ";
  const pkgsLine =
    ` pkgs ×${(inst.packages ?? []).length}` +
    ((inst.skills_extra ?? []).length ? ` · +${inst.skills_extra.length} skills` : "") + " ";
  const drift = (inst.drift ?? []).length ? `drift ☓${inst.drift.length}` : "drift ✓";
  const syncLine = inst.maturity === "alpha" && !(inst.drift ?? []).length
    ? ` sync ${inst.last_sync ? mmdd(inst.last_sync) : "∅"} `
    : ` sync ${inst.last_sync ? mmdd(inst.last_sync) : "∅"} · ${drift} `;
  const lines = inst.maturity === "production"
    ? [head, pkgsLine, syncLine]
    : [head, syncLine];
  return { title: `${shortId(inst.id)} ${shade}`, lines };
}

/** `ledger: freshest Nmo » … » never ∅` — freshest first, null last. */
export function syncLedger(instances, now) {
  const parts = [...instances]
    .map((i) => ({ id: shortId(i.id), m: monthsAgo(i.last_sync, now) }))
    .sort((a, b) => (a.m ?? Infinity) - (b.m ?? Infinity))
    .map((x) => `${x.id} ${fmtAge(x.m)}`);
  return "ledger: " + parts.join(" » ");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/quilt-view.test.mjs`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/quilt-view.mjs tests/quilt-view.test.mjs
git commit -m "feat(quilt): view model — instance shades, ages, federation patches"
```

---

### Task 4: View model — package tiering and project tiering

**Files:**
- Modify: `scripts/lib/quilt-view.mjs` (append)
- Test: `tests/quilt-view.test.mjs` (append)

- [ ] **Step 1: Write the failing tests**

```js
// append to tests/quilt-view.test.mjs
import { packageTiers, projectTiers, PKG_DETAIL } from "../scripts/lib/quilt-view.mjs";

test("packageTiers routes packages to patch / sleeping / away", () => {
  const tiers = packageTiers([
    { id: "toolkit-framework", in_framework: true, lifecycle_status: "active",
      promotion_status: "canonical", instances_using: ["regen-toolkit"], notes: "" },
    { id: "koi-bridge", in_framework: true, lifecycle_status: "dormant",
      promotion_status: "canonical", instances_using: [], notes: "" },
    { id: "opal-bridge", in_framework: true, lifecycle_status: "planned",
      promotion_status: "canonical", instances_using: [], notes: "" },
    { id: "governance", in_framework: false, lifecycle_status: "active",
      promotion_status: "evaluating", instances_using: ["refi-dao-os"], notes: "" },
    { id: "paperclip-agents-app", in_framework: true, lifecycle_status: "dormant",
      promotion_status: "canonical", instances_using: ["regen-coordination-os"],
      notes: "⚠ fork is AHEAD" },
  ]);
  assert.equal(tiers.patches.length, 2); // toolkit + paperclip (☓ promotes to patch)
  assert.equal(tiers.patches[0].title, "toolkit █");
  assert.equal(tiers.patches[1].title, "paperclip ☓");
  assert.deepEqual(tiers.sleeping, ["(koi-bridge)", "(opal-bridge » planned)"]);
  assert.deepEqual(tiers.away, ["(governance ▓)"]);
});

test("packageTiers uses PKG_DETAIL override, else derives from instances_using", () => {
  assert.equal(PKG_DETAIL["toolkit-framework"][0], " 100/100 ✓ ");
  const tiers = packageTiers([
    { id: "mystery-pkg", in_framework: true, lifecycle_status: "active",
      promotion_status: "canonical", instances_using: ["refi-bcn-os", "refi-dao-os"], notes: "" },
  ]);
  assert.deepEqual(tiers.patches[0].lines, [" refi-bcn·refi-dao "]);
});

test("projectTiers — Develop → patches, Discovery → pods", () => {
  const t = projectTiers([
    { id: "v2-stabilization", status: "Develop" },
    { id: "opal-rollout", status: "Discovery" },
    { id: "brand-new-thing", status: "Develop" },
  ]);
  assert.equal(t.patches[0].title, "v2-stab ▓");
  assert.equal(t.patches[1].title, "brand-new-thing ▓"); // unknown id still renders
  assert.deepEqual(t.discovery, ["(opal-rollout)"]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/quilt-view.test.mjs`
Expected: FAIL — `packageTiers is not exported`

- [ ] **Step 3: Implement package/project tiering with template constants**

```js
// append to scripts/lib/quilt-view.mjs

/** Hand-authored patch detail lines (creative residue). Derived default otherwise. */
export const PKG_DETAIL = {
  "toolkit-framework": [" 100/100 ✓ "],
  "org-os-kms": [" 44/44 ✓ "],
  "org-os-federation-map": [" the torch·d3 "],
  operations: [" bcn·dao "],
  "regen-agents": [" bcn·dao "],
  webapps: [" bcn·dao "],
  "hermes-integration": [" page auto-tool "],
  "opencode-integration": [" 2 tools·5 cmds "],
  "paperclip-agents-app": [" rgc fork AHEAD ", " backport pending "],
  dashboard: [" bcn+dao ", " » fw template "],
};

export const PKG_SHORT = {
  "toolkit-framework": "toolkit", "org-os-kms": "kms",
  "org-os-federation-map": "fed-map", "hermes-integration": "hermes",
  "opencode-integration": "opencode", "paperclip-agents-app": "paperclip",
};

const pkgShort = (id) => PKG_SHORT[id] ?? id;
const instShort = (id) => id.replace(/-os$/, "");

function pkgShade(p) {
  if (/AHEAD|⚠/.test(p.notes ?? "")) return "☓";
  if (p.promotion_status === "candidate") return "⊕";
  if (p.promotion_status === "evaluating") return "▓";
  return "█";
}

/** Route packages-matrix entries into { patches, sleeping, away }. */
export function packageTiers(pkgs) {
  const patches = [], sleeping = [], away = [];
  for (const p of pkgs) {
    const shade = pkgShade(p);
    if (!p.in_framework) {
      away.push(`(${pkgShort(p.id)}${shade !== "█" ? ` ${shade}` : ""})`);
    } else if (p.lifecycle_status === "active" || shade === "☓" || shade === "⊕") {
      const lines = PKG_DETAIL[p.id] ??
        [` ${(p.instances_using ?? []).map(instShort).join("·") || p.lifecycle_status} `];
      if (!PKG_DETAIL[p.id]) console.warn(`quilt: no PKG_DETAIL for "${p.id}" — derived line used`);
      patches.push({ title: `${pkgShort(p.id)} ${shade}`, lines });
    } else {
      sleeping.push(
        p.lifecycle_status === "planned" ? `(${pkgShort(p.id)} » planned)` : `(${pkgShort(p.id)})`,
      );
    }
  }
  return { patches, sleeping, away };
}

/** Hand-authored Develop-project patch lines. */
export const PROJECT_DETAIL = {
  "v2-stabilization": [" v3 tag local only ", " changelog pending "],
  "federation-protocol": [" e2e sync queued ", " » autopoiesis p2 "],
  "instance-orchestration": [" drift 27»0 ✓ ", " backports ×3 "],
  "skill-promotion": [" v0.5 wave ✓ ", " dao-wave next "],
};

export const PROJECT_SHORT = {
  "v2-stabilization": "v2-stab", "federation-protocol": "federation",
  "instance-orchestration": "orchestration", "skill-promotion": "skill-promo",
  "package-integration": "pkg-integration·multica", "non-tech-onboarding": "onboarding",
  "instance-bootstrap": "bootstrap", "opal-rollout": "opal",
  "operator-interfaces": "operator-interfaces", "framework-evolution": "evolution » autopoiesis",
  reliability: "reliability",
};

const projShort = (id) => PROJECT_SHORT[id] ?? id;

/** Route projects.yaml entries into { patches, discovery }. */
export function projectTiers(projects) {
  const patches = [], discovery = [];
  for (const p of projects) {
    if (p.status === "Develop") {
      const lines = PROJECT_DETAIL[p.id] ?? [" develop "];
      if (!PROJECT_DETAIL[p.id]) console.warn(`quilt: no PROJECT_DETAIL for "${p.id}"`);
      patches.push({ title: `${projShort(p.id)} ${SHADE_PROJECT.Develop}`, lines });
    } else {
      discovery.push(`(${projShort(p.id)})`);
    }
  }
  return { patches, discovery };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/quilt-view.test.mjs`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/quilt-view.mjs tests/quilt-view.test.mjs
git commit -m "feat(quilt): view model — package and project tiering with overrides"
```

---

### Task 5: View model — skills pipeline counts and garden groups

**Files:**
- Modify: `scripts/lib/quilt-view.mjs` (append)
- Test: `tests/quilt-view.test.mjs` (append)

- [ ] **Step 1: Write the failing tests**

```js
// append to tests/quilt-view.test.mjs
import { skillCounts, GARDEN_GROUPS } from "../scripts/lib/quilt-view.mjs";

test("skillCounts tallies promotion pipeline from the matrix", () => {
  const c = skillCounts([
    { id: "a", promotion_status: "canonical" },
    { id: "b", promotion_status: "canonical" },
    { id: "c", promotion_status: "evaluating" },
    { id: "d", promotion_status: "candidate" },
    { id: "e", promotion_status: "instance-specific" },
  ]);
  assert.deepEqual(c, { canonical: 2, evaluating: 1, candidate: 1, "instance-specific": 1, total: 5 });
});

test("GARDEN_GROUPS is label → pod tokens", () => {
  assert.ok(GARDEN_GROUPS["█ lifecycle"].includes("(initialize)"));
  assert.ok(GARDEN_GROUPS["█ builders"].includes("(mcp)"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/quilt-view.test.mjs`
Expected: FAIL — `skillCounts is not exported`

- [ ] **Step 3: Implement skills view**

```js
// append to scripts/lib/quilt-view.mjs

/** Tally skills-matrix promotion_status values. */
export function skillCounts(skills) {
  const c = { canonical: 0, evaluating: 0, candidate: 0, "instance-specific": 0, total: 0 };
  for (const s of skills) {
    c.total++;
    if (c[s.promotion_status] == null) {
      console.warn(`quilt: unknown promotion_status "${s.promotion_status}" (${s.id})`);
      continue;
    }
    c[s.promotion_status]++;
  }
  return c;
}

/** Hand-curated garden domains (template). Membership is prose, counts are data. */
export const GARDEN_GROUPS = {
  "█ lifecycle": ["(initialize)", "(org-os-init)", "(bootstrap-interviewer)", "(commands)"],
  "█ discipline": ["(superpowers ×9 · tdd·debug·plans·worktrees·reviews)"],
  "█ org-ops": ["(heartbeat)", "(meetings)", "(funding)", "(ideas)"],
  "█ knowledge": ["(curator)", "(research)", "(web-browsing)", "(notion-cli)", "(canvas)"],
  "█ builders": ["(skill-creator)", "(mcp)", "(frontend)", "(artifacts)", "(schema-gen)"],
  "█ mentors": ["(feynman)", "(karpathy)", "(workspace)", "(transcription)"],
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/quilt-view.test.mjs`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/quilt-view.mjs tests/quilt-view.test.mjs
git commit -m "feat(quilt): view model — skill pipeline counts + garden groups"
```

---

### Task 6: The generator CLI — weave and write `docs/QUILT.md`

**Files:**
- Create: `scripts/generate-quilt.mjs`
- Modify: `package.json` (add `"generate:quilt": "node scripts/generate-quilt.mjs"` to `scripts`, next to `generate:skills`)
- Test: `tests/generate-quilt.test.mjs`

- [ ] **Step 1: Write the failing smoke test** (spawnSync + tmp fixture root, same pattern as `tests/sync-packages.test.mjs`)

```js
// tests/generate-quilt.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(__dirname, "..", "scripts", "generate-quilt.mjs");

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "quilt-"));
  mkdirSync(path.join(root, "data"));
  mkdirSync(path.join(root, "docs"));
  mkdirSync(path.join(root, "memory"));
  writeFileSync(path.join(root, "data", "instances.yaml"), `instances:
  - id: "refi-bcn-os"
    type: "LocalNode"
    maturity: "production"
    federation_role: "spoke"
    packages: ["a", "b"]
    skills_extra: ["s"]
    last_sync: "2026-03-19"
    drift: []
  - id: "openclaw"
    type: "AgentRuntime"
    maturity: "alpha"
    federation_role: "agent-runtime"
    packages: []
    skills_extra: []
    last_sync: null
    drift: ["stub_identity"]
`);
  writeFileSync(path.join(root, "data", "packages-matrix.yaml"), `packages:
  - id: "org-os-kms"
    in_framework: true
    lifecycle_status: "active"
    promotion_status: "canonical"
    instances_using: ["regen-toolkit"]
    notes: ""
  - id: "koi-bridge"
    in_framework: true
    lifecycle_status: "dormant"
    promotion_status: "canonical"
    instances_using: []
    notes: ""
`);
  writeFileSync(path.join(root, "data", "skills-matrix.yaml"), `skills:
  - id: "initialize"
    promotion_status: "canonical"
  - id: "safe-treasury"
    promotion_status: "candidate"
`);
  writeFileSync(path.join(root, "data", "projects.yaml"), `projects:
  - id: "v2-stabilization"
    status: "Develop"
  - id: "opal-rollout"
    status: "Discovery"
`);
  writeFileSync(path.join(root, "HEARTBEAT.md"), "- [ ] one\n- [ ] two\n- [x] done\n");
  writeFileSync(path.join(root, "memory", "2026-07-16.md"), "log\n");
  return root;
}

test("generator weaves a valid organism from registry data", () => {
  const root = setup();
  const res = spawnSync("node", [scriptPath, "--root", root], { encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  const doc = readFileSync(path.join(root, "docs", "QUILT.md"), "utf8");
  assert.ok(doc.includes("╔═ ORG-OS"));
  assert.ok(doc.includes("refi-bcn █"));           // instance patch, shaded from data
  assert.ok(doc.includes("kms █"));                 // package patch via override
  assert.ok(doc.includes("(koi-bridge)"));          // dormant → sleeping pod
  assert.ok(doc.includes("(openclaw"));             // agent-runtime → substrate pod
  assert.ok(doc.includes("2 open"));                // HEARTBEAT count
  assert.ok(doc.includes("v2-stab ▓"));             // project patch
  assert.ok(doc.includes("(opal-rollout)"));        // discovery pod
  // width invariant: no fenced line wider than organism outer width (88)
  let inFence = false;
  for (const l of doc.split("\n")) {
    if (l.startsWith("```")) { inFence = !inFence; continue; }
    if (inFence) assert.ok([...l].length <= 88, `wide line: ${l}`);
  }
});

test("--stdout prints instead of writing", () => {
  const root = setup();
  const res = spawnSync("node", [scriptPath, "--root", root, "--stdout"], { encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(res.stdout.includes("╔═ ORG-OS"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/generate-quilt.test.mjs`
Expected: FAIL — script not found (spawnSync status !== 0)

- [ ] **Step 3: Implement `scripts/generate-quilt.mjs`**

The weave mirrors `docs/QUILT.md` @ `910ea3a` — same organs, same stitches, same header/legend/footer prose — with every count, shade, date, and drift flag read from the root. Full implementation:

```js
#!/usr/bin/env node
/**
 * generate-quilt.mjs — re-weave docs/QUILT.md (the organism) from data/*.yaml.
 * Phase B of docs/superpowers/specs/2026-07-19-quilt-visualization-design.md.
 *
 * Usage: node scripts/generate-quilt.mjs [--root <dir>] [--stdout]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import {
  patch, pack, pods, organ, organism, stitch, ORGANISM_INNER as OW,
} from "./lib/quilt-compose.mjs";
import {
  instancePatch, syncLedger, packageTiers, projectTiers, skillCounts,
  GARDEN_GROUPS, shortId,
} from "./lib/quilt-view.mjs";

const args = process.argv.slice(2);
const root = args.includes("--root") ? args[args.indexOf("--root") + 1] : process.cwd();
const toStdout = args.includes("--stdout");
const today = new Date().toISOString().slice(0, 10);

const yaml = (rel) => loadYaml(readFileSync(path.join(root, rel), "utf8"));
const instances = yaml("data/instances.yaml").instances ?? [];
const pkgs = yaml("data/packages-matrix.yaml").packages ?? [];
const skills = yaml("data/skills-matrix.yaml").skills ?? [];
const projects = yaml("data/projects.yaml").projects ?? [];

const heartbeat = existsSync(path.join(root, "HEARTBEAT.md"))
  ? readFileSync(path.join(root, "HEARTBEAT.md"), "utf8") : "";
const openTasks = (heartbeat.match(/^- \[ \]/gm) ?? []).length;

const memDates = readdirSync(path.join(root, "memory"))
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
const memAge = memDates.length
  ? `${Math.max(0, Math.round((new Date(today) - new Date(memDates.at(-1).slice(0, 10))) / 86400000))}d ago`
  : "∅";

/* organs */
const core = organ("CORE · nucleus", [
  ...pack([
    patch("HEARTBEAT █", [` ${openTasks} open `]),
    patch("MEMORY █", [` ${memAge} `]),
  ], 34),
  ...pods("█ spine", ["(SOUL)", "(IDENTITY)", "(USER)", "(TOOLS)"], 34),
  "▓ MASTERPLAN · the mandate",
], 38);

const registries = existsSync(path.join(root, "data"))
  ? readdirSync(path.join(root, "data")).filter((f) => f.endsWith(".yaml")).length : 0;
const schemas = existsSync(path.join(root, ".well-known"))
  ? readdirSync(path.join(root, ".well-known")).filter((f) => f.endsWith(".json")).length : 0;

const data = organ("DATA ≡ SCHEMAS", [
  ...pack([
    patch("data/*.yaml █", [` ×${registries} registries `]),
    patch(".well-known █", [` EIP-4824 ×${schemas} `]),
  ], 41),
  "≡ generate ⇄ validate ✓",
  "  yaml is truth, schema is face",
], 45);

const interfaces = organ("INTERFACES · doors", [
  ...pods("in", ["(claude-code █)", "(obsidian █ hub)", "(zed/acp ▓)", "(opencode ▓)",
    "(hermes ▓)", "(canvas ▒)", "(web-dash ░)"], 37),
  "~ many doors, one house",
], 41);

const integrations = organ("INTEGRATIONS · edges", [
  ...pods("out", ["(github █)", "(notion █)", "(koi ▓ mcp)", "(hermes ▓)",
    "(opal ░ » rollout)", "(eip-4824 ≡ █)"], 38),
  "~ where the world plugs in",
], 42);

const scriptCount = existsSync(path.join(root, "scripts"))
  ? readdirSync(path.join(root, "scripts")).filter((f) => f.endsWith(".mjs")).length : 0;
const automation = organ(`AUTOMATION · metabolism · scripts ×${scriptCount} + hooks`, [
  ...pods("loop", ["(initialize » dashboard)", "(generate ⇄ validate)",
    "(sync-upstream ↔ spokes)", "(analyze » drift-report)", "(clone-framework » birth)"], 80),
], OW);

const bodies = instances.filter((i) => i.federation_role !== "agent-runtime");
const substrates = instances.filter((i) => i.federation_role === "agent-runtime");
const driftTotal = instances.reduce((n, i) => n + (i.drift ?? []).length, 0);
const networks = new Set(instances.map((i) => i.federation_network).filter(Boolean)).size;
const instPatches = bodies.map((i) => { const p = instancePatch(i); return patch(p.title, p.lines); });

const federation = organ(
  `FEDERATION · the membrane · ◉ hub ↔ ${instances.length} · ${networks} networks`, [
    ...pack(instPatches, 80),
    ...(substrates.length ? pods("▒☓ substrate", substrates.map((s) =>
      `(${shortId(s.id)} · agent runtime · sync ∅ · ${(s.drift ?? []).length} drift)`), 80) : []),
    `${syncLedger(instances, new Date(today))} · ☓${driftTotal}`,
  ], OW);

const tiers = packageTiers(pkgs);
const packagesOrgan = organ(`PACKAGES · travelers · matrix ×${pkgs.length}`, [
  ...pack(tiers.patches.map((p) => patch(p.title, p.lines)), 80),
  ...(tiers.sleeping.length ? pods("░ sleeping", tiers.sleeping, 80) : []),
  ...(tiers.away.length ? pods("~ away, instance-owned", tiers.away, 80) : []),
], OW);

const sc = skillCounts(skills);
const skillsOrgan = organ(`SKILLS · the garden · matrix ×${sc.total}`, [
  ...pack([
    patch("PIPELINE ⊕", [` ▒×${sc.candidate} → ▓×${sc.evaluating} → █×${sc.canonical} `,
      " promotion is the pulse "]),
    patch("DAO WAVE ▒⊕", [" safe·hats·gardens ", " karma·eip4824 » next "]),
  ], 80),
  ...Object.entries(GARDEN_GROUPS).flatMap(([label, tokens]) => pods(label, tokens, 80)),
  ...pods("▒ local color", [`(instance-specific ×${sc["instance-specific"]})`,
    "— stays local until it proves general"], 80),
], OW);

const pt = projectTiers(projects);
const projectsOrgan = organ(`PROJECTS · the field · ×${projects.length}`, [
  ...pack(pt.patches.map((p) => patch(p.title, p.lines)), 80),
  ...(pt.discovery.length ? pods("▒ discovery", pt.discovery, 80) : []),
  ...pack([patch("QUEUE ░",
    [" » autopoiesis-p2 (12-task TDD) · multica ×25 · e2e sync · scoping ×4 "])], 80),
], OW);

const version = existsSync(path.join(root, "federation.yaml"))
  ? (yaml("federation.yaml").metadata?.framework_version ?? "?") : "?";

const body = organism(`ORG-OS · framework v${version} · woven ${today}`, [
  [core, data],
  stitch("∴ the nucleus writes truth · truth becomes face"),
  [interfaces, integrations],
  stitch("↕"),
  [automation],
  stitch("↔ the membrane breathes: sync-upstream out, promotion ⊕ back in"),
  [federation],
  stitch("⊕"),
  [packagesOrgan],
  stitch("⊕"),
  [skillsOrgan],
  stitch("»"),
  [projectsOrgan],
]);

const doc = `# org-os · QUILT

> A [QUILT-protocol](https://wibandwob.com/quiltprotocol/) visualization of the org-os
> system as **one organism** — modules, integrations, and federation as nested
> containers, shaded by live status.
>
> Woven **${today}** by \`npm run generate:quilt\` from \`data/*.yaml\` — do not edit by
> hand; edit the view templates in \`scripts/lib/quilt-view.mjs\`.

## Legend

\`\`\`
containment ╔═╗ organism · ┏━┓ organ · ╭─╮ patch (size = vitality) · (pod) small/asleep
status      █ live · ▓ moving · ▒ forming · ░ latent · ☓ needs attention
stitches    → flow · ↔ sync · ⊕ promotion · ≡ correspondence · ∴ therefore
            » points-to-next · ◉ hub · ✓ verified · ∅ never · ~ ambient
\`\`\`

Status is mapped from each registry's native vocabulary: instance maturity
(\`production/beta/alpha\`), package \`lifecycle_status\`, skill \`promotion_status\`,
project stage (\`Develop/Discovery\`), and drift flags. A thing earns its pixels:
live patches get room, dormant things shrink to pods.

## The organism

\`\`\`
${body}
\`\`\`

#orgos-organism · one membrane ∴ organs breathe · patches earn size · pods sleep ░ · hub ↔ spokes ⊕

---

*Sources: \`data/instances.yaml\`, \`data/packages-matrix.yaml\`, \`data/skills-matrix.yaml\`,*
*\`data/projects.yaml\`, \`federation.yaml\`, \`HEARTBEAT.md\`. Regenerate: \`npm run generate:quilt\`.*
`;

if (toStdout) {
  process.stdout.write(doc);
} else {
  writeFileSync(path.join(root, "docs", "QUILT.md"), doc);
  console.log(`woven docs/QUILT.md (${today}) · instances ×${instances.length} · packages ×${pkgs.length} · skills ×${sc.total} · projects ×${projects.length}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/generate-quilt.test.mjs`
Expected: PASS (2 tests)

- [ ] **Step 5: Add the npm script**

In `package.json` `scripts`, after `"generate:skills"`:

```json
"generate:quilt": "node scripts/generate-quilt.mjs",
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS (all suites, including the pre-existing clone-framework/render/sync-packages/discover-skills tests)

- [ ] **Step 7: Regenerate the real quilt and eyeball it**

Run: `npm run generate:quilt && sed -n '/^## The organism/,/^#orgos/p' docs/QUILT.md`
Expected: organism renders with live counts (instances ×7, packages ×23, skills ×40); layout matches the reference render at `910ea3a` modulo data-derived values. Verify no organ overflow error, ledger ordering sensible, QUEUE patch present.

- [ ] **Step 8: Commit**

```bash
git add scripts/generate-quilt.mjs package.json tests/generate-quilt.test.mjs docs/QUILT.md
git commit -m "feat(quilt): generate:quilt — re-weave organism from data/*.yaml (Phase B)"
```

---

### Task 7: Close the loop — spec + HEARTBEAT

**Files:**
- Modify: `docs/superpowers/specs/2026-07-19-quilt-visualization-design.md` (Phase B section)
- Modify: `HEARTBEAT.md` (routine)

- [ ] **Step 1: Mark Phase B shipped in the spec**

In the spec's `## Phase B — generator outline` heading, change to `## Phase B — generator (shipped)` and replace the body's first bullet with:

```markdown
- Shipped as `scripts/generate-quilt.mjs` + `scripts/lib/quilt-compose.mjs` +
  `scripts/lib/quilt-view.mjs`; `npm run generate:quilt`. Tests: `tests/quilt-*.test.mjs`,
  `tests/generate-quilt.test.mjs`.
```

- [ ] **Step 2: Add the regeneration routine to HEARTBEAT.md**

In the HEARTBEAT routines/recurring section (alongside "After any `data/` change → `npm run generate:schemas && npm run validate:schemas`"), add:

```markdown
- [ ] After any `data/` change → `npm run generate:quilt` (QUILT.md is generated — never hand-edit)
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-19-quilt-visualization-design.md HEARTBEAT.md
git commit -m "docs(quilt): mark Phase B shipped; add generate:quilt to HEARTBEAT routine"
```

---

## Self-Review Notes

- **Spec coverage:** composer core (Tasks 1-2), data-driven shades/counts/tiering (Tasks 3-5), CLI + npm script + width self-check (Task 6), regeneration + staleness stamp (Task 6 Step 7), spec/HEARTBEAT closure (Task 7). The spec's open question (data-driven vs template-fixed federation art) is resolved by rev 2026-07-19b: instance patches are fully data-driven; garden groups/taglines are template constants with warn-on-unknown.
- **Known intentional divergences from the hand-woven render:** MEMORY/HEARTBEAT figures, ledger, and matrix counts become live; `branch v0.5` dropped from the organism title (git state isn't registry data); hand render's `36 open · 0 crit` becomes `N open`. Acceptable per spec ("prose taglines stay hand-authored; data is live").
- **Type consistency check:** `patch()` returns `string[]`; view functions return `{title, lines}` specs and the CLI adapts via `patch(p.title, p.lines)` — consistent across Tasks 3-6. `ORGANISM_INNER` exported in Task 2, imported in Task 6.
