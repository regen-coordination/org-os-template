// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import Governance, { ruleCells } from './Governance.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, refuse, resource } from '../test/data.ts'
import { proposalView, proposalViews, PROPOSAL_NOW } from '../test/fixtures/proposals.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import type { GovernanceView, ProposalView } from '../api.ts'
import { NO_MODEL } from '../../../lib/governance-read.mjs'

const view = (over: Partial<GovernanceView> = {}): GovernanceView => ({
  model: 'solo-maintainer', description: null,
  rules: [{ direct: true, sentence: 'applies to everything · a maintainer proposes · the maintainer decides alone', source: 'implied by model: solo-maintainer' }],
  decisions: [
    { date: '2026-10-15', id: 'LD-2026-032', title: 'co-fund goes ahead as B1 plus a prototype', status: 'adopted', group: 'ratified', where: 'DECISIONS.md', anchor: 'ld-2026-032' },
    { date: '2026-10-16', id: 'LD-2026-034', title: 'states beside the catalogue', status: 'Ratified', group: 'ratified', where: 'DECISIONS.md', anchor: 'ld-2026-034' },
    { date: '2026-09-01', id: 'gov-1', title: 'adopt the solo model', status: 'preference-not-ratified', group: null, where: 'governance.yaml' },
  ],
  problems: [], ...over,
})

describe('ruleCells', () => {
  it('splits a rule sentence into applies to · who proposes · how it is decided', () => {
    expect(ruleCells('applies to everything · a maintainer proposes · the maintainer decides alone')).toEqual(['everything', 'a maintainer proposes', 'the maintainer decides alone'])
    expect(ruleCells('the maintainer decides alone')).toBeNull()
  })
})

