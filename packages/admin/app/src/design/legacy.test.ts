// Nothing is left on 0.6's look (C10): design.css only imports the group sheets, every rule a sheet holds is drawn by
// some element, every class an element names is drawn by some sheet (or is a listed hook), and nothing reaches for a primitive the house
// retired. The scans read the sources with the TypeScript parser, so a class in a comment counts for nothing.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const SRC = fileURLToPath(new URL('..', import.meta.url))
const DESIGN = fileURLToPath(new URL('.', import.meta.url))
const read = (path: string) => readFileSync(path, 'utf8')
const walk = (dir: string): string[] => readdirSync(dir).flatMap(f => {
  const p = join(dir, f)
  return statSync(p).isDirectory() ? walk(p) : [p]
})
const rel = (p: string) => relative(SRC, p).split('\\').join('/')
const ALL = walk(SRC)
const isTest = (p: string) => /\.test\.tsx?$/.test(p) || rel(p).startsWith('test/')
/** What ships: the client's own modules, not its tests or their helpers and fixtures. */
const SHIPPED = ALL.filter(p => /\.tsx?$/.test(p) && !isTest(p))
const SHEETS = ALL.filter(p => p.endsWith('.css'))

/** The class names a stylesheet's selectors name (comments, strings, imports and declarations left out). */
function selectorClasses(css: string): Set<string> {
  const s = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;/g, '').replace(/"[^"]*"|'[^']*'/g, '""')
  // a block's prelude is what stands between the last `;`, `{` or `}` and its `{`: a selector list or an at-rule
  const preludes = [...s.matchAll(/([^;{}]+)\{/g)].map(m => m[1]!)
  return new Set(preludes.flatMap(p => [...p.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(m => m[1]!)))
}

const sourceOf = (p: string) => ts.createSourceFile(p, read(p), ts.ScriptTarget.Latest, true, p.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
const words = (text: string) => text.split(/\s+/).filter(Boolean)

/** Every word of every string a module writes, and the prefixes it builds classes from (`tl-${state}`, `'note-' + s`). */
function stringsOf(p: string): { words: Set<string>; prefixes: Set<string> } {
  const out = { words: new Set<string>(), prefixes: new Set<string>() }
  const piece = (text: string, open: boolean) => {
    for (const w of words(text)) out.words.add(w)
    const last = /(\S+)$/.exec(text)?.[1]
    if (open && last && /[-_]$/.test(last)) out.prefixes.add(last)
  }
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) piece(n.text, /[-_]$/.test(n.text))
    else if (ts.isTemplateExpression(n)) {
      piece(n.head.text, true)
      n.templateSpans.forEach(s => piece(s.literal.text, !ts.isTemplateTail(s.literal)))
    }
    ts.forEachChild(n, visit)
  }
  visit(sourceOf(p))
  return out
}

/** The literal class tokens of every `className` a `.tsx` writes: its strings, the branches of a condition, the
 *  pieces of a template and of an array that is joined. A call's arguments (`buttonClass({ variant })`) are not
 *  class names, and a word glued to an interpolation (`tl-${s}`) is only a prefix. */
function classNameTokens(p: string): string[] {
  const out: string[] = []
  const piece = (text: string, glued: { before: boolean; after: boolean }) => {
    const ws = words(text)
    if (ws.length === 0) return
    const first = /^\S/.test(text) && glued.before ? 1 : 0
    const last = /\S$/.test(text) && glued.after ? ws.length - 1 : ws.length
    out.push(...ws.slice(first, last))
  }
  const expr = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) piece(n.text, { before: false, after: false })
    else if (ts.isTemplateExpression(n)) {
      piece(n.head.text, { before: false, after: true })
      n.templateSpans.forEach(s => { expr(s.expression); piece(s.literal.text, { before: true, after: !ts.isTemplateTail(s.literal) }) })
    } else if (ts.isConditionalExpression(n)) { expr(n.whenTrue); expr(n.whenFalse) }
    else if (ts.isBinaryExpression(n)) { expr(n.left); expr(n.right) }
    else if (ts.isParenthesizedExpression(n) || ts.isJsxExpression(n)) { if (n.expression) expr(n.expression) }
    else if (ts.isArrayLiteralExpression(n)) n.elements.forEach(expr)
    else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ['join', 'filter'].includes(n.expression.name.text)) expr(n.expression.expression)
  }
  const visit = (n: ts.Node) => {
    if (ts.isJsxAttribute(n) && n.name.getText() === 'className' && n.initializer) expr(n.initializer)
    ts.forEachChild(n, visit)
  }
  visit(sourceOf(p))
  return out
}

/** Classes drawn by a library, not by us: React Flow puts these on its own elements, and map.css scopes them. */
const LIBRARY_DRAWN = ['react-flow__']
/** Class names that are hooks, not looks: no sheet draws them, and each is read by a library or found by a test or a
 *  module. A new one is a decision made here, with its reason. */
