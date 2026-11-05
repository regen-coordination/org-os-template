/** The house's own glyphs, copied from the approved gallery's symbols (24 grid, drawn with the shared
 *  stroke). `fill` marks a glyph that is a solid shape instead of an outline. */
export interface HouseGlyph { paths: string[]; fill?: boolean }

export const HOUSE_GLYPHS = {
  hat: { paths: [
    'M7 16.5V6.5A1.5 1.5 0 0 1 8.5 5h7A1.5 1.5 0 0 1 17 6.5v10',
    'M3.5 17.5c0 .8 3.8 1.5 8.5 1.5s8.5-.7 8.5-1.5-3.8-1.5-8.5-1.5-8.5.7-8.5 1.5z',
    'M7 12.5h10',
  ] },
  safe: { paths: [
    'M5.5 4.5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z',
    'M15.25 12a3.25 3.25 0 1 1-6.5 0 3.25 3.25 0 0 1 6.5 0z',
    'M12 8.75V7.5M12 16.5v-1.25M15.25 12h1.25M7.5 12h1.25M6.5 19.5v1M17.5 19.5v1',
  ] },
  pool: { paths: [
    'M12 4v8M8.5 8.5 12 12l3.5-3.5',
    'M4 15c2 0 2 1.5 4 1.5s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M4 19c2 0 2 1.5 4 1.5s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5',
  ] },
  seal: { fill: true, paths: ['M12 3.5c3 2.6 5.5 5.9 5.5 9.4a5.5 5.5 0 0 1-11 0c0-3.5 2.5-6.8 5.5-9.4z'] },
} as const satisfies Record<string, HouseGlyph>

export type HouseGlyphName = keyof typeof HOUSE_GLYPHS
