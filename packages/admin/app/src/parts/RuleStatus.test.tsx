// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RuleStatus, ruleStatus } from './RuleStatus.tsx'
import { PROPOSAL_NOW, RESULTS } from '../test/fixtures/proposals.ts'

const draw = (result: typeof RESULTS.met, sentence = 'two maintainers approve') =>
  render(<ul><RuleStatus sentence={sentence} result={result} now={PROPOSAL_NOW} /></ul>)

describe('ruleStatus', () => {
  it('reads met, waiting, held, failed and expired from a rule result', () => {
    expect(ruleStatus(RESULTS.met)).toBe('met')
    expect(ruleStatus(RESULTS.waiting)).toBe('waiting')
    expect(ruleStatus(RESULTS.window)).toBe('waiting')
    expect(ruleStatus(RESULTS.held)).toBe('held')
    expect(ruleStatus(RESULTS.failed)).toBe('failed')
    expect(ruleStatus(RESULTS.expired)).toBe('expired')
  })
})

describe('RuleStatus', () => {
  const cases: [keyof typeof RESULTS, string, string][] = [['met', 'Met', 'done'], ['waiting', 'Waiting', 'open'], ['held', 'Held by an objection', 'needs'],
    ['failed', 'Failed', 'failed'], ['expired', 'Expired', 'closed']]
  for (const [key, word, mark] of cases) {
    it(`${key}: the house's ${mark} mark, its shape and the word "${word}", and an accessible name, so colour is never the only sign`, () => {
      const { container } = draw(RESULTS[key])
      const group = screen.getByRole('group', { name: `${word.toLowerCase()}: two maintainers approve` })
      expect(group.querySelector(`.smark-${mark} > .smark-shape`)!.getAttribute('aria-hidden')).toBe('true')
      expect(group.querySelector('.smark-word')!.textContent).toBe(word)
      expect(container.querySelector(`.rst-${key}`)).toBeTruthy()
      expect(group.textContent).toContain('two maintainers approve')
    })
  }

  it('the rule sentence, then the mark, the meter and its words', () => {
    draw(RESULTS.waiting)
    const group = screen.getByRole('group')
    expect(group.firstElementChild!.className).toBe('rst-s')
    expect(group.firstElementChild!.textContent).toBe('two maintainers approve')
    const line = group.querySelector('.rst-m')!
    expect([...line.children].map(c => c.className)).toEqual(['smark smark-open', 'meter-w', 'rst-x'])
    expect(line.querySelector('.meter')!.getAttribute('aria-hidden')).toBe('true')
    expect(line.querySelectorAll('.meter > i')).toHaveLength(2)
    expect(line.querySelector('.meter-l')!.textContent).toBe('1 of 2 approved')
  })

  it('a vote counts the ballots cast against its quorum; a rule with no count draws no meter', () => {
    draw(RESULTS.failed)
    expect(screen.getByRole('group').querySelector('.meter-l')!.textContent).toBe('3 voted · quorum 2')
    const { container } = draw(RESULTS.held, 'a maintainer decides unless a member objects within 3 days')
    expect(container.querySelector('.meter')).toBeNull()
  })

  it('says "wearer list partial" beside the tally when a wearer list was not read whole (DAO-OS L5 §7.3), and not otherwise', () => {
    const { unmount } = render(<ul><RuleStatus sentence="two of the council approve" result={RESULTS.waiting} now={PROPOSAL_NOW} partial /></ul>)
    expect(screen.getByText('wearer list partial').closest('.rst-tally')).toBeTruthy()
    unmount()
    draw(RESULTS.waiting)
    expect(screen.queryByText('wearer list partial')).toBeNull()
  })

  it('says what is missing, the tally by name, and the clock in words', () => {
    draw(RESULTS.waiting)
    expect(screen.getByText('needs 1 more approval from a maintainer')).toBeTruthy()
    expect(screen.getByText('for ana')).toBeTruthy()
    expect(screen.getByText('2 needed')).toBeTruthy()
    expect(screen.getByText('closes in 5 days')).toBeTruthy()
  })

  it('names who objects, and who voted each way', () => {
    draw(RESULTS.held)
    expect(screen.getByText('objecting bruno')).toBeTruthy()
    draw(RESULTS.failed)
    expect(screen.getByText('for ana')).toBeTruthy()
    expect(screen.getByText('against bruno, carla')).toBeTruthy()
  })

  it('says nothing is missing for a met rule, and shows no clock when nothing closes', () => {
    const { container } = draw(RESULTS.met)
    expect(container.querySelector('.rst-x')).toBeNull()
    expect(container.querySelector('.rst-clock')).toBeNull()
  })

  it('draws a rule with no tally entries without empty parts', () => {
    const { container } = draw(RESULTS.expired)
    expect(container.querySelector('.rst-tally')).toBeNull()
  })
})
