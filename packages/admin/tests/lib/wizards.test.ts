// A wizard is data (wizards spec §5.3). The checker must be able to fail, and every wizard the
// platform ships must pass it.
import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadWizards, validateWizard, wizardsDir } from '../../lib/wizards.mjs'
import { LANGUAGES, ORG_TYPES } from '../../lib/open-instance.mjs'

const good = () => ({
  id: 'claim-handle', title: 'Claim your handle', summary: 'Tell the app which member you are.',
  intro: { body: 'You will pick a member.', writes: 'Nothing.' },
  steps: [{ id: 'who', title: 'Which member are you?', ask: 'Pick one.', writes: 'Nothing yet.' }],
  review: { title: 'Check the line', ask: 'This is what will be written.', writes: 'One line.' },
  done: { title: 'Done', body: 'You can edit now.' },
})

describe('validateWizard', () => {
  it('accepts a wizard with an intro, steps that each say what they write, a review and a done', () => {
    expect(validateWizard(good())).toEqual([])
  })

  it('names each fault, in words', () => {
    const faults = (mutate: (w: Record<string, any>) => void) => { const w = good() as Record<string, any>; mutate(w); return validateWizard(w) }
    expect(faults(w => { w.id = 'Not A Slug' })).toEqual(expect.arrayContaining([expect.stringMatching(/id/)]))
    expect(faults(w => { delete w.title })).toEqual(expect.arrayContaining([expect.stringMatching(/title/)]))
    expect(faults(w => { w.steps = [] })).toEqual(expect.arrayContaining([expect.stringMatching(/at least one step/)]))
    expect(faults(w => { delete w.steps[0].writes })).toEqual(expect.arrayContaining([expect.stringMatching(/Step "who".*writes/)]))
    expect(faults(w => { w.steps.push({ ...w.steps[0] }) })).toEqual(expect.arrayContaining([expect.stringMatching(/twice/)]))
    expect(faults(w => { delete w.review })).toEqual(expect.arrayContaining([expect.stringMatching(/review/)]))
    expect(faults(w => { delete w.review.writes })).toEqual(expect.arrayContaining([expect.stringMatching(/review.*writes/)]))
    expect(faults(w => { w.steps[0].id = 'review' })).toEqual(expect.arrayContaining([expect.stringMatching(/review.*reserved/)]))
    expect(validateWizard(null)).toEqual(['A wizard is a mapping of keys to values.'])
  })

  it('checks doors and fields where a step has them', () => {
    const faults = (mutate: (w: Record<string, any>) => void) => { const w = good() as Record<string, any>; mutate(w); return validateWizard(w) }
    expect(faults(w => { w.steps[0].doors = [{ value: 'a', label: 'A' }] })).toEqual([])
    expect(faults(w => { w.steps[0].doors = [] })).toEqual(expect.arrayContaining([expect.stringMatching(/doors/)]))
    expect(faults(w => { w.steps[0].doors = [{ value: 'a' }] })).toEqual(expect.arrayContaining([expect.stringMatching(/door.*value and a label/)]))
    expect(faults(w => { w.steps[0].fields = [{ id: 'n', label: 'N', kind: 'text' }] })).toEqual([])
    expect(faults(w => { w.steps[0].fields = [{ id: 'n', label: 'N', kind: 'date' }] })).toEqual(expect.arrayContaining([expect.stringMatching(/kind that is not text, email or choice/)]))
    expect(faults(w => { w.steps[0].fields = [{ id: 'n', label: 'N', kind: 'choice' }] })).toEqual(expect.arrayContaining([expect.stringMatching(/needs options/)]))
    expect(faults(w => { w.steps[0].fields = [{ id: 'n', label: 'N', kind: 'text' }, { id: 'n', label: 'M', kind: 'text' }] })).toEqual(expect.arrayContaining([expect.stringMatching(/used twice/)]))
  })
})

describe('the wizards the platform ships', () => {
  it('all load and pass', () => {
    const files = readdirSync(wizardsDir()).filter(f => f.endsWith('.yaml')).sort()
    expect(files.length).toBeGreaterThan(0)
    const { wizards, problems } = loadWizards()
    expect(problems).toEqual([])
    expect(wizards.map(w => `${w.id}.yaml`).sort()).toEqual(files)
  })

  it('keep open-instance\'s choices the ones the clone command takes', () => {
    const w = loadWizards().wizards.find(x => x.id === 'open-instance')!
    const org = w.steps.find((s: { id: string }) => s.id === 'org')!
    const options = (id: string) => org.fields!.find(f => f.id === id)!.options!.map(o => o.value)
    expect(options('type')).toEqual(ORG_TYPES.map(t => t.value))
    expect(options('language')).toEqual(LANGUAGES.map(l => l.value))
    expect(w.steps.map((s: { id: string }) => s.id)).toEqual(['start', 'org', 'you'])
  })

  it('include claim-handle, the first slice', () => {
    const w = loadWizards().wizards.find(x => x.id === 'claim-handle')!
    expect(w.title).toBe('Claim your handle')
    expect(w.steps.map((s: { id: string }) => s.id)).toEqual(['who'])
    expect(fileURLToPath(new URL('../../wizards/', import.meta.url))).toBe(wizardsDir() + '/')
  })
})
