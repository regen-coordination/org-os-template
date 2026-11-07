import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { seatAttention } from '../attention.ts'
import { readFront, str } from '../util.ts'
import type { Adapter, Edge, Resource } from '../types.ts'

export const CREW_TIMEOUT_MS = 5000
const STACK_FRAME = /^\s*at\s|node:internal|\.[cm]?[jt]s:\d+/

interface CrewRow {
  agent: string; role: string; state: string; status: string; title: string | null
  brief: string; branch: string; id: string; created: string; prompted?: unknown
}
interface CrewBoard {
  rows?: CrewRow[]
  handoffs?: { id: string; from_role: string; to_role: string; brief: string }[]
  needsRelease?: { id: string; status: string }[]
}

/** Crew is read through its own `board --json`, not by reading its files: whether an agent is
 *  alive, working or waiting at a dialog is herdr's knowledge, and crew is what asks herdr. */
export const crew: Adapter = {
  name: 'crew', board: 'systems', title: 'Crew',
  watch: ['roles', 'memory/crew'],
  async read(ctx) {
    const script = join(ctx.repo, 'scripts', 'crew.mjs')
    if (!existsSync(script)) return { absent: "Crew isn't installed here (no scripts/crew.mjs)" }
    const res = await ctx.run(process.execPath, [script, 'board', '--json'], { cwd: ctx.repo, timeoutMs: CREW_TIMEOUT_MS })
    if (res.timedOut) return { absent: "crew didn't answer in 5 s" }
    let board: CrewBoard
    try { board = JSON.parse(res.stdout) as CrewBoard } catch {
      const said = res.stderr.trim().split('\n')[0] ?? ''
      // A crash before crew speaks begins with a source location or a stack frame: that is for a developer, not Home.
      if (STACK_FRAME.test(said)) return { absent: "crew's board can't run in this checkout" }
      return { absent: `crew board failed: ${said || `exit code ${res.code}`}` }
    }
    const rows = board.rows ?? []
    const handoffs = board.handoffs ?? []
    const gone = board.needsRelease ?? []
    const nodes: Resource[] = []
    const edges: Edge[] = []

    const seated = new Map<string, number>()
    for (const r of rows) seated.set(r.role, (seated.get(r.role) ?? 0) + 1)
    const rolesDir = join(ctx.repo, 'roles')
    if (existsSync(rolesDir)) {
      for (const file of readdirSync(rolesDir).filter(f => f.endsWith('.md') && f !== 'README.md').sort()) {
        const front = readFront(join(rolesDir, file))
        const id = str(front.id) ?? file.slice(0, -'.md'.length)
        const open = handoffs.filter(h => h.to_role === id)
        const count = seated.get(id) ?? 0
        nodes.push({
          id: `role:${id}`, kind: 'role', board: 'systems', name: id, status: count ? `${count} seated` : 'free',
          attention: open.length ? { level: 'warn', text: `${open.length} open handoff${open.length === 1 ? '' : 's'}` } : null,
          changed: null,
          facts: { circle: front.circle ?? null, kind: front.kind ?? null, model: front.model ?? null, handoffs: open.map(h => `${h.from_role}: ${h.brief}`) },
          source: { path: `roles/${file}`, editable: false },
        })
      }
    }

    /** A seat from crew's live row when there is one, else from its record alone (agent gone). */
    const seat = (id: string, state: string | null, status: string, row?: CrewRow): Resource => {
      const front = readFront(join(ctx.repo, 'memory', 'crew', `${id}.md`))
      const role = row?.role ?? str(front.role) ?? 'unknown'
      const title = row?.title ?? str(front.title)
      const brief = row?.brief ?? ''
      const at = str(row?.created) ?? str(front.updated) ?? str(front.created)
      const by = row?.agent ?? str(front.agent) ?? role
      return {
        id: `seat:${id}`, kind: 'seat', board: 'systems',
        name: title ?? `${role} · ${brief || id}`, status,
        attention: seatAttention({ state, status, prompted: row?.prompted }),
        changed: at ? { at, by } : null,
        facts: { role, state, branch: row?.branch ?? str(front.branch), brief, title, agent: row?.agent ?? str(front.agent),
          pane: str(front.pane), workspace: str(front.workspace), task: front.task ?? null },
        source: { path: `memory/crew/${id}.md`, editable: false },
      }
    }
    for (const r of rows) {
      const s = seat(r.id, r.state, r.status, r)
      nodes.push(s)
      edges.push({ from: s.id, to: `role:${r.role}`, kind: 'seat-of' })
    }
    for (const g of gone) {
      const s = seat(g.id, null, g.status)
      nodes.push(s)
      edges.push({ from: s.id, to: `role:${s.facts.role}`, kind: 'seat-of' })
    }
    return { nodes, edges }
  },
}
