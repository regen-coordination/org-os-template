import { configure } from '@testing-library/react'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The server keeps job records and layouts under ~/.org-os/admin. No test may write there.
process.env.ORG_OS_ADMIN_HOME ??= mkdtempSync(join(tmpdir(), 'admin-state-'))

// Every server a test starts opens the private store (L5 Task 5): in a folder of its own under the temp directory, never
// inside a fixture (where git does not ignore it, and Home would say so), this worktree or the operator's real store,
// whatever the caller's shell sets. A test about the place sets it itself. The backup variables are the caller's machine's: no test backs up into its folders or under its key.
process.env.ORG_OS_PRIVATE_DIR = mkdtempSync(join(tmpdir(), 'admin-private-')) // assigned: never the caller's own store
for (const key of ['ORG_OS_BACKUP_KEY_FILE', 'ORG_OS_BACKUP_DIR', 'ORG_OS_BACKUP_EVERY', 'ORG_OS_BACKUP_KEEP', 'ORG_OS_HOSTED']) delete process.env[key]

// Every git command a test runs (its own, and the server's under test) reads the repository its `cwd` names and nothing
// else: a variable inherited from the caller (a hook exports GIT_DIR and GIT_INDEX_FILE) outranks the cwd and would point
// git at another repository (final review I6). And no global or system configuration: fixtures set user.name and
// user.email in their own repository, and a commit signer, a hook path or a default branch from the caller's machine
// would make the suite depend on it.
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) {
  delete process.env[key]
}
process.env.GIT_CONFIG_GLOBAL = '/dev/null'
process.env.GIT_CONFIG_SYSTEM = '/dev/null'

// Text queries read what is drawn: the page's one polite region (parts/live.tsx, screen-reader only) repeats an error
// note's words since every error note says itself through it (C11 I-1), and a `getByText` would find them twice. Tests
// that read what was said read the region by its test id, or with `heard()`.
configure({ defaultIgnore: 'script, style, [data-testid="live"]' })
