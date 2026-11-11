// @vitest-environment jsdom
// DAO-OS L7 Task 19: the template wizard runner. A shelf wizard with a `result` (L7 §7.1) asks its steps, reviews what
// the add will stage, posts `{ config }` to the entry's add and opens /compose; a 422 goes back to the step holding the
// field, with the sentence. Fixtures are invented (placeholder addresses, the Test DAO).
import { describe, it, expect } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import TemplateWizard from './TemplateWizard.tsx'
import WizardPage from './WizardPage.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { knownActor, refuse } from '../test/data.ts'
import { preview as libraryPreview } from '../test/fixtures/library.ts'
import { errorNote, findErrorNote } from '../test/notes.ts'
import { ViewAsProvider } from '../viewAs/ViewAs.tsx'
import { expectNoWriteControls } from '../test/publicPreview.tsx'
import type { WizardDef } from '../api.ts'

const A1 = `0x${'0'.repeat(38)}a1`, A2 = `0x${'0'.repeat(38)}a2`, A3 = `0x${'0'.repeat(38)}a3`

/** The DAO shelf's compose wizard, as an instance serves it (`dao/compose-a-dao`): five steps, then the review. */
const COMPOSE: WizardDef = {
  id: 'dao/compose-a-dao', title: 'Compose a DAO', summary: 'A Safe, a council that signs for it and a Snapshot space, composed and not deployed.',
  intro: { body: 'Five questions, then the composition is staged in your changes.', writes: 'Nothing yet.' },
  steps: [
    { id: 'template', title: 'Template', ask: 'What do you want to compose?', writes: 'Nothing yet.', doors: [
      { value: 'council-safe-hats', label: 'Council + Safe + Hats', help: 'A Safe that a council signs for through a Hats tree.' },
      { value: 'blank', label: 'Start blank', help: 'Open the compose canvas with nothing on it.' },
    ] },
    { id: 'name', title: 'Name', ask: 'What is the organization called?', writes: 'Nothing yet.', fields: [{ id: 'name', label: 'Name', kind: 'text', required: true }] },
    { id: 'signers', title: 'Signers', ask: 'Who signs for the Safe, and how many of them must sign?', writes: 'Nothing yet.', fields: [
      { id: 'owners', label: 'Signers', kind: 'addresses', required: true, help: 'One address per line.' },
      { id: 'threshold', label: 'Signatures needed', kind: 'count', required: true },
    ] },
    { id: 'roles', title: 'Roles', ask: 'What is the council called, and who wears its hat?', writes: 'Nothing yet.', fields: [
      { id: 'council', label: 'Council', kind: 'text', required: true },
      { id: 'wearers', label: 'Council members', kind: 'addresses', required: true, help: 'One address per line.' },
    ] },
    { id: 'votes', title: 'Votes', ask: 'Which ENS name is the Snapshot space on Sepolia?', writes: 'Nothing yet.', fields: [{ id: 'space', label: 'Snapshot space', kind: 'text', required: true }] },
  ],
  review: { title: 'Review', ask: 'Stage this composition in your changes?', writes: 'Stages the Safe, the council’s Hats tree, the Snapshot space and a board in your changes, as one change. Nothing is deployed.' },
  done: { title: 'Staged', body: 'The composition is in your changes.' },
  result: { add: 'template:council-safe-hats', config: {
    name: '${field.name}', owners: '${field.owners}', threshold: '${field.threshold}', council: '${field.council}', wearers: '${field.wearers}', space: '${field.space}',
  } },
}

