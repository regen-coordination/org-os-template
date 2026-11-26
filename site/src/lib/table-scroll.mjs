// table-scroll.mjs — a docs table wider than its column scrolls sideways in a
// region of its own, so the page never scrolls sideways. A region that scrolls
// must be reachable by keyboard and named, or it is a part of the page some
// readers cannot get to. Three pieces, shared so they cannot disagree:
//   - the rehype plugin wraps every markdown table at build time, so the
//     region works with script off;
//   - `tablesOutsideRegion` lets scripts/verify-build.mjs fail a build whose
//     page has a table the plugin did not reach (one written as raw HTML);
//   - `moreTo` and HINTS are what the page's script uses to print the cue.

const NAME_MAX = 80;

const textOf = (node) => node.type === "text" ? node.value : (node.children ?? []).map(textOf).join("");
function find(node, tagName, out = []) {
  for (const child of node.children ?? []) {
    if (child.type === "element" && child.tagName === tagName) out.push(child);
    else find(child, tagName, out);
  }
  return out;
}

/** The region's name: "Table: " and the column headings, cut at 80 characters. */
export function tableName(table) {
  const headings = find(table, "th").map((th) => textOf(th).replace(/\s+/g, " ").trim()).filter(Boolean);
  if (headings.length === 0) return "Table";
  const name = `Table: ${headings.join(", ")}`;
  return name.length <= NAME_MAX ? name : `${name.slice(0, NAME_MAX - 1).trimEnd()}…`;
}

const isRegion = (node) => node.type === "element" && (node.properties?.className ?? []).includes("table-scroll");

/** rehype plugin: `<table>` becomes `<div class="table-scroll" role="region" aria-label="…" tabindex="0"><table>`. */
export default function rehypeTableScroll() {
  return (tree) => {
    (function walk(node) {
      if (isRegion(node)) return;
      for (const [i, child] of (node.children ?? []).entries()) {
        if (child.type === "element" && child.tagName === "table") {
          node.children[i] = {
            type: "element", tagName: "div",
            properties: { className: ["table-scroll"], role: "region", ariaLabel: tableName(child), tabIndex: 0 },
            children: [child],
          };
        } else walk(child);
      }
    })(tree);
  };
}

/** In built HTML: how many tables there are, and how many are not directly inside a focusable, named region. */
export function tablesOutsideRegion(html) {
  let tables = 0, outside = 0;
  for (const m of html.matchAll(/(<div\b[^>]*>)?\s*<table\b/g)) {
    tables++;
    const open = m[1] ?? "";
    const ok = /\bclass="[^"]*\btable-scroll\b/.test(open) && /\brole="region"/.test(open)
      && /\baria-label="[^"]+"/.test(open) && /\btabindex="0"/.test(open);
    if (!ok) outside++;
  }
  return { tables, outside };
}

/** Which way a scroll region has more: "", "right", "left" or "both". */
export function moreTo({ scrollLeft, clientWidth, scrollWidth }) {
  const right = scrollWidth - clientWidth - scrollLeft > 1;
  const left = scrollLeft > 1;
  return right && left ? "both" : right ? "right" : left ? "left" : "";
}

/** The words of the cue above a table that does not fit. */
export const HINTS = {
  right: "more columns: scroll sideways →",
  both: "← more columns: scroll sideways →",
  left: "← more columns: scroll sideways",
};
