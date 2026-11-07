// The allowlist scan of server/git.ts (P2 spec §3.15, "How the vocabulary is held").
//
// It parses the module with the TypeScript compiler API and its type checker, and reports every
// place where the module could run a git command that is not on the list: an import outside a fixed
// set, a subcommand or flag nobody listed, a client method nobody listed (also behind an alias, a
// destructuring or an element access, because the checker reads the type), an option that changes
// the binary, and anything that would blind the scan (`any`, `@ts-ignore`).

import ts from 'typescript'

export interface ScanRules {
  /** Subcommand → the exact flags it may carry. `--version` is the one key that begins with a dash. */
  allowed: Record<string, readonly string[]>
  /** The `SimpleGit` methods the module may call. */
  clientMethods: readonly string[]
  /** Module specifiers the module may import. */
  imports: readonly string[]
  /** The `unsafe` categories of simple-git a client may be built with, each `true` (L5 §6.4: the environment's own). */
  unsafe: readonly string[]
  /** The variables `.env` may set beside a spread of `process.env`, and nothing else (L5 §6.4: a commit's ident). */
  env: readonly string[]
}

const PROPOSAL_REF = /^refs\/heads\/proposal\/p-\d{4}-\d{2}-\d{2}-\d{3}-[0-9a-f]{4}$/
const HEX40 = /^[0-9a-f]{40}$/
const FORBIDDEN_COMMENT = /@ts-(ignore|expect-error|nocheck)/

/** A program over `files`, with the compiler options git.ts is built with. */
export function programFor(files: string[]): ts.Program {
  return ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true, noEmit: true, skipLibCheck: true, types: ['node'], allowImportingTsExtensions: true, allowJs: true,
  })
}

const isStringLiteral = (n: ts.Node): n is ts.StringLiteral => ts.isStringLiteral(n)
/** The text a literal element starts with, or null when it is not a literal at all (an identifier,
 *  a call, a spread): the run-time check reads those. */
function headOf(n: ts.Expression): string | null {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text
  if (ts.isTemplateExpression(n)) return n.head.text
  return null
}