const ENTRY = '/api/library/template%3Acouncil-safe-hats'
const DRAFT = '/api/wizards/dao%2Fcompose-a-dao/draft'
const PREVIEW = libraryPreview({
  id: 'template:council-safe-hats',
  adds: [
    { record: 'systems:test-dao-safe', op: 'create', class: 'records', summary: 'system, safe' },
    { record: 'systems:test-dao-roles', op: 'create', class: 'records', summary: 'system, hats-tree' },
    { record: 'systems:test-dao-votes', op: 'create', class: 'records', summary: 'system, snapshot-space' },
    { record: 'boards:test-dao-council', op: 'create', class: 'records', summary: 'board, 2 blocks' },
  ],
})
const routes = (over: Record<string, unknown> = {}) => ({
  // who you are: the runner writes (a stage, a draft) only for a member (review M3), as /compose
  'GET /api/actor': knownActor,
  [`GET ${DRAFT}`]: null,
  [`PUT ${DRAFT}`]: (init?: RequestInit) => ({ ...JSON.parse(String(init?.body)), saved: 'now' }),
  [`DELETE ${DRAFT}`]: { discarded: true },
  [`GET ${ENTRY}/preview`]: PREVIEW,
  [`POST ${ENTRY}/add`]: { id: 'c1', actor: 'steward-a', ops: [] },
  ...over,
})

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
const heading = (name: string) => screen.findByRole('heading', { level: 2, name })
/** A field by its label (the rail names its steps too: `Name`, `Signers` are list items there). */
const field = (label: string) => screen.getByLabelText(label, { exact: true, selector: 'input, textarea' })
const fill = (label: string, value: string) => fireEvent.change(field(label), { target: { value } })
const eyebrow = () => document.querySelector('.wiz-k')?.textContent
const posts = (calls: { method: string; path: string; body: unknown }[]) => calls.filter(c => c.method === 'POST' && c.path === `${ENTRY}/add`)

/** Walks from the intro to the review with the given answers. */
async function walk(o: { owners?: string; threshold?: string; wearers?: string } = {}) {
  fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
  fireEvent.click(screen.getByRole('radio', { name: /Council \+ Safe \+ Hats/ }))
  next()
  await heading('Name'); fill('Name', 'Test DAO'); next()
  await heading('Signers'); fill('Signers', o.owners ?? `${A1}\n${A2}\n${A3}`); fill('Signatures needed', o.threshold ?? '2'); next()
  await heading('Roles'); fill('Council', 'Council'); if (o.wearers !== undefined) fill('Council members', o.wearers); next()
  await heading('Votes'); fill('Snapshot space', 'test-dao.eth'); next()
  await heading('Review')
}

