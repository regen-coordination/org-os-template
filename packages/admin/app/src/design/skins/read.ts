/** Reading a skin's source: its blocks, its declarations, the colours a viewer gets from it, and how far
 *  two colours stand apart. Pure string work (no file access), so the skin tests and the /parts tokens page
 *  read a skin the same way. */

export type Scheme = 'light' | 'dark'

/** The text between the braces of the first block that opens after `selector`; '' when there is none. */
export function blockAfter(src: string, selector: string): string {
  const at = src.indexOf(selector)
  if (at < 0) return ''
  const open = src.indexOf('{', at)
  return src.slice(open + 1, src.indexOf('}', open))
}

/** Every `--name: value;` of a block, as written. */
export function declarations(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/^\s*--([a-z0-9-]+):\s*([^;]+);/gm)].map(m => [m[1]!, m[2]!.trim()]))
}

/** The two blocks that draw a skin in dark: the one under the system preference (the first frame, and the
 *  page with scripts off) and the one under the viewer's choice. They must hold the same values. */
export function darkBlocks(src: string, id: string): readonly [string, string] {
  return [
    blockAfter(src, `:root[data-skin="${id}"]:not([data-theme="light"])`),
    blockAfter(src, `:root[data-skin="${id}"][data-theme="dark"]`),
  ] as const
}

const TOKEN = /^\s*--([a-z0-9-]+):\s*(#[0-9a-f]{6}|var\(--[a-z0-9-]+\)|transparent)\s*;/gm
const colours = (block: string): Record<string, string> => Object.fromEntries([...block.matchAll(TOKEN)].map(m => [m[1]!, m[2]!]))

/** The colours a viewer gets, from a skin's source: the light block, with the dark override laid over it in
 *  dark, and a token set to another (`var(--ink)`) following it. `null` is transparent: it draws nothing, so
 *  nothing is measured against it. A token that names no colour is dropped. */
export function coloursIn(src: string, id: string, scheme: Scheme): Record<string, string | null> {
  const light = colours(blockAfter(src, `:root[data-skin="${id}"] {`))
  const raw: Record<string, string> = scheme === 'light' ? light : { ...light, ...colours(darkBlocks(src, id)[1]) }
  const resolve = (name: string, depth = 0): string | null | undefined => {
    const v = raw[name]
    if (v === undefined || depth > 5) return undefined
    if (v === 'transparent') return null
    const ref = /^var\(--([a-z0-9-]+)\)$/.exec(v)
    return ref ? resolve(ref[1]!, depth + 1) : v
  }
  return Object.fromEntries(Object.keys(raw).map(k => [k, resolve(k)]).filter(([, v]) => v !== undefined) as Array<[string, string | null]>)
}

const channel = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

/** WCAG 2.x contrast ratio of two `#rrggbb` colours (1 to 21). */
export function ratio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
