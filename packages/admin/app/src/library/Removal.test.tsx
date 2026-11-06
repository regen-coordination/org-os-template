// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Removal } from './Removal.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { changeView, refuse } from '../test/data.ts'
import { removal } from '../test/fixtures/library.ts'
import { heard } from '../test/notes.ts'

const REMOVAL = 'GET /api/library/receipts/board-test-desk/removal'
const REMOVE = 'POST /api/library/receipts/board-test-desk/remove'

afterEach(() => { vi.restoreAllMocks() })

describe('Removal', () => {
  it('says what removing would do to each record the add created, and who decides', async () => {
    fetchRoutes({ [REMOVAL]: removal({ records: [
      { record: 'boards:test-desk', state: 'edited', referrers: [] },
      { record: 'systems:test-link', state: 'as added', referrers: ['boards:front'] },
      { record: 'systems:old-link', state: 'gone', referrers: [] },
    ] }) })
    renderAt(<Removal receipt="board-test-desk" onClose={() => {}} />)
    const r = await screen.findByRole('region', { name: 'Remove Test desk' })
    const row = (record: string) => within(r).getByText(record).closest('li')!
    expect(row('boards:test-desk').textContent).toContain('edited since added — asks before taking it')
    expect(row('boards:test-desk').className).toContain('lib-row-clay') // §11.2: the same clay row as a taken id
    expect(row('systems:test-link').textContent).toContain('as added')
    expect(row('systems:test-link').textContent).toContain('still named by boards:front, so it cannot be deleted')
    expect(row('systems:old-link').textContent).toContain('already gone')
    expect(row('systems:old-link').className).not.toContain('lib-row-clay')
    expect(within(r).getByRole('heading', { level: 4, name: 'It would delete 3 records' })).toBeTruthy()
    expect(within(r).getByText('records: the maintainer decides alone')).toBeTruthy()
  })

  it('offers Remove unavailable, with its reason, while a record it would delete is still named elsewhere (E-22)', async () => {
    const { calls } = fetchRoutes({ [REMOVAL]: removal({ asks: [], records: [{ record: 'systems:test-link', state: 'as added', referrers: ['boards:front'] }] }), [REMOVE]: changeView() })
    renderAt(<Removal receipt="board-test-desk" onClose={() => {}} />)
    const remove = await screen.findByRole('button', { name: 'Remove' })
    expect(remove.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getAllByText('systems:test-link is still named by boards:front, so it cannot be deleted. Change boards:front first.').length).toBeGreaterThan(0)
    fireEvent.click(remove)
    await new Promise(r => setTimeout(r, 20))
    expect(calls.some(c => c.method === 'POST')).toBe(false)
  })

  it('asks before taking records edited since the add, naming them, then sends them all', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { calls } = fetchRoutes({ [REMOVAL]: removal(), [REMOVE]: changeView() })
    const onClose = vi.fn()
    renderAt(<Removal receipt="board-test-desk" onClose={onClose} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0]![0]).toContain('boards:test-desk')
    await waitFor(() => expect(calls.find(c => c.method === 'POST')?.body).toEqual({ take: ['boards:test-desk'] }))
    await waitFor(() => expect(onClose).toHaveBeenCalledWith('The removal of Test desk is staged in the changes.'))
  })

  it('sends nothing when the question is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { calls } = fetchRoutes({ [REMOVAL]: removal(), [REMOVE]: changeView() })
    renderAt(<Removal receipt="board-test-desk" onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await new Promise(r => setTimeout(r, 20))
    expect(calls.some(c => c.method === 'POST')).toBe(false)
  })

  it('asks nothing when no record was edited, and takes nothing', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { calls } = fetchRoutes({ [REMOVAL]: removal({ asks: [], records: [{ record: 'boards:test-desk', state: 'as added', referrers: [] }] }), [REMOVE]: changeView() })
    renderAt(<Removal receipt="board-test-desk" onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(calls.find(c => c.method === 'POST')?.body).toEqual({ take: [] }))
    expect(confirm).not.toHaveBeenCalled()
  })

  it('says why it cannot be removed, and offers no Remove', async () => {
    fetchRoutes({ [REMOVAL]: removal({ refusal: 'This was removed on 2026-10-29.', asks: [], decided: [] }) })
    renderAt(<Removal receipt="board-test-desk" onClose={() => {}} />)
    expect(await screen.findByText('This was removed on 2026-10-29.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('says a refusal from the server in its own words, and stays open', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fetchRoutes({ [REMOVAL]: removal(), [REMOVE]: refuse(409, { code: 'REMOVED', error: 'This was removed on 2026-10-29.' }) })
    const onClose = vi.fn()
    renderAt(<Removal receipt="board-test-desk" onClose={onClose} />)
    const voice = heard()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    // C10 (ledger; E-81, §13): the refusal is a clay note, not an alert, and it is said once through the polite region
    expect((await screen.findByText('This was removed on 2026-10-29.')).closest('.note-error')).not.toBeNull()
    // announce() runs in an effect after the note is drawn: wait for it, as a loaded machine can find the note first
    await waitFor(() => expect(voice.said).toEqual(['This was removed on 2026-10-29.']))
    voice.stop()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('when records were edited after it opened (409 ASK), looks again and names them in plain words, never the API sentence', async () => {
    const API = 'Since it was added, boards:test-desk and systems:test-link were edited. Removing deletes them with the edits; name them in take to go ahead. Nothing was staged.'
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    let looks = 0
    const { calls } = fetchRoutes({
      [REMOVAL]: () => (++looks === 1 ? removal() : removal({
        records: [{ record: 'boards:test-desk', state: 'edited', referrers: [] }, { record: 'systems:test-link', state: 'edited', referrers: [] }],
        asks: ['boards:test-desk', 'systems:test-link'],
      })),
      [REMOVE]: refuse(409, { code: 'ASK', asks: ['boards:test-desk', 'systems:test-link'], error: API }),
    })
    const onClose = vi.fn()
    renderAt(<Removal receipt="board-test-desk" onClose={onClose} />)
    const voice = heard()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    const said = await screen.findByText('Since you opened this, systems:test-link was edited. Look again and remove, or go back.')
    expect(said.closest('.note-error')).not.toBeNull() // C10: a clay note, not an alert (§13), said through the polite region
    await waitFor(() => expect(voice.said).toContain('Since you opened this, systems:test-link was edited. Look again and remove, or go back.'))
    voice.stop()
    expect(screen.queryByText(API)).toBeNull()
    expect(document.body.textContent).not.toContain('take')
    await waitFor(() => expect(screen.getByText('systems:test-link').closest('li')!.textContent).toContain('edited since added'))
    expect(calls.filter(c => c.method === 'GET')).toHaveLength(2)
    expect(onClose).not.toHaveBeenCalled()

    // Remove again: the question names both, and both are sent.
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2))
    expect(confirm.mock.calls[1]![0]).toContain('boards:test-desk, systems:test-link')
    await waitFor(() => expect(calls.filter(c => c.method === 'POST').at(-1)?.body).toEqual({ take: ['boards:test-desk', 'systems:test-link'] }))
  })

  it('goes back to the preview without sending anything', async () => {
    const { calls } = fetchRoutes({ [REMOVAL]: removal() })
    const onClose = vi.fn()
    renderAt(<Removal receipt="board-test-desk" onClose={onClose} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }))
    expect(onClose).toHaveBeenCalledWith(null)
    expect(calls.every(c => c.method === 'GET')).toBe(true)
  })
})
