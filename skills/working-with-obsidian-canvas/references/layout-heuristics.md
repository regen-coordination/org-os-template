# Layout heuristics — three recipes for canvas generation

When generating a new canvas or auto-placing a small number of new nodes, pick one of these three recipes. Do **not** invoke dagre / force-directed / ELK in v0.1 of this skill — those are deferred.

## Recipe 1 — Hub-and-spoke (compass geometry)

**Use when:** one root + 2–8 branches. Examples: a dashboard with sub-pages, a topic with related-concept clusters.

**Math** (copied from `scripts/generate-canvases.mjs`):

```js
const HUB_W = 800, HUB_H = 600;
const LEAF_FILE_W = 350, LEAF_FILE_H = 80;
const PADDING = 40;

function compass(bearing, radius) {
  const rad = (bearing - 90) * Math.PI / 180;
  return { x: Math.cos(rad) * radius, y: Math.sin(rad) * radius };
}

function sideForBearing(bearing) {
  if (bearing < 22.5 || bearing >= 337.5) return { fromSide: "top",    toSide: "bottom" };
  if (bearing < 67.5)                     return { fromSide: "top",    toSide: "bottom" };
  if (bearing < 112.5)                    return { fromSide: "right",  toSide: "left"   };
  if (bearing < 157.5)                    return { fromSide: "bottom", toSide: "top"    };
  if (bearing < 202.5)                    return { fromSide: "bottom", toSide: "top"    };
  if (bearing < 247.5)                    return { fromSide: "bottom", toSide: "top"    };
  if (bearing < 292.5)                    return { fromSide: "left",   toSide: "right"  };
  return                                       { fromSide: "top",    toSide: "bottom" };
}

// Build:
const hub = { id: "hub", type: "file", file: "ROOT.md",
              x: -HUB_W/2, y: -HUB_H/2, width: HUB_W, height: HUB_H, color: "5" };
const radius = 1600;  // tune by branch count
const leaves = branches.map((b, i) => {
  const bearing = (360 / branches.length) * i;
  const { x, y } = compass(bearing, radius);
  return {
    id: b.id, type: "file", file: b.file,
    x: Math.round(x - LEAF_FILE_W/2),
    y: Math.round(y - LEAF_FILE_H/2),
    width: LEAF_FILE_W, height: LEAF_FILE_H,
  };
});
const edges = branches.map((b, i) => {
  const bearing = (360 / branches.length) * i;
  return { id: `edge-${i}`, fromNode: "hub", toNode: b.id, ...sideForBearing(bearing) };
});
```

**Tuning:**
- Radius ≈ `max(HUB_W, HUB_H) + (max leaf size * 2)` for 4 branches; scale up for more.
- For >8 branches, prefer grid or zone-with-leaves.

## Recipe 2 — Grid

**Use when:** N disjoint items, no parent. Catalogs, lists, palettes.

```js
const cols = Math.ceil(Math.sqrt(items.length));
const PAD_X = 40, PAD_Y = 40;
const CELL_W = 350, CELL_H = 100;

const nodes = items.map((item, i) => {
  const col = i % cols;
  const row = Math.floor(i / cols);
  return {
    id: item.id,
    type: item.type ?? "text",
    x: col * (CELL_W + PAD_X),
    y: row * (CELL_H + PAD_Y),
    width: CELL_W,
    height: CELL_H,
    text: item.text,
    file: item.file,
    url: item.url,
    color: item.color,
  };
});
```

**Tuning:**
- For text-heavy items, increase `CELL_H` to 200; for file-refs, 80 is enough.
- Add a single title group node above the grid (color `"5"`) if the canvas needs a header.

## Recipe 3 — Zone-with-leaves

**Use when:** content clusters into named zones (e.g., the branding canvas: "Brand Strategy" / "Visual Inspiration" / "Decisions"). Mirrors how `projects/branding/branding.canvas` is structured.

```js
// Each zone is a group node; its children are positioned inside.
const ZONE_W = 1400, ZONE_H = 1000, ZONE_PAD = 40;
const CHILD_W = 400, CHILD_H = 120, CHILD_PAD = 20;

const nodes = [];
zones.forEach((zone, zi) => {
  const zx = zi * (ZONE_W + 120);  // horizontal arrangement of zones
  const zy = 0;
  nodes.push({
    id: zone.id, type: "group",
    x: zx, y: zy, width: ZONE_W, height: ZONE_H,
    label: zone.label, color: zone.color,
  });

  // Children inside the zone, flowed top-to-bottom in two columns
  zone.children.forEach((child, ci) => {
    const col = ci % 2;
    const row = Math.floor(ci / 2);
    nodes.push({
      ...child,
      x: zx + ZONE_PAD + col * (CHILD_W + CHILD_PAD),
      y: zy + ZONE_PAD + row * (CHILD_H + CHILD_PAD),
      width: CHILD_W,
      height: CHILD_H,
    });
  });
});
```

**Tuning:**
- Resize `ZONE_W` / `ZONE_H` to fit the largest zone's children + padding.
- Don't auto-shrink zone height to fit children tightly — leave 40px slack at the bottom for in-session additions.

## Auto-place rule (single new node in existing canvas)

When adding ONE new node to a canvas with hand-laid existing content:

1. Identify the target group from operator intent (e.g., "in the Decisions zone").
2. Compute `(zx, zy, zw, zh)` of the target group.
3. Collect all non-group children inside the group's bounding box.
4. Find the lowest `y` among them; place the new node at `(zx + 40, lowest_y + CHILD_H + 20)`.
5. If that overflows the zone height, resize the zone (height += new node H + padding).
6. If no target group, place below the lowest non-group node in the canvas, with `x = 0` and `padding = 40`.

**Never:**
- Re-flow existing nodes to make room.
- Auto-pick a random `(x, y)` and hope it doesn't overlap.
- Compute "optimal" placement with a real layout algorithm — those destroy intentional spatial relationships.

## When to give up and ask

If the operator's intent doesn't fit any of the three recipes (e.g., "make it look like a flowchart with branches and joins"), don't improvise. Ask:

> "I have three layout recipes: hub-and-spoke, grid, and zone-with-leaves. What you're describing sounds like a hierarchical flowchart, which would need dagre or similar — that's not in this skill's v0.1 scope. Want me to (a) approximate with hub-and-spoke, (b) hand-place the nodes one by one with your input, or (c) skip the canvas and write a Markdown outline instead?"

## Out of scope (deferred)

- Dagre / Sugiyama hierarchical layout.
- Force-directed (D3 / fdg).
- ELK / OGDF.
- Auto-routing of edges around obstacles.
- Re-layout of existing canvases.

Track these in a follow-up plan if demand emerges.
