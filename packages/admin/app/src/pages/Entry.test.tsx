// @vitest-environment jsdom
/** The entry page (spec §4.2): the record's fields and checks, the references with each target's state, the private
 *  fields with "not published", and the Public face — which drops what the commons cannot show. */
import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import Entry from './Entry.tsx'
import ProposePanel from '../changes/ProposePanel.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, changeView, knownActor } from '../test/data.ts'
import { entryView } from '../test/fixtures/knowledge.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import type { Viewer } from '../viewAs/visibility.ts'
import { clientWith, statusRoute } from '../test/writesOff.ts'

/** The member's tray, as the server holds it (G7): a field edit stages the entry's record op (a second field folds into
 *  it), × takes it out, Apply writes it; every answer is the change as it now stands. */
const RECORD = 'knowledge:encyclopedia-entry/living-mulch'
const BEFORE = { title: 'Living mulch', audience: 'Field crews', public_use: 'reviewed-for-guidance', maturity: 'reviewed' }
function tray(over: { rule?: Record<string, unknown>; classes?: string[]; others?: unknown[] } = {}) {
  let ops: { op: 'update'; record: string; set: Record<string, unknown>; base: string; before: Record<string, unknown> }[] = []
  const view = () => changeView({ ops: [...ops, ...(over.others ?? [])] as never, classes: ops.length ? (over.classes ?? ['workspace']) : [],
    ...(over.rule ? { rule: over.rule as never } : {}) })
  return {
    held: () => ops,
    routes: {
      'GET /api/changes': () => view(),
      'POST /api/changes/ops': (init: RequestInit | undefined) => {
        for (const o of (JSON.parse(String(init?.body)) as { ops: { record: string; set: Record<string, unknown> }[] }).ops) {
          const i = ops.findIndex(x => x.record === o.record)
          if (i >= 0) ops[i] = { ...ops[i]!, set: { ...ops[i]!.set, ...o.set } }
          else ops.push({ op: 'update', record: o.record, set: o.set, base: 'b'.repeat(64), before: BEFORE })
        }
        return view()
      },
      'DELETE /api/changes/ops/0': () => { ops = []; return view() },
      'POST /api/changes/apply': () => { ops = []; return { commit: 'abc1234def5678' } },
    },
  }
}
const routes = (over: Record<string, unknown> = {}, t = tray()) => ({
  ...baseRoutes(),
  'GET /api/knowledge/entry/encyclopedia-entry/living-mulch': entryView(),
  ...t.routes,
  ...over,
})

const at = () => renderAt(<Entry type="encyclopedia-entry" slug="living-mulch" />, '/c/knowledge/encyclopedia-entry/living-mulch')
const atAs = (initial: Viewer) => renderAt(<ViewAsProvider initial={initial}><Entry type="encyclopedia-entry" slug="living-mulch" /></ViewAsProvider>,
  '/c/knowledge/encyclopedia-entry/living-mulch')
const UNPUBLISHED = entryView({
  row: { ...entryView().row, lane: 'internal', why: 'public use: internal only', internal: true, pageHref: null, apiHref: null },
  publicFace: { published: false, title: 'Living mulch', lead: '', body: [], related: [], about: [], atUri: null, cite: null,
    reason: 'This entry is internal: the commons will not show it, and references to it are dropped.' },
})