export function scanVocabulary(program: ts.Program, file: string, rules: ScanRules): string[] {
  const sf = program.getSourceFile(file)
  if (!sf) throw new Error(`the program does not hold ${file}`)
  const checker = program.getTypeChecker()
  const found: string[] = []
  const at = (node: ts.Node, why: string) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
    found.push(`line ${line + 1}: ${why}`)
  }
  const isClient = (expr: ts.Expression): boolean => {
    const t = checker.getTypeAtLocation(expr)
    return t.symbol?.name === 'SimpleGit' || checker.typeToString(t) === 'SimpleGit'
  }
  const stringArray = (expr: ts.Expression): boolean => checker.typeToString(checker.getTypeAtLocation(expr)) === 'string[]'

  /** The elements of an argv after the subcommand: flags held to the subcommand's list, `--` ends them. */
  function checkArgs(sub: string, elements: readonly ts.Expression[]) {
    const flags = rules.allowed[sub] ?? []
    let afterDashes = false
    elements.forEach((el, i) => {
      if (ts.isSpreadElement(el)) return
      const head = headOf(el)
      if (head === null) return
      const whole = isStringLiteral(el) || ts.isNoSubstitutionTemplateLiteral(el)
      if (whole && head === '--') { afterDashes = true; return }
      if (!afterDashes && (head.startsWith('-') || head.startsWith('+')) && !(whole && flags.includes(head))) {
        at(el, `"${head}" is not a flag ${sub} may carry`)
      }
      if (sub === 'worktree' && i === 0 && whole && head !== 'add' && head !== 'remove') at(el, `worktree ${head} is not allowed (add and remove only)`)
      if (sub === 'update-ref' && whole && !PROPOSAL_REF.test(head) && !HEX40.test(head)) {
        at(el, 'update-ref takes refs/heads/proposal/<id> and two 40-hex values, nothing else')
      }
    })
  }

  /** An argv written out as an array: the subcommand must be a plain literal that is a key. */
  function checkArgv(arr: ts.ArrayLiteralExpression) {
    const [first, ...rest] = arr.elements
    if (first === undefined) { at(arr, 'an empty argv'); return }
    if (!isStringLiteral(first)) { at(first, 'the subcommand is not a plain string literal'); return }
    if (!Object.hasOwn(rules.allowed, first.text)) { at(first, `"${first.text}" is not a subcommand on the list`); return }
    checkArgs(first.text, rest)
  }

  /** simple-git's `unsafe`: an object literal whose every property is a listed category set to `true`. */
  function checkUnsafe(value: ts.Expression) {
    if (!ts.isObjectLiteralExpression(value)) { at(value, 'unsafe must be an object literal'); return }
    for (const p of value.properties) {
      const name = ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null
      if (name === null || !rules.unsafe.includes(name)) at(p, `unsafe "${name ?? 'spread'}" is not a category of the environment's own that the list allows`)
      else if (!ts.isPropertyAssignment(p) || p.initializer.kind !== ts.SyntaxKind.TrueKeyword) at(p, `unsafe "${name}" must be true, written out`)
    }
  }

  /** `.env`'s object: one spread of `process.env` and the listed variables, each once. */
  function checkEnv(obj: ts.ObjectLiteralExpression) {
    const seen = new Set<string>()
    let spread = 0
    for (const p of obj.properties) {
      if (ts.isSpreadAssignment(p)) {
        spread++
        if (p.expression.getText(sf) !== 'process.env') at(p, '.env spreads process.env and nothing else')
        continue
      }
      const name = ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null
      if (name === null || !rules.env.includes(name)) at(p, `.env may not set "${name ?? 'a computed name'}"`)
      else if (seen.has(name)) at(p, `.env sets "${name}" twice`)
      if (name !== null) seen.add(name)
    }
    if (spread !== 1) at(obj, '.env must spread process.env exactly once, so the call keeps the environment every other call has')
  }

  const insideRun = (node: ts.Node): boolean => {
    for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
      if (ts.isFunctionDeclaration(p) && p.name?.text === 'run') return true
    }
    return false
  }

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const spec = node.moduleSpecifier
      if (spec && ts.isStringLiteral(spec) && !rules.imports.includes(spec.text)) at(spec, `imports "${spec.text}", which is not on the list`)
    }
    if (ts.isImportEqualsDeclaration(node)) at(node, 'import = require is not allowed')
    if (node.kind === ts.SyntaxKind.AnyKeyword) at(node, 'the any keyword hides what a value is')

    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (callee.kind === ts.SyntaxKind.ImportKeyword) at(node, 'a dynamic import() is not allowed')
      if (ts.isIdentifier(callee) && callee.text === 'require') at(node, 'require() is not allowed')

      if (ts.isIdentifier(callee) && callee.text === 'simpleGit') {
        const opts = node.arguments[1]
        if (opts !== undefined) {
          if (!ts.isObjectLiteralExpression(opts)) at(opts, 'simpleGit options must be an object literal')
          else for (const p of opts.properties) {
            const name = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null
            if (!ts.isSpreadAssignment(p) && name === 'unsafe' && ts.isPropertyAssignment(p)) { checkUnsafe(p.initializer); continue }
            if (ts.isSpreadAssignment(p) || name !== 'errors') at(p, `simpleGit option "${name ?? 'spread'}" is not allowed (errors, and unsafe for the environment's own categories, only)`)
          }
        }
      }

      if (ts.isIdentifier(callee) && callee.text === 'run') {
        const [sub, args] = node.arguments
        if (!sub || !isStringLiteral(sub)) at(node, 'run() takes a plain string literal as its subcommand')
        else if (!Object.hasOwn(rules.allowed, sub.text)) at(sub, `"${sub.text}" is not a subcommand on the list`)
        else if (args !== undefined && ts.isArrayLiteralExpression(args)) checkArgs(sub.text, args.elements)
        // Anything else (a variable) is checked when it runs.
      }

      if (ts.isPropertyAccessExpression(callee) && isClient(callee.expression)) {
        const name = callee.name.text
        const [a0, a1] = node.arguments
        switch (name) {
          case 'add':
            if (node.arguments.length !== 1) at(node, '.add takes one argument')
            else if (a0 !== undefined) {
              // simple-git puts these on the command line as they are: `add -f ign.txt` adds an ignored file.
              const parts = ts.isArrayLiteralExpression(a0) ? [...a0.elements] : [a0]
              for (const part of parts) {
                const head = headOf(part)
                if (head !== null && (head.startsWith('-') || head.startsWith('+'))) at(part, `.add takes paths, and "${head}" is an option`)
              }
            }
            break
          case 'commit':
            if (node.arguments.length !== 2) at(node, '.commit takes exactly the message and the paths')
            else if (!(a1 && (ts.isArrayLiteralExpression(a1) || (ts.isIdentifier(a1) && stringArray(a1))))) at(node, '.commit paths must be an array literal or an identifier of type string[]')
            break
          case 'status':
            if (node.arguments.length > 1) at(node, '.status takes none or [\'--\', ...paths]')
            else if (a0 !== undefined) {
              const ok = ts.isArrayLiteralExpression(a0) && a0.elements.length >= 1 && ts.isStringLiteral(a0.elements[0]!) && (a0.elements[0] as ts.StringLiteral).text === '--'
                && a0.elements.slice(1).every(e => ts.isSpreadElement(e))
              if (!ok) at(a0, '.status takes none or [\'--\', ...paths]')
            }
            break
          case 'env':
            if (node.arguments.length !== 1 || !a0 || !ts.isObjectLiteralExpression(a0)) at(node, '.env takes one object literal: { ...process.env } and the ident variables')
            else checkEnv(a0)
            break
          case 'getConfig':
            if (node.arguments.length !== 1 || !a0 || !isStringLiteral(a0)) at(node, '.getConfig takes one string literal')
            break
          case 'revparse':
            if (!a0 || !ts.isArrayLiteralExpression(a0)) at(node, '.revparse takes an array written out')
            else checkArgs('rev-parse', a0.elements)
            break
          case 'raw':
            if (a0 && ts.isIdentifier(a0) && a0.text === 'argv' && insideRun(node)) break // the one choke point
            if (!a0 || !ts.isArrayLiteralExpression(a0)) at(node, '.raw is called only by run(), or with an array written out')
            else checkArgv(a0)
            break
          default:
            break
        }
      }
    }

    if (ts.isPropertyAccessExpression(node) && isClient(node.expression) && !rules.clientMethods.includes(node.name.text)) {
      at(node.name, `the client method ".${node.name.text}" is not on the list`)
    }
    if (ts.isElementAccessExpression(node) && isClient(node.expression)) at(node, 'element access on the git client is not allowed')
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && isClient(node.initializer)) {
      at(node, 'destructuring the git client is not allowed')
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  if (FORBIDDEN_COMMENT.test(sf.text)) found.push('the file carries @ts-ignore, @ts-expect-error or @ts-nocheck')
  return found
}
