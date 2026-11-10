import { recall, remember } from './storage.ts'
import { setTheme, type Theme } from './theme.ts'

/** The key index.html's inline script reads too, so a chosen theme is drawn from the first frame. Kept as
 *  `<id>:<scheme>`, so the script can set both attributes without asking the server. */
export const ORG_THEME_KEY = 'org-os-admin.org-theme'
const STORED = /^([a-z0-9-]{1,24}):(light|dark)$/

export interface OrgThemeChoice { id: string; scheme: Theme }

/** The instance theme this browser chose, or null (the instance's own look, under System, Light or Dark). */
export function storedOrgTheme(): OrgThemeChoice | null {
  const m = STORED.exec(recall(ORG_THEME_KEY) ?? '')
  return m ? { id: m[1]!, scheme: m[2] as Theme } : null
}

/** `data-org-theme` on <html> (server/instanceThemes.ts): the instance's theme block of that id applies; none, its own look. */
export function applyOrgTheme(choice: OrgThemeChoice | null, root: HTMLElement = document.documentElement): void {
  if (choice) root.dataset.orgTheme = choice.id
  else delete root.dataset.orgTheme
}

/** Appearance: one of the instance's themes, kept for this browser where it may be. Its scheme becomes the light or
 *  dark choice too, so the house's own parts follow it. Null hands back to the instance's own look; the light or dark
 *  choice is then the caller's (System, Light or Dark). */
export function setOrgTheme(choice: OrgThemeChoice | null, root: HTMLElement = document.documentElement): void {
  remember(ORG_THEME_KEY, choice ? `${choice.id}:${choice.scheme}` : null)
  applyOrgTheme(choice, root)
  if (choice) setTheme(choice.scheme, root)
}
