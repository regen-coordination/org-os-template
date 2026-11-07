import { describe, it, expect } from 'vitest'
import { transition, walk, type Machine } from '../../lib/machines/run.mjs'
import { verify } from '../../lib/machines/verify.mjs'
import { change, changeGuards, deriveChangeState } from '../../lib/machines/change.mjs'
import { proposal, proposalGuards, proposalInitial } from '../../lib/machines/proposal.mjs'
import { job, jobGuards } from '../../lib/machines/job.mjs'
import { reading } from '../../lib/machines/reading.mjs'
import { board } from '../../lib/machines/board.mjs'
import { resolveRoles } from '../../lib/rules.mjs'

const ALL: Machine[] = [change, proposal, job, reading, board]
const SOLO = { direct: true, sentence: 'the maintainer decides alone', source: 'implied by model: solo-maintainer' }
const COUNCIL = { direct: false, sentence: 'records changes go to the council for approval', source: 'governance.yaml rules' }

describe('server machines', () => {
  for (const m of ALL) {
    it(`${m.id} is well formed: every state reachable, no dead end, every edge can fire`, () => {
      expect(verify(m)).toEqual([])
    })
  }

  it('their states and events are the contract\'s', () => {
    expect(walk(change).states).toEqual(['empty', 'staged', 'stale', 'applying'])
    expect(change.events).toEqual(['STAGE', 'UNSTAGE', 'BASE_MOVED', 'TAKE_THEIRS', 'KEEP_MINE', 'APPLY', 'APPLIED', 'REFUSED', 'DISCARD'])
    expect(walk(proposal).states).toEqual(['approving', 'objecting', 'voting', 'stale', 'ratified', 'rejected', 'withdrawn', 'expired'])
    expect(proposal.events).toEqual(['APPROVE', 'OBJECT', 'VOTE', 'COMMENT', 'RETRACT', 'ATTACH', 'SYSTEM', 'REVISE', 'TRUNK_MOVED', 'REPLAYED', 'RATIFY', 'REJECT', 'WITHDRAW', 'EXPIRE'])
    expect(walk(job).states).toEqual(['queued', 'running', 'ok', 'failed', 'timed-out', 'cancelled', 'finished-with-surprises', 'interrupted'])
    expect(job.events).toEqual(['START', 'FINISH', 'CANCEL', 'INTERRUPT'])
    expect(walk(reading).states).toEqual(['unknown', 'reading', 'fresh', 'aged', 'failed'])
    expect(reading.events).toEqual(['READ', 'GOT', 'FAILED', 'TTL_PASSED'])
    expect(walk(board).states).toEqual(['shared'])
  })

  it('server texts hold no placeholders, so a refusal never shows a raw {name} (Review Focus 5)', () => {
    for (const m of ALL) for (const [name, s] of Object.entries(m.states)) expect(`${m.id}.${name}: ${s.shows.text}`).not.toMatch(/\{/)
  })
})

describe('change', () => {
  it('derives its state from the change and is never stored', () => {
    expect(deriveChangeState({ ops: [], stale: [] })).toBe('empty')
    expect(deriveChangeState({ ops: [{}], stale: [] })).toBe('staged')
    expect(deriveChangeState({ ops: [{}], stale: [0] })).toBe('stale')
    expect(deriveChangeState({ ops: [{}], stale: [] }, { applying: true })).toBe('applying')
    expect(deriveChangeState({ ops: [], stale: [] }, { applying: true })).toBe('empty')
  })

  it('applies only from staged, under a direct rule, and refuses with the rule\'s own sentence otherwise', () => {
    expect(transition(change, changeGuards, 'staged', { type: 'APPLY' }, { ops: [{}], stale: [], rule: SOLO })).toEqual({ ok: true, state: 'applying', effects: ['commit'] })
    expect(transition(change, changeGuards, 'staged', { type: 'APPLY' }, { ops: [{}], stale: [], rule: COUNCIL }))
      .toEqual({ ok: false, reason: COUNCIL.sentence, guard: 'directRule' })
    expect(transition(change, changeGuards, 'stale', { type: 'APPLY' }, { ops: [{}], stale: [0], rule: SOLO })).toMatchObject({ ok: false })
    expect(transition(change, changeGuards, 'empty', { type: 'APPLY' }, { ops: [], stale: [], rule: SOLO }))
      .toEqual({ ok: false, reason: "That can't be done now: Nothing is staged." })
  })

  it('unstaging or rebasing reads the change as it is after the event', () => {
    expect(transition(change, changeGuards, 'staged', { type: 'UNSTAGE' }, { ops: [], stale: [] })).toMatchObject({ state: 'empty' })
    expect(transition(change, changeGuards, 'staged', { type: 'UNSTAGE' }, { ops: [{}], stale: [] })).toMatchObject({ state: 'staged' })
    expect(transition(change, changeGuards, 'stale', { type: 'TAKE_THEIRS' }, { ops: [{}, {}], stale: [1] })).toMatchObject({ state: 'stale' })
    expect(transition(change, changeGuards, 'stale', { type: 'KEEP_MINE' }, { ops: [{}], stale: [] })).toMatchObject({ state: 'staged' })
    expect(transition(change, changeGuards, 'stale', { type: 'TAKE_THEIRS' }, { ops: [], stale: [] })).toMatchObject({ state: 'empty' })
  })
})

describe('proposal', () => {
  it('opens in the state its rule\'s method starts with (ruling 9)', () => {
    expect(proposalInitial('approve')).toBe('approving')
    expect(proposalInitial('consent')).toBe('objecting')
    expect(proposalInitial('vote')).toBe('voting')
    expect(proposalInitial('direct')).toBe('approving')
  })

  it('ratifies only when the rule is met, and goes stale when the trunk moves', () => {
    expect(transition(proposal, proposalGuards, 'approving', { type: 'RATIFY' }, { outcome: 'pending' })).toMatchObject({ ok: false, guard: 'ruleMet' })
    // RATIFY is a person's act too (P2 Task 4: `mayRatify`), so the context names the proposal, its rules and the roles
    const met = { outcome: 'met', author: 'ana', proposal: { author: 'ana', events: [] }, rules: [], book: resolveRoles({}, [{ id: 'ana' }]) }
    expect(transition(proposal, proposalGuards, 'approving', { type: 'RATIFY', by: 'ana' }, met)).toMatchObject({ ok: true, state: 'ratified' })
    expect(transition(proposal, proposalGuards, 'voting', { type: 'TRUNK_MOVED' }, {})).toMatchObject({ state: 'stale' })
    expect(transition(proposal, proposalGuards, 'stale', { type: 'RATIFY' }, { outcome: 'met' })).toMatchObject({ ok: false })
    expect(transition(proposal, proposalGuards, 'stale', { type: 'REPLAYED', by: 'ana', choose: 'mine' }, { ...met, method: 'consent' })).toMatchObject({ state: 'objecting' })
  })

  it('a closed proposal stays closed', () => {
    for (const s of ['ratified', 'rejected', 'withdrawn', 'expired']) expect(proposal.states[s]!.final).toBe(true)
  })

  it('only the author withdraws', () => {
    expect(transition(proposal, proposalGuards, 'approving', { type: 'WITHDRAW', by: 'bruno' }, { author: 'ana' }))
      .toEqual({ ok: false, reason: 'only its author can withdraw a proposal', guard: 'byAuthor' })
    expect(transition(proposal, proposalGuards, 'approving', { type: 'WITHDRAW', by: 'ana' }, { author: 'ana' })).toMatchObject({ state: 'withdrawn' })
  })
})

describe('job', () => {
  it('ends in the status the run ended with', () => {
    for (const status of ['ok', 'failed', 'timed-out', 'cancelled', 'finished-with-surprises']) {
      expect(transition(job, jobGuards, 'running', { type: 'FINISH', status }, null)).toMatchObject({ ok: true, state: status })
    }
    expect(transition(job, jobGuards, 'running', { type: 'FINISH', status: 'queued' }, null)).toMatchObject({ ok: false })
  })

  it('a queued job can be cancelled or interrupted, but not finished', () => {
    expect(transition(job, jobGuards, 'queued', { type: 'CANCEL' }, null)).toMatchObject({ state: 'cancelled' })
    expect(transition(job, jobGuards, 'queued', { type: 'INTERRUPT' }, null)).toMatchObject({ state: 'interrupted' })
    expect(transition(job, jobGuards, 'queued', { type: 'FINISH', status: 'ok' }, null)).toMatchObject({ ok: false })
  })
})

describe('reading', () => {
  it('a failed read goes back to reading on the next read, like any other', () => {
    expect(transition(reading, {}, 'failed', { type: 'READ' }, null)).toMatchObject({ state: 'reading' })
    expect(transition(reading, {}, 'fresh', { type: 'TTL_PASSED' }, null)).toMatchObject({ state: 'aged' })
    expect(transition(reading, {}, 'unknown', { type: 'GOT' }, null)).toMatchObject({ ok: false })
  })
})
