// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import FieldInput from './FieldInput.tsx'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'

const members = { 'GET /api/registries/members': { name: 'members', kind: 'collection', schemaVersion: '2.0', entries: [{ id: 'steward-a', name: 'Steward A' }, { id: 'ana', name: 'Ana Silva' }] } }

describe('FieldInput', () => {
  it('renders an enum as a select with its options, blank first', () => {
    renderAt(<FieldInput registry="projects" field="status" prop={{ enum: ['idea', 'develop', 'execute', 'archive'] }} value="idea" onChange={() => {}} />)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect([...select.options].map(o => o.value)).toEqual(['', 'idea', 'develop', 'execute', 'archive'])
  })

  it('reads a null in the enum as the blank option, not an option of its own (members.kind, as the old form did)', () => {
    const onChange = vi.fn()
    renderAt(<FieldInput registry="members" field="kind" prop={{ enum: ['person', 'agent', null] }} value={null} onChange={onChange} />)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect([...select.options].map(o => o.value)).toEqual(['', 'person', 'agent'])
    expect(select.value).toBe('')
    fireEvent.change(select, { target: { value: 'agent' } })
    fireEvent.change(select, { target: { value: '' } })
    expect(onChange.mock.calls).toEqual([['agent'], [null]])
  })

  it('renders string arrays as comma-separated text, and lets you type the comma', () => {
    const onChange = vi.fn()
    renderAt(<FieldInput registry="projects" field="tags" prop={{ type: 'array', items: { type: 'string' } }} value={['a', 'b']} onChange={onChange} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('a, b')
    fireEvent.change(input, { target: { value: 'a, b, ' } })
    expect(input.value).toBe('a, b, ')
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b'])
  })

  it('checks a date as you type, passing on only a real one', () => {
    const onChange = vi.fn(), onProblem = vi.fn()
    renderAt(<FieldInput registry="projects" field="started" prop={{ type: 'string', format: 'date' }} value="2026-01-01" onChange={onChange} onProblem={onProblem} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '2026-02-30' } })
    expect(onProblem).toHaveBeenLastCalledWith('not a date: day 30 (month 2 has 28)')
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '2026-02-28' } })
    expect(onProblem).toHaveBeenLastCalledWith(null)
    expect(onChange).toHaveBeenLastCalledWith('2026-02-28')
  })

  it('edits booleans as a checkbox, numbers as numbers, and clears text to null', () => {
    const onChange = vi.fn()
    renderAt(<>
      <FieldInput registry="x" field="public" prop={{ type: 'boolean' }} value={false} onChange={onChange} />
      <FieldInput registry="x" field="budget" prop={{ type: 'number' }} value={3} onChange={onChange} />
      <FieldInput registry="x" field="title" prop={{ type: 'string' }} value="T" onChange={onChange} />
    </>)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onChange).toHaveBeenLastCalledWith(true)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '12' } })
    expect(onChange).toHaveBeenLastCalledWith(12)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('picks a single reference from its target registry', async () => {
    fetchRoutes(members)
    const onChange = vi.fn()
    renderAt(<FieldInput registry="projects" field="lead" prop={{ type: ['string', 'null'] }} value="steward-a" onChange={onChange} />)
    expect(await screen.findByRole('option', { name: 'Ana Silva (ana)' })).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ana' } })
    expect(onChange).toHaveBeenLastCalledWith('ana')
  })

  it('edits an array of references as tokens with a picker', async () => {
    fetchRoutes(members)
    const onChange = vi.fn()
    renderAt(<FieldInput registry="projects" field="contributors" prop={{ type: 'array', items: { type: 'string' } }} value={['steward-a']} onChange={onChange} />)
    expect(await screen.findByRole('option', { name: 'Ana Silva', hidden: true })).toBeTruthy()
    const picker = screen.getByRole('combobox')
    fireEvent.change(picker, { target: { value: 'ana' } })
    fireEvent.keyDown(picker, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith(['steward-a', 'ana'])
    fireEvent.click(screen.getByRole('button', { name: 'Remove steward-a' }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('never names a reference by its id before its records are read: "…" while they load, "a member" when they fail (DP-71)', async () => {
    fetchRoutes({ 'GET /api/registries/members': () => new Promise(() => {}) })
    const { unmount } = renderAt(<>
      <FieldInput registry="projects" field="lead" prop={{ type: ['string', 'null'] }} value="steward-a" onChange={() => {}} />
      <FieldInput registry="projects" field="contributors" prop={{ type: 'array', items: { type: 'string' } }} value={['steward-a', 'ana']} onChange={() => {}} />
    </>)
    expect(screen.getByRole('option', { name: '…' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove … 1 of 2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove … 2 of 2' })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/steward-a|ana/)
    unmount()
    fetchRoutes({ 'GET /api/registries/members': new Response('{}', { status: 500 }) })
    renderAt(<>
      <FieldInput registry="projects" field="lead" prop={{ type: ['string', 'null'] }} value="steward-a" onChange={() => {}} />
      <FieldInput registry="projects" field="contributors" prop={{ type: 'array', items: { type: 'string' } }} value={['steward-a', 'ana']} onChange={() => {}} />
    </>)
    expect(await screen.findByRole('option', { name: 'a member' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Remove a member 2 of 2' })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/steward-a|ana/)
  })

  it('edits a string holding a line break in a textarea, keeping its breaks untouched and when edited (final 1)', () => {
    const onChange = vi.fn()
    const value = 'First line.\nSecond line.\n\nA paragraph.'
    renderAt(<FieldInput registry="projects" field="description" prop={{ type: 'string' }} value={value} onChange={onChange} />)
    const area = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(area.tagName).toBe('TEXTAREA')
    expect(area.value).toBe(value)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(area, { target: { value: `${value}\nOne more.` } })
    expect(onChange).toHaveBeenLastCalledWith(`${value}\nOne more.`)
  })

  it('edits a long string in a textarea, and keeps it one while you type it short (final 1)', () => {
    const onChange = vi.fn()
    renderAt(<FieldInput registry="projects" field="description" prop={{ type: 'string' }} value={'word '.repeat(20).trim()} onChange={onChange} />)
    const area = screen.getByRole('textbox')
    expect(area.tagName).toBe('TEXTAREA')
    fireEvent.change(area, { target: { value: 'short' } })
    expect(screen.getByRole('textbox')).toBe(area)
  })

  it('edits a field the schema marks as a textarea in one, even while empty (final 1)', () => {
    renderAt(<FieldInput registry="projects" field="notes" prop={{ type: 'string', format: 'textarea' }} value={null} onChange={() => {}} />)
    expect(screen.getByRole('textbox').tagName).toBe('TEXTAREA')
  })

  it('keeps a short one-line string in a one-line input', () => {
    renderAt(<FieldInput registry="projects" field="title" prop={{ type: 'string' }} value="River Commons" onChange={() => {}} />)
    expect(screen.getByRole('textbox').tagName).toBe('INPUT')
  })

  it('edits what it cannot draw as YAML, and reports bad YAML as a problem', () => {
    const onChange = vi.fn(), onProblem = vi.fn()
    renderAt(<FieldInput registry="projects" field="notes" prop={{}} value={{ a: 1 }} onChange={onChange} onProblem={onProblem} />)
    const area = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(area.value).toBe('a: 1\n')
    fireEvent.change(area, { target: { value: 'a: [' } })
    expect(onProblem.mock.lastCall![0]).toMatch(/./)
    fireEvent.change(area, { target: { value: 'a: 2\n' } })
    expect(onChange).toHaveBeenLastCalledWith({ a: 2 })
  })
})
