// fragments.mjs — pure helpers for checking that a "#fragment" in a link
// points at an element that exists in the page it targets. No filesystem:
// verify-build.mjs reads the built pages and passes their HTML in.

/** The set of ids (and anchor names) a page's HTML defines. */
export function idsIn(html) {
  const ids = new Set();
  for (const tag of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const isAnchor = /^<a\s/i.test(tag[0]);   // `name` is a fragment target only on <a>
    // Walk the tag's attributes one at a time so quoted values are skipped whole.
    for (const m of tag[0].matchAll(/\s([^\s=/>]+)(?:=("[^"]*"|'[^']*'|[^\s>]*))?/g)) {
      const name = m[1].toLowerCase();
      if (name !== "id" && !(name === "name" && isAnchor)) continue;
      const value = (m[2] ?? "").replace(/^["']|["']$/g, "");
      if (value !== "") ids.add(value);
    }
  }
  return ids;
}

/** The decoded fragment of an address, or null when it has none (or an empty one). */
export function fragmentOf(href) {
  const i = href.indexOf("#");
  if (i === -1) return null;
  const raw = href.slice(i + 1);
  if (raw === "") return null;
  try { return decodeURIComponent(raw); } catch { return raw; }
}

/** Does `fragment` name an id in `ids`? `#top` and the empty fragment always resolve (browsers scroll to the top). */
export function fragmentVerdict(fragment, ids) {
  if (fragment === "" || fragment === "top") return { ok: true };
  if (ids.has(fragment)) return { ok: true };
  return { ok: false, reason: `no element with id "${fragment}" in the target page` };
}
