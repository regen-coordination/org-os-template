import { describe, it, expect } from 'vitest'
import { transition, walk, sentence, type Machine } from '../../../lib/machines/run.mjs'
import { verify } from '../../../lib/machines/verify.mjs'
import { editor, editorGuards, settleEditor } from './editor.ts'
import { tray } from './tray.ts'
import { palette } from './palette.ts'
import { panels } from './panels.ts'
import { block, blockGuards } from './block.ts'
import { arrange, arrangeGuards } from './arrange.ts'
import { drop } from './drop.ts'
import { libraryEntry, libraryEntryGuards } from './libraryEntry.ts'
import { propose } from './propose.ts'

const ALL: Machine[] = [editor, tray, palette, panels, block, arrange, drop, libraryEntry, propose]

describe('client machines', () => {
  for (const m of ALL) {
    it(`${m.id} is well formed: every state reachable, no dead end, every edge can fire`, () => {
      expect(verify(m)).toEqual([])
    })
  }

  it('their states are the contract\'s (the tray\'s per ruling 3)', () => {
    expect(walk(editor).states).toEqual(['viewing', 'editing', 'invalid', 'changedUnder', 'gone', 'saving'])
    expect(walk(block).states).toEqual(['loading', 'ready', 'empty', 'error', 'notYet', 'unavailable'])
    expect(walk(arrange).states).toEqual(['off', 'arranging', 'review', 'staging'])
    expect(walk(drop).states).toEqual(['idle', 'dragging', 'staging', 'refused'])
    expect(walk(panels).states).toEqual(['closed', 'open'])
    expect(walk(tray).states).toEqual(['idle', 'busy', 'applied', 'failed'])
    expect(walk(palette).states).toEqual(['closed', 'searching', 'running'])
    expect(walk(libraryEntry).states).toEqual(['browsing', 'previewing', 'viewing', 'refused', 'staged'])
    expect(walk(propose).states).toEqual(['composing', 'submitting', 'opened', 'refused'])
  })
})

describe('libraryEntry', () => {
  const ctx = (over: Record<string, unknown> = {}) => ({ title: 'Onboarding', reason: '', addable: false, whyNot: 'Adding is not available yet.', ...over })

  it('previews from browsing, and goes back when closed or when another entry is chosen', () => {
    expect(transition(libraryEntry, libraryEntryGuards, 'browsing', { type: 'PREVIEW' }, ctx())).toMatchObject({ ok: true, state: 'previewing' })
    expect(transition(libraryEntry, libraryEntryGuards, 'previewing', { type: 'PREVIEW' }, ctx())).toMatchObject({ ok: true, state: 'previewing' })
    expect(transition(libraryEntry, libraryEntryGuards, 'previewing', { type: 'CLOSE' }, ctx())).toMatchObject({ ok: true, state: 'browsing' })
  })

  it('cannot add from browsing: there is nothing in view to add', () => {
    expect(transition(libraryEntry, libraryEntryGuards, 'browsing', { type: 'ADD' }, ctx({ addable: true })).ok).toBe(false)
  })

  it('refuses ADD with the guard sentence while adding is not built, and stages once it is allowed', () => {
    expect(transition(libraryEntry, libraryEntryGuards, 'previewing', { type: 'ADD' }, ctx())).toEqual(
      { ok: false, reason: 'Adding is not available yet.', guard: 'addable' })
    expect(transition(libraryEntry, libraryEntryGuards, 'previewing', { type: 'ADD' }, ctx({ addable: true }))).toMatchObject({ ok: true, state: 'staged' })
  })

  it('says a refusal in the sentence the server gave, and the preview in words that promise nothing changes', () => {
    expect(sentence(libraryEntry, 'refused', ctx({ reason: 'A board with the id `x` already exists. Add it under another id.' })))
      .toBe('A board with the id `x` already exists. Add it under another id.')
    expect(sentence(libraryEntry, 'previewing', ctx())).toBe('Previewing Onboarding. Nothing changes until it is added.')
  })

  it('views an entry that cannot be added without promising it can: no "until it is added"', () => {
    expect(transition(libraryEntry, libraryEntryGuards, 'browsing', { type: 'VIEW' }, ctx())).toMatchObject({ ok: true, state: 'viewing' })
    expect(transition(libraryEntry, libraryEntryGuards, 'previewing', { type: 'VIEW' }, ctx())).toMatchObject({ ok: true, state: 'viewing' })
    expect(transition(libraryEntry, libraryEntryGuards, 'viewing', { type: 'PREVIEW' }, ctx())).toMatchObject({ ok: true, state: 'previewing' })
    expect(transition(libraryEntry, libraryEntryGuards, 'viewing', { type: 'CLOSE' }, ctx())).toMatchObject({ ok: true, state: 'browsing' })
    expect(transition(libraryEntry, libraryEntryGuards, 'viewing', { type: 'ADD' }, ctx({ addable: true })).ok).toBe(false)
    expect(sentence(libraryEntry, 'viewing', ctx({ title: 'Treasury' }))).toBe('Viewing Treasury. It adds nothing to this organization.')
  })
})

