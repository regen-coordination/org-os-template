// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { EntryPreview } from './EntryPreview.tsx'
import { renderAt } from '../test/render.tsx'
import { councilPreview, hatsPreview, listed, preview, RECEIPTS, SHELF, TEST_DESK, testDeskPreview } from '../test/fixtures/library.ts'
import { heard } from '../test/notes.ts'

const none = { onAdd: async () => {}, onRemove: () => {} }

const council = listed({ id: 'board:treasury-council', title: 'Treasury & council', summary: "One Safe, what waits on signers, runway, the council's open items." })
const previewing = { state: 'previewing', text: 'Previewing Treasury & council. Nothing changes until it is added.' }
const ADD = 'Add — stage a change'
const region = (name: string) => screen.getByRole('region', { name })
const side = (heading: string) => screen.getByRole('heading', { level: 3, name: heading }).parentElement!

describe('EntryPreview (§11.2)', () => {
  it('heads the preview with "<kind> · preview" and id@version in Mono, the title, the full summary and the promise line', () => {
    renderAt(<EntryPreview entry={SHELF[0]!} preview={councilPreview()} machine={{ state: 'previewing', text: 'Previewing Council + Safe + Hats. Nothing changes until it is added.' }} {...none} />)
    const p = region('Council + Safe + Hats preview')
    expect(p.querySelector('.lib-prev-k')!.textContent).toBe('DAO template · preview')
    expect(p.querySelector('.lib-prev-id')!.textContent).toBe('template:council-safe-hats@0.1.0')
    expect(p.querySelector('.lib-prev-id')!.className).toContain('mono')
    expect(within(p).getByRole('heading', { level: 2, name: 'Council + Safe + Hats' })).toBeTruthy()
    expect(within(p).getByText(/^A council, a Safe it controls/)).toBeTruthy()
    expect(within(p).getByText('Adding stages one change. The org’s rules decide it. Nothing is written by this preview.')).toBeTruthy()
  })

  it('lists what it would create, a row each — glyph, name, registry:id in Mono, the class and who decides — the taken id in clay', () => {
    renderAt(<EntryPreview entry={SHELF[0]!} preview={councilPreview()} machine={previewing} {...none} />)
    expect(screen.getByRole('heading', { level: 3, name: 'It would create 4 records' })).toBeTruthy()
    const rows = within(screen.getByRole('list', { name: 'It would create 4 records' })).getAllByRole('listitem')
    expect(rows.map(r => [r.querySelector('.lib-row-n')!.textContent, r.querySelector('.mono')!.textContent])).toEqual([
      ['Treasury', 'systems:treasury'], ['Council', 'systems:roles'], ['Rule: council approval', 'governance:council-approval'], ['Treasury board', 'boards:treasury'],
    ])
    expect(rows[0]!.querySelector('.lib-row-c')!.textContent).toBe('governed · Council consent: 4 of the 8 who wear the Council hat.')
    expect(rows[0]!.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    expect(rows.map(r => r.className.includes('lib-row-clay'))).toEqual([false, false, false, true])
    expect(rows[3]!.querySelector('.lib-row-c')!.textContent).toBe('id taken · would be treasury-2')
  })

  it('beside it: Needs (what is missing in clay, with its word), Would reach, read only (hosts in Mono), and Who decides', () => {
    renderAt(<EntryPreview entry={SHELF[0]!} preview={councilPreview()} machine={previewing} {...none} />)
    const needs = side('Needs')
    expect(needs.closest('.lib-prev-s')).toBeTruthy()
    const items = within(needs).getAllByRole('listitem')
    expect(items.map(li => [li.textContent, li.className.includes('miss')])).toEqual([
      ['A governance file, present', false], ['The safe and hats-tree kinds, present', false], ['A chain for the Safe — asked during compose, missing', true],
    ])
    expect([...side('Would reach, read only').querySelectorAll('.mono')].map(e => e.textContent)).toEqual(['safe-transaction-celo.safe.global', 'api.hatsprotocol.xyz'])
    expect(within(side('Who decides')).getByText('governed: Council consent: 4 of the 8 who wear the Council hat.')).toBeTruthy()
  })

  it('offers Add — stage a change as the primary, and Close, a link back to the list', () => {
    renderAt(<EntryPreview entry={TEST_DESK} preview={testDeskPreview()} machine={previewing} {...none} />)
    const add = screen.getByRole('button', { name: ADD })
    expect(add.className).toContain('primary')
    const close = screen.getByRole('link', { name: 'Close preview' })
    expect(close.textContent).toBe('Close')
    expect(close.getAttribute('href')).toBe('/library')
  })

  it('says what adding would change, what it needs, who decides and where it came from, without adding it', () => {
    renderAt(<EntryPreview entry={council} preview={preview()} machine={previewing} {...none} />)
    const p = region('Treasury & council preview')
    expect(within(p).getByRole('heading', { level: 2, name: 'Treasury & council' })).toBeTruthy()
    expect(within(p).getByText('Previewing Treasury & council. Nothing changes until it is added.')).toBeTruthy()
    expect(within(p).getByText('boards:treasury-council')).toBeTruthy()
    expect(within(p).getByText('The Safe (system)')).toBeTruthy()
    expect(within(p).getByText('records: the maintainer decides alone')).toBeTruthy()
    expect(within(p).getByText('framework · v1.0.0 · stated 2026-10-18')).toBeTruthy()
    expect(within(p).getByText('system')).toBeTruthy() // what it asks for
  })

  it('shows what is missing in clay with its word, and what is there as plain words', () => {
    const { rerender } = renderAt(<EntryPreview entry={council} preview={preview({ needs: [{ text: 'a system of kind safe', met: false }] })} machine={previewing} {...none} />)
    expect(screen.getByText('a system of kind safe').closest('li')!.className).toContain('miss')
    expect(screen.getByText('a system of kind safe').closest('li')!.textContent).toBe('a system of kind safe, missing')
    rerender(<EntryPreview entry={council} preview={preview()} machine={previewing} {...none} />)
    expect(screen.getByText('a system of kind safe').closest('li')!.className).not.toContain('miss')
  })

  it('offers Add disabled when the entry cannot be added, with the sentence beside it in a note', () => {
    const raw = 'This entry is raw: the library shows it and does not add it.'
    renderAt(<EntryPreview entry={council} preview={preview({ cannotAdd: raw })} machine={previewing} {...none} />)
    const add = screen.getByRole('button', { name: ADD }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    expect(screen.getByText(raw).closest('[role=note]')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull() // nothing to fill in for an entry that cannot be added
  })

  it('offers no add for a built-in board, and says it is already there', () => {
    renderAt(<EntryPreview entry={listed({ id: 'board:treasury', title: 'Treasury', builtin: true, installable: false, version: 'built in' })}
      preview={preview({ builtin: true, adds: [], needs: [], asks: [], decided: [], note: 'Built in: every instance has this board.' })} machine={previewing} {...none} />)
    expect(screen.queryByRole('button', { name: ADD })).toBeNull()
    expect(screen.queryByText(/^Adding stages one change/)).toBeNull()
    expect(screen.getByText('Built in: every instance has this board.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Close preview' })).toBeTruthy()
  })

  it('says a refused id in the server’s sentence, as a failed mark (the page says it once, politely), and the next free id on its row', () => {
    renderAt(<EntryPreview entry={council} machine={{ state: 'refused', text: 'A board with the id `treasury-council` already exists. Add it under another id.' }}
      preview={preview({ refusal: { sentence: 'A board with the id `treasury-council` already exists. Add it under another id.', nextFreeId: 'treasury-council-2' } })} {...none} />)
    const said = screen.getByText('A board with the id `treasury-council` already exists. Add it under another id.')
    expect(said.closest('.smark-failed')).toBeTruthy()
    expect(said.closest('[role=alert]')).toBeNull()
    expect(screen.getByText('id taken · would be treasury-council-2').closest('li')!.className).toContain('lib-row-clay')
  })

  it('lists rules and roles as sentences, and the hosts a driver reaches as read only', () => {
    renderAt(<EntryPreview entry={listed({ id: 'system:safe', shelf: 'system', title: 'Safe multisig' })} machine={previewing} {...none}
      preview={preview({ roles: [{ id: 'member', sentence: 'member: every member who is a person' }], rules: [{ id: 'records', sentence: 'records: one maintainer approves' }],
        reaches: [{ host: 'api.safe.global', reads: 'read only' }], blocks: [], adds: [] })} />)
    expect(screen.getByText('member: every member who is a person')).toBeTruthy()
    expect(screen.getByText('records: one maintainer approves')).toBeTruthy()
    expect(within(side('Would reach, read only')).getByText('api.safe.global').className).toContain('mono')
  })

  it('says a limit of the platform as it is: a note, not a failure', () => {
    renderAt(<EntryPreview entry={council} machine={previewing} {...none}
      preview={preview({ note: 'Adding a rule set is not available yet: the change engine cannot edit data/governance.yaml yet.' })} />)
    expect(screen.getByText(/cannot edit data\/governance\.yaml yet/).closest('[role=note]')).toBeTruthy()
  })

  describe('the receipt (L1, §11.2)', () => {
    it('says who decided the add, when, and what it created, then Remove', () => {
      const onRemove = vi.fn()
      renderAt(<EntryPreview entry={SHELF[1]!} preview={hatsPreview()} receipts={RECEIPTS} machine={previewing} onAdd={async () => {}} onRemove={onRemove} />)
      const line = screen.getByText('Added by p-2026-10-12-001-ab12 on 2026-10-12 · created 1 record')
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
      expect(onRemove).toHaveBeenCalledWith('system-hats-tree')
      expect(screen.getByRole('button', { name: 'Remove' }).getAttribute('aria-describedby')).toBe(line.id)
    })

    it('names the member who applied it when no proposal decided it, and says less while the receipts are not read', () => {
      const { rerender } = renderAt(<EntryPreview entry={TEST_DESK} preview={testDeskPreview({ receipts: [{ id: 'board-test-desk', at: '2026-10-29', by: 'steward-a' }] })}
        receipts={RECEIPTS} machine={previewing} {...none} />)
      expect(screen.getByText('Added by steward-a on 2026-10-29 · created 2 records')).toBeTruthy()
      rerender(<EntryPreview entry={TEST_DESK} preview={testDeskPreview({ receipts: [{ id: 'board-test-desk', at: '2026-10-29', by: 'steward-a' }] })} machine={previewing} {...none} />)
      expect(screen.getByText('Added by steward-a on 2026-10-29')).toBeTruthy()
    })

    it('says Removal staged for a receipt whose removal is in your changes, and offers no Remove (E-22)', () => {
      renderAt(<EntryPreview entry={SHELF[1]!} preview={hatsPreview()} receipts={RECEIPTS} removals={['system-hats-tree']} machine={previewing} {...none} />)
      expect(screen.getByText('Removal staged').closest('.smark-staged')).toBeTruthy()
      expect(screen.queryByText(/^Added by/)).toBeNull()
      expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    })

    it('says Staged in your changes for an entry just added, with no add form and no taken id (E-22)', () => {
      renderAt(<EntryPreview entry={TEST_DESK} staged preview={testDeskPreview({ refusal: { sentence: 'A board with the id `test-desk` already exists. Add it under another id.', nextFreeId: 'test-desk-2' } })}
        machine={{ state: 'staged', text: 'Test desk is staged in the changes.' }} {...none} />)
      expect(screen.getByText('Staged in your changes').closest('.smark-staged')).toBeTruthy()
      expect(screen.queryByRole('button', { name: ADD })).toBeNull()
      expect(screen.queryByRole('textbox')).toBeNull()
      expect(screen.queryByText(/id taken/)).toBeNull()
    })
  })

  describe('adding', () => {
    const desk = { state: 'previewing', text: 'Previewing Test desk. Nothing changes until it is added.' }

    it('asks for what the entry needs, one labelled input per field, with its default, and an Add that can be pressed', () => {
      renderAt(<EntryPreview entry={TEST_DESK} preview={testDeskPreview()} machine={desk} {...none} />)
      expect((screen.getByLabelText('id') as HTMLInputElement).value).toBe('test-desk')
      expect((screen.getByLabelText('name') as HTMLInputElement).value).toBe('')
      expect((screen.getByLabelText('url') as HTMLInputElement).value).toBe('')
      expect(screen.getByLabelText('name').getAttribute('aria-describedby')).toBeTruthy()
      expect(screen.getByText('What it is called here.')).toBeTruthy()
      expect(screen.getByRole('group', { name: 'What it asks for' })).toBeTruthy()
      expect((screen.getByRole('button', { name: ADD }) as HTMLButtonElement).disabled).toBe(false)
    })

    it('offers the next free id when the id is taken', () => {
      renderAt(<EntryPreview entry={TEST_DESK} machine={desk} {...none}
        preview={testDeskPreview({ refusal: { sentence: 'A board with the id `test-desk` already exists. Add it under another id.', nextFreeId: 'test-desk-2' } })} />)
      expect((screen.getByLabelText('id') as HTMLInputElement).value).toBe('test-desk-2')
    })

    it('after a 409 TAKEN, the id field takes the next free id and the keyboard (E-22)', async () => {
      const onAdd = vi.fn(async () => ({ nextFreeId: 'test-desk-2' }))
      renderAt(<EntryPreview entry={TEST_DESK} preview={testDeskPreview()} machine={desk} onAdd={onAdd} onRemove={() => {}} />)
      fireEvent.click(screen.getByRole('button', { name: ADD }))
      await waitFor(() => expect((screen.getByLabelText('id') as HTMLInputElement).value).toBe('test-desk-2'))
      await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('id')))
    })

    it('sends what was typed when Add is pressed', async () => {
      const onAdd = vi.fn(async () => {})
      renderAt(<EntryPreview entry={TEST_DESK} preview={testDeskPreview()} machine={desk} onAdd={onAdd} onRemove={() => {}} />)
      fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Front desk' } })
      fireEvent.change(screen.getByLabelText('url'), { target: { value: 'https://desk.example' } })
      fireEvent.click(screen.getByRole('button', { name: ADD }))
      await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ id: 'test-desk', name: 'Front desk', url: 'https://desk.example' }))
    })

    it("leaves out a field left empty, so the entry's own rules say what is missing", async () => {
      const onAdd = vi.fn(async () => {})
      renderAt(<EntryPreview entry={TEST_DESK} preview={testDeskPreview()} machine={desk} onAdd={onAdd} onRemove={() => {}} />)
      fireEvent.click(screen.getByRole('button', { name: ADD }))
      await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ id: 'test-desk' }))
    })

    it('says a failure that is not about a field in a clay note under the actions (E-27)', async () => {
      const onAdd = vi.fn(async () => { throw new Error('The change could not be read.') })
      renderAt(<EntryPreview entry={TEST_DESK} preview={testDeskPreview()} machine={desk} onAdd={onAdd} onRemove={() => {}} />)
      const voice = heard()
      fireEvent.click(screen.getByRole('button', { name: ADD }))
      expect((await screen.findByText('The change could not be read.')).closest('.note-error')).toBeTruthy()
      // not an alert (§13, C10): the refused Add is said once through the page's polite region. announce() runs in
      // an effect after the note is drawn, so wait for it: under load the note can be found before the effect ran.
      await waitFor(() => expect(voice.said).toEqual(['The change could not be read.']))
      voice.stop()
    })

    it('says a reason once: a refusal the machine already shows is not repeated beside the button', () => {
      const taken = 'A board with the id `onboarding` already exists. Add it under another id.'
      renderAt(<EntryPreview entry={listed()} machine={{ state: 'refused', text: taken }} {...none}
        preview={preview({ id: 'board:onboarding', cannotAdd: taken, refusal: { sentence: taken, nextFreeId: 'onboarding-2' } })} />)
      expect(screen.getAllByText(taken)).toHaveLength(1)
      expect((screen.getByRole('button', { name: ADD }) as HTMLButtonElement).disabled).toBe(true)
    })
  })
})
