import type { IconName } from '../../design/Icon.tsx'
import type { Mark } from '../../design/StatusMark.tsx'
import type { LaneId } from '../../api.ts'

/** The house's marks (§6.1), by the shape kms gives a maturity or a check. An unknown shape is `open`: drawn, never
 *  dropped, and never mistaken for done. */
const SHAPES: ReadonlySet<string> = new Set(['needs', 'open', 'ok', 'done', 'failed', 'closed', 'aged', 'draft', 'stale'])
export const markOf = (shape: string | null | undefined): Mark => (shape && SHAPES.has(shape) ? shape as Mark : 'open')

/** Each lane's mark and word (spec §3): the lane is drawn with the house's StatusMark, in its own words. */
export const LANE_MARK: Record<LaneId, { mark: Mark; word: string }> = {
  draft: { mark: 'open', word: 'Draft' },
  awaiting: { mark: 'needs', word: 'Awaiting review' },
  published: { mark: 'done', word: 'Published' },
  internal: { mark: 'closed', word: 'Internal only' },
}

/** The glyph for a canon kind: kms's own, by schema (KI §4-7). An unknown kind falls back to the page. */
export const kindGlyph = (type: string): IconName => {
  const known: Record<string, IconName> = {
    'encyclopedia-entry': 'book', 'concept-lineage': 'branch', 'claim-evidence': 'quote', 'option-entry': 'sliders',
    'implementation-record': 'hammer', track: 'route', 'source-system': 'db', resource: 'file', signal: 'signal',
    'relationship-record': 'link', deployment: 'layers', place: 'pin', 'territorial-unit': 'pin', 'data-stream': 'stream',
  }
  return known[type] ?? 'doc'
}

/** kms's glyph names (`glyphFor`), which are the house's for the kinds it draws; anything else is the page. */
const GLYPHS: ReadonlySet<string> = new Set(['book', 'branch', 'quote', 'sliders', 'hammer', 'route', 'db', 'file', 'signal', 'link', 'layers', 'pin', 'stream', 'doc'])
export const glyphIcon = (glyph: string | null | undefined): IconName => (glyph && GLYPHS.has(glyph) ? glyph as IconName : 'file')
