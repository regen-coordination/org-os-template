// fragments.mjs — pure helpers for checking that a "#fragment" in a link
// points at an element that exists in the page it targets. No filesystem:
// verify-build.mjs reads the built pages and passes their HTML in.

/** The set of ids (and anchor names) a page's HTML defines. */
export function idsIn(html) {
  const ids = new Set();
  for (const tag of stripInert(html).matchAll(/<[a-zA-Z][^>]*>/g)) {
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

/**
 * The page with the text of `<code>` and `<pre>` taken out. They hold text a
 * doc may write as an example (`src="x.json"`), which the link checks must not
 * read as an attribute of a real element. Markup nested inside them is real
 * and stays, so a raw-HTML link written in a `<code>` is still checked. The
 * element's own tags go: they carry no href or src. The name must end at a
 * space or `>`, so `<code-block>` and `<pre-x>` are other elements.
 */
export function stripCode(html) {
  return html.replace(/<(pre|code)(?=[\s>])[^>]*>([\s\S]*?)<\/\1\s*>/gi, (_all, _name, inner) => inner.match(/<[^>]*>/g)?.join("") ?? "");
}

/**
 * Did the fragment check look at enough? Returns the failure text, or null.
 * Same-page links always exist (the skip link), so their absence means the
 * pattern is stale; a build with no cross-page link is legitimate, but one
 * with no fragment link of either kind looked at nothing.
 */
export function fragmentCoverage(samePage, crossPage) {
  if (samePage === 0 && crossPage === 0) return "fragment check: matched 0 #fragment links — the pattern is stale";
  if (samePage === 0) return "fragment check: matched 0 same-page #fragment links — the pattern is stale";
  return null;
}

/** The page without comments and the elements whose text is not markup (script, style, template, textarea). */
export function stripInert(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|template|textarea)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
}
