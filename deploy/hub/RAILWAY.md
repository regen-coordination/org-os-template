# The Hub on Railway

How the image in `deploy/hub/Dockerfile` runs on Railway, a container service with a persistent volume, where
Railway's proxy terminates TLS. This is the trimmed Task 17 of the L9 plan (ruling R-T17-1). A deployment on
your own server adds a `Caddyfile` and a `compose.yaml` later; the full runbooks are Task 18's, in `docs/hosting/`.

Every value below is a placeholder (`hub.example.org`, `/srv/...`). No account, project or service id belongs in
this repository.

## What runs

- **Build.** Railway builds `deploy/hub/Dockerfile` from the repository root (set the service's Dockerfile path to
  it). The base image is pinned by digest through the build argument `NODE_BASE_DIGEST`, which has no default:
  add it as a service variable (Railway passes a variable to a build when the Dockerfile declares it with `ARG`).
  Use the digest of a `node:22-bookworm-slim` at Node 22.13 or later.
- **Start command.** The image's own: `node node_modules/.bin/tsx scripts/hub.ts serve`, that is `hub serve`. It runs
  every start check (`hub check`), then the server, hosted. Leave Railway's start command empty, or set it to that.
- **Port.** Railway sets `PORT`; the Hub listens on it, on `0.0.0.0` (`ORG_OS_BIND`).
- **Health.** `GET /api/health` answers `{"ok":true}` while the server serves with its private store open, and
  `{"ok":false}` with 503 otherwise. The image's `HEALTHCHECK` calls it on `127.0.0.1`.
  Before you set it as Railway's healthcheck path, check which `Host` Railway's healthcheck sends. The hosted guard
  answers only the configured host (`ORG_OS_PUBLIC_ORIGIN`'s) and, for `/api/health` alone, the loopback. A probe
  under any other name is refused with 403, and the deploy would never turn healthy.

## The volume

Railway mounts one volume per service, at a path you choose in the service's settings. Mount it at **`/srv`**.
The Hub's folders are then subfolders of it, which are the defaults (`env.example`):

| Folder | Variable | Holds |
|---|---|---|
| `/srv/instance` | `hub ... --repo` (default) | the instance's clone |
| `/srv/private` | `ORG_OS_PRIVATE_DIR` | the private store (0700) |
| `/srv/backups` | `ORG_OS_BACKUP_DIR` | sealed backups (0700) |
| `/srv/state` | `ORG_OS_ADMIN_HOME` | jobs, layouts, drafts, the pid file |
| `/srv/door` | `ORG_OS_DOOR_DIR` | door releases (later) |

If the volume is mounted elsewhere, set each variable to the folder under that path. The instance is a subfolder,
never the mount itself, because a fresh volume may hold `lost+found` and `hub init` takes only an empty folder.

The image runs as the user `hub` (uid 10001), not root. A volume that Railway mounts owned by root cannot be
written by it. `hub check` says so: "ORG_OS_PRIVATE_DIR cannot be written by the Hub's user." Give the folders to
uid 10001 once, from a shell on the service, before the first `hub serve`. Do not run the image as root to get
around it.

## The deploy key, for a read-only clone

Until writes are turned on (house amendment item 6), the Hub only reads its instance. It needs a **read-only**
deploy key on the instance's repository, and `ORG_OS_PUSH=off`.

Railway has no secret files, so put the key and the known hosts on the volume, readable by `hub` only:

    /srv/secrets/deploy_key      (mode 400, owner 10001)
    /srv/secrets/known_hosts     (the forge's host keys, checked by hand)
    /srv/secrets/backup.pub      (the maintainer's backup public key; not a secret)

Then set:

    GIT_SSH_COMMAND=ssh -i /srv/secrets/deploy_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/srv/secrets/known_hosts
    ORG_OS_BACKUP_PUBLIC_KEY_FILE=/srv/secrets/backup.pub

`hub check` refuses a key that group or others can read. Clone once with
`hub init git@forge.example.org:org/instance.git`, then start with `hub serve`. A key on the volume is in every copy of
the volume. A read-only key limits what a lost copy can do, and it can be revoked at the forge.

The same key keeps the clone current. While writes are off, the Hub fetches the instance at start and every 15 minutes
(`ORG_OS_REFRESH_EVERY`) and moves its trunk forward, fast-forward only. If the clone and the remote diverge, the
refresh stops and the Sources page says so; once they agree again, restart the service.

## The proxy

- Railway terminates TLS and forwards the request with the `Host` the visitor used. Set `ORG_OS_PUBLIC_ORIGIN` to
  the custom domain (`https://hub.example.org`), never the `*.up.railway.app` name, or the guard refuses every
  request.
- `ORG_OS_TRUST_PROXY=on`: the rate limits read the client's address from `X-Real-IP`. Railway's proxy sets the
  `X-Forwarded-*` headers. **Check on staging** that it also sets `X-Real-IP`, and that it replaces a value the
  client sent. If it does not set one, every visitor shares the proxy's address and one bucket. If it passes a
  client's value through, a visitor can choose their own bucket. Either case needs a change before production.
- The Hub writes no client address to its log (Q-L9-7). Railway's own HTTP logs are outside the Hub.

## Backups

The Hub seals its backups to the public key every 6 hours into `/srv/backups` on the same volume. The off-site
copy is a separate job (`hub backup` in a one-off run, then a copy of the sealed file). The runbook for it is
Task 18's. Restore with the service stopped:

    ORG_OS_BACKUP_PRIVATE_KEY_FILE=/path/to/backup.key hub restore /srv/backups/house-<time>.db.enc

Set that variable for that one run only. The server never reads it.
