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
