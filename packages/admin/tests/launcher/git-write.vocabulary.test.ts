import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { LAUNCHER_GIT_VERBS } from '../../launcher/git-write.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
const FILE = join(here, '../../launcher/git-write.ts')
// What the launcher may do, written out here so that adding a verb is an edit of two files.
const EXPECTED_VERBS = ['clone', 'status', 'rev-parse', 'show-ref', 'switch', 'add', 'commit']
// Verbs the launcher must never run. None may appear in its source as a string literal.
const FORBIDDEN = ['push', 'pull', 'fetch', 'reset', 'clean', 'stash', 'checkout', 'rebase', 'merge', 'branch', 'cherry-pick', 'restore', 'rm', 'mv', 'tag', 'remote', 'config', 'gc', 'prune', 'update-ref', 'worktree', 'revert', 'apply', 'am']
const SPAWNERS = /^(spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)$/

/** What is wrong with `text` as the launcher's git module: a forbidden verb, a spawn whose arguments are not the two
 *  protocol options followed by the checked `verb` variable, or an import beyond node:child_process. */
function scan(text: string): string[] {
  const sf = ts.createSourceFile('git-write.ts', text, ts.ScriptTarget.Latest, true)
  const problems: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text !== 'node:child_process') {
      problems.push(`import ${node.moduleSpecifier.text}`)
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) problems.push('dynamic import')
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') problems.push('require')
    if (ts.isStringLiteralLike(node) && FORBIDDEN.includes(node.text)) problems.push(`verb "${node.text}"`)
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && SPAWNERS.test(node.expression.text)) {
      const args = node.arguments[1]
      const fifth = args && ts.isArrayLiteralExpression(args) ? args.elements[4] : undefined
      if (!fifth || !ts.isIdentifier(fifth) || fifth.text !== 'verb') problems.push('a spawn does not pass the checked verb')
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return problems
}

describe('the launcher git vocabulary', () => {
  it('is the list written in this file', () => {
    expect([...LAUNCHER_GIT_VERBS]).toEqual(EXPECTED_VERBS)
  })
  it('passes the real module: no verb off the list appears as a spawn argument', () => {
    expect(scan(readFileSync(FILE, 'utf8'))).toEqual([])
  })
  it('fails a copy with a push planted in the list (the scan can fail)', () => {
    const real = readFileSync(FILE, 'utf8')
    const planted = real.replace("'status', 'rev-parse'", "'status', 'push', 'rev-parse'")
    expect(planted).not.toBe(real)
    expect(scan(planted).join('|')).toMatch(/verb "push"/)
  })
  it('fails a copy that spawns a literal verb', () => {
    const real = readFileSync(FILE, 'utf8')
    const planted = real.replace("'protocol.fd.allow=never', verb,", "'protocol.fd.allow=never', 'status',")
    expect(planted).not.toBe(real)
    expect(scan(planted).join('|')).toMatch(/does not pass the checked verb/)
  })
  it('fails a copy that imports another module', () => {
    const planted = `import { x } from 'simple-git'\n${readFileSync(FILE, 'utf8')}`
    expect(scan(planted).join('|')).toMatch(/import simple-git/)
  })
})
