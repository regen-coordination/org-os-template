// The instance's themes. Beside its one look (house/skin.css), an instance may offer a few more, which a viewer picks
// in Appearance: `house/themes.yaml` names them, and `house/themes.css` draws them (served after skin.css at
// /instance-skin.css, instanceSkin.ts). Picking one sets `data-org-theme` on <html> and `data-theme` to its scheme,
// so a theme's block is written `html:root[data-skin][data-theme][data-org-theme="<id>"]`, more specific than the
// skin's light and dark blocks. Nothing of any organisation is written into the framework.
//
//   themes:
//     - { id: dawn, label: Dawn, scheme: light, note: "Soft morning light" }
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

export const INSTANCE_THEMES_PATH = '/api/instance/themes'
export const INSTANCE_THEMES_FILE = join('house', 'themes.yaml')
export const INSTANCE_THEMES_CSS = join('house', 'themes.css')
export const INSTANCE_THEMES_MAX_BYTES = 16 * 1024
/** More than this is a palette shop, not a choice. */
export const INSTANCE_THEMES_MAX = 8
export const THEME_ID = /^[a-z0-9-]{1,24}$/

export interface InstanceTheme { id: string; label: string; scheme: 'light' | 'dark'; note?: string }
export interface InstanceThemes { themes: InstanceTheme[] }

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() !== '' && v.trim().length <= max ? v.trim() : null)

/** The themes an instance offers, in its order: each with an id, a label and a scheme, or left out. None when the
 *  instance names none, or carries a file that is not a list of themes. Read on every call. */
export function readInstanceThemes(repo: string): InstanceThemes {
  const file = join(repo, INSTANCE_THEMES_FILE)
  if (!existsSync(file)) return { themes: [] }
  const st = statSync(file)
  if (!st.isFile() || st.size > INSTANCE_THEMES_MAX_BYTES) return { themes: [] }
  let doc: unknown
  try { doc = parse(readFileSync(file, 'utf8')) } catch { return { themes: [] } }
  const list = doc && typeof doc === 'object' && !Array.isArray(doc) ? (doc as { themes?: unknown }).themes : null
  if (!Array.isArray(list)) return { themes: [] }
  const out: InstanceTheme[] = []
  const seen = new Set<string>()
  for (const t of list) {
    if (out.length >= INSTANCE_THEMES_MAX) break
    if (!t || typeof t !== 'object') continue
    const e = t as Record<string, unknown>
    const id = typeof e.id === 'string' && THEME_ID.test(e.id) ? e.id : null
    const label = text(e.label, 24)
    const scheme = e.scheme === 'light' || e.scheme === 'dark' ? e.scheme : null
    if (!id || !label || !scheme || seen.has(id)) continue
    seen.add(id)
    const note = text(e.note, 120)
    out.push({ id, label, scheme, ...(note ? { note } : {}) })
  }
  return { themes: out }
}
