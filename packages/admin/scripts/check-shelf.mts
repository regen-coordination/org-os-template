// Check a library shelf the way the Hub serves it (DAO-OS L7 §5.5): every entry against the framework's
// entry.schema.json, its placeholders, its wizard, and its id against the framework's shelf. Prints one problem per
// line and exits 1, or a one-line summary and exits 0. Writes nothing.
//
//   From this package:        node --import tsx scripts/check-shelf.mts <shelf directory>
//   From another repository:  npm --prefix "$ORG_OS_FRAMEWORK/packages/admin" run --silent check:shelf -- <shelf directory>
//
// The second form is how the dao-os repository runs it (its `npm run check:shelf`): npm runs the script in this
// package, so `--import tsx` resolves the framework's own tsx, and nothing needs installing where the shelf lives. A
// relative shelf directory is read from where the command was run (npm's INIT_CWD), not from this package.
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { loadEntries, loadShelf } from '../server/library/read.ts'

const arg = process.argv[2]
if (!arg) {
  console.log('Name the shelf directory: check-shelf <dir>.')
  process.exit(1)
}
const dir = isAbsolute(arg) ? arg : resolve(process.env.INIT_CWD ?? process.cwd(), arg)
if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  console.log(`${arg}: there is no such directory.`)
  process.exit(1)
}
const shelf = loadShelf(dir, new Set(loadEntries().map(e => e.id)))
if (shelf.problems.length > 0) {
  for (const p of shelf.problems) console.log(p.sentence.replaceAll(dir, arg))
  process.exit(1)
}
console.log(`${arg}: ${shelf.entries.length === 1 ? '1 entry' : `${shelf.entries.length} entries`}, no problems.`)
