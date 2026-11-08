# Network N1 (opening an instance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person opens their org's instance from the platform in one of three ways, then lists everything else the org runs:
- open an existing instance, from a local folder or a git address;
- create a new one, with the framework's own clone command actually run;
- adopt a repo that isn't org-os, on a new branch, with no file overwritten.

**Architecture:**
- **The launcher.** A new local server in `packages/admin/launcher/`, port 4679, `127.0.0.1` only.
  - It serves the existing app at `/launch`, keeps the recent-instances list, and owns the only new write path.
  - For each instance it opens, it starts one admin server as a child process, because the admin server fixes one repo per process.
  - Its git writes go through their own small locked vocabulary. The instance server's `git.ts` is not touched.
- **Inside an instance.** "Map the rest" (`/systems/map`) recognises pasted links as Systems and stages them through the existing `POST /api/changes/ops`. The Systems page gains read-only facts for mounted repos and a per-row Clone operation.

**Tech Stack:** TypeScript server (Hono, tsx), React app (wouter, existing blocks), Node ESM `.mjs` pure modules with JSDoc, vitest in `packages/admin`, `node --test` at the root.

**Spec:** `docs/superpowers/specs/2026-11-06-org-os-open-and-federate-design.md`. The relevant parts are §3, §4.1–4.3, §5, §9 N1, §11 (operator decisions), and §13 R6–R10, which bind over §5 where they differ.

**Inherited from N0 (its plan said these move here):**
- the one-time import of `repos.manifest.json` entries (Task 7);
- the facts for mounted repos (Task 9).

**Not in N1:**
- "Join a network": its door is shown as coming with federation (R9).
- Federation requests, invites, the portal and hosted mode.

## Global Constraints

- **Nothing is pushed, ever.** No step writes a repo's default branch. Adopt commits only on `org-os/adopt` (R7).
- **The launcher writes only in the places R7 lists:**
  - a new or empty folder;
  - the adopt branch of a clean repo, adding only missing files. Every write uses an exclusive-create flag (`COPYFILE_EXCL` / `wx`), so nothing is ever overwritten;
  - its scratch folders under `os.tmpdir()`;
  - `<launcherHome>/instances.json`, holding paths only;
  - `join(stateDir(repo), 'doctor.json')`.
- **`clone:framework` is never given `--force`,** and never `--dry` on a real create.
- `packages/admin/server/git.ts` and `tests/server/git.vocabulary.test.ts` are unchanged.
- **The launcher refuses to start in hosted mode** (`readHosted(argv, env)` true), with the sentence: `A hosted Hub is one instance. The launcher is for your own machine.`
- **The platform signs nothing and holds no keys** (spec §3 anti-goals).
- **Tests never touch the real `~/.org-os` or any real instance.**
  - `tests/setup.ts` sets `ORG_OS_LAUNCHER_HOME` to a temp folder, as it already does for `ORG_OS_ADMIN_HOME`.
  - Any code that runs git is tested in fresh temp repos only: `makeFixtureRepo()`, or `mkdtemp` + `git init`.
- **Full suites, builds and browser walks run one at a time, through the shared lock:**
  `~/.cache/lf-heavy-run.sh "w5|<pane>|<what>" <command…>`.
  Single test files don't need it.
- **Copy is plain and second person.** The door labels are exactly `Open an instance`, `Create a new one`, `Adopt a repo` and `Join a network`. The fourth door's note is exactly `Comes with federation.`
- **Vocabulary:** instance, System, proposal, operator, portal. Never "surface".
- **Stay off PR A and PR B paths:** no change to `server/session/`, sign-in, or `app/src/portal/`.
- **Commit messages:** `feat(network N1): …` / `fix(network N1): …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A web page in the person's browser posts to `http://127.0.0.1:4679/api/launcher/create`** (cross-site request, DNS rebinding). It must be refused with 403 before any work starts. Test: Task 2, `refuses a foreign Origin or Host`.
2. **A folder typed as `~/x`, as a relative path, or as a symlink to a non-empty folder** must resolve to the real target and be refused when that target isn't empty. Test: Task 1, `follows symlinks and refuses a non-empty target`.
3. **A git address starting with `-`, using `ext::`/`fd::`, containing whitespace, or carrying a token in the URL** must be refused before git runs. Test: Task 1, `gitUrlProblem refuses option, transport and credential tricks`.
4. **Adopt on a repo that has uncommitted or untracked files, is mid-merge or mid-rebase, has no commits, or already has `org-os/adopt`** must be refused with nothing written and the branch unchanged. Test: Task 6, `refuses every unsafe repo state and writes nothing`.
5. **A recent list holding a deleted folder, or an `instances.json` that isn't valid JSON:** the launcher still starts. The entry shows as not found and can be removed, and the next write rewrites the file cleanly. Tests: Task 1, `reads a corrupt list as empty`; Task 2, `lists a missing folder as not found`.

---

### Task 1: Launcher home, folder guards and the launcher's git vocabulary

**Files:**
- Create: `packages/admin/launcher/home.ts`, `packages/admin/launcher/folders.ts`, `packages/admin/launcher/git-write.ts`
- Modify: `packages/admin/tests/setup.ts` (set `ORG_OS_LAUNCHER_HOME` to a fresh temp folder)
- Test: `packages/admin/tests/launcher/home.test.ts`, `folders.test.ts`, `git-write.test.ts`, `git-write.vocabulary.test.ts`

