// The Hub's words (rulings Q66, G-4): the product is the Hub in everything a person reads. Every .ts and .tsx under
// app/src that is not a test (the /parts groups and the test fixtures included) is parsed, and no JSX text and no
// string literal may say "house", in any case, except as a code name: the skin id, a plain string literal that is exactly
// 'house' (nothing else, not "House", not JSX text, not a template piece), a `house:`
// event name, a `data-skin="house"` selector, a HOUSE_* identifier, a file or folder name (`skins/house.css`,
// `fixtures/house/`), a class name, and an import path. Comments are code, and not read. The server's sentences in
// server/systems/ are held by their own drivers' tests.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const SRC = fileURLToPath(new URL('../', import.meta.url))

/** Code names a literal may hold: each is taken out before the word is looked for. */
const CODE_NAMES: RegExp[] = [
  /\bhouse:[a-z][a-z-]*/gi, // DOM events: house:open-keymap
  /data-skin=["']?house["']?/gi, // the skin's selector
  /\bHOUSE_[A-Z_]+\b/g, // identifiers named in a string
  /[\w./-]*\bhouse[\w-]*\.(?:css|tsx?|mjs|json|webp|png|db)\b(?:\?raw)?/gi, // a file: skins/house.css, house.db
  /[\w./-]*\bfixtures\/house\b\/?/gi, /\bhouse-record\b\/?/gi, // folders
]
const WORD = /house/i

/** The literals and JSX texts of one source that say "house" outside a code name, as `line: text`. */
function houseWords(source: string, file = 'x.tsx'): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found: string[] = []
  const inClassName = (n: ts.Node): boolean => {
    for (let p: ts.Node | undefined = n.parent; p && !ts.isSourceFile(p); p = p.parent) {
      if (ts.isJsxAttribute(p)) return p.name.getText(sf) === 'className'
      if (ts.isPropertyAssignment(p) && /^(className|class)$/.test(p.name.getText(sf))) return true
    }
    return false
  }
  const isModulePath = (n: ts.Node) => {
    const p = n.parent
    return ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p) || ts.isImportTypeNode(p.parent)
      || (ts.isCallExpression(p) && (p.expression.kind === ts.SyntaxKind.ImportKeyword || p.expression.getText(sf) === 'require'))
  }
  const visit = (n: ts.Node) => {
    let text: string | null = null
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) text = n.text
    else if (ts.isJsxText(n)) text = n.text
    // the skin id is exempt as one thing only: a plain string literal that is exactly `house`, lower case (C12 review
    // I-4); never JSX text, a JSX attribute, a template piece, or "House"
    const skinId = ts.isStringLiteral(n) && n.text === 'house' && !ts.isJsxAttribute(n.parent)
    if (text !== null && WORD.test(text) && !skinId && !isModulePath(n) && !inClassName(n)) {
      const rest = CODE_NAMES.reduce((t, re) => t.replace(re, ' '), text)
      if (WORD.test(rest)) {
        found.push(`${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}: ${text.trim().slice(0, 120)}`)
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return found
}

const walk = (dir: string): string[] => readdirSync(dir).flatMap(e => {
  const p = join(dir, e)
  return statSync(p).isDirectory() ? walk(p) : [p]
})

describe("the Hub's words (Q66)", () => {
  it('finds "House" alone wherever a person reads it: a label, a heading, a template, a JSX attribute (I-4)', () => {
    expect(houseWords(`const skin = { id: 'house', label: 'House' }
      export const H = () => <h2>House</h2>
      const name = \`House \${x}\`; const t = "House"; const j = <code>house</code>; const a = <p title="house">x</p>`)).toEqual([
      '1: House', '2: House', '3: House', '3: House', '3: house', '3: house',
    ])
  })

  it('finds the word in a sentence, a label, a template and JSX text (the scan can fail)', () => {
    expect(houseWords(`const a = 'the house never signs'; const b = \`In the house: \${n}\`
      export const C = () => <p aria-label="House map">Welcome to the House</p>`)).toEqual([
      '1: the house never signs', '1: In the house:', '2: House map', '2: Welcome to the House',
    ])
  })

  it('passes code names: the skin id, events, selectors, identifiers, files, folders, classes and imports', () => {
    expect(houseWords(`import x from './skins/house.css?raw'
      import { y } from '../test/fixtures/house/org.ts'
      const skin = { id: 'house', label: 'Hub' }; const nodeTypes = { house: N }; const t = { type: 'house' }
      window.dispatchEvent(new Event('house:open-keymap')); const css = ':root[data-skin="house"] {'
      const ids = 'HOUSE_SECTIONS'; const rec = 'docs/design/house-record/'
      export const C = () => <div className="house-plate"><code>{'house'}</code></div>
      const lazy = () => import('./house-thing.ts')`)).toEqual([])
  })

  it('no file under app/src a person reads from says "house"', () => {
    const files = walk(SRC).filter(f => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith('.d.ts'))
    expect(files.length).toBeGreaterThan(200)
    expect(files.some(f => f.includes(`${join('parts', 'groups')}`))).toBe(true)
    const hits = files.flatMap(f => houseWords(readFileSync(f, 'utf8'), f).map(h => `${f.slice(SRC.length)}:${h}`))
    expect(hits).toEqual([])
  })
})
