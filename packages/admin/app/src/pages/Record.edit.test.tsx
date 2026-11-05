// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import type { StageOp } from '../api.ts'
import { page, projectRoutes, projectSchema } from '../test/record.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { baseRoutes, changeView, refuse, resource } from '../test/data.ts'

const before = { id: 'p1', title: 'Seed Library', status: 'develop', lead: 'steward-a' }
const asOps = (ops: StageOp[]) => changeView({ ops: ops.map(o => ({ ...o, base: o.op === 'create' ? null : 'h', before: o.op === 'create' ? null : before })) })
const stageRoute = (seen: unknown[]) => ({
  'POST /api/changes/ops': (init?: RequestInit) => { const body = JSON.parse(String(init!.body)) as { ops: StageOp[] }; seen.push(body); return asOps(body.ops) },
})
const saveButton = () => screen.getByRole('button', { name: 'Save to changes' }) as HTMLButtonElement

describe('RecordPage, editing in place', () => {
  it('Edit turns fields into inputs; Save to changes stages only what changed and returns to reading, marked', async () => {
    const seen: unknown[] = []
    projectRoutes(stageRoute(seen))
    page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'execute' } })
    expect(screen.getByLabelText('Status').closest('dd')!.className).toBe('staged')
    fireEvent.click(saveButton())
    await waitFor(() => expect(seen).toEqual([{ ops: [{ op: 'update', record: 'projects:p1', set: { status: 'execute' } }] }]))
    const cell = (await screen.findByText('execute')).closest('dd')!
    expect(cell.className).toBe('staged')
    expect(cell.querySelector('.was s')!.textContent).toBe('develop')
    expect(screen.queryByRole('button', { name: 'Save to changes' })).toBeNull()
  })

  it('when Save stages and the form closes, focus goes to the Edit that stands where Save stood, not to the page (2.4.3; C11 keyboard walk)', async () => {
    const seen: unknown[] = []
    projectRoutes(stageRoute(seen))
    page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'execute' } })
    saveButton().focus()
    fireEvent.click(saveButton())
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save to changes' })).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit' })))
  })

  it('keeps the line breaks of a multi-line description: untouched it stages nothing, edited it stages them all (final 1)', async () => {
    const seen: unknown[] = []
    const description = 'First line.\nSecond line.'
    projectRoutes({ ...stageRoute(seen), 'GET /api/schemas/projects': { ...projectSchema, properties: { ...projectSchema.properties, description: { type: 'string' } } } },
      () => [{ ...before, description }])
    page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe(description)
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Brasil' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(seen).toEqual([{ ops: [{ op: 'update', record: 'projects:p1', set: { title: 'Brasil' } }] }]))
    seen.length = 0
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: `${description}\nThird line.` } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(seen).toEqual([{ ops: [{ op: 'update', record: 'projects:p1', set: { description: `${description}\nThird line.` } }] }]))
  })

  it('keys: e starts editing, but not while typing; ⌘S saves; Esc cancels; an Escape handled elsewhere does not (Review Focus 1)', async () => {
    const seen: unknown[] = []
    projectRoutes(stageRoute(seen))
    const { container } = page('/r/project/p1')
    await screen.findByRole('heading', { level: 1, name: 'Seed Library' })
    const elsewhere = document.createElement('input')
    container.appendChild(elsewhere)
    fireEvent.keyDown(elsewhere, { key: 'e' })
    expect(screen.queryByRole('button', { name: 'Save to changes' })).toBeNull()
    fireEvent.keyDown(document.body, { key: 'e' })
    const title = await screen.findByLabelText('Title')
    fireEvent.change(title, { target: { value: 'Brasil' } })
    fireEvent.keyDown(title, { key: 'e' })
    const handled = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    handled.preventDefault() // what ⌘K and the inspector do with the Escape that closes them
    act(() => { window.dispatchEvent(handled) })
    expect(screen.getByLabelText('Title')).toBeTruthy()
    fireEvent.keyDown(title, { key: 's', metaKey: true })
    await waitFor(() => expect(seen).toEqual([{ ops: [{ op: 'update', record: 'projects:p1', set: { title: 'Brasil' } }] }]))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save to changes' })).toBeNull()) // the stage answered: reading again
    fireEvent.keyDown(document.body, { key: 'e' })
    await screen.findByLabelText('Title')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByLabelText('Title')).toBeNull()
  })

  it("shows the server's stage-time error under its field, Save off until that field is edited", async () => {
    projectRoutes({ 'POST /api/changes/ops': refuse(422, { errors: [{ record: 'projects:p1', field: 'lead', message: 'no member with id "zed" in members' }] }) })
    page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'X' } })
    fireEvent.click(saveButton())
    expect(await screen.findByText('no member with id "zed" in members')).toBeTruthy()
    expect(saveButton().disabled).toBe(true)
    await screen.findByRole('option', { name: 'Steward B (steward-b)' })
    fireEvent.change(screen.getByLabelText('Lead'), { target: { value: 'steward-b' } })
    expect(saveButton().disabled).toBe(false)
  })

  it('checks a date as you type, and will not save one that is not a date', async () => {
    projectRoutes()
    page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Started'), { target: { value: '2026-13-01' } })
    expect(screen.getByText('not a date: month 13')).toBeTruthy()
    expect(saveButton().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Started'), { target: { value: '2026-12-01' } })
    expect(screen.queryByText(/not a date/)).toBeNull()
    expect(saveButton().disabled).toBe(false)
  })

  it('shows the stale card when the file moves under an open editor, and will not save until you choose; Keep mine', async () => {
    let title = 'Old'
    projectRoutes({}, () => [{ id: 'p1', title, status: 'develop', lead: 'steward-a' }])
    const { qc } = page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Mine' } })
    title = 'Theirs'
    await qc.invalidateQueries({ queryKey: ['registry', 'projects'] })
    const said = await screen.findByText('This entry changed while you were editing it.')
    expect(said.closest('.note')).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull() // a note, said once through the polite region (E-67)
    const theirs = within(screen.getByRole('group', { name: 'Yours and theirs' })).getByText('Title').closest('dt')!.nextElementSibling!
    expect(theirs.className).toBe('stale')
    expect(theirs.textContent).toContain('Mine')
    expect(theirs.textContent).toContain('now Theirs on the trunk')
    expect(saveButton().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }))
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Mine')
    expect(saveButton().disabled).toBe(false)
  })

  it('Take theirs puts their entry in the editor', async () => {
    let title = 'Old'
    projectRoutes({}, () => [{ id: 'p1', title, status: 'develop', lead: 'steward-a' }])
    const { qc } = page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    title = 'Theirs'
    await qc.invalidateQueries({ queryKey: ['registry', 'projects'] })
    fireEvent.click(await screen.findByRole('button', { name: 'Take theirs' }))
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Theirs')
    expect(document.querySelector('.rp-stale')).toBeNull() // the live region keeps what it last said
  })

  it('says so when the entry has gone from the file', async () => {
    let there = true
    projectRoutes({}, () => (there ? [{ id: 'p1', title: 'Old' }] : []))
    const { qc } = page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByLabelText('Title')
    there = false
    await qc.invalidateQueries({ queryKey: ['registry', 'projects'] })
    expect(await screen.findByText('This entry is no longer in the file: it was removed while you were editing it.')).toBeTruthy()
    expect(saveButton().disabled).toBe(true)
  })

  it('starts fresh on another record', async () => {
    projectRoutes({ 'GET /api/resources/project%3Ap2': { resource: resource({ id: 'project:p2', name: 'Project two', source: { path: 'data/projects.yaml', editable: true, registry: 'projects', entityId: 'p2' } }), edges: [], neighbours: [] } },
      () => [{ id: 'p1', title: 'One' }, { id: 'p2', title: 'Two' }])
    const { loc } = page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Typed on one' } })
    act(() => loc.navigate('/r/project/p2'))
    await screen.findByRole('heading', { level: 1, name: 'Project two' })
    expect(screen.queryByLabelText('Title')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect((await screen.findByLabelText('Title') as HTMLInputElement).value).toBe('Two')
  })

  it('saves an entry holding a __proto__ field as a whole replace without it, and says so first', async () => {
    const seen: unknown[] = []
    projectRoutes(stageRoute(seen), () => [JSON.parse('{"id":"p1","title":"A","__proto__":{"x":1}}')])
    page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.getByText(/field named __proto__.*saving.*removes it/i)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'A2' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(seen).toHaveLength(1))
    expect(JSON.stringify(seen[0])).toBe('{"ops":[{"op":"replace","record":"projects:p1","value":{"id":"p1","title":"A2"}}]}')
  })

  it('shows no __proto__ notice for an ordinary entry', async () => {
    projectRoutes()
    page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.queryByText(/__proto__/)).toBeNull()
  })

  it('source, while editing, edits the whole entry as YAML and stages one replace; a source that is not one entry keeps Save off', async () => {
    const seen: unknown[] = []
    projectRoutes(stageRoute(seen))
    page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'source' }))
    const yaml = screen.getByLabelText('yaml')
    fireEvent.change(yaml, { target: { value: '- a\n- b\n' } })
    expect(screen.getByText('the source must be one entry: a map of fields')).toBeTruthy()
    expect(saveButton().disabled).toBe(true)
    fireEvent.change(yaml, { target: { value: 'id: p1\ntitle: Whole\n' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(seen).toEqual([{ ops: [{ op: 'replace', record: 'projects:p1', value: { id: 'p1', title: 'Whole' } }] }]))
  })

  it('leaving source drops text that did not parse, so it cannot hold Save off unseen', async () => {
    projectRoutes()
    page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'source' }))
    fireEvent.change(screen.getByLabelText('yaml'), { target: { value: '- a\n' } })
    expect(saveButton().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'source' }))
    expect(saveButton().disabled).toBe(false)
  })

  it('Delete, in the action menu, stages a delete', async () => {
    const seen: unknown[] = []
    projectRoutes(stageRoute(seen))
    page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await waitFor(() => expect(seen).toEqual([{ ops: [{ op: 'delete', record: 'projects:p1' }] }]))
    expect(await screen.findByText(/Staged for deletion/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('a delete refused at stage time names the records that still refer to it', async () => {
    projectRoutes({ 'POST /api/changes/ops': refuse(422, { errors: [{ record: 'projects:p1', field: '', message: 'Not deleted: projects "p1" is still referred to by events "e1" (related_project).' }] }) })
    page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(await screen.findByText('Not deleted: projects "p1" is still referred to by events "e1" (related_project).')).toBeTruthy()
  })

  it('?edit=1 opens the editor, then drops itself from the address', async () => {
    projectRoutes()
    const { loc } = page('/r/project/p1?edit=1')
    expect(await screen.findByLabelText('Title')).toBeTruthy()
    expect(loc.history.at(-1)).toBe('/r/project/p1')
  })

  it("offers no Edit, Delete or e for an entry it can't address, and says why (contract)", async () => {
    projectRoutes({}, () => [{ id: 'p1', title: 'Seed Library' }, { id: 'p1', title: 'A second p1' }])
    page('/r/project/p1?edit=1')
    expect(await screen.findByText('id p1 appears 2 times in data/projects.yaml; fix it in the file.')).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'e' })
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull()
    expect(screen.queryByLabelText('Title')).toBeNull()
  })

  it('offers no Edit or Delete when your git email matches no member, and ignores ?edit=1', async () => {
    projectRoutes(baseRoutes({ 'GET /api/actor': { unknown: 'x@example.org' } }))
    const { qc, loc } = page('/r/project/p1?edit=1')
    await screen.findByRole('heading', { level: 1, name: 'Seed Library' })
    await waitFor(() => expect(qc.getQueryData(['actor'])).toBeTruthy())
    await waitFor(() => expect(loc.history.at(-1)).toBe('/r/project/p1'))
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull()
    expect(screen.queryByLabelText('Title')).toBeNull()
  })

  it('marks the Escape it handles, so nothing else (the inspector) acts on it too', async () => {
    projectRoutes()
    page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await screen.findByLabelText('Title')
    expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(false) // false: default prevented
    expect(screen.queryByLabelText('Title')).toBeNull()
    expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(true) // not editing: left alone
  })

  it('shows a staging 409 that has no code as the server wrote it, and leaves Save on after an edit (C7)', async () => {
    projectRoutes({ 'POST /api/changes/ops': refuse(409, { error: 'data/projects.yaml has YAML errors; fix the file before staging.' }) })
    page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'X' } })
    fireEvent.click(saveButton())
    expect(await screen.findByText('data/projects.yaml has YAML errors; fix the file before staging.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Y' } })
    expect(saveButton().disabled).toBe(false)
  })

  it('shows the reason of a 403', async () => {
    projectRoutes({ 'POST /api/changes/ops': refuse(403, { error: 'Forbidden', reason: 'Read-only: your git email x@example.org matches no member.' }) })
    page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'X' } })
    fireEvent.click(saveButton())
    expect(await screen.findByText('Read-only: your git email x@example.org matches no member.')).toBeTruthy()
  })

  it('edits a record that lives only in its registry, in a collection (C17)', async () => {
    const seen: unknown[] = []
    fetchRoutes({ ...baseRoutes(), ...stageRoute(seen),
      'GET /api/registries/meetings': { name: 'meetings', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'm-1', title: 'Kick-off' }] },
      'GET /api/schemas/meetings': { 'x-order': ['id', 'title'], properties: { id: { type: 'string' }, title: { type: 'string' } } } })
    page('/r/meetings/m-1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Kick-off, again' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(seen).toEqual([{ ops: [{ op: 'update', record: 'meetings:m-1', set: { title: 'Kick-off, again' } }] }]))
  })

  it('offers no Edit or Delete on a registry-only record to someone whose git email matches no member (C17)', async () => {
    fetchRoutes({ ...baseRoutes({ 'GET /api/actor': { unknown: 'x@example.org' } }),
      'GET /api/registries/meetings': { name: 'meetings', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'm-1', title: 'Kick-off' }] },
      'GET /api/schemas/meetings': { 'x-order': ['id', 'title'], properties: {} } })
    const { qc } = page('/r/meetings/m-1')
    await screen.findByRole('heading', { level: 1, name: 'Kick-off' })
    await waitFor(() => expect(qc.getQueryData(['actor'])).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull()
  })

  it('stages nothing for a field the entry did not hold, typed into and cleared again (I1)', async () => {
    const seen: unknown[] = []
    projectRoutes(stageRoute(seen))
    page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const started = screen.getByLabelText('Started')
    fireEvent.change(started, { target: { value: '2026-01-01' } })
    expect(started.closest('dd')!.className).toBe('staged')
    fireEvent.change(started, { target: { value: '' } })
    expect(started.closest('dd')!.className).toBe('')
    fireEvent.click(saveButton())
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save to changes' })).toBeNull())
    expect(seen).toEqual([])
  })

  it('Take theirs puts their value in a YAML field (I2)', async () => {
    let notes: unknown = { a: 'old' }
    projectRoutes({}, () => [{ id: 'p1', title: 'T', notes }])
    const { qc } = page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Notes (YAML)'), { target: { value: 'a: mine\n' } })
    notes = { a: 'theirs' }
    await qc.invalidateQueries({ queryKey: ['registry', 'projects'] })
    fireEvent.click(await screen.findByRole('button', { name: 'Take theirs' }))
    expect((screen.getByLabelText('Notes (YAML)') as HTMLTextAreaElement).value).toBe('a: theirs\n')
  })

  it('Take theirs puts their entry in the source editor (I2)', async () => {
    let title = 'Old'
    projectRoutes({}, () => [{ id: 'p1', title }])
    const { qc } = page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'source' }))
    fireEvent.change(screen.getByLabelText('yaml'), { target: { value: 'id: p1\ntitle: Mine\n' } })
    title = 'Theirs'
    await qc.invalidateQueries({ queryKey: ['registry', 'projects'] })
    fireEvent.click(await screen.findByRole('button', { name: 'Take theirs' }))
    expect((screen.getByLabelText('yaml') as HTMLTextAreaElement).value).toBe('id: p1\ntitle: Theirs\n')
  })

  it('in source, shows the field problems it holds, and a whole entry that parses clears them (I3)', async () => {
    projectRoutes()
    page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Started'), { target: { value: '2026-13-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'source' }))
    expect(screen.getByText('started: not a date: month 13')).toBeTruthy()
    expect(saveButton().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('yaml'), { target: { value: 'id: p1\ntitle: Seed Library\nstarted: 2026-12-01\n' } })
    expect(screen.queryByText(/not a date/)).toBeNull()
    expect(saveButton().disabled).toBe(false)
  })

  it('in source, shows a refusal about a field, and a whole entry that parses clears it (I3)', async () => {
    projectRoutes({ 'POST /api/changes/ops': refuse(422, { errors: [{ record: 'projects:p1', field: 'lead', message: 'no member with id "zed" in members' }] }) })
    page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'source' }))
    fireEvent.change(screen.getByLabelText('yaml'), { target: { value: 'id: p1\nlead: zed\n' } })
    fireEvent.click(saveButton())
    expect(await screen.findByText('lead: no member with id "zed" in members')).toBeTruthy()
    expect(saveButton().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('yaml'), { target: { value: 'id: p1\nlead: steward-b\n' } })
    expect(saveButton().disabled).toBe(false)
  })

  it('reads the page promptly, read-only, when /api/actor fails: no retries (5)', async () => {
    projectRoutes(baseRoutes({ 'GET /api/actor': refuse(500, { error: 'git is not installed' }) }))
    page('/r/project/p1', { queryClient: new QueryClient() }) // the library's default retries, as in the app
    expect(await screen.findByRole('heading', { level: 1, name: 'Seed Library' }, { timeout: 500 })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it("a contributor whose name the gate restricts reads \"Ops only\" in the edit form's tokens, never its id, and is not offered by it (D-12, the re-review's RefTokens)", async () => {
    const schema = { ...projectSchema, 'x-order': [...projectSchema['x-order'], 'contributors'],
      properties: { ...projectSchema.properties, contributors: { type: 'array', items: { type: 'string' } } } }
    projectRoutes({
      'GET /api/schemas/projects': schema,
      'GET /api/registries/members': { name: 'members', kind: 'collection', schemaVersion: '2.0',
        entries: [{ id: 'steward-a', name: 'Steward A' }, { id: 'ana-silva', restricted: { name: 'hat:ops' } }] },
    }, () => [{ ...before, contributors: ['ana-silva'] }])
    const { container } = page('/r/project/p1')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const tokens = await waitFor(() => { const t = container.querySelector('.tokens'); if (!t) throw new Error('no tokens'); return t })
    await waitFor(() => expect(within(tokens as HTMLElement).getByRole('button', { name: 'Remove Ops only' })).toBeTruthy())
    expect(tokens.textContent).not.toContain('ana-silva')
    const input = tokens.querySelector('input')!
    expect([...container.querySelectorAll(`[id="${input.id}-list"] option`)].map(o => o.getAttribute('value'))).toEqual(['steward-a'])
  })

})
