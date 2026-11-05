import { recall, remember } from './storage.ts'

export type Theme = 'light' | 'dark'
const KEY = 'org-os-admin.theme'

export const storedTheme = (): Theme | null => { const v = recall(KEY); return v === 'light' || v === 'dark' ? v : null }

export function systemTheme(): Theme {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' } catch { return 'light' }
}

/** `data-theme` on <html> overrides prefers-color-scheme (tokens.css); none hands it back to the system. */
export function applyTheme(theme: Theme | null, root: HTMLElement = document.documentElement): void {
  if (theme) root.dataset.theme = theme
  else delete root.dataset.theme
}

/** Appearance (the org switcher's System / Light / Dark): the choice, kept for this browser where it may be —
 *  null is System, kept as no choice at all. Every transition is held for one frame (`data-theme-switching`,
 *  frame.css), so the whole house changes colour at once instead of fading part by part. */
export function setTheme(theme: Theme | null, root: HTMLElement = document.documentElement): void {
  remember(KEY, theme)
  root.dataset.themeSwitching = ''
  applyTheme(theme, root)
  void getComputedStyle(root).color // the new colours are drawn with transitions off; the next frame lets them back
  const release = () => { delete root.dataset.themeSwitching }
  try { requestAnimationFrame(release) } catch { release() }
}

/** ⌘K's Toggle dark: the opposite of what shows now, kept for this browser where it may be. */
export function toggleTheme(): Theme {
  const next: Theme = (storedTheme() ?? systemTheme()) === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}
