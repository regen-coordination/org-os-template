// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DateInput, NumberInput, SelectInput, TextInput, YamlInput, dateProblem } from './index.ts'
import * as fromRecord from '../../record/FieldInput.tsx'
import { dateProblem as fromFields } from '../../record/fields.ts'

const common = { id: 'f-x' }

describe('the inputs, outside any record', () => {
  it('a text input becomes a textarea for prose and for a value with a line break, and stays one', () => {
    const onChange = vi.fn()
    const { rerender, container } = render(<TextInput common={common} prose={false} value="one line" readOnly={false} onChange={onChange} />)
    expect(container.querySelector('input')).toBeTruthy()
    rerender(<TextInput common={common} prose={false} value={'two\nlines'} readOnly={false} onChange={onChange} />)
    expect(container.querySelector('textarea')).toBeTruthy()
    rerender(<TextInput common={common} prose={false} value="short again" readOnly={false} onChange={onChange} />)
    expect(container.querySelector('textarea')).toBeTruthy()
    fireEvent.change(container.querySelector('textarea')!, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('a text input says it is required when its caller says so, and only then (C7 I-4)', () => {
    const { container, rerender } = render(<TextInput common={{ id: 'f-r', 'aria-required': true }} prose value="" readOnly={false} onChange={() => {}} />)
    expect(container.querySelector('textarea')!.getAttribute('aria-required')).toBe('true')
    rerender(<TextInput common={{ id: 'f-r' }} prose value="" readOnly={false} onChange={() => {}} />)
    expect(container.querySelector('textarea')!.hasAttribute('aria-required')).toBe(false)
  })

  it('a number input stages a number, and null when cleared', () => {
    const onChange = vi.fn()
    render(<NumberInput common={common} value={3} onChange={onChange} />)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '12' } })
    expect(onChange).toHaveBeenLastCalledWith(12)
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('a date input reports a date that is not one, and stages only one that is', () => {
    const onChange = vi.fn(), onProblem = vi.fn()
    render(<DateInput common={common} value={null} onChange={onChange} onProblem={onProblem} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '2026-02-30' } })
    expect(onProblem).toHaveBeenLastCalledWith('not a date: day 30 (month 2 has 28)')
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '2026-02-28' } })
    expect(onChange).toHaveBeenLastCalledWith('2026-02-28')
  })

  it('a select offers its options after a blank one, and the blank stages null', () => {
    const onChange = vi.fn()
    render(<SelectInput common={common} options={['idea', 'active', null]} value="idea" onChange={onChange} />)
    expect([...screen.getByRole('combobox').querySelectorAll('option')].map(o => o.textContent)).toEqual(['', 'idea', 'active'])
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('a YAML input keeps the last good value and says what does not parse', () => {
    const onChange = vi.fn(), onProblem = vi.fn()
    render(<YamlInput id="f-y" value={{ a: 1 }} onChange={onChange} onProblem={onProblem} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a: [1' } })
    expect(onProblem).toHaveBeenLastCalledWith(expect.any(String))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('is still reachable where the record pages import it', () => {
    expect(fromRecord.TextInput).toBe(TextInput)
    expect(fromRecord.YamlInput).toBe(YamlInput)
    expect(fromFields).toBe(dateProblem)
  })
})
