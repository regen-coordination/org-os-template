export interface Wikilink { raw: string; target: string; heading: string | null; alias: string | null }

const WIKILINK_RE = /\[\[([^\]|#\n]+)(?:#([^\]|\n]+))?(?:\|([^\]\n]+))?\]\]/g

/** Strip fenced blocks and inline code before matching. */
function stripCode(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, m => ' '.repeat(m.length))
    .replace(/`[^`\n]*`/g, m => ' '.repeat(m.length))
}

export function extractWikilinks(markdown: string): Wikilink[] {
  const out: Wikilink[] = []
  for (const m of stripCode(markdown).matchAll(WIKILINK_RE)) {
    out.push({
      raw: m[0],
      target: m[1].trim(),
      heading: m[2]?.trim() ?? null,
      alias: m[3]?.trim() ?? null,
    })
  }
  return out
}
