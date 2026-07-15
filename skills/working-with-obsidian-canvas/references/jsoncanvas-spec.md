# JSONCanvas spec (1.0) — minimal reference

Canonical source: https://jsoncanvas.org/ · MIT-licensed, maintained by Obsidian.
GitHub: https://github.com/obsidianmd/jsoncanvas

This is the *minimum viable* subset Claude needs to read, write, and validate canvases without depending on a library. Full spec at the link above.

## Top-level shape

```json
{
  "nodes": [ ... ],
  "edges": [ ... ]
}
```

Both arrays are optional in the spec but **required by this skill's validator** — write `"nodes": []` / `"edges": []` rather than omitting them.

## Node — common fields (all node types)

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Unique within the canvas. This vault uses 16-char lowercase hex. |
| `type` | `"text"` \| `"file"` \| `"link"` \| `"group"` | yes | |
| `x`, `y` | number (int px) | yes | Top-left corner. Origin is canvas (0,0); negatives allowed. |
| `width`, `height` | number (int px) | yes | Must be > 0. |
| `color` | string | no | `"1"`–`"6"` (palette) or `"#rrggbb"`. Spec also allows preset names. This vault uses `"1".."6"` only. |

## Node — type-specific fields

### `type: "text"`

```json
{
  "id": "...", "type": "text",
  "x": 0, "y": 0, "width": 400, "height": 120,
  "text": "Markdown content — supports headings, lists, bold, inline code."
}
```

- `text`: required, Markdown string.
- Rendered with Obsidian's Markdown renderer (links to vault files work; transclusion supported).

### `type: "file"`

```json
{
  "id": "...", "type": "file",
  "x": 0, "y": 0, "width": 350, "height": 80,
  "file": "data/projects.yaml",
  "subpath": "#heading-or-block-id"
}
```

- `file`: required, **vault-relative path** (no leading slash). This skill resolves it against the nearest ancestor containing `.obsidian/` or `package.json`.
- `subpath`: optional, anchor inside the file (`#heading` for Markdown).
- The file should exist on disk. Validator flags missing files as errors.

### `type: "link"`

```json
{
  "id": "...", "type": "link",
  "x": 0, "y": 0, "width": 400, "height": 120,
  "url": "https://example.com"
}
```

- `url`: required, must parse as a URL.

### `type: "group"`

```json
{
  "id": "...", "type": "group",
  "x": 0, "y": 0, "width": 1200, "height": 600,
  "label": "Brand Strategy",
  "background": "path/to/img.png",
  "backgroundStyle": "cover"
}
```

- `label`: optional, group title.
- `background`, `backgroundStyle`: optional, rarely used in this vault.
- Groups are containers — nodes "in" a group are simply nodes whose bounding box sits inside the group's bounding box. There's no parent/child link in the JSON; containment is inferred geometrically.

## Edge

```json
{
  "id": "...",
  "fromNode": "<node-id>",
  "toNode": "<node-id>",
  "fromSide": "right",
  "toSide": "left",
  "fromEnd": "none",
  "toEnd": "arrow",
  "color": "5",
  "label": "writes →"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Unique within the canvas. |
| `fromNode` | string | yes | Must resolve to a node `id`. |
| `toNode` | string | yes | Must resolve to a node `id`. |
| `fromSide` | `"top"` \| `"right"` \| `"bottom"` \| `"left"` | no | Anchor point. |
| `toSide` | same enum | no | Anchor point. |
| `fromEnd` | `"none"` \| `"arrow"` | no | Default `"none"`. |
| `toEnd` | `"none"` \| `"arrow"` | no | Default `"arrow"`. |
| `color` | string | no | Same palette as nodes. |
| `label` | string | no | Edge text. |

## Worked example — minimal valid canvas

```json
{
  "nodes": [
    {
      "id": "0000000000000001",
      "type": "text",
      "x": 0, "y": 0,
      "width": 400, "height": 120,
      "text": "# Hello\nThis is a text node."
    },
    {
      "id": "0000000000000002",
      "type": "file",
      "x": 500, "y": 0,
      "width": 350, "height": 80,
      "file": "README.md"
    }
  ],
  "edges": [
    {
      "id": "edge-001",
      "fromNode": "0000000000000001",
      "toNode": "0000000000000002",
      "toEnd": "arrow",
      "label": "see also"
    }
  ]
}
```

## Common gotchas

- **Coordinates are integers in practice.** Obsidian writes ints; floats parse but look out-of-place in diffs. Use `Math.round(x)` when generating.
- **Negative coordinates are normal.** Canvases grow in all four quadrants. Don't normalize to (0,0).
- **Group containment is geometric, not declarative.** If you move a child node, it may "leave" its group silently — Obsidian re-checks containment on render.
- **`color` is a string, not a number.** `"1"`, not `1`.
- **File-node paths are vault-relative.** A canvas living at `docs/canvases/foo.canvas` that references `data/projects.yaml` resolves from the vault root, *not* from `docs/canvases/`.
- **Edge `fromEnd` defaults to "none" but `toEnd` defaults to "arrow"**. If you want a no-arrow connection, set `toEnd: "none"` explicitly.

## What this spec does NOT cover (deferred)

- Embedded canvas-in-canvas — `type: "file"` with a `.canvas` target works, but Obsidian's behavior on cycles is undefined. Don't nest.
- Rich style overrides per node (border, shadow, opacity). Not in JSONCanvas 1.0.
- Animation, layers, z-order. Stacking is implicit by array order.
