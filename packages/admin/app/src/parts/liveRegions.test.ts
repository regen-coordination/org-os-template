// The page's one polite region (spec §13; C11 ruling I-2): every sentence a person should hear is said through
// `announce()` (parts/live.tsx). A live region of its own — `aria-live` other than off, or role status, alert or log — is
// allowed only where it is listed below with the reason it is there. A new one fails this test until it is listed, or
// says its words through `announce()` instead.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../', import.meta.url))

/** file → how many live regions it draws, and why. */
const ALLOWED: Record<string, { count: number; why: string }> = {
  'parts/live.tsx': { count: 1, why: 'the one polite region itself' },
  'changes/Tray.tsx': { count: 2, why: "the tray bar's status (what is staged, busy, held: read when focus is in the bar), and a failed Apply or Propose, the one role=alert §13 names" },
  'changes/ProposePanel.tsx': { count: 2, why: 'the "Opened p-…" news that takes focus once the form is gone, and a refused Propose, the alert §13 names' },
  'elements/compose/ComposeCanvas.tsx': { count: 1, why: "the refused connection, the canvas's one role=alert §13 names" },
  'pages/Proposal.tsx': { count: 3, why: "the rule's overall state beside its path, what an act just did (it takes focus), and the read-back check's line: each a status that changes in place while the person is on it" },
  'pages/syncShare.tsx': { count: 1, why: "what Sync or Share did, where the person pressed it (a refusal is a quiet error note said by announce())" },
  'wizards/OpenInstance.tsx': { count: 1, why: '"Copied." beside the command just copied' },
  'wizards/WizardFrame.tsx': { count: 1, why: "the wizard's screen-reader status line (C4b: which step, what it writes), kept beside the polite region; e2e:a11y finds it in the tree. Not drawn where the page says the step through the one region (the stepped new-record form)" },
  'ReadOnly.tsx': { count: 1, why: 'the read-only band, drawn once with the page: a status that names the region, never updated in place' },
}

const LIVE = /aria-live="(?!off")[a-z]+"|role="(?:status|alert|log)"(?![^>]*aria-live="off")/g

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(e => {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) return e === 'test' ? [] : sources(p)
    return /\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e) ? [p] : []
  })
}

describe('live regions (C11 I-2)', () => {
  it('are the one polite region and the listed ones only, each with its reason', () => {
    const found: Record<string, number> = {}
    for (const f of sources(SRC)) {
      const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      const n = [...text.matchAll(LIVE)].length
      if (n > 0) found[relative(SRC, f)] = n
    }
    expect(found).toEqual(Object.fromEntries(Object.entries(ALLOWED).map(([f, a]) => [f, a.count])))
    for (const [f, a] of Object.entries(ALLOWED)) expect(a.why.length, f).toBeGreaterThan(20)
  })

  it('reads a band whose live region is off as no live region', () => {
    expect('<div className="band" role="status" aria-live="off">'.match(LIVE)).toBeNull()
    expect('<p role="status">'.match(LIVE)).toHaveLength(1)
    expect('<div aria-live="polite">'.match(LIVE)).toHaveLength(1)
  })
})