**Interfaces:**
- **Produces, from `home.ts`:**
  - `launcherHome(): string`: `process.env.ORG_OS_LAUNCHER_HOME ?? join(homedir(), '.org-os')`.
  - `readRecent(): string[]`: absolute paths, most recent first. Returns `[]` when the file is missing or unreadable.
  - `remember(path: string): string[]`: moves the path to the front, de-duplicates by `realpathSync` when the path exists, keeps at most 20, and writes atomically (temp file + rename).
  - `forget(path: string): string[]`.
  - File shape: `{ "instances": ["/abs/a", "/abs/b"] }`, nothing else.
- **Produces, from `folders.ts`:**
  - `type FolderState = 'new' | 'empty' | 'not-empty' | 'not-a-folder'`.
  - `resolveFolder(input: string, base: string): string`: trims, expands a leading `~/` (and bare `~`), resolves relative input against `base`, and returns an absolute path. Throws `Error('Say which folder.')` on empty input.
  - `folderState(abs: string): FolderState`: follows symlinks. A missing path is `new`, even when its parents are missing too.
  - `writableFolderProblem(abs: string): string | null`: `null` for `new`/`empty`. Otherwise one of exactly:
    - `` `${abs} already has files in it. Choose a new or empty folder.` ``
    - `` `${abs} is a file, not a folder.` ``
  - `isInstance(abs: string): boolean`: `data/` is a directory and `federation.yaml` is a file.
- **Produces, from `git-write.ts`:**
  - `LAUNCHER_GIT_VERBS = ['clone', 'status', 'rev-parse', 'show-ref', 'switch', 'add', 'commit'] as const`, with type `LauncherVerb`.
  - `gitUrlProblem(url: string): string | null`.
  - `launcherGit(cwd: string, verb: LauncherVerb, args: string[]): Promise<{ code: number; stdout: string; stderr: string }>`.
    - Runs `git -c protocol.ext.allow=never -c protocol.fd.allow=never <verb> …args`, with `GIT_TERMINAL_PROMPT=0`.
    - Throws `Error('git <verb> is not something the launcher does')` for any other verb, checked at run time as well as by type.

- [ ] **Step 1: Write the failing tests.** These assertions, verbatim:

```ts
// home.test.ts
it('keeps paths only, most recent first, at most 20', () => {
  for (let i = 0; i < 25; i++) remember(`/tmp/i${i}`)
  const raw = JSON.parse(readFileSync(join(launcherHome(), 'instances.json'), 'utf8'))
  expect(Object.keys(raw)).toEqual(['instances'])
  expect(raw.instances).toHaveLength(20)
  expect(raw.instances[0]).toBe('/tmp/i24')
})
it('reads a corrupt list as empty', () => {
  writeFileSync(join(launcherHome(), 'instances.json'), '{nope')
  expect(readRecent()).toEqual([])
  expect(remember('/tmp/a')).toEqual(['/tmp/a'])
})
// folders.test.ts
it('follows symlinks and refuses a non-empty target', () => {
  // full = mkdtemp with one file; link = symlink to full
  expect(folderState(link)).toBe('not-empty')
  expect(writableFolderProblem(resolveFolder('link', dirname(link)))).toMatch(/already has files/)
})
it('expands ~ and resolves relative input', () => {
  expect(resolveFolder('~/x', '/base')).toBe(join(homedir(), 'x'))
  expect(resolveFolder('x', '/base')).toBe('/base/x')
})
// git-write.test.ts
it('gitUrlProblem refuses option, transport and credential tricks', () => {
  for (const bad of ['-uhttps://x', 'ext::sh -c id', 'fd::3', 'https://tok@github.com/a/b', 'https://github.com/a b', 'http://github.com/a/b'])
    expect(gitUrlProblem(bad)).not.toBeNull()
  for (const ok of ['https://github.com/a/b', 'https://github.com/a/b.git', 'ssh://git@github.com/a/b', 'git@github.com:a/b.git', 'file:///tmp/x.git'])
    expect(gitUrlProblem(ok)).toBeNull()
})
it('runs only its own verbs', async () => {
  await expect(launcherGit(tmp, 'push' as never, [])).rejects.toThrow(/not something the launcher does/)
})
```

  In `git-write.vocabulary.test.ts`, mirror `tests/server/git.vocabulary.test.ts`. It reads `launcher/git-write.ts` and fails if any git verb outside `LAUNCHER_GIT_VERBS` appears as a spawn argument.

- [ ] **Step 2: Run the tests and confirm they fail.**
  Run: `cd packages/admin && npx vitest run tests/launcher/`. Expected: FAIL, modules not found.
- [ ] **Step 3: Implement the three modules** with the signatures above. `gitUrlProblem` accepts only:
  - `https://host/path` with no userinfo;
  - `ssh://…`;
  - scp form `user@host:path`, where the path doesn't start with `-`;
  - `file:///abs`.

  It refuses anything containing whitespace, `::`, or a leading `-`. Each refusal is one sentence that says what to paste instead.
