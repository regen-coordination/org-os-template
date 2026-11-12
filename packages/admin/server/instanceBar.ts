// The instance's sites bar. An organisation often keeps several sites side by side (a knowledge base, a forum, this
// house); an instance may carry `house/bar.yaml` to name them, and the frame then draws one slim bar of them over
// every page, the one this house is marked `current`. Nothing of any organisation is written into the framework:
// the names and addresses are the instance's. Absent, or not readable as a bar, the answer is no sites and the
// frame draws nothing.
//
//   label: Example Org              # optional: whose sites these are
//   sites:
//     - { label: Knowledge, href: "https://knowledge.example.org", note: "What we know" }
//     - { label: House, href: /, current: true }
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

export const INSTANCE_BAR_PATH = '/api/instance/bar'
/** Where an instance keeps its bar, from its root. */
export const INSTANCE_BAR_FILE = join('house', 'bar.yaml')
/** A bar is a handful of lines; a bigger file is a mistake, not a bar. */
export const INSTANCE_BAR_MAX_BYTES = 16 * 1024
/** More sites than this do not fit one row. */
export const INSTANCE_BAR_MAX_SITES = 8

export interface BarSite { label: string; href: string; current: boolean; note?: string }
export interface InstanceBar { label: string | null; sites: BarSite[] }

const NONE: InstanceBar = { label: null, sites: [] }
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() !== '' && v.trim().length <= max ? v.trim() : null)
/** Another site by its http(s) address, or a place in this house by a rooted path; nothing else is a link. */
const address = (v: unknown): string | null => {
  const u = text(v, 2000)
  return u && (/^https?:\/\/[^\s]+$/i.test(u) || /^\/(?![/\\])[^\s\\]*$/.test(u)) ? u : null
}

/** The instance's bar, or no sites when it carries none (or a file that is not one). A site without a label or with
 *  an address that is not a link is left out; only the first site marked current is. Read on every call, so an edit
 *  shows on the next load without a restart. */
export function readInstanceBar(repo: string): InstanceBar {
  const file = join(repo, INSTANCE_BAR_FILE)
  if (!existsSync(file)) return NONE
  const st = statSync(file)
  if (!st.isFile() || st.size > INSTANCE_BAR_MAX_BYTES) return NONE
  let doc: unknown
  try { doc = parse(readFileSync(file, 'utf8')) } catch { return NONE }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return NONE
  const { label, sites } = doc as { label?: unknown; sites?: unknown }
  if (!Array.isArray(sites)) return NONE
  const out: BarSite[] = []
  let marked = false
  for (const s of sites) {
    if (out.length >= INSTANCE_BAR_MAX_SITES) break
    if (!s || typeof s !== 'object') continue
    const e = s as Record<string, unknown>
    const name = text(e.label, 40)
    const href = address(e.href)
    if (!name || !href) continue
    const current = e.current === true && !marked
    if (current) marked = true
    const note = text(e.note, 120)
    out.push({ label: name, href, current, ...(note ? { note } : {}) })
  }
  return { label: text(label, 40), sites: out }
}
