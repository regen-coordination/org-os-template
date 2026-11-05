// packages/admin/lib/machines/run.mjs
//
// The one interpreter for org-os's state machines (P4 spec §3). A machine is data: its states,
// the events each one accepts, and guards named after the rule they check. transition() is pure:
// it says where an event leads and which effects the host should carry out, or why the event is
// refused. Server and client run this same function, so a control the client enables is one the
// server accepts. No import here may reach node:*, because the client bundles this file.

/** @typedef {'needs'|'staged'|'stale'|'draft'|'open'|'ok'|'done'|'running'|'failed'|'closed'|'aged'|'selected'|'faint'} Mark */
/** @typedef {string | { to: string, when?: string | string[], effects?: string[] }} Target */
/**
 * @typedef {object} StateDef
 * @property {{ mark: Mark | null, text: string }} shows  the state's mark and sentence; text may hold {placeholders}
 * @property {Record<string, Target | Target[]>} [on]     a list is tried in order; the first whose guards all pass wins
 * @property {string[]} [effects]                        run on entry
 * @property {string} [group]                            e.g. a proposal's approving, objecting, voting and stale are group 'open'
 * @property {boolean} [final]
 */
/** @typedef {{ id: string, initial: string, events: string[], guards: string[], states: Record<string, StateDef> }} Machine */
/** @typedef {{ type: string, [k: string]: unknown }} MachineEvent */
/** @typedef {(context: any, event: MachineEvent) => true | string} Guard  a string is the refusal sentence */
/** @typedef {Record<string, Guard>} Guards */
/** @typedef {{ ok: true, state: string, effects: string[] } | { ok: false, reason: string, guard?: string }} Result */

/** @typedef {{ to: string, when: string[], effects: string[] }} Candidate */

/** @param {Target | Target[] | undefined} t @returns {Candidate[]} */
export function candidates(t) {
  if (t === undefined) return []
  return (Array.isArray(t) ? t : [t]).map(c => (typeof c === 'string'
    ? { to: c, when: [], effects: [] }
    : { to: c.to, when: c.when === undefined ? [] : Array.isArray(c.when) ? c.when : [c.when], effects: c.effects ?? [] }))
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isRecord = v => typeof v === 'object' && v !== null && !Array.isArray(v)

/** @param {Machine} m @param {string} state @returns {StateDef} */
function stateDef(m, state) {
  const def = Object.hasOwn(m.states, state) ? m.states[state] : undefined
  if (!def) throw new Error(`machine ${m.id}: no state "${state}"`)
  return def
}

/** Checks a machine once, where it is defined, and freezes its top level.
 *  @param {Machine} m @returns {Machine} */
export function defineMachine(m) {
  /** @param {string} msg @returns {never} */
  const fail = msg => { throw new Error(`machine ${m.id}: ${msg}`) }
  if (!Object.hasOwn(m.states, m.initial)) fail(`initial state "${m.initial}" is not one of its states`)
  for (const [name, def] of Object.entries(m.states)) {
    if (def.final && def.on && Object.keys(def.on).length > 0) fail(`final state "${name}" has transitions`)
    for (const [event, t] of Object.entries(def.on ?? {})) {
      if (!m.events.includes(event)) fail(`state "${name}" handles "${event}", which is not in its events`)
      for (const c of candidates(t)) {
        if (!Object.hasOwn(m.states, c.to)) fail(`"${name}" --${event}--> "${c.to}": no such state`)
        for (const g of c.when) if (!m.guards.includes(g)) fail(`guard "${g}" (on "${name}" --${event}-->) is not in its guards`)
      }
    }
  }
  return Object.freeze(m)
}

/** The state's sentence, its {placeholders} filled from string and number values in `vars`.
 *  @param {Machine} m @param {string} state @param {Record<string, unknown>} [vars] */
export function sentence(m, state, vars) {
  return stateDef(m, state).shows.text.replace(/\{(\w+)\}/g, (whole, k) => {
    const v = vars?.[k]
    return typeof v === 'string' || typeof v === 'number' ? String(v) : whole
  })
}

/** @param {Machine} m @param {string} state */
export const groupOf = (m, state) => stateDef(m, state).group ?? state

/** Where `event` leads from `state`. Pure: effects are named, never run. A guard that throws is
 *  not a refusal; its exception reaches the caller.
 *  @param {Machine} m @param {Guards} guards @param {string} state @param {MachineEvent} event @param {unknown} context
 *  @returns {Result} */
export function transition(m, guards, state, event, context) {
  const def = stateDef(m, state)
  /** @type {{ reason: string, guard: string } | null} */
  let first = null
  // The event type comes from outside (HTTP), so only the state's own keys count: "constructor" or "__proto__" must not resolve.
  const t = def.on && Object.hasOwn(def.on, event.type) ? def.on[event.type] : undefined
  for (const c of candidates(t)) {
    /** @type {{ reason: string, guard: string } | null} */
    let refused = null
    for (const g of c.when) {
      const guard = Object.hasOwn(guards, g) ? guards[g] : undefined
      if (typeof guard !== 'function') throw new Error(`machine ${m.id}: guard "${g}" was not given`)
      const r = guard(context, event)
      if (r !== true) { refused = { reason: typeof r === 'string' ? r : `${g} does not hold`, guard: g }; break }
    }
    if (!refused) return { ok: true, state: c.to, effects: [...c.effects, ...(stateDef(m, c.to).effects ?? [])] }
    first ??= refused
  }
  if (first) return { ok: false, reason: first.reason, guard: first.guard }
  return { ok: false, reason: `That can't be done now: ${sentence(m, state, isRecord(context) ? context : undefined)}` }
}

/** The events that would pass from `state` with this context (sent as `{ type }` alone).
 *  @param {Machine} m @param {Guards} guards @param {string} state @param {unknown} context @returns {Set<string>} */
export function enabled(m, guards, state, context) {
  const out = new Set()
  for (const type of m.events) if (transition(m, guards, state, { type }, context).ok) out.add(type)
  return /** @type {Set<string>} */ (out)
}

/** Every edge, regardless of guards, and what the initial state reaches.
 *  @param {Machine} m */
export function walk(m) {
  const states = Object.keys(m.states)
  /** @type {{ from: string, to: string, event: string, when: string[] }[]} */
  const edges = []
  for (const from of states) {
    for (const [event, t] of Object.entries(m.states[from]?.on ?? {})) {
      for (const c of candidates(t)) edges.push({ from, to: c.to, event, when: c.when })
    }
  }
  const reachable = [m.initial]
  for (let i = 0; i < reachable.length; i++) {
    for (const e of edges) if (e.from === reachable[i] && !reachable.includes(e.to)) reachable.push(e.to)
  }
  return {
    states,
    reachable,
    unreachable: states.filter(s => !reachable.includes(s)),
    deadEnds: states.filter(s => !m.states[s]?.final && !edges.some(e => e.from === s)),
    edges,
  }
}