const stageAudience = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Edit Audience' }))
  const input = screen.getByRole('textbox', { name: 'Audience' })
  fireEvent.change(input, { target: { value: 'Field crews · volunteer growers' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await screen.findByText('Staged')
}

describe('the entry page', () => {
  it('draws the record header with the entry’s id and its own words', async () => {
    fetchRoutes(routes())
    at()
    expect(await screen.findByRole('heading', { level: 1, name: 'Living mulch' })).toBeTruthy()
    expect(screen.getAllByText(/encyclopedia-entry\/living-mulch/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('in the selection').length).toBeGreaterThan(0)
  })

  it('puts the six checks beside the article, the failing one naming its fix', async () => {
    fetchRoutes(routes())
    at()
    await screen.findByRole('heading', { level: 1 })
    const checks = screen.getByRole('region', { name: /Checks/ })
    expect(within(checks).getByText('3 of 4 resolve')).toBeTruthy()
    expect(within(checks).getByText('1 points at nothing')).toBeTruthy()
    expect(within(checks).getByText('Selected')).toBeTruthy()
    // One run of text, as a field row's value is: the mark, then its value, then its note, set apart.
    expect(checks.textContent).toContain('3 of 4 resolve · 1 points at nothing')
  })

  it('shows a broken reference and an internal one on the Record face', async () => {
    fetchRoutes(routes())
    at()
    await screen.findByRole('heading', { level: 1 })
    const refs = screen.getByRole('region', { name: /References/ })
    expect(within(refs).getByText('No entry with this name. Fix the reference or publish the entry.')).toBeTruthy()
    expect(within(refs).getByText('internal only — absent from the commons')).toBeTruthy()
  })

  it('marks the private fields as not published, and says where the entry goes', async () => {
    fetchRoutes(routes())
    at()
    await screen.findByRole('heading', { level: 1 })
    const prov = screen.getByRole('region', { name: /Provenance/ })
    expect(within(prov).getByText('not published')).toBeTruthy()
    const goes = screen.getByRole('region', { name: /Where it goes/ })
    expect(within(goes).getByText('public/k/encyclopedia-entry/id-living-mulch.html')).toBeTruthy()
  })

  const edit = async (label: string, value: string) => {
    fireEvent.click(screen.getByRole('button', { name: `Edit ${label}` }))
    const input = screen.getByRole('textbox', { name: label })
    fireEvent.change(input, { target: { value } })
    fireEvent.keyDown(input, { key: 'Enter' })
  }

  it('stages a field edit as the entry\u2019s record op, the old value struck beside the new, nothing written (walk G7)', async () => {
    const t = tray()
    const { calls } = fetchRoutes(routes({}, t))
    at()
    await screen.findByRole('heading', { level: 1 })
    await edit('Audience', 'Field crews · volunteer growers')
    expect(await screen.findByText('Staged')).toBeTruthy()
    expect(calls.find(c => c.method === 'POST' && c.path === '/api/changes/ops')?.body).toEqual({ ops: [{ op: 'update', record: RECORD, set: { audience: 'Field crews · volunteer growers' } }] })
    expect(t.held()).toHaveLength(1)
    // The field row and the card's own row both carry the new value; the card reads the tray's rule.
    expect(screen.getAllByText('Field crews · volunteer growers').length).toBeGreaterThan(0)
    expect(screen.getByRole('region', { name: /Your change/ })).toBeTruthy()
    expect(screen.getByText('the maintainer decides alone')).toBeTruthy()
    expect(calls.some(c => c.path.endsWith('/apply'))).toBe(false)
  })

  it('a second field keeps the first, and a reload keeps both: "Staged" is drawn from the tray (walk G7)', async () => {
    const t = tray()
    fetchRoutes(routes({}, t))
    const first = at()
    await screen.findByRole('heading', { level: 1 })
    await edit('Audience', 'Volunteer growers')
    await screen.findByText('Staged')
    await edit('Steward', 'Seed steward')
    await waitFor(() => expect(screen.getAllByText('Staged')).toHaveLength(2))
    expect(t.held()[0]!.set).toEqual({ audience: 'Volunteer growers', steward: 'Seed steward' })
    first.unmount()
    at()
    await screen.findByRole('heading', { level: 1 })
    await waitFor(() => expect(screen.getAllByText('Staged')).toHaveLength(2))
    expect(within(screen.getByRole('region', { name: /Your change/ })).getByText('Seed steward')).toBeTruthy()
  })

  it('applies the staged change with the tray\u2019s Apply and says what happened', async () => {
    const { calls } = fetchRoutes(routes())
    at()
    await screen.findByRole('heading', { level: 1 })
    await edit('Audience', 'Field crews · volunteer growers')
    await screen.findByText('Staged')
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(calls.some(c => c.method === 'POST' && c.path === '/api/changes/apply')).toBe(true))
    await waitFor(() => expect(document.body.textContent).toContain('Applied as commit abc1234.'))
  })

  it('Discard takes the entry\u2019s op out of the tray', async () => {
    const t = tray()
    const { calls } = fetchRoutes(routes({}, t))
    at()
    await screen.findByRole('heading', { level: 1 })
    await edit('Audience', 'Volunteer growers')
    await screen.findByText('Staged')
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(calls.some(c => c.method === 'DELETE' && c.path === '/api/changes/ops/0')).toBe(true))
    await waitFor(() => expect(screen.queryByText('Staged')).toBeNull())
    expect(t.held()).toHaveLength(0)
  })

  it('beside other staged edits the card offers no Apply or Propose: the change goes whole from the tray', async () => {
    const other = { op: 'update', record: 'projects:seed-swap', set: { tags: ['x'] }, base: 'c'.repeat(64), before: { tags: [] } }
    fetchRoutes(routes({}, tray({ others: [other] })))
    at()
    await screen.findByRole('heading', { level: 1 })
    await edit('Audience', 'Volunteer growers')
    expect(await screen.findByText(/apply or propose the change whole from the tray/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Propose' })).toBeNull()
  })

  it('says a publication-classed edit is the publication rule\u2019s, and offers no Apply the rule would refuse', async () => {
    fetchRoutes(routes({}, tray({ classes: ['workspace', 'publication'],
      rule: { direct: false, proposable: false, source: 's', sentence: 'Steward A may not decide publication alone, and may not propose it either.' } })))
    at()
    await screen.findByRole('heading', { level: 1 })
    await edit('Public use', 'reviewed-for-guidance-2')
    expect(await screen.findByText(/This edit makes the entry publishable/)).toBeTruthy()
    expect(screen.getByText(/may not decide publication alone/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy()
  })

  it('proposes an edit the rules do not let this person apply alone: the house\u2019s Propose opened over the tray (L6 Task 10)', async () => {
    const { calls } = fetchRoutes(routes({}, tray({ classes: ['workspace', 'publication'],
      rule: { direct: false, proposable: true, source: 'data/governance.yaml rules: publishing', sentence: 'Steward B may not decide publication alone. Propose it instead.' } })))
    renderAt(<><Entry type="encyclopedia-entry" slug="living-mulch" /><ProposePanel /></>, '/c/knowledge/encyclopedia-entry/living-mulch')
    await screen.findByRole('heading', { level: 1 })
    await edit('Public use', 'internal-only')
    expect(await screen.findByText(/Propose it instead\./)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Propose' }))
    expect(await screen.findByRole('complementary', { name: 'Propose' })).toBeTruthy()
    expect(calls.some(c => c.path.endsWith('/apply'))).toBe(false)
    // L6 carries K10: the panel's title starts from the entry's title, not the record's address.
    expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe(`Update ${entryView().row.title}`)
  })

  it('offers neither Apply nor Propose when the rules let this person do neither', async () => {
    fetchRoutes(routes({}, tray({ classes: ['workspace', 'publication'],
      rule: { direct: false, proposable: false, source: 's', sentence: 'Agent A is a member of kind agent, and under solo-maintainer only a person decides.' } })))
    at()
    await screen.findByRole('heading', { level: 1 })
    await edit('Public use', 'internal-only')
    expect(await screen.findByText(/only a person decides/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Propose' })).toBeNull()
  })

  it('turns the same page into the public face, which drops the broken and internal references', async () => {
    fetchRoutes(routes())
    at()
    await screen.findByRole('heading', { level: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Public face' }))
    expect(await screen.findByText('This is what the commons shows. Nothing here is editable.')).toBeTruthy()
    expect(screen.queryByText('No entry with this name. Fix the reference or publish the entry.')).toBeNull()
    expect(screen.queryByText('internal only — absent from the commons')).toBeNull()
    expect(screen.getAllByText('Cover cropping').length).toBeGreaterThan(0)
    expect(screen.getByText(/Credit the Example DAO Seed Library/)).toBeTruthy()
  })

  it('says why an internal entry has no public face, rather than showing a pretend one', async () => {
    fetchRoutes(routes({ 'GET /api/knowledge/entry/encyclopedia-entry/living-mulch': entryView({ publicFace: { ...entryView().publicFace, published: false, reason: 'This entry is internal: the commons will not show it, and references to it are dropped.', related: [] } }) }))
    at()
    await screen.findByRole('heading', { level: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Public face' }))
    expect(await screen.findByText(/This entry is internal/)).toBeTruthy()
  })

  it('offers no edit to a reader', async () => {
    // A reader: git knows no member here, so the page offers no edit and no prepared change.
    fetchRoutes({ ...routes(), 'GET /api/actor': { known: false, actor: { kind: 'reader' } } })
    at()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('button', { name: 'Edit Audience' })).toBeNull()
  })

  /* ── review fixes: the house's elements, and View as Public (2026-11-04) ─────────────────────────────────────── */

  it('draws the house’s record header: the id in Mono, the lane’s mark, and who can read it', async () => {
    fetchRoutes(routes())
    const { container } = at()
    await screen.findByRole('heading', { level: 1, name: 'Living mulch' })
    const head = container.querySelector('header.rh') as HTMLElement
    expect(head.querySelector('.rh-id')!.textContent).toBe('encyclopedia-entry/living-mulch')
    expect(within(head).getByText('Published')).toBeTruthy()
    expect(within(head).getByText('Public')).toBeTruthy()
  })

  it('lays the fields out as the house’s field rows, a staged one with its old value struck', async () => {
    fetchRoutes(routes())
    at()
    await screen.findByRole('heading', { level: 1 })
    await stageAudience()
    const fields = screen.getByRole('group', { name: 'Fields' })
    expect(within(fields).getByText('Field crews', { selector: 's' })).toBeTruthy()
  })

  it('draws the references as the house’s data rows', async () => {
    fetchRoutes(routes())
    at()
    await screen.findByRole('heading', { level: 1 })
    const refs = screen.getByRole('list', { name: 'References' })
    expect(within(refs).getAllByRole('listitem')).toHaveLength(4)
  })

  it('previewing as Public shows the public face only, with no edit and no Record face', async () => {
    fetchRoutes(routes())
    atAs({ as: 'public' })
    expect(await screen.findByText('This is what the commons shows. Nothing here is editable.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit Audience' })).toBeNull()
    expect(screen.queryByRole('region', { name: /Checks/ })).toBeNull()
    expect(screen.queryByText('ask about the neighbour’s field')).toBeNull()
  })

  it('previewing as Public an entry the commons does not show: the reason, and none of its words', async () => {
    fetchRoutes(routes({ 'GET /api/knowledge/entry/encyclopedia-entry/living-mulch': UNPUBLISHED }))
    atAs({ as: 'public' })
    expect(await screen.findByText(/This entry is internal/)).toBeTruthy()
    expect(screen.queryByText(/Competes with young seedlings/)).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Known tensions' })).toBeNull()
  })

  it('previewing as Members keeps the record, and offers no edit', async () => {
    fetchRoutes(routes())
    atAs({ as: 'members' })
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByRole('region', { name: /Checks/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit Audience' })).toBeNull()
  })
})

// R2 (plan D-6): while the Hub's writes are off a knowledge entry is read only: no field's Edit (the prepared edit) and,
// for an edit already staged, no Apply. With writes on, both are offered.
describe('the entry page while the Hub\'s writes are off', () => {
  for (const off of [true, false]) {
    it(off ? 'off: no Edit on any field, no Apply for a staged edit' : 'on: Edit on each field, and Apply for a staged edit', async () => {
      const t = tray()
      const stage = t.routes['POST /api/changes/ops'] as (init: RequestInit) => unknown
      stage({ body: JSON.stringify({ ops: [{ record: RECORD, set: { audience: 'Volunteer growers' } }] }) })
      fetchRoutes({ ...routes({}, t), ...statusRoute(off) })
      renderAt(<Entry type="encyclopedia-entry" slug="living-mulch" />, '/c/knowledge/encyclopedia-entry/living-mulch', { queryClient: clientWith(off) })
      await screen.findByRole('heading', { level: 1, name: 'Living mulch' })
      await screen.findByText('Staged')
      if (off) {
        await new Promise(r => setTimeout(r, 50))
        expect(screen.queryAllByRole('button', { name: /^Edit / })).toEqual([])
        expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
      } else {
        expect((await screen.findAllByRole('button', { name: /^Edit / })).length).toBeGreaterThan(0)
        expect(await screen.findByRole('button', { name: 'Apply' })).toBeTruthy()
      }
    })
  }
})