const HOOKS = new Set([
  'nodrag', 'nopan', 'nowheel', // React Flow: a node's control that must not start a drag, a pan or a zoom
  // Found by tests (C10 review: listed, so a new test-only hook is a decision): each names a part its parent draws
  'band-ro',         // the read-only band among the bands (ReadOnly.test, ClaimHandle.test, e2e claim)
  'smark-word',      // a status mark's word, beside its shape (states.test, PreparedTx.test, RuleStatus.test, Proposal.test)
  'door-pool',       // one grant pool's card on the door (DoorPage.test)
  'from',            // the from mark in a meta line (Record.test, NewRecord.test, collection.test, treasury.test)
  'ff-t',            // a fund flow's label text in the SVG (FundFlow.test)
  'ptx-brief',       // the prepared card's brief form (PreparedTx.test, groups/Gov.test)
  'ptx-total-w',     // the words of the prepared card's total (PreparedTx.test)
  'prow-restricted', // a proposal row that changes a restricted collection (gov.test)
  'need-ctx',        // a need's context line (needs.view.test)
  'kcard-fact',      // a board card's fact (board.test)
  'thread-panel',    // the comment thread drawn as a panel, not a sheet (workspace.test)
  'lib-card-src',    // a library card's source (EntryCard.test)
  'lib-row-n',       // a library preview row's name (EntryPreview.test)
  'evt',             // one event in a proposal's event list (EventLog.test, PartsPage.test, groups/Gov.test)
  'rst-tally',       // a rule status's tally line (RuleStatus.test)
  'rst-clock',       // a rule status's window clock (RuleStatus.test)
])

describe('nothing is left on 0.6’s look (C10)', () => {
  it('design.css holds only @import lines: every rule lives in its group’s sheet', () => {
    const lines = read(join(DESIGN, 'design.css')).split('\n').filter(l => l.trim() !== '')
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.filter(l => !/^@import '\.\/css\/[a-z-]+\.css';$/.test(l))).toEqual([])
  })

  it('every class a group sheet draws is named by some module that ships (a dead rule fails)', () => {
    const strings = SHIPPED.map(stringsOf)
    const used = new Set(strings.flatMap(s => [...s.words]))
    const prefixes = [...new Set(strings.flatMap(s => [...s.prefixes]))]
    const sheets = [...walk(join(DESIGN, 'css')), join(DESIGN, 'base.css'), join(DESIGN, 'design.css')]
    const dead = sheets.flatMap(f => [...selectorClasses(read(f))]
      .filter(c => !used.has(c) && !prefixes.some(p => c.startsWith(p)) && !LIBRARY_DRAWN.some(p => c.startsWith(p)))
      .map(c => `${rel(f)} .${c}`))
    expect(dead).toEqual([])
  })

  it('every class an element names is drawn by some sheet, or is a hook on the commented list', () => {
    const drawn = new Set(SHEETS.flatMap(f => [...selectorClasses(read(f))]))
    const undrawn = SHIPPED.filter(p => p.endsWith('.tsx'))
      .flatMap(p => [...new Set(classNameTokens(p))].filter(t => !drawn.has(t) && !HOOKS.has(t)).map(t => `${rel(p)} ${t}`))
    expect(undrawn).toEqual([])
  })

  /** 0.6's primitives the house retired, and the exports that went with them. */
  const GONE_FILES = ['design/KindLabel.tsx', 'design/NavIcon.tsx', 'design/MapNode.tsx', 'map/MapCanvas.tsx', 'SkinPicker.tsx']
  const GONE_EXPORTS: Array<[file: string, name: string]> = [
    ['design/Empty.tsx', 'Absent'], ['design/Shell.tsx', 'NavItem'], ['design/Shell.tsx', 'NavGroup'],
    ['parts/Card.tsx', 'Density'], ['parts/Card.tsx', 'footer'],
  ]
  it('no file imports a retired primitive, and the retired exports are gone', () => {
    for (const f of GONE_FILES) expect(existsSync(join(SRC, f)), f).toBe(false)
    const reach = ALL.filter(p => /\.tsx?$/.test(p)).flatMap(p => {
      const text = read(p)
      const specs = [...text.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map(m => m[1]!)
      return specs.filter(s => GONE_FILES.some(g => s.endsWith(`/${g.replace(/\.tsx$/, '')}`) || s.endsWith(`/${g}`))).map(s => `${rel(p)} → ${s}`)
    })
    expect(reach).toEqual([])
    for (const [file, name] of GONE_EXPORTS) {
      expect(read(join(SRC, file)), `${file} still exports ${name}`).not.toMatch(new RegExp(`export (function|const|type|interface|\\{[^}]*)\\s*\\b${name}\\b`))
    }
    // a card is drawn at one density now, the record's fields (spec §14.2): no caller asks for another
    expect(read(join(SRC, 'parts/Card.tsx'))).not.toMatch(/density/)
  })

  it('role="alert" is only the compose canvas’s refused connection and the tray’s failed Apply and Propose (§13)', () => {
    const alerts = SHIPPED.filter(p => p.endsWith('.tsx')).flatMap(p => {
      const found: string[] = []
      const visit = (n: ts.Node) => {
        if (ts.isJsxAttribute(n) && n.name.getText() === 'role' && n.initializer && /alert/.test(n.initializer.getText())) found.push(rel(p))
        if (ts.isPropertyAssignment(n) && n.name.getText().replace(/['"]/g, '') === 'role' && /alert/.test(n.initializer.getText())) found.push(rel(p))
        if (ts.isVariableDeclaration(n) && /role/i.test(n.name.getText()) && n.initializer && /'alert'/.test(n.initializer.getText())) found.push(rel(p))
        ts.forEachChild(n, visit)
      }
      visit(sourceOf(p))
      return found
    })
    expect([...new Set(alerts)].sort()).toEqual(['changes/ProposePanel.tsx', 'changes/Tray.tsx', 'elements/compose/ComposeCanvas.tsx'])
    // the tray's one alert is its failed Apply: a staged list it could not read is a note, said where it stands
    const tray = read(join(SRC, 'changes/Tray.tsx'))
    expect(tray.match(/role="alert"/g)).toHaveLength(1)
    expect(tray).toMatch(/const notice = failure && \(\s*<div className="tray-why" role="alert">/)
  })
})
