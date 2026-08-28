# Adopting multica for an org-os instance

Runbook for Phases 0–1 of `docs/superpowers/specs/2026-07-24-multica-org-os-integration-design.md`.
Fill in the `<...>` fields as you go — this file is the reproducible record.

**Pilot instance:** the org-os framework repo
(`/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os`).
Everything here generalizes to any other instance by swapping that path.

## Machine state as checked 2026-08-01

| Thing | State | Action needed |
|---|---|---|
| Docker Desktop | installed at `/Applications/Docker.app` | started; daemon healthy |
| Port 3000 | **taken** by a `next-server` dev process from `refi-dao-os/commons` | remap multica's frontend (step 2) |
| Port 8080 | free | — |
| Agent CLIs on PATH | `claude`, `opencode`, `hermes`, `cursor-agent` | none — the daemon registers a runtime for each |
| Homebrew | present | used for the CLI install |

---

## Step 0 — Start Docker

```bash
open -a Docker
until docker info >/dev/null 2>&1; do sleep 2; done && echo "docker: ready"
```

First launch may prompt for an admin password and to accept the license. If `docker`
still isn't found afterwards, add Docker's bin dir to PATH:
`export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"`.

## Step 1 — Install the CLI and provision the server

```bash
brew install multica-ai/tap/multica          # CLI only
git clone https://github.com/multica-ai/multica.git ~/src/multica
cd ~/src/multica
```

(The one-liner `curl … install.sh | bash -s -- --with-server` does both at once, but
cloning first lets you set the ports below *before* anything binds.)

## Step 2 — Configure ports before first boot

Multica's frontend binds `127.0.0.1:${FRONTEND_PORT:-3000}:3000`, which collides with
the running `refi-dao-os/commons` dev server. Remap it:

```bash
cd ~/src/multica
cp .env.example .env
cat >> .env <<'EOF'
FRONTEND_PORT=3100
FRONTEND_ORIGIN=http://localhost:3100
BACKEND_PORT=8080
EOF
```

Generate a real `JWT_SECRET` in `.env` (`openssl rand -hex 32`) — the default is
`change-me-in-production`. Optionally set `RESEND_API_KEY` for email login codes; without
it, the code is printed in the backend logs (step 4).

Multica will then live at **http://localhost:3100**.

## Step 3 — Start the stack

```bash
cd ~/src/multica && make selfhost
docker compose -f docker-compose.selfhost.yml ps
```

Expected: `postgres`, `backend`, `frontend` all healthy/running. If the GHCR tag isn't
published yet, use `make selfhost-build` to build from the checkout instead.

## Step 4 — Log in

Open http://localhost:3100 and request a login code. Without Resend configured, read it
from the backend logs:

```bash
docker compose -f ~/src/multica/docker-compose.selfhost.yml logs backend | grep -i code | tail -5
```

## Step 5 — Point the CLI at the self-hosted server and start the daemon

```bash
multica setup self-host      # configure + authenticate + start daemon
multica daemon status
```

Expected: daemon running, with runtimes registered for `claude`, `opencode`, `hermes`,
`cursor-agent`. Detected 2026-08-02: `claude`, `opencode`, `hermes`, `cursor`, `openclaw`.

## Step 6 — Vanilla smoke test (before org-os is involved)

In the UI: create a scratch issue in the default workspace, assign it to a `claude`-runtime
agent, watch it run in a throwaway workdir. Any trivial prompt works
("create hello.txt containing hi").

**Do not continue until this passes.** It separates "multica is broken" from
"our integration is broken."

Result: `<fill>`

