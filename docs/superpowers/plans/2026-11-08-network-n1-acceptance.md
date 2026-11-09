# Network N1 — acceptance record (2026-11-09)

Branch `feat/network`. Counts and states only. Everything ran against temporary copies in a scratch folder. The one
real instance, refi-bcn-os, was read once (`git clone --local`) and never opened, written to or served.

Setup: the admin was built once (`npm run build` in `packages/admin`). The launcher ran directly, on port 4779 (not
the default 4679), with `ORG_OS_LAUNCHER_HOME` and `ORG_OS_ADMIN_HOME` in the scratch folder. Every write request
was sent with `content-type: application/json` and `Origin: http://localhost:4779`.

## 0. Guards

- `POST /api/launcher/create` with `Origin: http://evil.example`: 403.
- `GET /api/launcher/state`: base folder, an empty recent list, and the four doors; the fourth is unavailable with the
  note `Comes with federation.`

## 1. Open

`git clone --local` of refi-bcn-os into the scratch folder, then `POST /api/launcher/open` with that copy.
Result: `{"url":"http://localhost:4680/systems/map?first=1"}`. `doctor.json` was written in the copy's admin state
folder (under `ORG_OS_ADMIN_HOME`): status BLOCKER, 4 blockers, 43 warnings (the instance's own findings; nothing
was repaired). The admin answered 200 on 4680.

## 2. Clone

`POST /api/launcher/clone` with a `file://` address of the copy and a new folder. Result: a URL on port 4681; the
clone holds the same head commit as the copy.

## 3. Create

`POST /api/launcher/create` with a cooperative's answers and a new folder. Result: a URL on port 4682. The new
instance has exactly one commit, `chore: bootstrap from org-os framework (genesis)`.

## 4. Adopt

A scratch repo that isn't org-os: `git init -b main`, a `README.md`, a `package.json`, one commit, clean.

- `POST /api/launcher/adopt/plan`: 346 files to add, kept: `README.md`, `package.json`, none ignored. The repo's
  status stayed empty (nothing written at plan time).
- `POST /api/launcher/adopt/apply`: branch `org-os/adopt`, one commit ("346 added, 2 kept as they were"), then the
  instance opened on port 4683.
- After: the repo is on `org-os/adopt`; `main` is the same commit as before (`299faca`); `shasum -c` of the README
  passed (byte-identical); the working tree was clean.

## 5. Map the rest

In the opened copy (made a member by setting a scratch-only `handles.git` email and `git config user.email`):
`GET /api/systems/map/manifest` offered 7 repo Systems. Three pasted links were run through the page's own
recogniser (`recogniseLines`: 1 repo, 2 links). All 10 were staged with `POST /api/changes/ops`, as the page does.
`GET /api/changes` listed 10 staged ops; the copy's git log had no new commit (staged, not applied).

## 6. The real instance, before and after

`git status --porcelain | shasum` and `git rev-parse HEAD` of refi-bcn-os, taken before the clone and after the
launcher was stopped:

| | status checksum | HEAD |
|---|---|---|
| before | `e7a517228255f2b4ff832d419aee18ff7df6b744` | `8d55df30c38d2b34e69c73d6095903cb90f1df90` |
| after | `e7a517228255f2b4ff832d419aee18ff7df6b744` | `8d55df30c38d2b34e69c73d6095903cb90f1df90` |

Identical. (It already had 3 uncommitted lines of its own before the run, which are part of the checksum.)

## 7. Screenshots (headless Chrome, 1280×900, kept in the scratch folder, not committed)

- `/launch`: the four doors by their labels (Open an instance, Create a new one, Adopt a repo, Join a network); the
  fourth reads "Comes with federation." with a disabled button; the recent list; no console errors.
- `/systems/map?first=1` of the opened copy: "Map the rest", the seven manifest rows ticked, the "One link per line"
  textarea with Recognise, "Stage 7 additions", and the 10 staged changes in the bar. One console error: a 503 from
  `/api/notifications`, because that copy's `.gitignore` lacks `.org-os/private/`; it is that instance's, not N1's.

## 8. Cleanup

The launcher was stopped with SIGTERM; it stopped the four admins it had started. `ps` and `lsof` showed no process
or listener left from this run.

## 9. Full suites (one at a time, through the lock)

- Root `npm test`: 1007 tests, 1007 passed, 0 failed (the clone manifest needed no change).
- Admin `npm --prefix packages/admin test`: first run 7520 passed, 2 skipped, 3 failed: design and accessibility
  guards (`legacy.test.ts`, `liveRegions.test.ts`, `skins.test.ts`) that the launcher and map pages did not satisfy.
  Fixed in the next commit (two classes drawn in the stylesheets, the Launcher's inline styles moved into classes,
  the map page's "Staged" status listed as a live region). Re-run: 500 files passed, 7523 passed, 2 skipped, 0 failed.
- `npm --prefix packages/admin run typecheck`: 0 errors.

Status: green.
