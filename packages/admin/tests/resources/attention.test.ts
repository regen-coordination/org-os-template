import { describe, it, expect } from 'vitest'
import { daysUntil, fundingAttention, moduleAttention, seatAttention, instanceAttention, connectorAttention } from '../../server/resources/attention.ts'

// Local noon, so the calendar day is the same in every time zone the suite runs in.
const now = new Date(2026, 9, 15, 12, 0, 0)

describe('daysUntil', () => {
  it.each([
    ['2026-10-15', 0], ['2026-10-16', 1], ['2026-10-14', -1], ['2026-10-29', 14], ['2026-11-15T00:00:00Z', 31],
    ['15/10/2026', null], [null, null], [20261015, null],
  ])('%s → %s', (input, days) => expect(daysUntil(input, now)).toBe(days))
})

describe('fundingAttention', () => {
  it.each([
    ['2026-10-30', 'researching', null],
    ['2026-10-29', 'researching', { level: 'warn', text: 'deadline in 14 days' }],
    ['2026-10-19', 'researching', { level: 'warn', text: 'deadline in 4 days' }],
    ['2026-10-18', 'researching', { level: 'alert', text: 'deadline in 3 days' }],
    ['2026-10-16', 'monitoring', { level: 'alert', text: 'deadline in 1 day' }],
    ['2026-10-15', 'researching', { level: 'alert', text: 'deadline today' }],
    ['2026-10-13', 'researching', { level: 'alert', text: 'deadline passed 2 days ago' }],
    ['2026-10-13', 'Submitted', null],
    ['2026-10-16', 'awarded', null],
    [undefined, 'researching', null],
  ])('%s while %s', (deadline, status, expected) => expect(fundingAttention(deadline, status, now)).toEqual(expected))
})

describe('moduleAttention', () => {
  it('is quiet when every check passes, and names the first failure', () => {
    expect(moduleAttention([])).toBeNull()
    expect(moduleAttention(['a.md missing'])).toEqual({ level: 'alert', text: 'check fails: a.md missing' })
    expect(moduleAttention(['a.md missing', 'b.md missing', 'c.md missing'])).toEqual({ level: 'alert', text: 'check fails: a.md missing (+2 more)' })
  })
})

describe('seatAttention', () => {
  it.each([
    [{ state: null, status: 'seated' }, { level: 'alert', text: 'agent gone while seated' }],
    [{ state: null, status: 'reported' }, { level: 'warn', text: 'reported; its agent has ended — release it' }],
    [{ state: 'blocked', status: 'reported' }, { level: 'warn', text: 'waiting at a dialog' }],
    [{ state: 'idle', status: 'seated', prompted: false }, { level: 'warn', text: 'first prompt not sent' }],
    [{ state: 'working', status: 'seated', prompted: false }, null],
    [{ state: 'idle', status: 'seated', prompted: 'stalled' }, { level: 'warn', text: 'first prompt not started' }],
    [{ state: 'idle', status: 'seated', prompted: 'unconfirmed' }, { level: 'warn', text: 'first prompt may not have arrived — look at its pane' }],
    [{ state: 'working', status: 'seated', prompted: 'unconfirmed' }, null],
    [{ state: null, status: 'failed' }, { level: 'alert', text: 'seating failed — release it' }],
    [{ state: 'idle', status: 'reported', prompted: true }, { level: 'warn', text: 'a report waits for you' }],
    [{ state: 'working', status: 'seated', prompted: true }, null],
  ])('%o', (signal, expected) => expect(seatAttention(signal)).toEqual(expected))
})

describe('instanceAttention', () => {
  it.each([
    [['framework_version behind'], '2026-10-14', { level: 'warn', text: '1 drift item' }],
    [['a', 'b'], '2026-10-14', { level: 'warn', text: '2 drift items' }],
    [[], '2026-09-15', null],
    [[], '2026-09-14', { level: 'warn', text: 'last synced 31 days ago' }],
    [undefined, undefined, null],
  ])('%o, %s', (drift, lastSync, expected) => expect(instanceAttention(drift, lastSync, now)).toEqual(expected))
})

describe('connectorAttention', () => {
  it('warns only when the last ok ingest is more than 14 days old', () => {
    expect(connectorAttention(null, now)).toBeNull()
    expect(connectorAttention(new Date(2026, 9, 1, 12).toISOString(), now)).toBeNull()
    // 14 days and 1 hour is still 14 whole days: not more than 14, so quiet.
    expect(connectorAttention(new Date(2026, 9, 1, 11).toISOString(), now)).toBeNull()
    expect(connectorAttention(new Date(2026, 8, 30, 12).toISOString(), now)).toEqual({ level: 'warn', text: 'last ingest 15 days ago' })
  })
})
