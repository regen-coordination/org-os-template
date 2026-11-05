// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import ClaimHandle from './ClaimHandle.tsx'
import ReadOnlyNotice from '../ReadOnly.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { refuse } from '../test/data.ts'
import type { ClaimPlan, ClaimStatus, WizardDef } from '../api.ts'
import { errorNote, findErrorNote } from '../test/notes.ts'

const def: WizardDef = {
  id: 'claim-handle', title: 'Claim your handle', summary: 'Tell this app which member you are.',
  intro: { body: 'No member holds your address yet.', writes: 'Nothing. You choose, and you see the exact line, before anything is written.' },
  steps: [{ id: 'who', title: 'Which member are you?', ask: 'Pick the member that is you.', writes: 'Nothing yet. The next screen shows the exact line.' }],
  review: { title: 'Check the line', ask: 'This is the line that will be written.', writes: 'One line in data/members.yaml, and one commit that records it. You can undo it with git revert.' },
  done: { title: 'You are {member}', body: 'This page is editable now.' },
}
const status: ClaimStatus = {
  available: true, refusal: null, address: 'steward-a@example.org', rule: 'bootstrap/claim', canCreate: false,
  candidates: [{ id: 'steward-a', name: 'Steward A' }, { id: 'steward-b', name: 'Steward B' }],
}
const plan = (over: Partial<ClaimPlan['review']> = {}): ClaimPlan => ({
  nonce: 'n'.repeat(48), expiresInMs: 120000,
  review: {
    address: 'steward-a@example.org', file: 'data/members.yaml', lines: ['      git: steward-a@example.org'],
    member: { id: 'steward-a', name: 'Steward A', created: false },
    commit: { message: 'admin(members): claim the git handle for steward-a', trailers: { 'Org-Actor': 'unknown <steward-a@example.org>', 'Org-Rule': 'bootstrap/claim' } },
    note: 'This file is committed. If this repository is public, the address becomes public. Use your noreply address if you prefer.',
    cmd: 'node', args: ['claim-handle.mjs', '--member', 'steward-a'], writes: ['data/members.yaml'], timeoutMs: 10000, network: false, ...over,
  },
})
const done = { ok: true, commit: 'abcdef1234567890', member: { id: 'steward-a' }, changed: ['data/members.yaml'], trailers: { 'Org-Actor': 'unknown <steward-a@example.org>', 'Org-Rule': 'bootstrap/claim' } }
const routes = (over: Record<string, unknown> = {}) => ({
  'GET /api/bootstrap/claim': status,
  'GET /api/wizards/claim-handle/draft': null,
  'PUT /api/wizards/claim-handle/draft': (init?: RequestInit) => ({ ...JSON.parse(String(init?.body)), saved: 'now' }),
  'DELETE /api/wizards/claim-handle/draft': { discarded: true },
  'GET /api/actor': { unknown: 'steward-a@example.org' },
  'POST /api/bootstrap/claim/plan': plan(),
  'POST /api/bootstrap/claim/confirm': done,
  ...over,
})
const start = async () => fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
const choose = (name: string) => fireEvent.click(screen.getByRole('radio', { name: new RegExp(name) }))
const writes = () => screen.getByRole('group', { name: 'What this writes' }).textContent
const posts = (calls: { method: string; path: string }[], path: string) => calls.filter(c => c.method === 'POST' && c.path === path)