describe('the template wizard runner (L7 Task 19)', () => {
  // Walk M14 adapted this case: the eyebrow counts the rail (the steps and the review), as the page's head ("6 steps")
  // and the parts' frame do, so the count is the same on every screen, the review included.
  it('asks the five steps, then the review, and counts the rail in the eyebrow: "Compose a DAO · 3 of 6"', async () => {
    fetchRoutes(routes())
    renderAt(<TemplateWizard def={COMPOSE} />, '/wizards/dao%2Fcompose-a-dao')
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
    const rail = screen.getByRole('list', { name: 'Steps' })
    expect(within(rail).getAllByRole('listitem').map(li => li.querySelector('.wiz-step-t')!.textContent)).toEqual(['Template', 'Name', 'Signers', 'Roles', 'Votes', 'Review'])
    expect(eyebrow()).toBe('Compose a DAO · 1 of 6')
    fireEvent.click(screen.getByRole('radio', { name: /Council \+ Safe \+ Hats/ }))
    next()
    await heading('Name'); fill('Name', 'Test DAO'); next()
    await heading('Signers')
    expect(eyebrow()).toBe('Compose a DAO · 3 of 6')
  })

  it('refuses to leave a step whose answer does not read, in words, and marks the field', async () => {
    fetchRoutes(routes())
    renderAt(<TemplateWizard def={COMPOSE} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
    next()
    expect(errorNote().textContent).toContain('Choose one.')
    fireEvent.click(screen.getByRole('radio', { name: /Council \+ Safe \+ Hats/ }))
    next()
    await heading('Name'); next()
    expect(errorNote().textContent).toContain('Name is required.')
    fill('Name', 'Test DAO'); next()
    await heading('Signers')
    fill('Signers', `${A1}\nnot an address`); fill('Signatures needed', '2'); next()
    expect(await heading('Signers')).toBeTruthy()
    expect(errorNote().textContent).toContain('Line 2, "not an address", is not an address')
    expect(field('Signers').getAttribute('aria-invalid')).toBe('true')
  })

  it('fills the council members from the signers, and keeps what the person wrote there', async () => {
    fetchRoutes(routes())
    renderAt(<TemplateWizard def={COMPOSE} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
    fireEvent.click(screen.getByRole('radio', { name: /Council \+ Safe \+ Hats/ })); next()
    await heading('Name'); fill('Name', 'Test DAO'); next()
    await heading('Signers'); fill('Signers', `${A1}\n${A2}`); fill('Signatures needed', '2'); next()
    await heading('Roles')
    expect((field('Council members') as HTMLTextAreaElement).value).toBe(`${A1}\n${A2}`)
    fill('Council members', A3)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await heading('Signers'); fill('Signers', `${A1}\n${A2}\n${A3}`); next()
    await heading('Roles')
    expect((field('Council members') as HTMLTextAreaElement).value).toBe(A3)
  })

  it('reviews the answers and lists the records the add stages, and posts nothing before it is confirmed', async () => {
    const { calls } = fetchRoutes(routes())
    renderAt(<TemplateWizard def={COMPOSE} />)
    await walk()
    const answers = screen.getByRole('group', { name: 'Your answers' })
    expect([...answers.querySelectorAll('dt')].map(dt => dt.textContent)).toEqual(['Name', 'Signers', 'Signatures needed', 'Council', 'Council members', 'Snapshot space'])
    expect(within(answers).getAllByText(A1).length).toBe(2)
    const staged = await screen.findByRole('list', { name: 'What it stages' })
    expect(within(staged).getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'systems:test-dao-safe · system, safe', 'systems:test-dao-roles · system, hats-tree', 'systems:test-dao-votes · system, snapshot-space', 'boards:test-dao-council · board, 2 blocks',
    ])
    expect(screen.getByRole('group', { name: 'What this writes' }).textContent).toContain('Nothing is deployed.')
    expect(posts(calls)).toEqual([])
  })

  it('stages the add with the config its result names, read as each field reads, then opens /compose', async () => {
    const { calls } = fetchRoutes(routes())
    const { loc } = renderAt(<TemplateWizard def={COMPOSE} />, '/wizards/dao%2Fcompose-a-dao')
    await walk()
    fireEvent.click(screen.getByRole('button', { name: 'Stage in your changes' }))
    await waitFor(() => expect(loc.history!.at(-1)).toBe('/compose'))
    expect(posts(calls).map(c => c.body)).toEqual([{ config: {
      name: 'Test DAO', owners: [A1, A2, A3], threshold: 2, council: 'Council', wearers: [A1, A2, A3], space: 'test-dao.eth',
    } }])
    await waitFor(() => expect(calls.some(c => c.method === 'DELETE' && c.path === DRAFT)).toBe(true))
  })

  it('goes back to Signers with the sentence when the add refuses the threshold (a 422 on the composition)', async () => {
    const sentence = 'threshold is 4, and the Safe has 3 owners; it is between 1 and the number of owners.'
    fetchRoutes(routes({ [`POST ${ENTRY}/add`]: refuse(422, { errors: [{ record: 'systems:test-dao-safe', field: 'deployment.threshold', message: sentence }] }) }))
    const { loc } = renderAt(<TemplateWizard def={COMPOSE} />, '/wizards/dao%2Fcompose-a-dao')
    await walk({ threshold: '4' })
    fireEvent.click(screen.getByRole('button', { name: 'Stage in your changes' }))
    expect(await heading('Signers')).toBeTruthy()
    expect((await findErrorNote()).textContent).toContain(sentence)
    expect(field('Signatures needed').getAttribute('aria-invalid')).toBe('true')
    expect(loc.history!.at(-1)).toBe('/wizards/dao%2Fcompose-a-dao')
    // what the person changes there clears the sentence
    fill('Signatures needed', '3')
    expect(document.querySelector('.note-error')).toBeNull()
  })

  it('goes back to the step of a config field the add refuses (a 422 on config.<name>)', async () => {
    fetchRoutes(routes({ [`POST ${ENTRY}/add`]: refuse(422, { errors: [{ record: 'template:council-safe-hats', field: 'config.space', message: 'space must match pattern "\\.eth$"' }] }) }))
    renderAt(<TemplateWizard def={COMPOSE} />)
    await walk()
    fireEvent.click(screen.getByRole('button', { name: 'Stage in your changes' }))
    expect(await heading('Votes')).toBeTruthy()
    expect((await findErrorNote()).textContent).toContain('space must match pattern')
  })

  it('says a refusal no step holds, and stages nothing, then reviews again', async () => {
    fetchRoutes(routes({ [`POST ${ENTRY}/add`]: refuse(409, { code: 'TAKEN', error: 'systems:test-dao-safe is taken.', nextFreeId: 'test-dao-2' }) }))
    const { loc } = renderAt(<TemplateWizard def={COMPOSE} />, '/wizards/dao%2Fcompose-a-dao')
    await walk()
    fireEvent.click(screen.getByRole('button', { name: 'Stage in your changes' }))
    expect(await heading('Nothing was staged')).toBeTruthy()
    expect(errorNote().textContent).toContain('systems:test-dao-safe is taken.')
    expect(loc.history!.at(-1)).toBe('/wizards/dao%2Fcompose-a-dao')
    fireEvent.click(screen.getByRole('button', { name: 'Back to review' }))
    expect(await heading('Review')).toBeTruthy()
  })

  it('Start blank opens the canvas and stages nothing', async () => {
    const { calls } = fetchRoutes(routes())
    const { loc } = renderAt(<TemplateWizard def={COMPOSE} />, '/wizards/dao%2Fcompose-a-dao')
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
    fireEvent.click(screen.getByRole('radio', { name: /Start blank/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Open the canvas' }))
    await waitFor(() => expect(loc.history!.at(-1)).toBe('/compose'))
    expect(calls.filter(c => c.method === 'POST')).toEqual([])
  })

  it('previewing as Public, draws no control that writes and keeps no draft', async () => {
    const { calls } = fetchRoutes(routes())
    renderAt(<ViewAsProvider initial={{ as: 'public' }}><TemplateWizard def={COMPOSE} /></ViewAsProvider>)
    await walk()
    expectNoWriteControls()
    expect(screen.queryByRole('button', { name: 'Save and leave' })).toBeNull()
    expect(calls.filter(c => c.method !== 'GET')).toEqual([])
  })
})

describe('the runner after the review of Tasks 19/17 (M2, M3)', () => {
  it('M2: a 422 with a field sentence and one no field holds says both on the step it goes back to', async () => {
    const mapped = 'threshold is 4, and the Safe has 3 owners; it is between 1 and the number of owners.'
    const unmapped = 'the top hat is worn by "test-dao-safe", which is not a composed Safe on eip155:11155111.'
    fetchRoutes(routes({ [`POST ${ENTRY}/add`]: refuse(422, { errors: [
      { record: 'systems:test-dao-safe', field: 'deployment.threshold', message: mapped },
      { record: 'systems:test-dao-roles', field: 'deployment.top.worn_by', message: unmapped },
    ] }) }))
    renderAt(<TemplateWizard def={COMPOSE} />)
    await walk({ threshold: '4' })
    fireEvent.click(screen.getByRole('button', { name: 'Stage in your changes' }))
    expect(await heading('Signers')).toBeTruthy()
    const note = (await findErrorNote()).textContent
    expect(note).toContain(mapped)
    expect(note).toContain(unmapped)
  })

  it('M1: an owner or wearer that is no account on the chain goes back to Signers or Roles with its sentence', async () => {
    const bad = `eip155:1:${A1}`
    for (const [field, step] of [['deployment.owners', 'Signers'], ['hats.council.wearers', 'Roles']] as const) {
      const sentence = `${field === 'deployment.owners' ? 'owner' : 'wearer'} "${bad}" is neither a 0x address nor an account on eip155:11155111 (eip155:11155111:0x…).`
      fetchRoutes(routes({ [`POST ${ENTRY}/add`]: refuse(422, { errors: [{ record: 'systems:test-dao-safe', field, message: sentence }] }) }))
      const { unmount } = renderAt(<TemplateWizard def={COMPOSE} />)
      await walk()
      fireEvent.click(screen.getByRole('button', { name: 'Stage in your changes' }))
      expect(await heading(step)).toBeTruthy()
      expect((await findErrorNote()).textContent).toContain(sentence)
      unmount()
    }
  })

  it('M3: an actor who is no member sees no Stage, reads and writes no draft, and is offered no Save and leave', async () => {
    const { calls } = fetchRoutes(routes({ 'GET /api/actor': { unknown: 'someone@example.invalid' } }))
    renderAt(<TemplateWizard def={COMPOSE} />)
    await walk()
    expect(screen.queryByRole('button', { name: 'Stage in your changes' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save and leave' })).toBeNull()
    expect(calls.filter(c => c.path === DRAFT)).toEqual([])
  })

  it('M3: waits for who you are before offering anything', async () => {
    let answer: (v: unknown) => void = () => {}
    const { calls } = fetchRoutes(routes({ 'GET /api/actor': () => new Promise(r => { answer = r }) }))
    renderAt(<TemplateWizard def={COMPOSE} />)
    await waitFor(() => expect(calls.some(c => c.path === '/api/actor')).toBe(true))
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
    expect(calls.filter(c => c.path === DRAFT)).toEqual([])
    answer(knownActor)
    expect(await screen.findByRole('button', { name: 'Start' })).toBeTruthy()
  })
})

/** The test shelf's compose wizard (`test-shelf/test-compose`): the Name step asks the id the records are named from. */
const TEST_COMPOSE: WizardDef = {
  id: 'test-shelf/test-compose', title: 'Compose a test council', summary: 'A Safe and a council hat for the Test DAO.',
  intro: { body: 'Two questions, then the composition is staged in your changes.', writes: 'Nothing yet.' },
  steps: [
    { id: 'name', title: 'Name', ask: 'What is the organization called?', writes: 'Nothing yet.', fields: [
      { id: 'name', label: 'Name', kind: 'text', required: true },
      { id: 'id', label: 'Id', kind: 'text', required: true, help: 'The records are named from it.' },
    ] },
    { id: 'signers', title: 'Signers', ask: 'Who signs for the Safe?', writes: 'Nothing yet.', fields: [
      { id: 'owners', label: 'Signers', kind: 'addresses', required: true },
      { id: 'threshold', label: 'Signatures needed', kind: 'count', required: true },
    ] },
  ],
  review: { title: 'Review', ask: 'Stage this composition in your changes?', writes: 'Stages the Safe, the council’s Hats tree and a board.' },
  done: { title: 'Staged', body: 'The composition is in your changes.' },
  result: { add: 'template:test-council', config: { id: '${field.id}', name: '${field.name}', owners: '${field.owners}', threshold: '${field.threshold}' } },
}
const TEST_ENTRY = '/api/library/template%3Atest-council'
const testRoutes = (over: Record<string, unknown> = {}) => ({
  'GET /api/actor': knownActor,
  'GET /api/wizards/test-shelf%2Ftest-compose/draft': null,
  'PUT /api/wizards/test-shelf%2Ftest-compose/draft': (init?: RequestInit) => ({ ...JSON.parse(String(init?.body)), saved: 'now' }),
  'DELETE /api/wizards/test-shelf%2Ftest-compose/draft': { discarded: true },
  [`GET ${TEST_ENTRY}/preview`]: libraryPreview({ id: 'template:test-council', adds: [] }),
  [`POST ${TEST_ENTRY}/add`]: { id: 'c1', actor: 'steward-a', ops: [] },
  ...over,
})
const status = () => document.querySelector('.wiz [role="status"]')?.textContent ?? ''

describe('the id a composition is named from (walk I12) and a steady count (walk M14)', () => {
  it('fills the Id from the Name while the person has not written in it, and keeps what they wrote', async () => {
    fetchRoutes(testRoutes())
    renderAt(<TemplateWizard def={TEST_COMPOSE} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
    await heading('Name'); fill('Name', 'Test DAO')
    expect((field('Id') as HTMLInputElement).value).toBe('test-dao')
    fill('Name', 'Riverbend Growers’ Co-op')
    expect((field('Id') as HTMLInputElement).value).toBe('riverbend-growers-co-op')
    fill('Id', 'riverbend')
    fill('Name', 'Riverbend')
    expect((field('Id') as HTMLInputElement).value).toBe('riverbend')
  })

  it('on a taken id, goes back to the Name step with the next free id in the Id field and the sentence; Continue stages it', async () => {
    const taken = 'A system with the id `test-dao-safe` already exists. Add it under another id.'
    let first = true
    const { calls } = fetchRoutes(testRoutes({
      [`POST ${TEST_ENTRY}/add`]: () => {
        if (first) { first = false; return refuse(409, { code: 'TAKEN', error: taken, nextFreeId: 'test-dao-2' })() }
        return { id: 'c1', actor: 'steward-a', ops: [] }
      },
    }))
    const { loc } = renderAt(<TemplateWizard def={TEST_COMPOSE} />, '/wizards/test-shelf%2Ftest-compose')
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
    await heading('Name'); fill('Name', 'Test DAO'); next()
    await heading('Signers'); fill('Signers', A1); fill('Signatures needed', '1'); next()
    await heading('Review')
    fireEvent.click(screen.getByRole('button', { name: 'Stage in your changes' }))
    expect(await heading('Name')).toBeTruthy()
    expect((field('Id') as HTMLInputElement).value).toBe('test-dao-2')
    expect((await findErrorNote()).textContent).toContain(taken)
    expect(errorNote().textContent).toContain('test-dao-2')
    next(); await heading('Signers'); next(); await heading('Review')
    fireEvent.click(screen.getByRole('button', { name: 'Stage in your changes' }))
    await waitFor(() => expect(loc.history!.at(-1)).toBe('/compose'))
    const bodies = calls.filter(c => c.method === 'POST' && c.path === `${TEST_ENTRY}/add`).map(c => (c.body as { config: { id: string } }).config.id)
    expect(bodies).toEqual(['test-dao', 'test-dao-2'])
  })

  it('counts the same rail on every screen: 1 of 3, 2 of 3, then the review 3 of 3, and the status says so', async () => {
    fetchRoutes(testRoutes())
    renderAt(<TemplateWizard def={TEST_COMPOSE} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
    await heading('Name')
    expect(eyebrow()).toBe('Compose a test council · 1 of 3')
    fill('Name', 'Test DAO'); next()
    await heading('Signers')
    expect(eyebrow()).toBe('Compose a test council · 2 of 3')
    expect(status()).toContain('Step 2 of 3')
    expect(status()).not.toContain('of 2')
    fill('Signers', A1); fill('Signatures needed', '1'); next()
    await heading('Review')
    expect(eyebrow()).toBe('Compose a test council · 3 of 3')
  })
})

describe('/wizards/:id for a shelf wizard', () => {
  it('runs a shelf wizard that has a result in the template runner', async () => {
    const def: WizardDef = { ...COMPOSE, id: 'test-shelf/test-compose', title: 'Compose a test council' }
    fetchRoutes({ ...routes(), 'GET /api/wizards/test-shelf%2Ftest-compose': def, 'GET /api/wizards/test-shelf%2Ftest-compose/draft': null })
    renderAt(<WizardPage id="test-shelf/test-compose" />, '/wizards/test-shelf%2Ftest-compose')
    expect(await screen.findByRole('heading', { level: 1, name: 'Compose a test council' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Start' })).toBeTruthy()
    expect(screen.queryByText(/no screens in this app yet/)).toBeNull()
  })
})