- [ ] **Step 4: Run the tests and confirm they pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(network N1): launcher home, folder guards and its own git vocabulary`

### Task 2: The launcher server, opening a local instance, and the doctor's findings

**Files:**
- Create: `packages/admin/launcher/serve.ts`, `packages/admin/launcher/index.ts`, `packages/admin/launcher/children.ts`
- Modify:
  - `packages/admin/package.json`: add `"open": "npm run build && tsx launcher/index.ts"`.
  - Root `package.json`: add `"open": "npm --prefix packages/admin run open --"`.
  - `packages/admin/server/resources/adapters/fleet.ts`: the self card's attention.
- Test: `packages/admin/tests/launcher/serve.test.ts`, `packages/admin/tests/resources/fleet-doctor.test.ts`

**Interfaces:**
- **Consumes:**
  - Task 1's modules.
  - From `server/state.ts`: `stateDir(repo)` and `runningServer(repo)`.
  - `readHosted` from `server/serve.ts`.
  - `refusal()` from `server/guard.ts`, if its `Caller` fits. Otherwise write a `launcherRefusal(c)` with the same 403/415 sentences.
- **Produces, from `serve.ts`:**
  - `interface DoctorSummary { status: string; blockers: number; warnings: number; findings: { level: 'WARN' | 'BLOCKER'; code: string; message: string; hint?: string }[] }`
  - `type StartAdmin = (repo: string) => Promise<{ url: string; stop: () => Promise<void> }>`
  - `type Assess = (repo: string) => Promise<DoctorSummary>`
  - `interface LauncherOptions { port: number; frameworkDir: string; appDist?: string; base?: string; hosted?: boolean; startAdmin?: StartAdmin; assess?: Assess }`
  - `startLauncher(opts: LauncherOptions): Promise<{ port: number; app: Hono; close: () => Promise<void> }>`. It throws the Global Constraints' hosted sentence when `hosted` is true.
  - Within the module, `openFlow(repo: string): Promise<{ url: string }>`. Tasks 4–6 reuse it.
- **Routes** (all JSON):
  - `GET /api/launcher/state` returns `{ base, recent: { path, name: string | null, found: boolean, instance: boolean }[], doors: { id: 'open' | 'create' | 'adopt' | 'join'; available: boolean; note?: string }[] }`.
    - `name` comes from the folder's `federation.yaml` identity, read live through `readFederation`. It is never stored.
    - `join` is `available: false, note: 'Comes with federation.'`
    - `base` is `opts.base`, or the parent of the most recent found instance, or `homedir()`.
  - `POST /api/launcher/open {path}` returns one of:
    - 200 `{ url }`, where `url` is the admin URL plus `/systems/map?first=1`;
    - 404 `{ error }` when the path doesn't exist;
    - 409 `{ error, adoptable: true, path }` when it exists but isn't an instance;
    - 409 `{ error }` when `runningServer(repo)` names a process the launcher didn't start: `` `This instance is already open in another window (process ${pid}). Use that window, or stop it first.` ``
  - `DELETE /api/launcher/recent {path}` returns `{ recent }`.
  - Everything else under `/api/` returns 404. The app is served from `appDist` with an SPA fallback, as `serve.ts` does.
- **`openFlow`:**
  1. `assess(repo)`.
  2. Write `join(stateDir(repo), 'doctor.json')` as `{ at, ...summary }`.
  3. `remember(repo)`.
  4. Reuse a child already started for this repo, or call `startAdmin(repo)`.
  5. Return the URL.
- **Defaults** (in `children.ts`):
  - `defaultStartAdmin(frameworkDir)`:
    - Spawns `process.execPath --import tsx <frameworkDir>/packages/admin/server/index.ts --repo <repo> --port <p>`, where `p` is the first free port from 4680 up.
    - Resolves when stdout prints `org-os admin → http://localhost:<p>`, and rejects after 30 s with the child's last stderr lines.
    - `close()` stops every child it started.
  - `defaultAssess(frameworkDir)`:
    - Spawns `node <frameworkDir>/scripts/doctor.mjs assess --dir <repo> --json` and maps its JSON to `DoctorSummary`.
    - Exit code 1 (blockers) is still a result. Exit 2, or output that isn't JSON, gives `{ status: 'unknown', blockers: 0, warnings: 1, findings: [{ level: 'WARN', code: 'doctor-unavailable', message }] }`.
- **`index.ts`:** reads `--port` (default 4679), refuses hosted mode with the sentence, prints `org-os → http://localhost:<port>/launch`, and closes on SIGINT/SIGTERM/SIGHUP the way `server/index.ts` does.
- **`fleet.ts`, self card:** when `doctor.json` exists for this repo and has blockers, the card's attention is `{ level: 'alert', text: 'The doctor found <n> blocker(s) when this instance was opened: <first message>' }`. With warnings only, the level is `warn` and the text says "warning(s)". Existing attention of a higher level is kept.

- [ ] **Step 1: Write the failing tests.** Use `startLauncher({ port: 0, frameworkDir: REAL_REPO, startAdmin: fake, assess: fake })` and `fetch` against it, with `makeFixtureRepo()` instances.

