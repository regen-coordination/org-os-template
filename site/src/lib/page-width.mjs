// page-width.mjs — PURE parts of the two checks that a page does not scroll sideways.
//
// 1. The rule, read from the stylesheet (test/page-width.test.mjs, at every
//    `npm test`): inline code in a doc may break inside a word. A long path or
//    address set in <code> has no place to break, and without the rule the
//    paragraph holding it is wider than a phone's screen.
// 2. The measurement, taken in a browser (`npm run widths`,
//    scripts/page-widths.mjs): every built page, at each width, is as wide as
//    the viewport and no wider. It needs Chrome on the machine, so it is not
//    part of `npm run build`; the rule above is what the build's tests hold.

// The widths measured: a common phone, and the narrowest phone still in use.
export const WIDTHS = [375, 320];

const WRAPS = /overflow-wrap\s*:\s*(anywhere|break-word)\b/;

// The selectors of a rule, with Astro's :global() wrapper removed.
function selectorsOf(prelude) {
  return prelude.replace(/:global\(((?:[^()]|\([^()]*\))*)\)/g, "$1").split(",").map((s) => s.trim());
}

// Does a stylesheet let inline code in a doc break inside a word?
// Returns one sentence per problem; none means the rule is there.
// The rule must be on `code` that is not inside `pre` (a code block scrolls in
// its own box, and its lines must not be broken), under the doc's class.
export function inlineCodeWrapProblems(css, { scope = ".doc" } = {}) {
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const onInlineCode = (selector) =>
    selector.startsWith(`${scope} `) && /(^|[\s>])(:not\(pre\)\s*>\s*code|code:not\(pre\s+code\)|code:not\(pre\s*>\s*code\))$/.test(selector);
  const wrapping = rules.filter(([, prelude, body]) => WRAPS.test(body) && selectorsOf(prelude).some(onInlineCode));
  if (wrapping.length > 0) return [];
  return [`no rule lets inline code under ${scope} break inside a word. Add \`${scope} :global(:not(pre) > code) { overflow-wrap: break-word; }\`: without it a long path or address in <code> makes the page scroll sideways on a phone.`];
}

// The built pages to measure: every index.html under dist/, as the address it is served at.
export function pagesIn(files) {
  return files
    .filter((file) => file === "index.html" || file.endsWith("/index.html"))
    .map((file) => `/${file.replace(/index\.html$/, "")}`)
    .sort();
}

// What was measured, as sentences. `measured` is [{ page, width, documentWidth,
// widest: [{ what, right }] }]: the viewport asked for, the document's
// scrollWidth, and the elements that reach past the viewport's edge.
export function widthProblems(measured) {
  const problems = [];
  for (const { page, width, documentWidth, widest = [] } of measured) {
    if (documentWidth === width) continue;
    if (!Number.isFinite(documentWidth)) { problems.push(`${page} at ${width}px could not be measured (the browser returned ${documentWidth}).`); continue; }
    const cause = widest.length > 0
      ? ` Reaching past the edge: ${widest.map(({ what, right }) => `${what} (to ${Math.round(right)}px)`).join("; ")}.`
      : "";
    problems.push(`${page} at ${width}px is ${documentWidth}px wide: the page scrolls sideways by ${documentWidth - width}px.${cause} Let the text break (overflow-wrap) or put the wide thing in a box that scrolls on its own.`);
  }
  return problems;
}

// The summary line. A run that measured nothing is a failure, not a pass.
export function widthSummary(measured, widths = WIDTHS) {
  const pages = new Set(measured.map((m) => m.page)).size;
  const wide = new Set(measured.filter((m) => m.documentWidth !== m.width).map((m) => m.page)).size;
  if (pages === 0) return { ok: false, line: "page widths: measured no page — is dist/ built? Run `npm run build` first." };
  const missing = widths.filter((w) => !measured.some((m) => m.width === w));
  if (missing.length > 0) return { ok: false, line: `page widths: nothing was measured at ${missing.join(" and ")}px.` };
  return wide === 0
    ? { ok: true, line: `page widths: ${pages} pages at ${widths.join(" and ")}px, each exactly as wide as the screen` }
    : { ok: false, line: `page widths: ${wide} of ${pages} pages scroll sideways at ${widths.join(" or ")}px` };
}
