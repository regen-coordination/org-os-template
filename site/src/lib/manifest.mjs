// manifest.mjs — pure functions over a docs manifest. No filesystem, no git:
// callers pass those in, so this is testable without either.

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const SHA = /^[0-9a-f]{7,40}$/;
const filled = (v) => typeof v === "string" && v.trim() !== "";

/** Pages in reading order: by the order of `sections`, then by `order`. */
export function sortPages(pages, sections) {
  const rank = new Map(sections.map((s, i) => [s.id, i]));
  return [...pages].sort(
    (a, b) => (rank.get(a.section) ?? 999) - (rank.get(b.section) ?? 999) || a.order - b.order,
  );
}

/** The pages before and after `slug` in reading order. */
export function neighboursOf(pages, sections, slug) {
  const ordered = sortPages(pages, sections);
  const i = ordered.findIndex((p) => p.slug === slug);
  if (i === -1) return { prev: null, next: null };
  return { prev: ordered[i - 1] ?? null, next: ordered[i + 1] ?? null };
}

/**
 * Every problem in a manifest, as messages a person can act on.
 * @param {{ fileExists: (path: string) => boolean, commitExists: (sha: string) => boolean, allowUnverified: boolean }} io
 */
export function validateManifest(pages, sections, { fileExists, commitExists, allowUnverified, trackedFiles }) {
  const problems = [];
  const sectionIds = new Set(sections.map((s) => s.id));
  const slugs = new Set();
  const sources = new Set();

  for (const p of pages) {
    const at = `manifest: ${p.source || p.slug || "(unnamed entry)"}`;
    for (const field of ["source", "slug", "title", "summary"]) {
      if (!filled(p[field])) problems.push(`${at} — ${field} is empty`);
    }
    if (filled(p.slug) && !SLUG.test(p.slug)) problems.push(`${at} — slug "${p.slug}" must be lower-case letters, digits and hyphens`);
    if (!sectionIds.has(p.section)) problems.push(`${at} — section "${p.section}" is not one of ${[...sectionIds].join(", ")}`);
    if (!Number.isFinite(p.order)) problems.push(`${at} — order must be a number`);

    if (filled(p.source)) {
      if (p.source.startsWith("/") || p.source.split("/").includes("..")) {
        problems.push(`${at} — source must be a path inside the repository, from its root`);
      } else if (!p.source.endsWith(".md")) {
        problems.push(`${at} — source must be a .md file`);
      } else if (!fileExists(p.source)) {
        problems.push(`${at} — source does not exist`);
      }
    }

    if (slugs.has(p.slug)) problems.push(`${at} — duplicate slug "${p.slug}"`);
    slugs.add(p.slug);
    if (sources.has(p.source)) problems.push(`${at} — duplicate source`);
    sources.add(p.source);

    if (p.verified == null) {
      if (!allowUnverified) problems.push(`${at} — not verified (no commit recorded)`);
    } else if (typeof p.verified !== "string" || !SHA.test(p.verified)) {
      problems.push(`${at} — verified "${p.verified}" is not a commit id`);
    } else if (!commitExists(p.verified)) {
      problems.push(`${at} — verified commit ${p.verified} is not in the repository`);
    }

    if (p.covers !== undefined && !(Array.isArray(p.covers) && p.covers.every(filled))) {
      problems.push(`${at} — covers must be a list of paths`);
    } else if (Array.isArray(trackedFiles) && Array.isArray(p.covers)) {
      // A covers path that names nothing would report "no changes" for ever.
      for (const c of p.covers) {
        const dir = c.replace(/\/+$/, "") + "/";
        if (!trackedFiles.some((f) => f === c || f.startsWith(dir))) problems.push(`${at} — covers "${c}" matches no tracked file`);
      }
    }
  }
  return problems;
}