```ts
it('refuses a foreign Origin or Host', async () => {
  expect((await post('/api/launcher/open', { path: repo }, { origin: 'https://evil.example' })).status).toBe(403)
  expect((await post('/api/launcher/open', { path: repo }, { host: 'evil.example:4679' })).status).toBe(403)
  expect(fakeStartAdmin).not.toHaveBeenCalled()
})
it('opens an instance: doctor result saved, remembered, admin started, sent to map the rest', async () => {
  const r = await post('/api/launcher/open', { path: repo })
  expect(await r.json()).toEqual({ url: 'http://localhost:4999/systems/map?first=1' })
  expect(JSON.parse(readFileSync(join(stateDir(repo), 'doctor.json'), 'utf8')).blockers).toBe(0)
  expect(readRecent()[0]).toBe(realpathSync(repo))
})
it('offers adopt for a folder that is not an instance', async () => { /* 409, adoptable: true */ })
it('lists a missing folder as not found', async () => { /* remember('/nope'); state.recent[0] = { path:'/nope', found:false, name:null, instance:false } */ })
it('shows join as coming with federation', async () => { /* doors.find(d => d.id==='join') = { id:'join', available:false, note:'Comes with federation.' } */ })
it('will not start hosted', async () => { await expect(startLauncher({ ...opts, hosted: true })).rejects.toThrow('A hosted Hub is one instance') })
```

  In `fleet-doctor.test.ts`: write a `doctor.json` with 2 blockers into the fixture repo's `stateDir`. The self card's attention is `alert` with text starting `The doctor found 2 blocker(s)`. With no file, the self card is unchanged.

- [ ] **Step 2: Run the tests and confirm they fail.**
  `npx vitest run tests/launcher/serve.test.ts tests/resources/fleet-doctor.test.ts`
- [ ] **Step 3: Implement** `serve.ts`, `children.ts`, `index.ts`, the scripts and the `fleet.ts` change. Bind to `127.0.0.1` and reuse `serve.ts`'s readable-Host wrapper pattern. Requests other than GET must carry `content-type: application/json` and an `Origin` equal to the launcher's own origin.
- [ ] **Step 4: Run the tests and confirm they pass.** Also run `npx vitest run tests/resources/` (fleet) and `npx tsc --noEmit -p .`, gated through the lock.
- [ ] **Step 5: Commit.** `feat(network N1): the launcher — opens an instance, saves the doctor's findings, starts its admin`

### Task 3: The launcher page

**Files:**
- Create: `packages/admin/app/src/launcher/Launcher.tsx`, `packages/admin/app/src/launcher/api.ts`
- Modify: `packages/admin/app/src/App.tsx`. Render `/launch` alone, outside the frame, the way `/portal` is.
- Test: `packages/admin/app/src/launcher/Launcher.test.tsx`, following the conventions of the existing `app/src/**/*.test.tsx`.

**Interfaces:**
- **Consumes:** the Task 2 routes.
- **Produces:** `api.ts` with `launcherState()`, `openInstance(path)` and `forgetRecent(path)`. Tasks 4–6 add their calls here. Each returns the parsed JSON, or throws `Error(body.error)`.
- **Page layout, top to bottom:**
  1. **Recent instances:** name, then path. A row that isn't found is greyed and says `Not found.`, with a `Remove from the list` button.
  2. **The four doors, as cards with exactly the Global Constraints' labels.**
     - "Open an instance" holds a folder field: `The folder it's in`, defaulting to empty, with its placeholder showing `base`.
     - The 409-adoptable answer shows `This folder isn't an org-os instance yet.` and a button `Adopt it`, which opens the Adopt door pre-filled.
     - Create and Adopt are wired in Tasks 5–6. Until then they render disabled.
     - Join is disabled and shows `Comes with federation.`
  3. **On success,** `window.location.assign(url)`.

- [ ] **Step 1: Write the failing tests.** With `api.ts` mocked:
  - renders the recent list and the four labels;
  - a not-found row offers `Remove from the list`, and clicking it calls `forgetRecent`;
  - submitting a folder calls `openInstance` and assigns the URL;
  - a 409-adoptable answer shows `Adopt it`;
  - Join is disabled with `Comes with federation.`
- [ ] **Step 2: Run the tests and confirm they fail.** `npx vitest run app/src/launcher/`
- [ ] **Step 3: Implement** with the existing blocks and design tokens. No new CSS framework.
- [ ] **Step 4: Run the tests and confirm they pass.** Also `npm run build` in `packages/admin`, through the lock.
- [ ] **Step 5: Commit.** `feat(network N1): the launcher page — recent instances and the four ways in`

### Task 4: Open from a git address

**Files:**
- Modify: `packages/admin/launcher/serve.ts`, `packages/admin/app/src/launcher/Launcher.tsx`, `packages/admin/app/src/launcher/api.ts`
- Test: `packages/admin/tests/launcher/clone.test.ts`, plus cases in `Launcher.test.tsx`

**Interfaces:**
- **Consumes:** `gitUrlProblem`, `launcherGit`, `resolveFolder`, `writableFolderProblem`, `isInstance` and `openFlow`.
- **Produces:**
  - `defaultCloneFolder(url: string, base: string): string`: `join(base, <last path segment without .git>)`.
  - `POST /api/launcher/clone {url, folder}` returns one of:
    - 400 `{ error }` from `gitUrlProblem`;
    - 409 `{ error }` from `writableFolderProblem`;
    - 502 `{ error }` with git's last stderr line when the clone fails;
    - the `openFlow` answer for an instance;
    - 409 `{ error, adoptable: true, path }` otherwise.
  - The clone runs `launcherGit(dirname(abs), 'clone', ['--', url, abs])`. A folder the launcher made, which was `new`, is removed after a failed clone. A folder that was already `empty` is left empty.
- **UI:** under the Open door's folder field, `Or paste a git address`. A second field holds the folder, pre-filled from `defaultCloneFolder` and editable.

