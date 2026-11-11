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
  // The knowledge kinds (KI §4-7, kms's own `house/icons.mjs`): one glyph per schema, so a kind is told by its
  // glyph and never by its hue. Stroke only — the same 24 grid, 1.5 stroke, as every other house glyph; the two
  // solid dots the commons uses are drawn as small arcs so the glyph stays one family.
  book: { paths: [
    'M4 5.5c2.8-.8 5.5-.5 8 1.2v13c-2.5-1.7-5.2-2-8-1.2z',
    'M20 5.5c-2.8-.8-5.5-.5-8 1.2v13c2.5-1.7 5.2-2 8-1.2z',
  ] },
  branch: { paths: [
    'M8.5 5.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8.5 18.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM19.5 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
    'M6.5 7.5v9M17.5 10c0 4-4.5 3.5-9.5 7',
  ] },
  quote: { paths: [
    'M9.75 9.5a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0zM18.75 9.5a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0z',
    'M9.75 9.5c0 3.9-1.8 6.4-4.75 7.75M18.75 9.5c0 3.9-1.8 6.4-4.75 7.75',
  ] },
  sliders: { paths: [
    'M5 7h8M17 7h2M5 17h2M11 17h8',
    'M17 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM11 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  ] },
  hammer: { paths: [
    'm13.5 9.5-8 8a1.6 1.6 0 0 0 2.3 2.2l8-8',
    'M11 6.5 14.5 3l6.5 6.5-3.5 3.5-2-2-1.5 1.5-3-3 1.5-1.5z',
  ] },
  route: { paths: [
    'M8 18.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM20 5.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
    'M8 18.5h7.5a3 3 0 0 0 0-6h-7a3 3 0 0 1 0-6H16',
  ] },
  db: { paths: [
    'M19 6c0 1.4-3.1 2.5-7 2.5S5 7.4 5 6s3.1-2.5 7-2.5S19 4.6 19 6z',
    'M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5',
  ] },
  signal: { paths: [
    'M13.75 12a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0z',
    'M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8',
  ] },
  stream: { paths: [
    'M3.5 8c2 0 2-1.5 4.25-1.5S9.75 8 12 8s2-1.5 4.25-1.5S18.5 8 20.5 8M3.5 12.5c2 0 2-1.5 4.25-1.5s2 1.5 4.25 1.5 2-1.5 4.25-1.5 2.25 1.5 4.25 1.5M3.5 17c2 0 2-1.5 4.25-1.5S9.75 17 12 17s2-1.5 4.25-1.5S18.5 17 20.5 17',
  ] },
  pin: { paths: [
    'M12 20.5s6-5.6 6-10.5a6 6 0 0 0-12 0c0 4.9 6 10.5 6 10.5z',
    'M14.25 10a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0z',
  ] },
} as const satisfies Record<string, HouseGlyph>

export type HouseGlyphName = keyof typeof HOUSE_GLYPHS