describe('editor', () => {
  const facts = (o: Partial<{ gone: boolean; stale: boolean; blocked: boolean }> = {}) => ({ gone: false, stale: false, blocked: false, ...o })

  it('settles an open editor by what the record says, gone before changed before invalid (ruling 4)', () => {
    expect(settleEditor('editing', facts())).toBe('editing')
    expect(settleEditor('editing', facts({ blocked: true }))).toBe('invalid')
    expect(settleEditor('editing', facts({ stale: true, blocked: true }))).toBe('changedUnder')
    expect(settleEditor('editing', facts({ gone: true, stale: true }))).toBe('gone')
  })

  it('leaves viewing and saving as they are', () => {
    expect(settleEditor('viewing', facts({ gone: true }))).toBe('viewing')
    expect(settleEditor('saving', facts({ stale: true }))).toBe('saving')
  })

  it('saves only from a settled editing; cancel works from saving too (Review Focus 4)', () => {
    expect(transition(editor, editorGuards, 'editing', { type: 'SAVE' }, facts()).ok).toBe(true)
    expect(transition(editor, editorGuards, 'invalid', { type: 'SAVE' }, facts({ blocked: true })).ok).toBe(false)
    expect(transition(editor, editorGuards, 'saving', { type: 'CANCEL' }, facts())).toMatchObject({ ok: true, state: 'viewing' })
  })
})

describe('tray', () => {
  it('one action at a time: a second ACT while busy is refused', () => {
    expect(transition(tray, {}, 'idle', { type: 'ACT' }, null)).toMatchObject({ state: 'busy' })
    expect(transition(tray, {}, 'busy', { type: 'ACT' }, null).ok).toBe(false)
    expect(transition(tray, {}, 'failed', { type: 'ACT' }, null)).toMatchObject({ state: 'busy' })
    expect(transition(tray, {}, 'applied', { type: 'ACT' }, null)).toMatchObject({ state: 'busy' }) // final review 3: ⌘K within appliedMs is not dropped
  })
})

describe('block, arrange, drop, panels, palette', () => {
  it('a block settles by its count; FAILED, UNAVAILABLE and NOT_YET go where they say; RELOAD goes back to loading (P4-C4)', () => {
    expect(transition(block, blockGuards, 'loading', { type: 'LOADED', count: 2 }, null)).toMatchObject({ state: 'ready' })
    expect(transition(block, blockGuards, 'loading', { type: 'LOADED', count: 0 }, null)).toMatchObject({ state: 'empty' })
    expect(transition(block, blockGuards, 'ready', { type: 'FAILED', error: 'boom' }, null)).toMatchObject({ state: 'error' })
    expect(transition(block, blockGuards, 'ready', { type: 'UNAVAILABLE', error: 'down' }, null)).toMatchObject({ state: 'unavailable' })
    expect(transition(block, blockGuards, 'loading', { type: 'NOT_YET' }, null)).toMatchObject({ state: 'notYet' })
    expect(transition(block, blockGuards, 'notYet', { type: 'RELOAD' }, null)).toMatchObject({ state: 'loading' })
    expect(transition(block, blockGuards, 'notYet', { type: 'LOADED', count: 3 }, null).ok).toBe(false)
    expect(transition(block, blockGuards, 'loading', { type: 'RELOAD' }, null).ok).toBe(false)
    for (const s of walk(block).states) expect(block.states[s]!.final).toBeUndefined()
  })

  it('Done with nothing moved ends arranging without staging anything', () => {
    expect(transition(arrange, arrangeGuards, 'arranging', { type: 'DONE' }, { changed: false })).toMatchObject({ state: 'off' })
    expect(transition(arrange, arrangeGuards, 'arranging', { type: 'DONE' }, { changed: true })).toMatchObject({ state: 'review' })
  })

  it('a drop stages from dragging, or from idle by the keyboard; a refused drop says why and is reset (P4-C7)', () => {
    expect(transition(drop, {}, 'dragging', { type: 'DROP' }, null)).toMatchObject({ state: 'staging' })
    expect(transition(drop, {}, 'idle', { type: 'DROP' }, null)).toMatchObject({ state: 'staging' })
    expect(transition(drop, {}, 'refused', { type: 'RESET' }, null)).toMatchObject({ state: 'idle' })
    expect(sentence(drop, 'refused', { reason: 'the record changed since you picked it up' })).toBe('Not moved: the record changed since you picked it up.')
  })

  it('a panel slot opens from either state and closes from open; there is no ESCAPE (P4-C5)', () => {
    expect(transition(panels, {}, 'open', { type: 'OPEN', id: 'inspector' }, null)).toMatchObject({ state: 'open' })
    expect(transition(panels, {}, 'open', { type: 'CLOSE' }, null)).toEqual({ ok: true, state: 'closed', effects: ['returnFocus'] })
    expect(panels.events).toEqual(['OPEN', 'CLOSE'])
  })

  it('the palette closes from every open state (P4-C6)', () => {
    expect(transition(palette, {}, 'searching', { type: 'CLOSE' }, null)).toMatchObject({ state: 'closed' })
    expect(transition(palette, {}, 'running', { type: 'CLOSE' }, null)).toMatchObject({ state: 'closed' })
    expect(transition(palette, {}, 'closed', { type: 'CLOSE' }, null).ok).toBe(false)
  })
})
