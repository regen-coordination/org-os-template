import { recall, remember } from './storage.ts'
import { SKINS, FALLBACK_SKIN } from './design/skins/index.ts'

/** The key index.html's inline script reads too (prepaint.test.ts holds the two together). */
export const SKIN_KEY = 'org-os-admin.skin'

export const isSkin = (id: unknown): id is string => typeof id === 'string' && SKINS.some(s => s.id === id)

/** The instance's default skin. A client setting for now (VITE_ORG_OS_SKIN at build); the instance's own
 *  data does not carry one yet (see the README, "Skins"). An unknown id falls back to house. */
export function instanceSkin(): string {
  const v: unknown = import.meta.env?.VITE_ORG_OS_SKIN
  return isSkin(v) ? v : FALLBACK_SKIN
}

export const storedSkin = (): string | null => { const v = recall(SKIN_KEY); return isSkin(v) ? v : null }

/** What shows: this browser's choice, else the instance default. */
export const chosenSkin = (): string => storedSkin() ?? instanceSkin()

export function applySkin(id: string, root: HTMLElement = document.documentElement): void {
  root.dataset.skin = isSkin(id) ? id : FALLBACK_SKIN
}

/** ⌘K's "Skin: …": kept for this browser where storage allows, applied either way. */
export function setSkin(id: string): void {
  if (!isSkin(id)) return
  remember(SKIN_KEY, id)
  applySkin(id)
}
