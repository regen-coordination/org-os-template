import { describe, it, expect } from 'vitest'
import { addDays, addMonths, dayHeading, monthGrid, monthTitle } from './calendar.ts'

const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay()

describe('monthGrid (weeks start Monday, C-18)', () => {
  it('starts November 2026 (the 1st is a Sunday) with six days of October', () => {
    const weeks = monthGrid(2026, 11, '2026-10-29')
    expect(weeks[0]!.map(d => d.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'])
    expect(weeks[0]!.map(d => d.inMonth)).toEqual([false, false, false, false, false, false, true])
  })

  it('has six rows for a month that needs six, and only the rows a month needs', () => {
    // August 2026 starts on a Saturday: five days of July, 31 of August
    expect(monthGrid(2026, 8, '2026-10-29')).toHaveLength(6)
    // February 2027 starts on a Monday and has 28 days
    expect(monthGrid(2027, 2, '2026-10-29')).toHaveLength(4)
    expect(monthGrid(2026, 10, '2026-10-29')).toHaveLength(5)
  })

  it('gives every week seven days, Monday first, one day after another', () => {
    for (const [y, m] of [[2026, 11], [2026, 8], [2027, 2], [2026, 12], [2027, 1]] as const) {
      for (const week of monthGrid(y, m, '2026-10-29')) {
        expect(week).toHaveLength(7)
        expect(weekday(week[0]!.date)).toBe(1)
        week.slice(1).forEach((d, i) => expect(d.date).toBe(addDays(week[i]!.date, 1)))
      }
    }
  })

  it('ends with the days of the next month that fill its last week', () => {
    const last = monthGrid(2026, 9, '2026-10-29').at(-1)!
    expect(last.map(d => d.date)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
    expect(last.filter(d => !d.inMonth).map(d => d.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
  })

  it('flags today on its date only', () => {
    const days = monthGrid(2026, 10, '2026-10-29').flat()
    expect(days.filter(d => d.today).map(d => d.date)).toEqual(['2026-10-29'])
    expect(monthGrid(2026, 12, '2026-10-29').flat().some(d => d.today)).toBe(false)
  })
})

describe('the calendar’s dates', () => {
  it('adds days across a month and a year', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31')
    expect(addDays('2026-10-29', 7)).toBe('2026-11-05')
  })

  it('adds months, keeping the day where the month has it and the month’s last day where it has not', () => {
    expect(addMonths('2026-10-29', 1)).toBe('2026-11-29')
    expect(addMonths('2026-10-31', 1)).toBe('2026-11-30')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
  })

  it('names a month "October 2026" and a day "Thu 29 Oct", today "Today · Thu 29 Oct"', () => {
    expect(monthTitle(2026, 10)).toBe('October 2026')
    expect(dayHeading('2026-10-30', '2026-10-29')).toBe('Fri 30 Oct')
    expect(dayHeading('2026-10-29', '2026-10-29')).toBe('Today · Thu 29 Oct')
  })
})