## Step 7 — Install the git hooks on this machine

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os"
npm run install:hooks
ls -l "$(git rev-parse --git-path hooks)/pre-push"
```

The `pre-push` guard that stops the agent publishing `agent/*` branches is only live where
it has been installed — unlike `.claude/settings.json`, which applies the moment it's
checked out. Being present in git is necessary but **not** sufficient.

## Step 8 — Wire the org-os workspace, agent, and project

All three are UI operations (`multica agent list` lists but does not create). Record the
exact screens/fields you used so this is reproducible elsewhere.

1. **Workspace** — create `org-os`. Then:
   `multica workspace switch org-os && multica workspace get`
2. **Agent** — name `org-os operator`, runtime `claude`, and paste the **entire contents**
   of `packages/multica-bridge/personas/org-os-operator.md` into the instructions field.
   That file is the source of truth: when it changes, re-paste. Skip skill imports — org-os
   skills already ship inside the repo the agent works in.
3. **Project** — title `org-os pilot`, with a **`local_directory`** resource pointing at
   `/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os`, pinned to this
   Mac's daemon. If the resource lives under a differently-named UI control
   ("repository" / "directory"), note where you actually found it: `<fill>`

Then record the identifiers:

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os/packages/multica-bridge"
cp config.example.yaml config.yaml
multica project list --output json     # copy the org-os pilot project id into config.yaml
```

Set `multica.baseUrl` to `http://localhost:3100` and `instance.path` to the repo path.
`config.yaml` is gitignored — confirm with `git status --short -- config.yaml` (silent = good).

## Step 9 — SAFETY GATE: verify session rooting

**Do this before any real issue runs.** The entire safety model — the `.claude/settings.json`
deny rules *and* the `PreToolUse` guard — only loads when the Claude session's project
directory **is** this repo. If multica's `local_directory` binding roots the agent above it
(e.g. at the parent vault), nothing is enforced and the agent can destroy untracked notes.

Assign the operator an issue whose entire content is:

> Run exactly this and report the output verbatim: `git -c core.pager=cat stash list`

- **Expected:** the operator reports being **blocked by the vault-safety guard**.
- **If it returns stash contents instead: STOP.** The binding is rooted wrong. Do not run
  any further operator issue until fixed.

Result: `<fill>`

Why this exact command: it is read-only, so the model has no independent reason to refuse
it — a refusal can therefore only come from the enforcement layer. A destructive probe
proves nothing, because the model declines on CLAUDE.md grounds before the Bash call is
ever attempted.

## Step 10 — End-to-end smoke issue

```bash
multica issue create \
  --title "Pilot smoke: record the multica integration idea" \
  --description "In data/ideas.yaml, add one idea titled 'Multica × org-os integration pilot' (status: developing), matching the existing entry format exactly. Follow your session discipline end to end: agent branch, schema regen if needed, memory entry, commit, report." \
  --assignee "org-os operator" \
  --project "<project-id>"
```

Then verify the operator actually obeyed its discipline:

```bash
cd "/Users/luizfernando/Desktop/Workspaces/Zettelkasten/03 Libraries/org-os"
git branch --list 'agent/*'                        # expect agent/<KEY>
git show "agent/<KEY>" --stat                      # ideas.yaml + memory/<date>.md (+ .well-known/* if regenerated)
git status --short                                 # tree NOT left dirty
git push origin "agent/<KEY>"                      # MUST be refused by the pre-push hook
```

The refused push is a success condition, not a failure.

Then review and merge by hand:

```bash
git checkout feat/multica-operator
git merge --no-ff "agent/<KEY>" -m "merge(agent/<KEY>): pilot smoke via multica operator"
git branch -d "agent/<KEY>"
```

Result: `<fill>`

---

## Operating it day to day

- **Create work** in the multica UI or via `multica issue create --assignee "org-os operator"`.
- **Everything lands on `agent/<issue-key>` branches** and is merged by a human. The agent
  cannot push.
- **External actions** (comms, publishing, financial) come back as drafts in the issue
  result — the persona forbids sending.
- **When the persona changes**, re-paste it into the agent's instructions; the file is
  canonical, the UI copy is a mirror.

## Adding a second instance later

Repeat steps 7–9 inside that instance: `npm run install:hooks`, copy `.claude/settings.json`
and `scripts/guards/deny-destructive-git.mjs` over, create a workspace + `local_directory`
project for it, and re-run the step 9 safety gate there. One multica workspace per org-os
instance keeps issue namespaces clean.

## Known limitations

- The pre-push hook is client-side and best-effort: an agent with shell access could remove
  it or repoint `core.hooksPath`. The real trust boundary is that a human merges `agent/*`
  branches locally.
- The `PreToolUse` guard matches command strings; it does not catch indirection through a
  script file, obfuscation, or destructive equivalents outside its scope
  (`git checkout -- .`, `git restore .`, `rm -rf`). It targets accidents, not adversaries.
- Multica's daemon may invoke `claude` with its own flags; step 9 is what proves our
  settings still apply under multica's actual invocation, not just under a plain shell.


---

# Live run record — 2026-08-02

Everything below was executed, not planned. Multica **0.4.16**, self-hosted,
frontend on **http://localhost:3100** (3000 was taken by an unrelated
`refi-dao-os/commons` dev server), backend on 8080, Postgres pgvector:pg17.

## What deviated from the runbook

- **Homebrew install failed** — it wanted a `sudo` reinstall of the Xcode
  Command Line Tools. The `install.sh` script fetches a prebuilt darwin/arm64
  binary instead; set `MULTICA_BIN_DIR=$HOME/.local/bin` to skip `sudo` entirely.
- **Login is scriptable.** `POST /auth/send-code` then `POST /auth/verify-code`
  (note: **no** `/api` prefix on the auth routes). Without Resend the code is
  printed to the backend log. `send-code` is rate-limited — don't loop it.
  Then `POST /api/tokens` with the returned JWT mints a `mul_...` PAT for
  `multica login --token`.
- `MULTICA_DEV_VERIFICATION_CODE` does **not** work out of the box: the compose
  file defaults `APP_ENV=production`, and the dev-code path is disabled in
  production. Not worth weakening; the log-printed code works.
- `multica login` blocks on "waiting for workspace creation" when no workspace
  exists. Create the workspace first via `POST /api/workspaces`.
- **Issues do not dispatch on assignment.** An issue sits in `todo` until it is
  moved to `in_progress` (`multica issue status <id> in_progress`).
- Agents are created via `POST /api/agents` with `runtime_id` from
  `GET /api/runtimes` — the UI is not required for any of this.

## Safety gate — PASSED (ORG-2)

The operator, running under multica's own invocation, reported verbatim:

> BLOCKED by the org-os vault-safety guard
> (`scripts/guards/deny-destructive-git.mjs`): destructive git operation:
> `stash` ... refused command: `git -c core.pager=cat stash list; echo ...`

It also confirmed that `-c core.pager=cat` and `;`-chaining do not bypass it.
The daemon log independently shows `workdir=".../03 Libraries/org-os"` — the
session is rooted AT the repo, so `.claude/settings.json` and the guard load.

## Smoke — PASSED on the second attempt (ORG-4)

Branch `agent/ORG-4`, commit `feat(ideas): record Multica x org-os integration
pilot [ORG-4]`, 3 files: `data/ideas.yaml`, regenerated `.well-known/ideas.json`,
`memory/2026-08-02.md`. Pushing `agent/ORG-4` to a throwaway remote was refused
by the pre-push hook, as designed.

## Two defects the live run exposed (both now fixed in the persona)

1. **The operator escaped its own guard.** Told to "create it from an up-to-date
   trunk — pull first", it reasoned *"Branches diverged significantly (5 vs 155).
   I'll use a worktree off `origin/main`"* and created a worktree at
   `03 Libraries/org-os-ORG-3` — a **sibling path inside the vault**, with no
   `.claude/settings.json` and no guard script, because that old `origin/main`
   history predates them. On this repo `origin/main` is a thin upstream template
   155 commits behind. Fixed: the persona now forbids `git worktree add` and any
   work outside its directory, and forbids branching from `origin/main` or
   pulling. Worktree and branch were removed; nothing was lost.

2. **A shared working copy leaks branch state.** The operator left the repo
   checked out on `agent/ORG-4`; a concurrent session in the same directory then
   committed unrelated work (`ca79192`, a philosophy-manifesto design) onto the
   agent branch. Fixed: step 7 now requires restoring the branch that was
   checked out on entry. Note this is inherent to `local_directory` — multica's
   path mutex serializes *its own* tasks, not other humans or agents using the
   directory.

## Failure modes seen (transient, not integration bugs)

`API Error: Stream idle timeout` and `Unable to connect to API
(ConnectionRefused)` both killed runs mid-task. The daemon reports these as
`blocked / agent_error.*` and the repo was left clean each time.
