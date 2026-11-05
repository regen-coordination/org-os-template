import { describe, it, expect } from 'vitest'
import type { ProposalDetail, ProposalView, Resource } from '../../api.ts'
import { RESTRICTED_SUBJECT } from '../../../../server/private/ops.ts'
import { RESTRICTED_NOTE as SERVER_NOTE } from '../../../../server/private/proposals.ts'
import { proposalDetail, proposalView } from '../../test/fixtures/proposals.ts'
import { resource } from '../../test/data.ts'
import { canSee, FIXTURE_SOURCE, type Viewer } from '../../viewAs/visibility.ts'
import { RESTRICTED_NOTE, RESTRICTED_TITLE, restrictedView, shownFor } from './seen.ts'

// Rule 8 and E-50 as a preview judges them (C7 review I-1, M-1). Role placeholders only.
const PUBLIC: Viewer = { as: 'public' }
const MEMBERS: Viewer = { as: 'members' }
const seesAs = (v: Viewer) => (item: unknown) => canSee(v, FIXTURE_SOURCE.visibilityOf(item), FIXTURE_SOURCE)
const record = (registry: string, id: string, visibility?: string): Resource => resource({
  id: `${registry.replace(/s$/, '')}:${id}`, facts: visibility ? { visibility } : {}, source: { path: `data/${registry}.yaml`, editable: true, registry, entityId: id } })
const own = (id: string, visibility?: string): Resource => resource({ id: `proposal:${id}`, kind: 'proposal', facts: visibility ? { visibility } : {}, source: null })
const on = (id: string, ...records: string[]) => proposalView({ id, title: `About ${records.join(', ') || 'nothing'}`,
  ops: records.map(r => ({ op: 'update', record: r, set: { lead: 'steward-a' }, base: 'h1' })) as never, rationale: 'Why it matters.' } as never)

describe('shownFor (E-50, rule 8)', () => {
  it('you are shown what the server gave you, whatever it touches', () => {
    const v = on('p-1', 'projects:gone')
    expect(shownFor(v, undefined, { as: 'you' }, () => false)).toBe(v)
  })

  it('a preview shows nothing until the resources are read (fails closed)', () => {
    expect(shownFor(on('p-1', 'projects:open'), undefined, MEMBERS, seesAs(MEMBERS))).toBeNull()
  })

  describe('as Public (the door’s view)', () => {
    const res = [own('p-1', 'public'), own('p-2', 'public'), record('projects', 'open', 'public'), record('projects', 'closed')]
    it('shows a proposal whose own record and every touched record are public', () => {
      const v = on('p-1', 'projects:open')
      expect(shownFor(v, res, PUBLIC, seesAs(PUBLIC))).toBe(v)
    })
    it('hides one touching a members record, a record nobody lists, a governance document or a create', () => {
      expect(shownFor(on('p-1', 'projects:open', 'projects:closed'), res, PUBLIC, seesAs(PUBLIC))).toBeNull()
      expect(shownFor(on('p-1', 'projects:gone'), res, PUBLIC, seesAs(PUBLIC))).toBeNull()
      expect(shownFor(on('p-1', 'governance'), res, PUBLIC, seesAs(PUBLIC))).toBeNull()
    })
    it('hides one whose own record is not listed, even with no ops (M-1)', () => {
      expect(shownFor(on('p-9'), res, PUBLIC, seesAs(PUBLIC))).toBeNull()
      expect(shownFor(on('p-1'), res, PUBLIC, seesAs(PUBLIC))).not.toBeNull()
    })
    it('never shows a placeholder: a restricted view, or one carrying private ops', () => {
      expect(shownFor({ ...on('p-1'), restricted: true } as ProposalView, res, PUBLIC, seesAs(PUBLIC))).toBeNull()
      expect(shownFor({ ...on('p-1', 'projects:open'), private: [{ ref: 'r', class: 'records', op: {} }] } as never, res, PUBLIC, seesAs(PUBLIC))).toBeNull()
    })
  })

  describe('as Members or a hat (as a member is listed it, R-L5-15.8)', () => {
    const res = [record('projects', 'garden'), record('payroll', 'q3', 'hat:treasury'), own('p-3', 'hat:treasury')]
    it('restricts an admitted full view that carries private ops: the server’s title, no ops, no rationale', () => {
      const full = { ...on('p-1', 'projects:garden'), private: [{ ref: 'payroll:q3', class: 'records', op: { op: 'update' } }] } as unknown as ProposalView
      const shown = shownFor(full, res, MEMBERS, seesAs(MEMBERS))!
      expect(shown.title).toBe(RESTRICTED_TITLE)
      expect(shown.ops).toEqual([])
      expect((shown as { restricted?: unknown }).restricted).toBe(true)
      expect('rationale' in shown).toBe(false)
      expect('private' in shown).toBe(false)
    })
    it('restricts a proposal touching a record the previewed viewer does not see, rather than hiding it', () => {
      const shown = shownFor(on('p-1', 'projects:garden', 'payroll:q3'), res, MEMBERS, seesAs(MEMBERS))!
      expect(shown.title).toBe(RESTRICTED_TITLE)
      // the Treasurer's hat sees it whole
      const treasurer: Viewer = { as: 'hat', hat: 'treasury', name: 'Treasurer' }
      expect(shownFor(on('p-1', 'projects:garden', 'payroll:q3'), res, treasurer, seesAs(treasurer))!.title).toBe('About projects:garden, payroll:q3')
    })
    it('keeps a governance-document proposal and a create whole: a record the resources do not hold restricts nothing', () => {
      const gov = on('p-1', 'governance')
      expect(shownFor(gov, res, MEMBERS, seesAs(MEMBERS))).toBe(gov)
      const create = proposalView({ id: 'p-2', title: 'Add a project', ops: [{ op: 'create', record: 'projects:new', value: { id: 'new' } }] as never })
      expect(shownFor(create, res, MEMBERS, seesAs(MEMBERS))).toBe(create)
    })
    it('hides one whose own record the previewed viewer does not see', () => {
      expect(shownFor(on('p-3', 'projects:garden'), res, MEMBERS, seesAs(MEMBERS))).toBeNull()
    })
  })
})

describe('restrictedView', () => {
  it('is the server’s restricted form, in the server’s words: no diff (the note), no records, revise events without ops', () => {
    expect(RESTRICTED_TITLE).toBe(RESTRICTED_SUBJECT)
    expect(RESTRICTED_NOTE).toBe(SERVER_NOTE)
    const detail = { ...proposalDetail({ id: 'p-1', events: [{ id: 'e-1', at: '2026-10-17T00:00:00Z', by: 'steward-a', kind: 'revise', rev: 'r', ops: [{ op: 'update' }] }] as never }) } as ProposalDetail
    const shown = restrictedView(detail)
    expect(shown.diff).toBeNull()
    expect(shown.note).toBe(SERVER_NOTE)
    expect(shown.current).toEqual([])
    expect('ops' in ((shown.events as unknown as object[])[0]!)).toBe(false)
    expect(shown.rules).toEqual(detail.rules)
    expect(shown.evaluation).toEqual(detail.evaluation)
  })
})