describe('W2a: claim your handle', () => {
  it('opens on an intro that says nothing is written, and lists the members who hold no address', async () => {
    const { calls } = fetchRoutes(routes())
    renderAt(<ClaimHandle def={def} />)
    expect(await screen.findByRole('heading', { level: 2, name: 'Claim your handle' })).toBeTruthy()
    expect(writes()).toContain('Nothing. You choose')
    expect(screen.getByRole('status').textContent).toMatch(/Nothing is written until you confirm the last step/)
    expect(calls.filter(c => c.method !== 'GET')).toEqual([])
  })

  it('walks intro → choose → review → confirm → done, and writes only at the confirm', async () => {
    let claimed = false
    const { calls } = fetchRoutes(routes({
      'GET /api/actor': () => (claimed ? { id: 'steward-a', name: 'Steward A', kind: 'person' } : { unknown: 'steward-a@example.org' }),
      'POST /api/bootstrap/claim/confirm': () => { claimed = true; return done },
    }))
    renderAt(<><ReadOnlyNotice /><ClaimHandle def={def} /></>)
    await waitFor(() => expect(document.querySelector('.band-ro .band-t')?.textContent).toMatch(/^Read only: your git address is not a member’s\./)) // C9: the read-only band (ledger)
    await start()
    expect(screen.getByRole('heading', { level: 2, name: 'Which member are you?' })).toBeTruthy()
    expect(writes()).toContain('Nothing yet')
    choose('Steward A')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    // review: the exact line, the address, the commit and its trailers, the sentence about a public repository
    expect(await screen.findByRole('heading', { level: 2, name: 'Check the line' })).toBeTruthy()
    const log = (await screen.findByText(/git: steward-a@example\.org/, { selector: '.wiz-log *, .wiz-log' })).closest('.wiz-log')!
    expect(log.textContent).toContain('data/members.yaml')
    expect(log.textContent).toContain('+       git: steward-a@example.org')
    expect(log.textContent).toContain('Org-Actor: unknown <steward-a@example.org>')
    expect(log.textContent).toContain('Org-Rule: bootstrap/claim')
    expect(screen.getByText(/the address becomes public/)).toBeTruthy()
    expect(writes()).toMatch(/One line in data\/members\.yaml/)
    expect(posts(calls, '/api/bootstrap/claim/confirm')).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'This is me' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'You are Steward A' })).toBeTruthy()
    expect(posts(calls, '/api/bootstrap/claim/plan').map(c => (c as { body?: unknown }).body)).toEqual([{ member: 'steward-a' }])
    expect(posts(calls, '/api/bootstrap/claim/confirm').map(c => (c as { body?: unknown }).body)).toEqual([{ nonce: 'n'.repeat(48) }])
    expect(screen.getByText(/git revert abcdef1/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /boards/i }).getAttribute('href')).toBe('/')
    await waitFor(() => expect(calls.some(c => c.method === 'DELETE' && c.path === '/api/wizards/claim-handle/draft')).toBe(true))
    // the page they were on becomes editable: the read-only notice reads who they are again, and goes
    await waitFor(() => expect(document.querySelector('.band-ro')).toBeNull())
    expect(calls.filter(c => c.path === '/api/actor').length).toBeGreaterThan(1)
  })

  it('reviews the answers as field rows, and every file it writes (E-26)', async () => {
    fetchRoutes(routes())
    renderAt(<ClaimHandle def={def} />)
    await start(); choose('Steward A'); fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const answers = await screen.findByRole('group', { name: 'Your answers' })
    expect([...answers.querySelectorAll('dt')].map(dt => dt.textContent)).toEqual(['Member', 'Address', 'Files it writes'])
    expect([...answers.querySelectorAll('dd')].map(dd => dd.textContent)).toEqual(['Steward A · steward-a', 'steward-a@example.org', 'data/members.yaml'])
    expect(answers.querySelector('dd:last-of-type .mono')).toBeTruthy()
  })

  it('ends done on what decided it and what to do next (E-26)', async () => {
    fetchRoutes(routes())
    renderAt(<ClaimHandle def={def} />)
    await start(); choose('Steward A'); fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(await screen.findByRole('button', { name: 'This is me' }))
    const done = (await screen.findByRole('heading', { level: 2, name: 'You are Steward A' })).closest('.wiz-out')! as HTMLElement
    expect(done.querySelector('.ktile-moss')).toBeTruthy()
    expect(within(done).getByText(/The rule bootstrap\/claim decided it/)).toBeTruthy()
    expect(within(done).getByRole('link', { name: 'Open your boards' }).getAttribute('href')).toBe('/')
  })

  it('never sends an address: the server reads it', async () => {
    const { calls } = fetchRoutes(routes())
    renderAt(<ClaimHandle def={def} />)
    await start(); choose('Steward B'); fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { level: 2, name: 'Check the line' })
    expect(JSON.stringify(calls.map(c => c.body))).not.toContain('example.org')
  })

  it('refuses to go on without a choice, in a sentence, and stays on the step', async () => {
    fetchRoutes(routes())
    renderAt(<ClaimHandle def={def} />)
    await start()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(errorNote().textContent).toContain('Choose who you are first.')
    expect(screen.getByRole('heading', { level: 2, name: 'Which member are you?' })).toBeTruthy()
    // the sentence goes once what it refused is no longer so
    choose('Steward A')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the exact command out of the way, and the line, the address and the trailers in view', async () => {
    fetchRoutes(routes())
    renderAt(<ClaimHandle def={def} />)
    await start(); choose('Steward A'); fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const cmd = (await screen.findByText('The exact command it runs')).closest('details')!
    expect(cmd.open).toBe(false)
    expect(cmd.textContent).toContain('claim-handle.mjs --member steward-a')
    expect(screen.getByText(/May write/).closest('.wiz-log')!.textContent).toContain('reaches nothing outside this machine')
  })

  it('goes back, keeping the choice, and back again to the intro', async () => {
    fetchRoutes(routes())
    renderAt(<ClaimHandle def={def} />)
    await start(); choose('Steward B'); fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { level: 2, name: 'Check the line' })
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect((screen.getByRole('radio', { name: /Steward B/ }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Claim your handle' })).toBeTruthy()
  })

  it('says why not, and offers no start, where the claim is refused', async () => {
    fetchRoutes(routes({ 'GET /api/bootstrap/claim': { ...status, available: false, refusal: 'This organisation has rules for who its members are. Ask a maintainer to add your address, or propose it.', candidates: [] } }))
    renderAt(<ClaimHandle def={def} />)
    expect((await findErrorNote()).textContent).toContain('has rules for who its members are')
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
  })

  it('shows the server\'s sentence when the plan is refused, and has nothing to confirm', async () => {
    fetchRoutes(routes({ 'POST /api/bootstrap/claim/plan': refuse(409, { error: 'Git has never seen steward-a@example.org author a commit here; add it to data/members.yaml yourself, or commit once and try again.' }) }))
    renderAt(<ClaimHandle def={def} />)
    await start(); choose('Steward A'); fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect((await findErrorNote()).textContent).toContain('Git has never seen steward-a@example.org')
    expect(screen.queryByRole('button', { name: 'This is me' })).toBeNull()
  })

  it('fails in words when the confirm is refused, writes nothing more, and plans again on a retry', async () => {
    let nth = 0
    const { calls } = fetchRoutes(routes({
      'POST /api/bootstrap/claim/plan': () => plan({ lines: [`      git: try${++nth}@example.org`] }),
      'POST /api/bootstrap/claim/confirm': refuse(409, { error: 'Something changed since you reviewed this: data/members.yaml changed. Nothing was written. Prepare it again.' }),
    }))
    renderAt(<ClaimHandle def={def} />)
    await start(); choose('Steward A'); fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText(/try1@example\.org/)
    fireEvent.click(screen.getByRole('button', { name: 'This is me' }))
    expect((await findErrorNote()).textContent).toContain('Something changed since you reviewed this')
    expect(screen.getByRole('status').textContent).toMatch(/Not done/)
    expect(screen.getByRole('heading', { level: 2, name: 'Nothing was written' }).closest('.wiz-out')!.querySelector('.ktile-attn')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to review' }))
    await screen.findByText(/try2@example\.org/)
    expect(posts(calls, '/api/bootstrap/claim/plan')).toHaveLength(2)
    expect(posts(calls, '/api/bootstrap/claim/confirm')).toHaveLength(1)
  })

  it('keeps a draft as you go, closes without deleting it, and continues from it', async () => {
    const first = fetchRoutes(routes())
    const one = renderAt(<ClaimHandle def={def} />)
    await start(); choose('Steward B')
    await waitFor(() => expect(first.calls.some(c => c.method === 'PUT' && JSON.stringify(c.body) === JSON.stringify({ index: 0, answers: { who: 'steward-b' } }))).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Save and leave' }))
    expect(screen.getByRole('status').textContent).toMatch(/kept as a draft/)
    expect(first.calls.some(c => c.method === 'DELETE')).toBe(false)
    one.unmount()
    fetchRoutes(routes({ 'GET /api/wizards/claim-handle/draft': { index: 0, answers: { who: 'steward-b' }, saved: 'earlier' } }))
    renderAt(<ClaimHandle def={def} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue where you left off' }))
    expect((screen.getByRole('radio', { name: /Steward B/ }) as HTMLInputElement).checked).toBe(true)
  })

  it('adds a new member when none exists, with the name asked for and the id shown at the review', async () => {
    const { calls } = fetchRoutes(routes({
      'GET /api/bootstrap/claim': { ...status, candidates: [], canCreate: true },
      'POST /api/bootstrap/claim/plan': plan({ lines: ['  - id: steward-a', '    name: "Steward A"', '    handles:', '      git: steward-a@example.org'], member: { id: 'steward-a', name: 'Steward A', created: true } }),
    }))
    renderAt(<ClaimHandle def={def} />)
    await start()
    choose('new member')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(errorNote().textContent).toContain('Write your name')
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Steward A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText(/id: steward-a/)).toBeTruthy()
    expect(posts(calls, '/api/bootstrap/claim/plan').map(c => (c as { body?: unknown }).body)).toEqual([{ create: { name: 'Steward A' } }])
    expect(within(screen.getByRole('region', { name: 'Claim your handle' })).getByText(/new member/i)).toBeTruthy()
  })
})
