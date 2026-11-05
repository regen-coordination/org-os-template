// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { BlockFrame } from './BlockFrame.tsx'
import { recordBlock } from './index.ts'
import { renderAt } from '../test/render.tsx'
import { projectRoutes } from '../test/record.tsx'
import { changeView, refuse } from '../test/data.ts'
import { p1 } from '../test/record.tsx'
import { ViewAsProvider, ViewAsControl } from '../viewAs/ViewAs.tsx'
import { expectNoWriteControls } from '../test/publicPreview.tsx'

const cfg = { title: 'River Commons', source: { record: 'project:p1' } }

describe('the record block', () => {
  it('reads the record in schema order', async () => {
    projectRoutes()
    renderAt(<BlockFrame def={recordBlock} id="r" cfg={cfg} />)
    const fields = await screen.findByRole('group', { name: 'Fields' })
    expect([...fields.querySelectorAll('dt')].map(dt => dt.textContent).slice(0, 3)).toEqual(['Id', 'Title', 'Status'])
    expect(screen.getByRole('link', { name: 'Open record →' }).getAttribute('href')).toBe('/r/project/p1')
  })

  it('edits in place and stages only what changed', async () => {
    const { calls } = projectRoutes({ 'POST /api/changes/ops': changeView({ ops: [{ op: 'update', record: 'projects:p1', set: { status: 'archive' }, base: 'h', before: { status: 'develop' } }] }) })
    renderAt(<BlockFrame def={recordBlock} id="r" cfg={cfg} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(await screen.findByLabelText('Status'), { target: { value: 'archive' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save to changes' }))
    await waitFor(() => expect(calls.find(c => c.method === 'POST')?.body).toEqual({ ops: [{ op: 'update', record: 'projects:p1', set: { status: 'archive' } }] }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save to changes' })).toBeNull())
  })

  it("stages a delete through its action, and shows a refusal in the server's words", async () => {
    projectRoutes({ 'POST /api/changes/ops': refuse(422, { errors: [{ record: 'projects:p1', field: '', message: 'Not deleted: River Commons is still referred to by funding:x.' }] }) })
    renderAt(<BlockFrame def={recordBlock} id="r" cfg={cfg} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Not deleted: River Commons is still referred to by funding:x.', { selector: '.note-error .note-t' })).toBeTruthy()
    expect(recordBlock.actions!.delete!('projects:p1' as never)).toEqual([{ op: 'delete', record: 'projects:p1' }])
  })

  it('offers no Edit or Delete to someone the server does not know', async () => {
    projectRoutes({ 'GET /api/actor': { unknown: 'x@example.org' } })
    renderAt(<BlockFrame def={recordBlock} id="r" cfg={cfg} />)
    await screen.findByRole('group', { name: 'Fields' })
    const region = screen.getByRole('region', { name: 'River Commons' })
    await waitFor(() => expect(within(region).queryByRole('button', { name: 'Edit' })).toBeNull())
    expect(within(region).queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('previewed as Public, offers no Edit and no Delete, only Open record (C8 fix I-1, C-23)', async () => {
    projectRoutes({ 'GET /api/resources/project%3Ap1': { resource: { ...p1, facts: { visibility: 'public' } }, edges: [], neighbours: [] } })
    renderAt(<ViewAsProvider initial={{ as: 'public' }}><BlockFrame def={recordBlock} id="r" cfg={cfg} /></ViewAsProvider>)
    await screen.findByRole('group', { name: 'Fields' })
    expect(screen.getByRole('link', { name: 'Open record →' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expectNoWriteControls()
  })

  // R7 (fix wave): an edit open when a preview begins kept drawing Save — disabled, which C-23 forbids ("hidden, never
  // disabled"). A preview ends the edit: the read rows, and only Cancel (which writes nothing).
  it('a preview that begins mid-edit draws the read fields, no Save, and Cancel', async () => {
    projectRoutes({ 'GET /api/resources/project%3Ap1': { resource: { ...p1, facts: { visibility: 'public' } }, edges: [], neighbours: [] } })
    renderAt(<ViewAsProvider><ViewAsControl /><BlockFrame def={recordBlock} id="r" cfg={cfg} /></ViewAsProvider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('button', { name: 'Save to changes' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^View as/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Public' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save to changes' })).toBeNull())
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    // the fields are the read rows again, not inputs
    expect(await screen.findByRole('group', { name: 'Fields' })).toBeTruthy()
    expect(screen.queryByLabelText('Status')).toBeNull()
    // and the edit can still be put down
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expectNoWriteControls()
  })
})
