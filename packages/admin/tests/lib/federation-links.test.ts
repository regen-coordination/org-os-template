// The link-record contract (network N2): the constants and the parsers every atproto read goes through (Task 3).
// Task 4 adds reciprocity, relationOf and linkKey here; Task 7 the planner.
import { describe, it, expect } from 'vitest'
import { NETWORK_AUTHORITY, LINK_NSID, PROFILE_NSID, RELATIONS, parseLinkRecord, parseProfileRecord } from '../../lib/federation/links.mjs'

const SUBJECT = 'did:plc:abcdefghijklmnopqrstuvwx'
const link = (o: Record<string, unknown> = {}) => ({ $type: LINK_NSID, subject: SUBJECT, relation: 'memberOf', createdAt: '2026-11-22T10:00:00.000Z', ...o })

describe('the constants', () => {
  it('one authority, two collections, three relations', () => {
    expect(NETWORK_AUTHORITY).toBe('example.orgosnetwork')
    expect(LINK_NSID).toBe('example.orgosnetwork.link')
    expect(PROFILE_NSID).toBe('example.orgosnetwork.profile')
    expect(RELATIONS).toEqual(['memberOf', 'hasMember', 'peerOf'])
    expect(Object.isFrozen(RELATIONS)).toBe(true)
  })
})

describe('parseLinkRecord', () => {
  it('keeps exactly the five fields, and ignores keys another client added', () => {
    expect(parseLinkRecord(link({ network: 'Regen Mesh', note: 'extra', subjectName: 'x' }))).toEqual(link({ network: 'Regen Mesh' }))
    expect(parseLinkRecord(link())).toEqual(link())
    expect(parseLinkRecord(link({ relation: 'peerOf', subject: 'did:web:peer.example.org' }))).toEqual(link({ relation: 'peerOf', subject: 'did:web:peer.example.org' }))
  })

  it('refuses a non-DID subject, an unknown relation, another type, a bad date or a bad network', () => {
    for (const bad of [
      link({ subject: 'alice.example.org' }), link({ subject: 'did:key:z6Mk' }), link({ subject: 42 }), link({ subject: undefined }),
      link({ relation: 'friendOf' }), link({ relation: 'none' }), link({ relation: undefined }),
      link({ $type: 'app.bsky.feed.post' }), link({ $type: undefined }),
      link({ createdAt: 'yesterday' }), link({ createdAt: '2026-11-22' }), link({ createdAt: '2026-13-40T99:00:00Z' }), link({ createdAt: undefined }),
      link({ network: 7 }), link({ network: '' }), link({ network: 'x'.repeat(201) }),
      null, 'record', [], 42,
    ]) {
      expect(parseLinkRecord(bad), JSON.stringify(bad)).toBeNull()
    }
    expect(parseLinkRecord(link({ network: 'x'.repeat(200) }))).not.toBeNull()
  })
})

describe('parseProfileRecord', () => {
  const profile = (o: Record<string, unknown> = {}) => ({ $type: PROFILE_NSID, name: 'Mesa', createdAt: '2026-11-22T10:00:00.000Z', networks: [{ hub: SUBJECT, name: 'Regen Mesh' }], ...o })

  it('reads its networks and keeps every other key as it is', () => {
    expect(parseProfileRecord(profile({ displayName: 'X' }))).toEqual({
      networks: [{ hub: SUBJECT, name: 'Regen Mesh' }],
      rest: { name: 'Mesa', createdAt: '2026-11-22T10:00:00.000Z', displayName: 'X' },
    })
    expect(parseProfileRecord(profile({ networks: undefined }))).toEqual({ networks: [], rest: { name: 'Mesa', createdAt: '2026-11-22T10:00:00.000Z' } })
  })

  it('drops a network entry it cannot read, and refuses another type or a networks that is not a list', () => {
    expect(parseProfileRecord(profile({ networks: [{ hub: 'nope', name: 'A' }, { hub: SUBJECT }, { hub: SUBJECT, name: 'B', extra: 1 }, 'x'] }))?.networks)
      .toEqual([{ hub: SUBJECT, name: 'B' }])
    for (const bad of [profile({ $type: LINK_NSID }), profile({ networks: 'Regen Mesh' }), profile({ networks: {} }), null, [], 'x']) {
      expect(parseProfileRecord(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})
