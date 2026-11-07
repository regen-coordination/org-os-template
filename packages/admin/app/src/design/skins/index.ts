/** The skins the client ships. Each is a CSS file of tokens beside this one (house.css, bare.css), imported
 *  by index.css; a skin is chosen by `data-skin` on <html> (skin.ts). Add one: packages/admin/README.md. */
export interface Skin { id: string; label: string }
export const SKINS: readonly Skin[] = [
  { id: 'bare', label: 'Bare' },
  { id: 'house', label: 'Hub' }, // the Hub's own look (Q66): the id stays the code name
]
/** The skin of last resort and of the shipped build: house owns the plain :root (house.css). */
export const FALLBACK_SKIN = 'house'
