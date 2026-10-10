// drift.mjs — the pure part of the docs drift report (spec §5.5).
// scripts/docs-drift.mjs asks git which paths changed; this turns the answers
// into text a person can read. No git here, so it is testable without a history.

/**
 * @typedef {{ slug: string, source: string, verified: string, covers: string[],
 *   changed: string[] | null, error?: string }} DriftEntry
 *   `changed` is null when git could not compare (the reason is in `error`).
 */

const short = (sha) => String(sha).slice(0, 7);

/** The pages worth asking git about: those that list `covers` and have a verified commit. */
export function pagesToCheck(pages) {
  return pages.filter((p) => Array.isArray(p.covers) && p.covers.length > 0 && typeof p.verified === "string" && p.verified !== "");
}

/** The report, as a string. Never throws; a page git could not compare is listed as such. */
export function formatDriftReport(entries, { head = "HEAD" } = {}) {
  const drifted = entries.filter((e) => e.changed && e.changed.length > 0);
  const failed = entries.filter((e) => e.changed === null);
  const lines = [];
  lines.push(`docs drift: ${entries.length} page(s) with covers, compared with ${head}`);
  lines.push("");
  for (const e of entries) {
    if (e.changed === null) {
      lines.push(`? ${e.slug} (${e.source}) — verified at ${short(e.verified)}; could not compare: ${e.error ?? "unknown error"}`);
    } else if (e.changed.length === 0) {
      lines.push(`  ${e.slug} (${e.source}) — verified at ${short(e.verified)}: no changes under its covers`);
    } else {
      lines.push(`! ${e.slug} (${e.source}) — verified at ${short(e.verified)}: ${e.changed.length} changed path(s)`);
      for (const path of e.changed) lines.push(`    ${path}`);
    }
  }
  lines.push("");
  if (drifted.length === 0 && failed.length === 0) lines.push("No page has drifted: nothing under any page's covers changed since it was verified.");
  else {
    const parts = [];
    if (drifted.length > 0) parts.push(`${drifted.length} of ${entries.length} page(s) have code changes since they were verified — re-check them`);
    if (failed.length > 0) parts.push(`${failed.length} page(s) could not be compared`);
    lines.push(parts.join("; ") + ".");
  }
  return lines.join("\n") + "\n";
}