describe('Governance', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(PROPOSAL_NOW) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
  // C7 (ledger): "scrolls to its part once when the page arrives…" — the three parts are tabs now, one drawn at a time,
  // so nothing scrolls to a part.
  it('the three URLs are tabs, Open · Decided · Rules, with their counts; the URL chooses the tab', async () => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/governance': view(), 'GET /api/proposals': proposalViews })
    const { loc } = renderAt(<Governance part="rules" />, '/governance/rules')
    const bar = await screen.findByRole('tablist', { name: 'Proposals' })
    await waitFor(() => expect(within(bar).getAllByRole('tab').map(t => t.textContent)).toEqual(['Open 4', 'Decided 7', 'Rules 1']))
    expect(within(bar).getAllByRole('tab').map(t => t.getAttribute('href'))).toEqual(['/governance/proposals', '/governance/decisions', '/governance/rules'])
    expect(within(bar).getByRole('tab', { name: /^Rules/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Proposals')
    expect(screen.getByRole('tabpanel', { name: 'Rules' })).toBeTruthy()
    fireEvent.click(within(bar).getByRole('tab', { name: /^Decided/ }))
    expect(loc.history.at(-1)).toBe('/governance/decisions')
  })

  it('shows the model and the rules in force as sentences, with where they come from', async () => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/governance': view() })
    const { container } = renderAt(<Governance part="rules" />)
    const rules = await screen.findByRole('region', { name: 'Rules' })
    expect(container.querySelector('.rh .rh-meta')!.textContent).toBe('model: solo-maintainer · data/governance.yaml')
    // C7 (ledger): a rule is a field row — what it applies to, then its sentence and where it is written — not a table row
    const rows = within(rules).getByRole('group', { name: 'Rules in force' })
    expect([...rows.querySelectorAll('dt')].map(d => d.textContent)).toEqual(['everything'])
    expect(within(rows).getByText('a maintainer proposes · the maintainer decides alone')).toBeTruthy()
    expect(within(rules).getByText('implied by model: solo-maintainer')).toBeTruthy()
    // C9: the server's source is shown as written; the client does not call a rule "implied".
    expect(within(rules).getByText('1 in force')).toBeTruthy()
  })

  it('writes a rule that does not split into three as one sentence', async () => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/governance': view({ rules: [{ direct: true, sentence: 'the maintainer decides alone', source: 'implied by model: solo-maintainer' }] }) })
    renderAt(<Governance part="rules" />)
    // C7 (ledger): the field row is labelled by its place ("Rule 1") and holds the whole sentence (0.6: one cell of three)
    const value = (await screen.findByText('the maintainer decides alone')).closest('dd')!
    expect(value.previousElementSibling!.textContent).toBe('Rule 1')
  })

  // C7 (ledger): the decisions table became the Decided tab's ledger of data rows (the id in Mono, the title, where it
  // is recorded, the outcome mark); a DECISIONS.md section opens with the row's Read, in a Mono well.
  it("lists decisions newest first, mapping status words through F1's table, and opens a DECISIONS.md section as text", async () => {
    const { calls } = fetchRoutes({ ...baseRoutes(), 'GET /api/governance': view(),
      'GET /api/governance/decisions/ld-2026-034': { markdown: '**Status:** ratified\n<script>alert(1)</script>' } })
    const { container } = renderAt(<Governance part="decisions" />)
    const decisions = await screen.findByRole('region', { name: 'Decisions' })
    const list = within(decisions).getByRole('list', { name: 'Decisions' })
    expect([...list.querySelectorAll('.prow-id')].map(e => e.textContent)).toEqual(['LD-2026-034', 'LD-2026-032', 'gov-1'])
    expect([...list.querySelectorAll('.drow-t')].map(e => e.textContent)).toEqual(['states beside the catalogue', 'co-fund goes ahead as B1 plus a prototype', 'adopt the solo model'])
    // the outcome is a mark and its word: the status as written, and F1's group when it says more
    expect(within(list).getByText('adopted · ratified').closest('.smark')!.className).toBe('smark smark-done')
    expect(within(list).getByText('Ratified').closest('.smark')).toBeTruthy()
    expect(within(list).getByText('preference-not-ratified').closest('.smark')).toBeNull()
    fireEvent.click(within(decisions).getByRole('button', { name: 'Read states beside the catalogue' }))
    const text = await screen.findByText(/\*\*Status:\*\* ratified/)
    expect(text.closest('pre')!.className).toBe('gov-well')
    expect(container.querySelector('script')).toBeNull()
    expect(calls.some(c => c.path === '/api/governance/decisions/ld-2026-034')).toBe(true)
    expect(within(decisions).queryByRole('button', { name: 'Read adopt the solo model' })).toBeNull()
  })

  it('keeps decisions with no id and no anchor apart, one row each (C8)', async () => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/governance': view({ decisions: [
      { date: '2026-10-01', id: '', title: 'first without an id', status: 'adopted', group: null, where: 'governance.yaml' },
      { date: '2026-10-02', id: '', title: 'second without an id', status: 'adopted', group: null, where: 'governance.yaml' },
    ] }) })
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a) })
    renderAt(<Governance part="decisions" />)
    const decisions = await screen.findByRole('region', { name: 'Decisions' })
    expect(within(decisions).getByText('first without an id')).toBeTruthy()
    expect(within(decisions).getByText('second without an id')).toBeTruthy()
    spy.mockRestore()
    expect(errors).toEqual([])
  })

  it('shows a decision that cannot be read in the server\'s words', async () => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/governance': view(),
      'GET /api/governance/decisions/ld-2026-034': refuse(404, { error: 'No decision "ld-2026-034" in DECISIONS.md.' }) })
    renderAt(<Governance part="decisions" />)
    const decisions = await screen.findByRole('region', { name: 'Decisions' })
    fireEvent.click(within(decisions).getByRole('button', { name: 'Read states beside the catalogue' }))
    expect(await screen.findByText('No decision "ld-2026-034" in DECISIONS.md.')).toBeTruthy()
  })

  it('says what will open a proposal, and no longer says it arrives with P2', async () => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/governance': view(), 'GET /api/proposals': [] })
    renderAt(<Governance part="proposals" />)
    const proposals = await screen.findByRole('region', { name: 'Proposals' })
    expect(await within(proposals).findByText(/a proposal opens when a rule asks for someone else's say/)).toBeTruthy()
    expect(proposals.textContent).not.toMatch(/arrives? with P2/)
  })
  it("puts F1's problems at the top in attn", async () => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/governance': view({ model: null, rules: [], decisions: [],
      problems: ['data/governance.yaml holds 3 YAML documents: merge them into one document under governance:.'] }) })
    const { container } = renderAt(<Governance part="rules" />)
    expect(await screen.findByText('data/governance.yaml holds 3 YAML documents: merge them into one document under governance:.')).toBeTruthy()
    // a house error note, not 0.6's problem line (walk 2026-11-04, L4c-fix 10)
    expect(container.querySelector('p.note-error')!.textContent).toContain('data/governance.yaml holds 3 YAML documents')
    expect(container.querySelector('.problem .mark')).toBeNull()
  })

  it('draws a problem as the server words it, in a house error note (walk 2026-11-04, L4c-fix 10)', async () => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/governance': view({ model: null, rules: [], decisions: [],
      problems: ['data/governance.yaml is not valid YAML: bad indentation at line 3'] }) })
    const { container } = renderAt(<Governance part="rules" />)
    expect(await screen.findByText('data/governance.yaml is not valid YAML: bad indentation at line 3')).toBeTruthy()
    expect(container.querySelector('p.note-error')!.textContent).toBe('data/governance.yaml is not valid YAML: bad indentation at line 3')
  })

  it('says NO_MODEL in its own words, as a quiet line, not an error (review I-2)', async () => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/governance': view({ model: null, rules: [], decisions: [], problems: [NO_MODEL] }) })
    const { container } = renderAt(<Governance part="rules" />)
    const line = await screen.findByText(NO_MODEL)
    expect(line.closest('.note-error')).toBeNull()
    expect(container.querySelector('p.note-error')).toBeNull()
    expect(document.body.textContent).not.toContain(`data/governance.yaml ${NO_MODEL}`)
  })

  it('shows the YAML on source', async () => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/governance': view(),
      'GET /api/registries/governance': { name: 'governance', kind: 'document', schemaVersion: '2.0', document: { model: 'solo-maintainer' } } })
    renderAt(<Governance part="rules" />)
    // C7 (ledger): "source" became "Show governance.yaml", and the YAML a Mono well
    fireEvent.click(await screen.findByRole('button', { name: 'Show governance.yaml' }))
    // The server hands back what is under `governance:`, already unwrapped (registry.ts).
    await waitFor(() => expect(screen.getByLabelText('governance.yaml').textContent).toBe('model: solo-maintainer\n'))
  })

  it("says why when governance can't be read", async () => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/governance': refuse(500, { error: 'governance.yaml cannot be read' }) })
    renderAt(<Governance part="rules" />)
    expect(await screen.findByText('governance.yaml cannot be read')).toBeTruthy()
  })

  it("says a read that failed once through the page's polite region: its note is no alert (§13, C11)", async () => {
    fetchRoutes({ ...baseRoutes(), 'GET /api/governance': refuse(500, { error: 'governance.yaml cannot be read' }) })
    renderAt(<Governance part="rules" />)
    await waitFor(() => expect(screen.getByTestId('live').textContent).toBe('governance.yaml cannot be read'))
    expect(document.querySelector('.note-error')!.closest('[role="alert"]')).toBeNull()
  })

  describe('proposals, sync and share', () => {
    const SELF = resource({ id: 'instance:self', kind: 'instance', board: 'systems', name: 'this instance', facts: { self: true }, source: null })
    const op = (id: string, label: string, effect: 'reads' | 'changes') => ({ id, label, effect, network: true, confirm: true, params: { type: 'object' }, preset: null, unavailable: null })
    const fetchPlan = { op: 'fetch', resource: 'instance:self', inProcess: true, cmd: null, args: [], writes: [], timeoutMs: 120000, confirm: true, nonce: 'n-fetch', summary: 'fetch origin: it downloads, it changes no file' }
    const sharePlan = { op: 'share', resource: 'instance:self', inProcess: false, cmd: 'git', args: ['push', '--', 'origin', 'refs/heads/main:refs/heads/main'], writes: [], timeoutMs: 120000, confirm: true, nonce: 'n-share' }
    const read = { remote: 'origin', ahead: 2, behind: 1, trunk: 'main', state: 'fetched', fetchedAt: '2026-10-17T11:00:00Z', sentence: '2 commits not shared · 1 new from the remote' }
    const routes = (over: Record<string, unknown> = {}) => fetchRoutes({
      ...baseRoutes(), 'GET /api/governance': view(), 'GET /api/proposals': proposalViews, 'GET /api/sync': read,
      'GET /api/generated': { behind: false }, 'GET /api/resources': [SELF],
      'GET /api/operations': [op('fetch', 'Fetch', 'reads'), op('share', 'Share', 'changes')],
      'POST /api/operations/fetch/plan': fetchPlan, 'POST /api/operations/share/plan': sharePlan, ...over,
    })

    // C7 (ledger): "the Proposals part is the proposals block, Open first, with an Open · Closed switch" — the switch
    // is the tabs: Open lists the open proposals, Decided the closed ones under the decisions.
    it('Open lists the open proposals as proposal rows; the closed ones are under Decided', async () => {
      routes()
      const { rerender } = renderAt(<Governance part="proposals" />, '/governance/proposals')
      const part = await screen.findByRole('region', { name: 'Proposals' })
      const open = await within(part).findByRole('list', { name: 'Open proposals' })
      expect(within(open).getByRole('link', { name: /Move the garden seat to the board/ }).getAttribute('href')).toBe('/r/proposal/p-2026-10-16-001')
      expect(within(open).queryByRole('link', { name: /Add a second signer/ })).toBeNull()
      // the one that waits on you is drawn as an attention item: the clay tile and the needs mark
      const waits = within(open).getByRole('link', { name: /Move the garden seat to the board/ })
      expect(waits.querySelector('.ktile')?.className ?? '').toMatch(/attn/)
      expect(within(waits).getByText('Needs you')).toBeTruthy()
      rerender(<Governance part="decisions" />)
      const closed = await screen.findByRole('list', { name: 'Closed proposals' })
      expect(within(closed).getByRole('link', { name: /Add a second signer/ })).toBeTruthy()
      expect(within(closed).queryByRole('link', { name: /Move the garden seat to the board/ })).toBeNull()
    })

    it('a row says "you approved", in moss, when the tally holds the viewer (E-51)', async () => {
      const mine = proposalView({ id: 'p-2026-10-16-003', title: 'Approved by me', lead: { state: 'pending', missing: 'needs 1 more approval', tally: { for: ['steward-a'], needed: 2 }, closesAt: null } as never })
      routes({ 'GET /api/proposals': [mine] })
      renderAt(<Governance part="proposals" />)
      const row = await screen.findByRole('link', { name: /Approved by me/ })
      const words = within(row).getByText('1 of 2 · you approved')
      expect(words.closest('.prow-yours')).toBeTruthy()
    })

    const pressSync = async () => {
      await waitFor(() => expect((screen.getByRole('button', { name: 'Sync' }) as HTMLButtonElement).disabled).toBe(false))
      fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
    }

    it('the head shows what the last fetch says, and Sync and Share', async () => {
      routes()
      const { container } = renderAt(<Governance part="rules" />)
      expect(await screen.findByText('2 commits not shared · 1 new from the remote')).toBeTruthy()
      // C7 (ledger): the line is the foot line under the head (§14.1 "tray foot line"), its buttons at its end
      const foot = container.querySelector('.sync-foot')!
      expect(foot.textContent).toContain('2 commits not shared')
      expect(within(foot as HTMLElement).getByRole('button', { name: 'Sync' })).toBeTruthy()
      expect(within(foot as HTMLElement).getByRole('button', { name: 'Share' })).toBeTruthy()
    })

    it('reads the line without the network: no plan is asked for until Sync is pressed', async () => {
      const { calls } = routes()
      renderAt(<Governance part="rules" />)
      await screen.findByText('2 commits not shared · 1 new from the remote')
      expect(calls.some(c => c.method === 'POST')).toBe(false)
    })

    it('Sync plans the fetch, says what it will do, and sends its nonce only when confirmed', async () => {
      const { calls } = routes({ 'POST /api/sync': { state: 'merged', remote: 'origin', trunk: 'main', ahead: 3, behind: 0, sentence: 'Merged origin/main into main. 3 commits not shared.' } })
      renderAt(<Governance part="rules" />)
      await pressSync()
      // C7 (ledger): the confirmation is the confirm dialog (§14.1), a modal <dialog> named by its title
      const box = await screen.findByRole('dialog', { name: 'Sync' })
      expect(box.tagName).toBe('DIALOG')
      expect(within(box).getByText(/^fetch origin: it downloads, it changes no file\. Then, if the trunk is behind/)).toBeTruthy()
      expect(calls.find(c => c.path === '/api/operations/fetch/plan')!.body).toEqual({ resource: 'instance:self', params: {} })
      expect(calls.some(c => c.path === '/api/sync' && c.method === 'POST')).toBe(false)
      fireEvent.click(within(box).getByRole('button', { name: 'Fetch and sync' }))
      expect(await screen.findByText('Merged origin/main into main. 3 commits not shared.')).toBeTruthy()
      expect(calls.find(c => c.path === '/api/sync' && c.method === 'POST')!.body).toEqual({ nonce: 'n-fetch' })
      expect(screen.queryByRole('dialog', { name: 'Sync' })).toBeNull()
    })

    it('a Sync that refuses shows the refusal as the sentence it came in', async () => {
      const sentence = 'Not synced: both sides changed `data/governance.yaml`; resolve it with git, then Sync again. Nothing was changed.'
      routes({ 'POST /api/sync': refuse(409, { state: 'refused', code: 'CONFLICT', error: sentence }) })
      renderAt(<Governance part="rules" />)
      await pressSync()
      fireEvent.click(await screen.findByRole('button', { name: 'Fetch and sync' }))
      // C7 (ledger, E-58): an error note, said once through the page's polite region, not an alert
      const note = (await screen.findByText(sentence)).closest('.note-error')!
      expect(note.getAttribute('role')).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
      await waitFor(() => expect(screen.getByTestId('live').textContent).toBe(sentence))
    })

    it('a double click on Fetch and sync sends the nonce once', async () => {
      const { calls } = routes({ 'POST /api/sync': { state: 'up-to-date', remote: 'origin', trunk: 'main', ahead: 0, behind: 0, sentence: 'Up to date.' } })
      renderAt(<Governance part="rules" />)
      await pressSync()
      const go = await screen.findByRole('button', { name: 'Fetch and sync' })
      fireEvent.click(go); fireEvent.click(go)
      await screen.findByText('Up to date.')
      expect(calls.filter(c => c.path === '/api/sync' && c.method === 'POST')).toHaveLength(1)
    })

    it('returns focus to Sync when its confirmation is cancelled', async () => {
      routes()
      renderAt(<Governance part="rules" />)
      await pressSync()
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sync' })))
    })

    it('keeps the generated-files answer 30 s, and does not refetch it on window focus', async () => {
      routes()
      const { qc } = renderAt(<Governance part="rules" />)
      await screen.findByText('2 commits not shared · 1 new from the remote')
      const opts = qc.getQueryCache().find({ queryKey: ['generated'] })!.options as { refetchOnWindowFocus?: unknown; staleTime?: unknown }
      expect(opts.refetchOnWindowFocus).toBe(false)
      expect(opts.staleTime).toBe(30_000)
    })

    it('Cancel leaves the plan unused: nothing is sent to /api/sync', async () => {
      const { calls } = routes()
      renderAt(<Governance part="rules" />)
      await pressSync()
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('dialog', { name: 'Sync' })).toBeNull()
      expect(calls.some(c => c.path === '/api/sync' && c.method === 'POST')).toBe(false)
    })

    it('Share shows the exact refspec in its confirmation, then runs the job with the nonce', async () => {
      const { calls } = routes({ 'POST /api/jobs': { id: 'j9', status: 'running' } })
      renderAt(<Governance part="rules" />)
      await waitFor(() => expect((screen.getByRole('button', { name: 'Share' }) as HTMLButtonElement).disabled).toBe(false))
      fireEvent.click(screen.getByRole('button', { name: 'Share' }))
      const box = await screen.findByRole('dialog', { name: 'Share' })
      expect(await within(box).findByText('git push -- origin refs/heads/main:refs/heads/main')).toBeTruthy()
      fireEvent.click(within(box).getByRole('button', { name: 'Run' }))
      await waitFor(() => expect(calls.find(c => c.path === '/api/jobs' && c.method === 'POST')!.body).toEqual({ nonce: 'n-share' }))
    })

    // Final review I3: the Share job is followed to its end and its outcome said; a non-fast-forward rejection is reported
    // (spec §3.12) with what to do, never as "started".
    const job = (status: string, sentence: string | null) => ({ id: 'j9', op: 'share', resource: 'instance:self', status, exitCode: status === 'ok' ? 0 : 1, changed: [], surprises: [], sentence })
    const runShare = async (answers: unknown[]) => {
      let n = 0
      routes({ 'POST /api/jobs': job('running', null), 'GET /api/jobs/j9': () => ({ job: answers[Math.min(n++, answers.length - 1)], log: '' }) })
      renderAt(<Governance part="rules" />)
      await waitFor(() => expect((screen.getByRole('button', { name: 'Share' }) as HTMLButtonElement).disabled).toBe(false))
      fireEvent.click(screen.getByRole('button', { name: 'Share' }))
      const box = await screen.findByRole('dialog', { name: 'Share' })
      await within(box).findByText('git push -- origin refs/heads/main:refs/heads/main')
      fireEvent.click(within(box).getByRole('button', { name: 'Run' }))
    }
    it('Share waits for its job and says when the remote holds the trunk', async () => {
      await runShare([job('running', null), job('ok', 'Done. No file changed.')])
      expect(await screen.findByText('Sharing main with origin…')).toBeTruthy()
      expect(await screen.findByText('Shared: origin now holds main.', {}, { timeout: 4000 })).toBeTruthy()
      expect(screen.queryByText(/Share started/)).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
    })
    it('a Share the remote rejects as not a fast-forward is reported, with what to do next', async () => {
      await runShare([job('failed', "Failed with exit code 1.\nTo /remote.git\n ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs to '/remote.git'")])
      const alert = await screen.findByText('The remote has commits this clone lacks: Sync, then Share again.', {}, { timeout: 4000 })
      expect(alert.closest('.note-error')).toBeTruthy()
      expect(screen.queryByText(/Shared:/)).toBeNull()
    })
    it('a Share that fails for another reason says the job\'s own sentence', async () => {
      await runShare([job('failed', "Failed with exit code 128.\nfatal: '/nowhere.git' does not appear to be a git repository")])
      const alert = (await screen.findByText(/^Not shared\. Failed with exit code 128\./, {}, { timeout: 4000 })).closest('.note-error')!
      expect(alert.textContent).toMatch(/^Not shared\. Failed with exit code 128\./)
      expect(alert.textContent).toMatch(/does not appear to be a git repository/)
    })

    it('says generated files are behind the data when the server says so, with no button', async () => {
      routes({ 'GET /api/generated': { behind: true, since: 'abc1234' } })
      renderAt(<Governance part="rules" />)
      const line = await screen.findByText('Generated files are behind the data: run npm run generate:schemas and commit .well-known/.')
      expect(line.closest('.problem')!.querySelector('button')).toBeNull()
    })

    it('says nothing of generated files when they are not behind', async () => {
      routes()
      renderAt(<Governance part="rules" />)
      await screen.findByText('2 commits not shared · 1 new from the remote')
      expect(screen.queryByText(/Generated files are behind/)).toBeNull()
    })
  })
  describe('previewing (E-50, C-23)', () => {
    const PUBLIC_RECORD = resource({ id: 'project:open-garden', facts: { visibility: 'public' }, source: { path: 'data/projects.yaml', editable: true, registry: 'projects', entityId: 'open-garden' } })
    const MEMBERS_RECORD = resource({ id: 'project:garden', source: { path: 'data/projects.yaml', editable: true, registry: 'projects', entityId: 'garden' } })
    const onPublic: ProposalView = proposalView({ id: 'p-2026-10-16-010', title: 'Open the public garden', ops: [{ op: 'update', record: 'projects:open-garden', set: { lead: 'steward-a' }, base: 'h1' }] as never })
    const onMembers: ProposalView = proposalView({ id: 'p-2026-10-16-011', title: 'Move the members garden', ops: [{ op: 'update', record: 'projects:garden', set: { lead: 'steward-a' }, base: 'h1' }] as never })
    const onUnknown: ProposalView = proposalView({ id: 'p-2026-10-16-012', title: 'Touch a record nobody lists', ops: [{ op: 'update', record: 'projects:gone', set: { lead: 'steward-a' }, base: 'h1' }] as never })
    const restricted = { ...proposalView({ id: 'p-2026-10-16-013', title: 'A change to a restricted collection', ops: [] as never }), restricted: true } as ProposalView
    // each proposal's own record, as the store lists it: the first public, the others the members'
    const OWN = [resource({ id: 'proposal:p-2026-10-16-010', kind: 'proposal', facts: { visibility: 'public' }, source: null }),
      ...['011', '012', '013'].map(n => resource({ id: `proposal:p-2026-10-16-${n}`, kind: 'proposal', source: null }))]
    const routes = (proposals: ProposalView[]) => fetchRoutes({ ...baseRoutes(), 'GET /api/governance': view(), 'GET /api/proposals': proposals,
      'GET /api/resources': [PUBLIC_RECORD, MEMBERS_RECORD, ...OWN], 'GET /api/sync': { remote: 'origin', ahead: 0, behind: 0, trunk: 'main', state: 'fetched', fetchedAt: null, sentence: 'Up to date' } })
    const preview = (as: 'public' | 'members') => renderAt(<ViewAsProvider initial={{ as }}><Governance part="proposals" /></ViewAsProvider>, '/governance/proposals')

    it('as Public, a members-only instance has no proposal: the empty state, Open 0, and no Sync or Share', async () => {
      routes(proposalViews)
      preview('public')
      expect(await screen.findByText(/None open\./)).toBeTruthy()
      await waitFor(() => expect(screen.getByRole('tab', { name: /^Open/ }).textContent).toBe('Open 0'))
      expect(screen.queryByRole('link', { name: /Move the garden seat/ })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Sync' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
    })

    it('as Public, a proposal is listed only when every record its ops touch is public; a restricted one never is', async () => {
      routes([onPublic, onMembers, onUnknown, restricted])
      preview('public')
      const open = await screen.findByRole('list', { name: 'Open proposals' })
      expect(within(open).getAllByRole('link').map(a => a.querySelector('.drow-t')!.textContent)).toEqual(['Open the public garden'])
      expect(screen.getByRole('tab', { name: /^Open/ }).textContent).toBe('Open 1')
    })

    // C7 review I-1: a member is listed every proposal, one they may not read in its restricted form (R-L5-15.8); a record
    // the resources do not hold (a create, a governance document) restricts nothing.
    it('as Members, every proposal is listed: the restricted one, and an admitted full view with private ops, in the restricted form', async () => {
      const admitted = { ...proposalView({ id: 'p-2026-10-16-014', title: 'Pay the Q3 stipends', rationale: 'The quarter closed.',
        ops: [{ op: 'update', record: 'projects:garden', set: { lead: 'steward-a' }, base: 'h1' }] as never } as never),
      private: [{ ref: 'payroll:q3', class: 'records', op: { op: 'update' } }] } as unknown as ProposalView
      const onGovernance = proposalView({ id: 'p-2026-10-16-015', title: 'Tighten the records rule', ops: [{ op: 'replace', record: 'governance', value: {}, base: 'h1' }] as never })
      routes([onPublic, onMembers, onUnknown, restricted, admitted, onGovernance])
      preview('members')
      const open = await screen.findByRole('list', { name: 'Open proposals' })
      expect(within(open).getAllByRole('link').map(a => a.querySelector('.drow-t')!.textContent)).toEqual([
        'Open the public garden', 'Move the members garden', 'Touch a record nobody lists', 'A change to a restricted collection',
        'A change to a restricted collection', 'Tighten the records rule'])
      expect(screen.queryByText('Pay the Q3 stipends')).toBeNull()
    })

    it('as Public, none of the governance the door never shows: no problems, no decision or its text, no source well, no rule (I-2)', async () => {
      fetchRoutes({ ...baseRoutes(), 'GET /api/proposals': [], 'GET /api/resources': [PUBLIC_RECORD],
        'GET /api/governance': view({ problems: ['data/governance.yaml holds 2 YAML documents.'], description: 'How the org decides.' }) })
      const { rerender } = renderAt(<ViewAsProvider initial={{ as: 'public' }}><Governance part="decisions" /></ViewAsProvider>, '/governance/decisions')
      expect(await screen.findByText('Previewing as Public, no decision is shown.')).toBeTruthy()
      expect(screen.queryByText('states beside the catalogue')).toBeNull()
      expect(screen.queryByRole('button', { name: /^Read / })).toBeNull()
      expect(screen.queryByText(/holds 2 YAML documents/)).toBeNull()
      expect(screen.queryByText('How the org decides.')).toBeNull()
      expect(document.querySelector('.rh-meta')).toBeNull() // no model
      expect(screen.getByRole('tab', { name: /^Decided/ }).textContent).toBe('Decided 0')
      rerender(<ViewAsProvider initial={{ as: 'public' }}><Governance part="rules" /></ViewAsProvider>)
      expect(await screen.findByText('Previewing as Public, the rules in force are not shown.')).toBeTruthy()
      expect(screen.queryByText(/the maintainer decides alone/)).toBeNull()
      expect(screen.queryByRole('button', { name: 'Show governance.yaml' })).toBeNull()
      expect(screen.getByRole('tab', { name: /^Rules/ }).textContent).toBe('Rules')
    })

    it('as Public, the rules show when the governance document itself is a record Public sees', async () => {
      const doc = resource({ id: 'governance:governance', kind: 'governance', facts: { visibility: 'public' }, source: { path: 'data/governance.yaml', editable: true, registry: 'governance', entityId: 'governance' } })
      fetchRoutes({ ...baseRoutes(), 'GET /api/proposals': [], 'GET /api/resources': [doc], 'GET /api/governance': view() })
      renderAt(<ViewAsProvider initial={{ as: 'public' }}><Governance part="rules" /></ViewAsProvider>, '/governance/rules')
      expect(await screen.findByText('a maintainer proposes · the maintainer decides alone')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Show governance.yaml' })).toBeNull()
    })
  })
})
