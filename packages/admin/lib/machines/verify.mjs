// packages/admin/lib/machines/verify.mjs
//
// The generated test for a machine (P4 spec §7): every state reachable from the initial one, no
// dead end unless final, every event handled somewhere, and every edge able to fire, which means
// no earlier target in a list always takes it. Each edge is tried with guards that pass exactly
// when they are the edge's own.

import { transition, walk } from './run.mjs'

/** @param {import('./run.mjs').Machine} m @returns {string[]} */
export function verify(m) {
  const w = walk(m)
  const problems = [
    ...w.unreachable.map(s => `${m.id}: "${s}" cannot be reached from "${m.initial}"`),
    ...w.deadEnds.map(s => `${m.id}: "${s}" has no way out and is not final`),
    ...m.events.filter(e => !w.edges.some(x => x.event === e)).map(e => `${m.id}: no state handles "${e}"`),
  ]
  for (const e of w.edges) {
    /** @type {import('./run.mjs').Guards} */
    const guards = Object.fromEntries(m.guards.map(g => [g, () => (e.when.includes(g) ? true : `${g} is off`)]))
    const r = transition(m, guards, e.from, { type: e.event }, {})
    if (!r.ok || r.state !== e.to) problems.push(`${m.id}: "${e.from}" --${e.event}--> "${e.to}" never fires (an earlier target takes it)`)
  }
  return problems
}
