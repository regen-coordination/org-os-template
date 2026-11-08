# The Hub's one image (L9 spec §6, Task 17). Built from the framework's root, from a tagged commit:
#
#   docker build -f deploy/hub/Dockerfile --build-arg NODE_BASE_DIGEST=<sha256 hex of node:22-bookworm-slim> -t org-os-hub .
#
# The base is pinned by digest, and the digest has no default: a build that names none fails instead of taking
# whatever the tag points at today. Pick a node:22-bookworm-slim at 22.13 or later (the private store uses
# node:sqlite) and pass its digest; the server checks the version again at start (carry 4).
#
# No VOLUME line: the platform mounts the data volume (some refuse a VOLUME instruction). The folders the Hub writes
# are set by ORG_OS_PRIVATE_DIR, ORG_OS_BACKUP_DIR, ORG_OS_DOOR_DIR and ORG_OS_ADMIN_HOME (defaults under /srv), and
# the instance by `hub ... --repo` (default /srv/instance). See env.example and RAILWAY.md.
ARG NODE_BASE_DIGEST

# Build stage: the admin package's dependencies, exactly as locked, and the members' app. (The door's bundles join
# here once the door command exists: Task 14.)
FROM node:22-bookworm-slim@sha256:${NODE_BASE_DIGEST} AS build
WORKDIR /build
COPY package.json ./
COPY schemas/ schemas/
COPY scripts/ scripts/
WORKDIR /build/packages/admin
COPY packages/admin/package.json packages/admin/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY packages/admin/ ./
RUN npm run build

# Runtime: git and ssh for the instance's clone, a user that is not root, and the server run with tsx as today.
FROM node:22-bookworm-slim@sha256:${NODE_BASE_DIGEST}
RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN groupadd --gid 10001 hub \
 && useradd --uid 10001 --gid hub --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin hub
WORKDIR /opt/org-os
COPY --from=build /build/package.json ./
COPY --from=build /build/schemas/ schemas/
COPY --from=build /build/scripts/ scripts/
COPY --from=build /build/packages/admin/ packages/admin/
# Hosted by default; the proxy in front sets the client's address (ORG_OS_TRUST_PROXY); the deploy key and the backup
# public key are read-only files the platform provides (GIT_SSH_COMMAND names the key; override it to where yours is).
ENV ORG_OS_HOSTED=1 \
    ORG_OS_TRUST_PROXY=on \
    ORG_OS_ADMIN_HOME=/srv/state \
    GIT_SSH_COMMAND="ssh -i /run/secrets/deploy_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/run/secrets/known_hosts"
USER hub
WORKDIR /opt/org-os/packages/admin
EXPOSE 4680
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4680)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["node", "node_modules/.bin/tsx", "scripts/hub.ts"]
CMD ["serve"]
