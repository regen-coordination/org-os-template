import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { parse } from 'yaml'
import { lastCommit } from '../changed.ts'
import { moduleAttention } from '../attention.ts'
import { absentCard } from '../graph.ts'
import { str, list } from '../util.ts'
import type { Adapter, Edge, Resource } from '../types.ts'

const ME = { name: 'modules', board: 'systems' as const, title: 'Modules' }

/** A manifest's checks, by form. `file-exists` is a stat the adapter may make; `command` is a
 *  command line the adapter never runs (it is offered as an operation instead, spec §12.5). */
export function splitChecks(checks: unknown): { fileChecks: string[]; commandChecks: string[] } {
  const fileChecks: string[] = []
  const commandChecks: string[] = []
  if (Array.isArray(checks)) {
    for (const c of checks) {
      if (!c || typeof c !== 'object') continue
      const o = c as Record<string, unknown>
      if (typeof o['file-exists'] === 'string') fileChecks.push(o['file-exists'])
      if (typeof o.command === 'string') commandChecks.push(o.command)
    }
  }
  return { fileChecks, commandChecks }
}

/** The file checks that fail, each as a short sentence. A path that leaves the repository fails:
 *  a manifest has no business pointing there. */
export function failingFileChecks(repo: string, fileChecks: string[]): string[] {
  const root = resolve(repo) + sep
  return fileChecks.flatMap(p => {
    const abs = resolve(repo, p)
    if (!abs.startsWith(root)) return [`${p} is outside the repository`]
    return existsSync(abs) ? [] : [`${p} missing`]
  })
}

export const modules: Adapter = {
  ...ME,
  watch: ['modules'],
  async read(ctx) {
    const dir = join(ctx.repo, 'modules')
    if (!existsSync(dir)) return { absent: 'No modules here (no modules/ directory)' }
    const nodes: Resource[] = []
    const edges: Edge[] = []
    for (const folder of readdirSync(dir).sort()) {
      const rel = `modules/${folder}/module.yaml`
      const file = join(ctx.repo, rel)
      if (!existsSync(file)) continue
      let m: Record<string, unknown>
      try {
        const v = parse(readFileSync(file, 'utf8'))
        m = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
      } catch (err) {
        nodes.push(absentCard({ ...ME, title: rel }, `cannot be read: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`, `modules:${folder}`))
        continue
      }
      const id = str(m.id) ?? folder
      const { fileChecks, commandChecks } = splitChecks(m.checks)
      const failing = failingFileChecks(ctx.repo, fileChecks)
      nodes.push({
        id: `module:${id}`, kind: 'module', board: 'systems', name: id, status: str(m.version),
        attention: moduleAttention(failing), changed: await lastCommit(ctx.repo, rel),
        facts: { type: m.type ?? null, description: m.description ?? null, fileChecks, commandChecks, failing },
        source: { path: rel, editable: false },
      })
      for (const dep of list(m.dependencies)) edges.push({ from: `module:${id}`, to: `module:${dep}`, kind: 'depends-on' })
    }
    if (nodes.length === 0) return { absent: 'No modules here (modules/ holds no module.yaml)' }
    return { nodes, edges }
  },
}
