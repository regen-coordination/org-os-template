// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { FieldRow, FieldTable } from './FieldRow.tsx'

describe('FieldRow', () => {
  it('is a dt/dd pair in a dl, the list a group named by its label', () => {
    const { container } = render(<FieldTable label="Fields"><FieldRow label="stage">develop</FieldRow></FieldTable>)
    const group = screen.getByRole('group', { name: 'Fields' })
    const dl = group.querySelector('dl.fields')!
    expect([...dl.children].map(c => [c.tagName, c.textContent])).toEqual([['DT', 'stage'], ['DD', 'develop']])
    expect(container.querySelector('table')).toBeNull()
  })

  it('ties its label to an input', () => {
    render(<FieldTable label="Fields"><FieldRow label="start" htmlFor="f-start"><input id="f-start" defaultValue="2026-10-01" /></FieldRow></FieldTable>)
    expect((screen.getByLabelText('start') as HTMLInputElement).value).toBe('2026-10-01')
  })

  it('staged: the moss bar class, and the old value struck beside the new, said as "was"', () => {
    const { container } = render(<FieldTable label="Fields"><FieldRow label="Threshold" staged was="4 of 9">4 of 8</FieldRow></FieldTable>)
    const dd = container.querySelector('dd')!
    expect(dd.className).toBe('staged')
    expect(dd.querySelector('.was s')!.textContent).toBe('4 of 9')
    expect(dd.querySelector('.was .sr-only')!.textContent).toBe('was ')
    expect(dd.textContent).toContain('4 of 8')
    expect(within(dd).getByText('Staged').closest('.smark-staged')).not.toBeNull()
  })

  it('keeps a value of text and links one run, so "A, B" reads as text (the marks and the note sit beside it)', () => {
    const { container } = render(<FieldTable label="Fields">
      <FieldRow label="lead" staged was="ana"><a href="/a">Steward A</a>, <a href="/b">Steward B</a></FieldRow>
    </FieldTable>)
    const dd = container.querySelector('dd')!
    expect([...dd.childNodes].some(n => n.nodeType === Node.TEXT_NODE)).toBe(false)
    expect([...dd.children].map(c => c.className)).toEqual(['fields-v', 'smark smark-staged'])
    expect(dd.querySelector('.fields-v')!.textContent).toBe('was anaSteward A, Steward B')
  })

  it('draws no value run when there is no value, only the note', () => {
    const { container } = render(<FieldTable label="Fields"><FieldRow label="Pools" error="Couldn’t read the Garden">{null}</FieldRow></FieldTable>)
    expect([...container.querySelector('dd')!.children].map(c => c.className)).toEqual(['note note-error'])
  })

  it('staged with nothing before: the bar and the mark, no struck value', () => {
    const { container } = render(<FieldTable label="Fields"><FieldRow label="started" staged>2026-10-01</FieldRow></FieldTable>)
    expect(container.querySelector('dd')!.className).toBe('staged')
    expect(container.querySelector('.was')).toBeNull()
  })

  it('stale: the clay bar class and "now 5 on the trunk"', () => {
    const { container } = render(<FieldTable label="Fields"><FieldRow label="Threshold" stale="5">4</FieldRow></FieldTable>)
    const dd = container.querySelector('dd')!
    expect(dd.className).toBe('stale')
    expect(within(dd).getByText('now 5 on the trunk').closest('.smark-stale')).not.toBeNull()
  })

  it('restricted: a lock glyph in the label and "Ops only" in faint, never the value, nor a change pending on it', () => {
    const { container } = render(<FieldTable label="Fields"><FieldRow label="Steward e-mail" restricted={{ hat: 'Ops' }} staged was="old@example.org">ops@example.org</FieldRow></FieldTable>)
    const dt = container.querySelector('dt')!
    expect(dt.textContent).toBe('Steward e-mail')
    expect(dt.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    const dd = container.querySelector('dd')!
    expect(dd.textContent).toBe('Ops only')
    expect(dd.className).toBe('')
    expect(dd.querySelector('.vis-field')).not.toBeNull()
    expect(container.textContent).not.toMatch(/ops@example.org|old@example.org/)
  })

  it('error: a note error under the value, at <htmlFor>-err, the id the input names in aria-describedby', () => {
    render(<FieldTable label="Fields">
      <FieldRow label="start" htmlFor="f-start" error="not a date: month 13"><input id="f-start" aria-describedby="f-start-err" defaultValue="2026-13-01" /></FieldRow>
    </FieldTable>)
    const err = screen.getByText('not a date: month 13')
    expect(err.classList.contains('note')).toBe(true)
    expect(err.classList.contains('note-error')).toBe(true)
    expect(err.querySelector('svg')).not.toBeNull()
    expect(screen.getByLabelText('start').getAttribute('aria-describedby')).toBe(err.id)
    expect(err.id).toBe('f-start-err')
  })

  it('help is a line under the value, its id from htmlFor, else from describe (a value no label points at)', () => {
    const { container, rerender } = render(<FieldTable label="Fields"><FieldRow label="Lead" htmlFor="f-lead" help="The person accountable."><input id="f-lead" /></FieldRow></FieldTable>)
    expect(container.querySelector('dd > .fields-help')!.id).toBe('f-lead-help')
    rerender(<FieldTable label="Fields"><FieldRow label="Kind" describe="f-kind" help="What shape it takes." error="pick one">x</FieldRow></FieldTable>)
    expect(container.querySelector('.fields-help')!.id).toBe('f-kind-help')
    expect(container.querySelector('.note-error')!.id).toBe('f-kind-err')
  })
})
