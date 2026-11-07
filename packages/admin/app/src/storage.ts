import type { Positions } from './api.ts'

/** Per-browser conveniences only. Storage may be refused (a private window, blocked site data):
 *  then a read gives null, a write is dropped, and nothing throws. */
export function recall(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
export function remember(key: string, value: string | null): void {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) } catch { /* forgetting is fine */ }
}

export type View = 'list' | 'map'
const VIEW = 'org-os-admin.view.'
export const recallView = (section: string): View => (recall(VIEW + section) === 'map' ? 'map' : 'list')
export const rememberView = (section: string, view: View): void => remember(VIEW + section, view)

const LAYOUT = 'org-os-admin.layout.'
const isPositions = (v: unknown): v is Positions =>
  typeof v === 'object' && v !== null && !Array.isArray(v) &&
  Object.values(v).every(p => typeof p === 'object' && p !== null && Number.isFinite((p as { x: unknown }).x) && Number.isFinite((p as { y: unknown }).y))

/** A section map's dragged positions (the layout routes take only the two boards: see the Rulings). */
export function recallPositions(section: string): Positions {
  const raw = recall(LAYOUT + section)
  if (!raw) return {}
  try { const v: unknown = JSON.parse(raw); return isPositions(v) ? v : {} } catch { return {} }
}
export const rememberPositions = (section: string, positions: Positions | null): void =>
  remember(LAYOUT + section, positions === null ? null : JSON.stringify(positions))