- [ ] **Step 1: Write the failing tests.** Make the source repos with `git init --bare` plus one pushed commit in temp folders, and use `file://` addresses.
  - It clones an instance-shaped repo and opens it.
  - It clones a plain repo and answers adoptable.
  - It refuses a non-empty target with nothing written.
  - It refuses `ext::` before git runs (spy on `launcherGit`).
  - A failed clone into a new folder leaves no folder behind.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(network N1): open an instance from a git address, cloned into a new or empty folder`

### Task 5: Create a new instance, actually run

**Files:**
- Modify:
  - `packages/admin/launcher/serve.ts`
  - `packages/admin/lib/open-instance.mjs`: `defaultFolder` takes an optional `base`.
  - `packages/admin/app/src/wizards/OpenInstance.tsx`: an optional `run` prop.
  - `packages/admin/app/src/launcher/Launcher.tsx`, `api.ts`
  - `packages/admin/wizards/open-instance.yaml`: the header comment only. It says the launcher runs the command, and that the wizard inside an instance still shows it.
- Test: `packages/admin/tests/launcher/create.test.ts`, `packages/admin/tests/lib/open-instance.test.ts` (extend), `packages/admin/app/src/wizards/OpenInstance.test.tsx` (create, or extend if it exists)

**Interfaces:**
- **Consumes:** `orgProblem`, `youProblem`, `cloneConfigText` and `openFlow`.
- **Produces:**
  - `defaultFolder(name: string, base?: string): string`. Without `base`, unchanged (`../<slug>`). With `base`, `` `${base}/${slug}` ``.
  - `GET /api/launcher/wizard` returns the `open-instance` wizard definition, through `readWizardFile`/`loadWizards`.
  - `POST /api/launcher/create {answers}` returns one of:
    - 400 `{ error }` from `orgProblem ?? youProblem`;
    - 409 from `writableFolderProblem`;
    - 500 `{ error, log }` when the command fails, with `log` holding the last 20 lines;
    - the `openFlow` answer.
  - The create writes the config to a `mkdtemp` file. It spawns `process.execPath <frameworkDir>/scripts/clone-framework.mjs --target <abs> --config <file>`, never `--force` or `--dry`, and removes the temp config afterwards.
  - `OpenInstance` gains `run?: (answers: Answers) => Promise<{ url: string } | { error: string }>`. With `run`:
    - the start step is skipped (`start = 'open'`);
    - drafts are neither loaded nor saved;
    - the folder defaults to `defaultFolder(name, base)`;
    - the review's action is `Create it`, and it calls `run`.

    Without `run`, the component is unchanged: it shows `Copy the command`.

- [ ] **Step 1: Write the failing tests.**
  - It creates into a new temp folder, and the folder then holds `federation.yaml`, `data/` and a git commit.
  - It refuses a non-empty folder, and the folder is unchanged.
  - Invalid answers return 400 with `orgProblem`'s sentence.
  - The spawned arguments never include `--force` (spy on the spawn).
  - `defaultFolder('Alder Commons', '/w')` is `'/w/alder-commons'`, and `defaultFolder('Alder Commons')` is still `'../alder-commons'`.
  - The component, with `run` mocked, shows `Create it` and calls `run` with the answers. Without `run`, it still shows `Copy the command`.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.** Wire the Create door to `OpenInstance` with `run` set to `createInstance`.
- [ ] **Step 4: Run the tests and confirm they pass.** Also run the existing `tests/lib/open-instance.test.ts`. It must stay green, and its dry-run check stays as it is.
- [ ] **Step 5: Commit.** `feat(network N1): create a new instance from the launcher — clone:framework actually run`

### Task 6: Adopt a repo on a branch, never overwriting

**Files:**
- Create: `packages/admin/launcher/adopt.ts`, `packages/admin/app/src/launcher/Adopt.tsx`
- Modify: `packages/admin/launcher/serve.ts`, `packages/admin/app/src/launcher/Launcher.tsx`, `api.ts`
- Test: `packages/admin/tests/launcher/adopt.test.ts`, `packages/admin/app/src/launcher/Adopt.test.tsx`

**Interfaces:**
- **Consumes:** `launcherGit`, `isInstance`, `openFlow`, the create path's config and spawn (factor a shared `scaffold(answers, target)` out of Task 5), and `OpenInstance` with `run`.
- **Produces, from `adopt.ts`:**
  - `ADOPT_BRANCH = 'org-os/adopt'`.
  - `adoptProblem(dir: string): Promise<string | null>`. It gives one sentence each for:
    - not a git repo's top level;
    - already an instance (`This is already an org-os instance. Open it instead.`);
    - no commits yet;
    - uncommitted or untracked files;
    - a merge or rebase in progress (`MERGE_HEAD`, `rebase-merge`, `rebase-apply`);
    - `refs/heads/org-os/adopt` already exists.
  - `interface AdoptPlan { id: string; dir: string; add: string[]; kept: string[]; scratch: string }`. `add` and `kept` are POSIX paths relative to the repo, sorted.
  - `planAdopt(dir: string, answers: Answers, frameworkDir: string): Promise<AdoptPlan>`.
    - Runs the scaffold with `--no-git` into `join(scratch, 'scaffold')`.
    - A scaffold file goes to `add` when nothing exists at that path in `dir` (`lstat`). Otherwise it goes to `kept`, and that includes a path whose parent is a file in `dir`.
  - `applyAdopt(plan: AdoptPlan): Promise<{ branch: string; commit: string; added: number; kept: number }>`. It:
    1. runs `adoptProblem` again;
    2. runs `switch -c org-os/adopt`;
    3. copies each `add` path with `mkdirSync(parent, {recursive})` and `copyFileSync(src, dst, constants.COPYFILE_EXCL)`, keeping the source's mode;
    4. runs `add -- <paths>`;
    5. commits with the message `chore(org-os): adopt — add the org-os files (<added> added, <kept> kept as they were)`, using the repo's own git identity;
    6. removes `scratch`.

    On an `EEXIST` it stops and throws, naming the path. The files already copied stay uncommitted on `org-os/adopt`, and the sentence says so.
- **Routes:** plans are held in memory by `id`. They expire after 30 minutes, and their scratch is removed on expiry and on `close()`.
  - `POST /api/launcher/adopt/plan {path, answers}` returns 409 `{ error }` from `adoptProblem`, or `{ planId, add, kept }`.
  - `POST /api/launcher/adopt/apply {planId}` returns `{ ...openFlow answer, branch }`, or 409/410 `{ error }`.
- **UI (`Adopt.tsx`):**
  1. A folder field.
  2. `OpenInstance` with `run` set to `adoptPlan`. The folder is preset to the repo and its field hidden.
  3. A review that lists every `add` path under `These files will be added on a new branch, org-os/adopt:` and every `kept` path under `Your repo already has these. They stay exactly as they are:`. The button is `Add them on org-os/adopt`, and the line under it is `Your default branch isn't touched. Merging is up to you.`

