import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { check, MachineRefusal } from '../../server/machines.ts'
import { Refusal } from '../../server/changes/apply.ts'
import { change, changeGuards } from '../../lib/machines/change.mjs'

const COUNCIL = { direct: false, sentence: 'records changes go to the council for approval', source: 'governance.yaml rules' }

describe('check', () => {
  it('answers the next state when the machine allows the event', () => {
    expect(check(change, changeGuards, 'empty', { type: 'STAGE' }, { ops: [{}], stale: [] })).toBe('staged')
  })

  it('throws a MachineRefusal, a Refusal whose body names the machine, state, event and reason', () => {
    let err: unknown
    try { check(change, changeGuards, 'staged', { type: 'APPLY' }, { ops: [{}], stale: [], rule: COUNCIL }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(MachineRefusal)
    expect(err).toBeInstanceOf(Refusal)
    expect((err as MachineRefusal).status).toBe(409)
    expect((err as MachineRefusal).body).toEqual({ code: 'REFUSED', machine: 'change', state: 'staged', event: 'APPLY', reason: COUNCIL.sentence, error: COUNCIL.sentence })
  })

  it('a route that lets it reach the app answers 409 with that body', async () => {
    const app = new Hono()
    app.onError((err, c) => (err instanceof Refusal ? c.json(err.body, err.status) : c.json({ error: String(err) }, 500)))
    app.post('/x', () => { check(change, changeGuards, 'empty', { type: 'APPLY' }, { ops: [], stale: [] }); return new Response('no') })
    const res = await app.request('/x', { method: 'POST' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ code: 'REFUSED', machine: 'change', state: 'empty', event: 'APPLY',
      reason: "That can't be done now: Nothing is staged.", error: "That can't be done now: Nothing is staged." })
  })
})
