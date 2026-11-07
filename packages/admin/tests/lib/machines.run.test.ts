import { describe, it, expect } from 'vitest'
import { defineMachine, enabled, groupOf, sentence, transition, walk, type Guards, type Machine } from '../../lib/machines/run.mjs'
import { verify } from '../../lib/machines/verify.mjs'

const door = (): Machine => defineMachine({
  id: 'door',
  initial: 'shut',
  events: ['OPEN', 'CLOSE', 'LOCK', 'UNLOCK', 'BREAK'],
  guards: ['hasKey', 'isEmpty'],
  states: {
    shut: { shows: { mark: null, text: 'Shut.' }, on: { OPEN: 'open', LOCK: { to: 'locked', when: 'hasKey', effects: ['click'] } } },
    open: { shows: { mark: null, text: 'Open to {who}.' }, group: 'usable', on: { CLOSE: [{ to: 'shut', when: 'isEmpty' }, 'open'] } },
    locked: { shows: { mark: 'stale', text: 'Locked.' }, effects: ['beep'], on: { UNLOCK: { to: 'shut', when: 'hasKey' }, BREAK: 'broken' } },
    broken: { shows: { mark: 'failed', text: 'Broken.' }, final: true },
  },
})
const guards = (o: { key?: boolean; empty?: boolean } = {}): Guards => ({
  hasKey: () => (o.key ? true : 'you have no key'),
  isEmpty: () => (o.empty ? true : 'someone is in the doorway'),
})

describe('defineMachine', () => {
  it('refuses a machine that names a state, a guard or an event it does not have', () => {
    const base = { id: 'm', initial: 'a', events: ['GO'], guards: [] as string[] }
    expect(() => defineMachine({ ...base, initial: 'zz', states: { a: { shows: { mark: null, text: 'A' } } } })).toThrow('machine m: initial state "zz" is not one of its states')
    expect(() => defineMachine({ ...base, states: { a: { shows: { mark: null, text: 'A' }, on: { GO: 'b' } } } })).toThrow('machine m: "a" --GO--> "b": no such state')
    expect(() => defineMachine({ ...base, states: { a: { shows: { mark: null, text: 'A' }, on: { STOP: 'a' } } } })).toThrow('machine m: state "a" handles "STOP", which is not in its events')
    expect(() => defineMachine({ ...base, states: { a: { shows: { mark: null, text: 'A' }, on: { GO: { to: 'a', when: 'x' } } } } })).toThrow('machine m: guard "x" (on "a" --GO-->) is not in its guards')
    expect(() => defineMachine({ ...base, states: { a: { shows: { mark: null, text: 'A' }, final: true, on: { GO: 'a' } } } })).toThrow('machine m: final state "a" has transitions')
  })
})