- [ ] **Step 1: Write the failing tests.** Each in a fresh temp repo with one commit holding `README.md`, `package.json` and `.gitignore`.

```ts
it('adds only what is missing, on org-os/adopt, and the default branch is untouched', async () => {
  const before = await headOf(dir, 'main'); const readme = readFileSync(join(dir, 'README.md'))
  const plan = await planAdopt(dir, answers, REAL_REPO)
  expect(plan.kept).toEqual(expect.arrayContaining(['README.md', 'package.json', '.gitignore']))
  expect(plan.add).toEqual(expect.arrayContaining(['federation.yaml']))
  const r = await applyAdopt(plan)
  expect(r.branch).toBe('org-os/adopt')
  expect(await headOf(dir, 'main')).toBe(before)
  expect(readFileSync(join(dir, 'README.md'))).toEqual(readme)
  expect(isInstance(dir)).toBe(true)
  expect(existsSync(plan.scratch)).toBe(false)
})
it('refuses every unsafe repo state and writes nothing', async () => {
  // one fresh repo per case: untracked file, modified file, MERGE_HEAD present, no commits, org-os/adopt exists, already an instance
  // each: adoptProblem(dir) is a sentence; POST /adopt/plan answers 409; `git status --porcelain` and `git branch` unchanged
})
it('stops on a file that appeared after planning, naming it', async () => { /* create federation.yaml after planAdopt; applyAdopt rejects with /federation.yaml/ */ })
```

  In `Adopt.test.tsx`: the review lists both groups with the exact headings, and the button reads `Add them on org-os/adopt`.

- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.** Wire the Adopt door, including the `Adopt it` hand-off from Tasks 3–4.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(network N1): adopt a repo — missing org-os files added on org-os/adopt, nothing overwritten`

### Task 7: "Map the rest": recognising links, and the manifest import

**Files:**
- Create: `packages/admin/lib/systems-recognise.mjs`, `packages/admin/server/systems/map-routes.ts`
- Modify: `packages/admin/server/serve.ts`, to mount the routes in `extend` beside `mountWizards`
- Test: `packages/admin/tests/lib/systems-recognise.test.ts`, `packages/admin/tests/systems/map-routes.test.ts`

**Interfaces:**
- **Consumes:** `sameAddress` from `lib/federation/peers.mjs`, and `deriveManifest`'s entry shape `{ name, url, branch }` under `baseDirectory`.
- **Produces, from `systems-recognise.mjs`:**
  - `recogniseLink(line: string)`: `null` for a blank line or one starting with `#`. Otherwise `{ ok: true, system }`, or `{ ok: true, githubOwner }`, or `{ ok: false, line, error }`. The first rule that matches wins:

| Input | Result |
|---|---|
| `https://github.com/<o>/<r>[.git][/…]` | `{ kind: 'repo', name: r, url: 'https://github.com/<o>/<r>' }` |
| `https://github.com/<o>[/]` | `{ githubOwner: o }` |
| `https://snapshot.box/#/s:<space>`, `https://snapshot.org/#/<space>` | `{ kind: 'snapshot-space', name: space, space }` |
| `<prefix>:0x<40 hex>`, alone or as `safe=` in an `app.safe.global` URL | `{ kind: 'safe', name: 'Safe <short>', chain, address }`. Prefixes: `eth`→`eip155:1`, `oeth`→`eip155:10`, `gno`→`eip155:100`, `matic`→`eip155:137`, `arb1`→`eip155:42161`, `base`→`eip155:8453`, `celo`→`eip155:42220`, `sep`→`eip155:11155111` |
| a bare `0x<40 hex>` | error `Say which chain, like celo:0x… or eth:0x….` |
| `notion.so`, `notion.site`, `docs.google.com/document`, `drive.google.com` | `{ kind: 'docs', name: <host's product + first path segment>, url }` |
| `docs.google.com/spreadsheets`, `airtable.com` | `{ kind: 'database', … }` |
| any other `https://` | `{ kind: 'link', name: <hostname>, url }` |
| `http://…` | error `Use the https address.` |
| anything else | error `Not a link this page knows. Paste a web address, a GitHub repo or organization, or a Safe as chain:0x….` |

  - `systemIdFor(name: string, taken: Set<string>): string`: a lower-case slug, with `-2`, `-3`… when the id is taken.
  - `recogniseLines(text: string, existing: object[]): { rows: { line: string; system: object; duplicateOf: string | null }[]; owners: string[]; errors: { line: string; error: string }[] }`. A duplicate of an existing System or of an earlier row carries the existing id in `duplicateOf`. Duplicates are found by `sameAddress` for repos, the same `url` for links and docs, the same `chain`+`address` for Safes, and the same `space` for Snapshot spaces.
  - `githubRepoSystems(list: { name: string; url: string; archived: boolean; fork: boolean; description?: string }[], existing: object[]): object[]`: repo Systems. `purpose` is `'archive'` when archived and `'fork'` when a fork. An item already listed is left out.
  - `manifestImports(manifest: object | null, systems: object[]): object[]`: for each `repositories[]` entry that no repo System matches by url (`sameAddress`) or by `mount === `${baseDirectory}/${name}``, it returns `{ id, kind: 'repo', name, url: <without .git>, mount: `${baseDirectory ?? 'repos'}/${name}`, branch: <only when not 'main'> }`.
