import { readFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { parse } from 'yaml'

export const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)

/** A field that real files write either as one string or as a list of strings. */
export const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : typeof v === 'string' && v !== '' ? [v] : []

export function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-')
}

/** A YAML file's top-level map, or {} when it is absent, unreadable or not a map. */
export function readYamlObject(file: string): Record<string, unknown> {
  try {
    if (!existsSync(file)) return {}
    const v = parse(readFileSync(file, 'utf8'))
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch { return {} }
}

/** The instance's own short name: identity.slug, else its name made a slug, else the folder name. */
export function instanceSlug(repo: string): string {
  const identity = (readYamlObject(join(repo, 'federation.yaml')).identity ?? {}) as Record<string, unknown>
  const fromSlug = str(identity.slug)
  if (fromSlug) return fromSlug
  const name = str(identity.name)
  if (name && slug(name)) return slug(name)
  return basename(repo)
}

/** The org's name as GET /api/status gives it: federation.yaml identity.name, else "org". */
export function orgName(repo: string): string {
  const identity = (readYamlObject(join(repo, 'federation.yaml')).identity ?? {}) as Record<string, unknown>
  return str(identity.name) ?? 'org'
}

/** The YAML front matter of a markdown file (between the first two `---` lines), or {}. */
export function readFront(file: string): Record<string, unknown> {
  try {
    const text = readFileSync(file, 'utf8')
    if (!text.startsWith('---')) return {}
    const end = text.indexOf('\n---', 3)
    if (end < 0) return {}
    const v = parse(text.slice(3, end))
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch { return {} }
}

/** "person:github:x" → "github:x": the id in its source, after the kind prefix. */
export const idOf = (resourceId: string): string => resourceId.slice(resourceId.indexOf(':') + 1)