describe('transition', () => {
  it('moves on a plain target and runs the target state\'s entry effects after the transition\'s own', () => {
    expect(transition(door(), guards(), 'shut', { type: 'OPEN' }, {})).toEqual({ ok: true, state: 'open', effects: [] })
    expect(transition(door(), guards({ key: true }), 'shut', { type: 'LOCK' }, {})).toEqual({ ok: true, state: 'locked', effects: ['click', 'beep'] })
  })

  it('refuses with the guard\'s own sentence, and says which guard refused (ruling 1)', () => {
    expect(transition(door(), guards(), 'shut', { type: 'LOCK' }, {})).toEqual({ ok: false, reason: 'you have no key', guard: 'hasKey' })
  })

  it('tries a list of targets in order; the first whose guards all pass wins', () => {
    expect(transition(door(), guards({ empty: true }), 'open', { type: 'CLOSE' }, {})).toMatchObject({ ok: true, state: 'shut' })
    expect(transition(door(), guards(), 'open', { type: 'CLOSE' }, {})).toMatchObject({ ok: true, state: 'open' })
  })

  it('refuses an event the state has no transition for, in the state\'s own words', () => {
    expect(transition(door(), guards(), 'shut', { type: 'BREAK' }, {})).toEqual({ ok: false, reason: "That can't be done now: Shut." })
    expect(transition(door(), guards(), 'broken', { type: 'OPEN' }, {})).toEqual({ ok: false, reason: "That can't be done now: Broken." })
  })

  it('refuses an event type that only the prototype has, with the default sentence, and never throws (fix round 1)', () => {
    for (const type of ['constructor', 'toString', '__proto__']) {
      expect(transition(door(), guards(), 'shut', { type }, {})).toEqual({ ok: false, reason: "That can't be done now: Shut." })
    }
  })

  it('a guard name only the prototype has is reported as not given, never called (fix round 1)', () => {
    const m = defineMachine({
      id: 'proto', initial: 'a', events: ['GO'], guards: ['toString'],
      states: { a: { shows: { mark: null, text: 'A' }, on: { GO: { to: 'b', when: 'toString' } } }, b: { shows: { mark: null, text: 'B' }, final: true } },
    })
    expect(() => transition(m, {}, 'a', { type: 'GO' }, {})).toThrow('machine proto: guard "toString" was not given')
  })

  it('fills the refusal\'s placeholders from a plain-object context (ruling 12)', () => {
    expect(transition(door(), guards(), 'open', { type: 'OPEN' }, { who: 'Ana' })).toEqual({ ok: false, reason: "That can't be done now: Open to Ana." })
  })

  it('throws on a state the machine does not have, naming both', () => {
    expect(() => transition(door(), guards(), 'ajar', { type: 'OPEN' }, {})).toThrow('machine door: no state "ajar"')
  })

  it('throws when a guard the transition needs was not given', () => {
    expect(() => transition(door(), {}, 'shut', { type: 'LOCK' }, {})).toThrow('machine door: guard "hasKey" was not given')
  })

  it('a guard that throws is not a refusal: the exception reaches the caller (Review Focus 1)', () => {
    const boom: Guards = { hasKey: () => { throw new Error('ctx.keys is undefined') }, isEmpty: () => true }
    expect(() => transition(door(), boom, 'shut', { type: 'LOCK' }, {})).toThrow('ctx.keys is undefined')
  })
})

describe('enabled', () => {
  it('lists the events that would pass from a state with this context', () => {
    expect([...enabled(door(), guards(), 'shut', {})]).toEqual(['OPEN'])
    expect([...enabled(door(), guards({ key: true }), 'shut', {})]).toEqual(['OPEN', 'LOCK'])
    expect([...enabled(door(), guards(), 'broken', {})]).toEqual([])
  })
})

describe('sentence and groupOf', () => {
  it('fills placeholders from string and number values and leaves the rest', () => {
    expect(sentence(door(), 'open', { who: 'Ana' })).toBe('Open to Ana.')
    expect(sentence(door(), 'open', { who: 3 })).toBe('Open to 3.')
    expect(sentence(door(), 'open', { who: { name: 'x' } } as never)).toBe('Open to {who}.')
    expect(sentence(door(), 'open')).toBe('Open to {who}.')
  })

  it('a state\'s group is its own name unless it says otherwise', () => {
    expect(groupOf(door(), 'open')).toBe('usable')
    expect(groupOf(door(), 'shut')).toBe('shut')
  })
})

describe('walk and verify', () => {
  it('walks every edge, regardless of guards, and finds what is reachable', () => {
    const w = walk(door())
    expect(w.states).toEqual(['shut', 'open', 'locked', 'broken'])
    expect(w.reachable).toEqual(['shut', 'open', 'locked', 'broken'])
    expect(w.unreachable).toEqual([])
    expect(w.deadEnds).toEqual([])
    expect(w.edges).toContainEqual({ from: 'open', to: 'shut', event: 'CLOSE', when: ['isEmpty'] })
    expect(w.edges).toContainEqual({ from: 'open', to: 'open', event: 'CLOSE', when: [] })
  })

  it('a well-formed machine has nothing to report', () => {
    expect(verify(door())).toEqual([])
  })

  it('reports unreachable states, dead ends, unhandled events and shadowed targets', () => {
    const bad = defineMachine({
      id: 'bad', initial: 'a', events: ['GO', 'NEVER'], guards: ['g'],
      states: {
        a: { shows: { mark: null, text: 'A' }, on: { GO: ['b', { to: 'c', when: 'g' }] } },
        b: { shows: { mark: null, text: 'B' } },
        c: { shows: { mark: null, text: 'C' }, final: true },
        d: { shows: { mark: null, text: 'D' }, final: true },
      },
    })
    expect(verify(bad)).toEqual([
      'bad: "d" cannot be reached from "a"',
      'bad: "b" has no way out and is not final',
      'bad: no state handles "NEVER"',
      'bad: "a" --GO--> "c" never fires (an earlier target takes it)',
    ])
  })
})
