// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { ImportSheet } from './ImportSheet.tsx'
import { renderAt } from '../test/render.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { baseRoutes, changeView, refuse } from '../test/data.ts'

const schema = {
  required: ['id'],
  properties: { id: { type: 'string' }, title: { type: ['string', 'null'] }, deadline: { type: ['string', 'null'], format: 'date' }, relevance: { enum: ['high', 'low'] } },
}
const routes = (over: Record<string, unknown> = {}) => fetchRoutes(baseRoutes({
  'GET /api/schemas/funding-opportunities': schema,
  'GET /api/registries/funding-opportunities': { name: 'funding-opportunities', kind: 'collection', schemaVersion: null, entries: [{ id: 'spring-round' }] },
  'GET /api/changes': changeView({ ops: [{ op: 'create', record: 'funding-opportunities:autumn', value: { id: 'autumn' } }] as never }),
  'POST /api/changes/ops': changeView(),
  ...over,
}))
const paste = async (text: string) => {
  const box = await screen.findByLabelText('Rows, the header row first')
  fireEvent.change(box, { target: { value: text } })
}
const stageButton = () => screen.getByRole('button', { name: /^Stage \d+ records?$/ }) as HTMLButtonElement

describe('Import from a sheet', () => {
  it('stages nothing before the preview: Stage is held until pasted rows are drawn', async () => {
    routes()
    renderAt(<ImportSheet registry="funding-opportunities" label="funding opportunities" onDone={() => {}} />)
    await screen.findByLabelText('Rows, the header row first')
    expect(screen.queryByRole('region', { name: 'Preview' })).toBeNull()
    expect(stageButton().disabled).toBe(true)
  })

  it('holds Stage while the registry’s file is still being read: its ids are not known yet (review M-2)', async () => {
    const { calls } = routes({ 'GET /api/registries/funding-opportunities': () => new Promise<Response>(() => {}) })
    renderAt(<ImportSheet registry="funding-opportunities" label="funding opportunities" onDone={() => {}} />)
    await paste('Title\nSpring round')
    await screen.findByRole('region', { name: 'Preview' })
    expect(stageButton().disabled).toBe(true)
    fireEvent.click(stageButton())
    expect(calls.filter(c => c.method === 'POST')).toEqual([])
  })

  it('previews each row with its problems, then stages the ready rows as one batch of creates, ids unique against the file, the change and each other', async () => {
    const { calls } = routes()
    const onDone = vi.fn()
    renderAt(<ImportSheet registry="funding-opportunities" label="funding opportunities" onDone={onDone} />)
    await waitFor(() => expect(screen.getByLabelText('Rows, the header row first')).toBeTruthy())
    await paste('Title\tDeadline\tRelevance\tFunder\nSpring round\t2026-12-01\thigh\tExample Fund\nAutumn\t\tlow\t\nBroken\t2026-13-01\t\t')
    const preview = await screen.findByRole('region', { name: 'Preview' })
    expect(within(preview).getByText('Left out: Funder (matches no field).')).toBeTruthy()
    const table = within(preview).getByRole('table', { name: 'Rows to import' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map(r => within(r).getAllByRole('cell').map(c => c.textContent))).toEqual([
      ['Spring round', '2026-12-01', 'high', 'spring-round-2', 'Ready'],
      ['Autumn', '—', 'low', 'autumn-2', 'Ready'],
      ['Broken', '—', '—', 'broken', 'Deadline: not a date: month 13'],
    ])
    expect(preview.querySelector('.imp-sum')!.textContent).toBe('2 records ready; 1 with problems is left out.')
    fireEvent.click(stageButton())
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    const posts = calls.filter(c => c.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0]!.body).toEqual({ ops: [
      { op: 'create', record: 'funding-opportunities:spring-round-2', value: { id: 'spring-round-2', title: 'Spring round', deadline: '2026-12-01', relevance: 'high' } },
      { op: 'create', record: 'funding-opportunities:autumn-2', value: { id: 'autumn-2', title: 'Autumn', relevance: 'low' } },
    ] })
  })

  it("puts the server's refusal under the row it names, and stages nothing more", async () => {
    routes({ 'POST /api/changes/ops': refuse(422, { error: 'invalid', errors: [{ record: 'funding-opportunities:spring', field: 'deadline', message: 'must be in the future' }] }) })
    const onDone = vi.fn()
    renderAt(<ImportSheet registry="funding-opportunities" label="funding opportunities" onDone={onDone} />)
    await paste('title,deadline\nSpring,2026-12-01')
    await screen.findByRole('region', { name: 'Preview' })
    fireEvent.click(stageButton())
    expect(await screen.findByText('deadline: must be in the future')).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
    expect(stageButton().disabled).toBe(true) // its one row now has a problem
  })

  it('reads a dropped CSV file', async () => {
    routes()
    renderAt(<ImportSheet registry="funding-opportunities" label="funding opportunities" onDone={() => {}} />)
    const box = await screen.findByLabelText('Rows, the header row first')
    const file = new File(['title,deadline\r\n"Round, one",2026-12-01\r\n'], 'rounds.csv', { type: 'text/csv' })
    fireEvent.drop(box.closest('.imp')!, { dataTransfer: { files: [file] } })
    const preview = await screen.findByRole('region', { name: 'Preview' })
    expect(within(preview).getByText('Round, one')).toBeTruthy()
    expect(stageButton().textContent).toBe('Stage 1 record')
  })
})