- **Produces, from `map-routes.ts`:** `mountSystemsMap(app: Hono, deps: { repo: string; fetch: FetchLike }): void`. Both routes are read-only and stage nothing; the page stages.
  - `GET /api/systems/map/manifest` returns `{ imports }`.
  - `GET /api/systems/map/github/:owner` returns `{ repos, more: boolean }`.
    - The owner must match `^[A-Za-z0-9-]{1,39}$`, otherwise 400.
    - It fetches `https://api.github.com/users/<owner>/repos?per_page=100&type=owner&sort=pushed`. That works for organizations and people alike.
    - `more` is true when 100 came back.
    - A failed fetch gives 502 `{ error: 'GitHub didn't answer for <owner>. Try again, or paste the repos one per line.' }`.

- [ ] **Step 1: Write the failing tests.**
  - One case per table row, using the exact values above.
  - `recogniseLines` marks a repeat of an existing System's URL with its id, and marks a line pasted twice, with `ssh` and `https` forms of the same repo, as a duplicate.
  - `manifestImports` against the framework's real `repos.manifest.json` returns one System per entry when `systems` is `[]`, and `[]` once those Systems are given back to it.
  - The GitHub route uses an injected `fetch` and never touches the network under vitest. It covers the owner pattern, the `more` flag and the 502 sentence.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(network N1): map the rest — links recognised as Systems, GitHub owners listed, manifest entries offered`

### Task 8: The "Map the rest" page

**Files:**
- Create: `packages/admin/app/src/pages/MapTheRest.tsx`
- Modify:
  - `packages/admin/app/src/App.tsx`: put `/systems/map` before `/systems` in the `<Switch>`.
  - `packages/admin/app/src/pages/Systems.tsx`: a `Map the rest` link in its header.
  - `packages/admin/app/src/api.ts`: `mapManifest()` and `mapGithub(owner)`.
- Test: `packages/admin/app/src/pages/MapTheRest.test.tsx`

**Interfaces:**
- **Consumes:**
  - `recogniseLines`, `githubRepoSystems` and `manifestImports` (the page imports the lib, as `OpenInstance.tsx` does).
  - The Task 7 routes.
  - The existing `api.stage(ops)` and the existing systems list hook (`useSystems` in `blocks/systems.tsx`).
- **Page:**
  1. With `?first=1`, it opens with `Opened. Now list everything else the org runs: repos, docs, accounts, Safes.`
  2. **"Already in repos.manifest.json":** the `manifestImports` rows, ticked by default.
  3. **A textarea, `One link per line`, and a button `Recognise`.**
  4. **A table:** a tick, the kind, the name (editable), the link, and a status.
     - The status is `New`, or `Already listed as <id>` (unticked and disabled), or the error sentence.
     - Each GitHub owner gets a sub-list from `mapGithub`, with every repo unticked. When `more` is true, it shows `Showing the first 100.`
     - Each repo row has an unticked checkbox: `Clone into repos/<name> later`. Ticking it sets `mount: 'repos/<name>'`. It never clones (R10).
     - Each repo row has an optional `Purpose` select with the eight values.
  5. **A button, `Stage <n> additions`.** It calls `api.stage(ticked.map(s => ({ op: 'create', record: `systems:${s.id}`, value: s })))`.
     - On success it shows `Staged. Review them in Changes.`, with a link to `/changes`.
     - On error it shows the server's sentence as it comes, including the actor 401/403.

- [ ] **Step 1: Write the failing tests.** With `api` mocked:
  - pasting three lines (one repo, one duplicate, one bad) renders three statuses;
  - manifest rows render ticked;
  - a GitHub owner line lists repos unticked;
  - ticking `Clone into repos/x later` puts `mount: 'repos/x'` in the staged value;
  - `Stage 2 additions` calls `api.stage` with exactly two `create` ops;
  - a 403 shows the server's sentence.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.** Also run `npm run build`, through the lock.
- [ ] **Step 5: Commit.** `feat(network N1): the map-the-rest page — paste, recognise, tick, stage`

### Task 9: Mounted repos on the Systems page, and Clone on a row

**Files:**
- Create: `packages/admin/lib/git-status-v2.mjs`
- Modify:
  - `packages/admin/server/resources/adapters/systems.ts`: the `mount` facts.
  - `packages/admin/server/operations/catalogue.ts`: the `system.clone` operation.
  - The Systems row view in `packages/admin/app/src/blocks/systems.tsx`: one line of mount facts.
- Test: `packages/admin/tests/lib/git-status-v2.test.ts`, `packages/admin/tests/resources/systems-mount.test.ts`, `packages/admin/tests/operations/system-clone.test.ts` (or the existing operations test folder)

**Interfaces:**
- **Consumes:** `gitUrlProblem` from `launcher/git-write.ts`, and the adapter's existing `ctx.run`.
- **Produces:**
  - `parseStatusV2(text: string): { branch: string | null; ahead: number | null; behind: number | null; dirty: boolean }`, from `git status --porcelain=v2 --branch` output.
    - It reads `# branch.head <name>` (`(detached)` gives `null`) and `# branch.ab +A -B` (when absent, both are `null`).
    - Any line not starting with `#` sets `dirty`.
  - The `facts.mount` of a repo System that has `mount`:
    - `{ path, cloned: true, branch, ahead, behind, dirty }` when `<repo>/<mount>/.git` exists, read with `git -C <abs> status --porcelain=v2 --branch`. It never fetches.
    - `{ path, cloned: false }` otherwise.
  - **Row line:** `On <branch> · <a> ahead · <b> behind · uncommitted work` (leave out the parts that are zero or null), or `Not cloned yet.`
  - **The `system.clone` operation:** `kinds: [<the systems adapter's kind>]`, `effect: 'changes'`, `network: true`, `refreshes: 'records'`.
    - `unavailable` gives one sentence each for:
      - not a repo;
      - no `mount`;
      - a mount not under `repos/`: `Clone works for mounts under repos/, which the instance ignores in git.`;
      - already there (the folder exists and isn't empty);
      - no url, or a `gitUrlProblem`.
    - `plan` gives `{ cmd: 'git', args: ['-c', 'protocol.ext.allow=never', 'clone', '--branch', branch ?? 'main', '--', url, join(repo, mount)], writes: [mount] }`.

- [ ] **Step 1: Write the failing tests.**
  - `parseStatusV2`: a clean tracked branch, ahead 2 / behind 1, detached, no upstream, and one untracked line.
  - The adapter: a fixture instance whose `systems.yaml` mounts `repos/site`, where `repos/site` is a fresh temp git repo with one modified file. The facts are `cloned: true, dirty: true`. A second System with an unmounted path gives `cloned: false`.
  - The operation: `unavailable` gives each sentence, and `plan` gives the exact args.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit.** `feat(network N1): mounted repos show branch, ahead/behind and uncommitted work; clone one from its row`

### Task 10: Docs, acceptance and full suites

**Files:**
- Create: `docs/OPENING.md`, `docs/superpowers/plans/2026-11-08-network-n1-acceptance.md`
- Modify:
  - `README.md`: one line for `npm run open`.
  - `docs/ADOPT-WITH-AN-AGENT.md`: a note at the top saying that `npm run open` now does create and adopt in the platform.
  - `packages/admin/README.md`: the launcher, in one paragraph.

**Interfaces:**
- **Consumes:** everything above.

- [ ] **Step 1: Write `docs/OPENING.md`.** It covers:
  - the launcher and its port;
  - the four ways in, and why Join comes with federation;
  - R7's write path, listed exactly;
  - what adopt keeps and where it commits;
  - "Map the rest" and Clone on a row.

  At most 120 lines. Plain words.
- [ ] **Step 2: Acceptance, against temp copies only.** Start the launcher with `ORG_OS_LAUNCHER_HOME` and `ORG_OS_ADMIN_HOME` pointing at scratch folders. Drive the routes with `curl`, using the launcher's own Origin.
  1. **Open:** `git clone --local` a real instance (refi-bcn-os) into scratch, then open the copy. The doctor's summary is saved, and the admin answers on its port.
  2. **Clone:** clone the same copy through `/api/launcher/clone` with a `file://` address.
  3. **Create:** create a new instance into a new scratch folder. It has a genesis commit.
  4. **Adopt:** adopt a scratch repo that isn't org-os, with a README and a package.json. It ends on `org-os/adopt`, its default branch head is unchanged, and the README is byte-identical.
  5. **Map the rest:** in the opened copy, stage three pasted links and the manifest imports through `/api/changes/ops`, as the page would.

  Afterwards, check that the real instance's `git status` and HEAD are identical to before. Record each step's command and result in the acceptance file, naming only the instances listed in the N0 acceptance record.
- [ ] **Step 3: Take headless screenshots of `/launch` and `/systems/map`** (playwright-core with the installed Chrome) through the lock, saved under scratch and referenced, not committed.
- [ ] **Step 4: Run the full suites, one at a time, through the lock.**
  - Root: `~/.cache/lf-heavy-run.sh "w5|<pane>|n1 root" npm test`.
  - Admin: `~/.cache/lf-heavy-run.sh "w5|<pane>|n1 admin" npm --prefix packages/admin test`.
  - Then: `~/.cache/lf-heavy-run.sh "w5|<pane>|n1 tsc" npm --prefix packages/admin run typecheck`.
  - Expected: green, apart from the load-timeout flakes the N0 record names. Re-run a failing file alone to tell them apart.
- [ ] **Step 5: Commit.** `docs(network N1): opening guide and acceptance — temp copies only, suites green`
