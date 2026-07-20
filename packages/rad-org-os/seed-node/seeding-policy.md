# Seeding policy — what your node keeps available

Your seed node keeps repositories fetchable while it is online. Control what it seeds:

- `rad seed <RID>` — seed a repo (your own + chosen peers').
- `rad unseed <RID>` — stop seeding.
- Public repos can *additionally* announce to public seeds (`iris.radicle.network`,
  `rosa.radicle.network`, `seed.radicle.xyz`) for reach; your node stays authoritative.

## Privacy — read this honestly

`rad init --private` gives **selective replication**: the repo is invisible and
inaccessible to nodes not on its allow-list. But private repos are **NOT encrypted at rest**
— every allow-listed node, and every delegate, can read the full contents.

- Low-threat community group wanting reliability → self-hosted node (this recipe) or a
  managed node (radicle.garden). Both can hold private repos, both can read them.
- High-threat organizing (the reason sovereignty matters) → use the Tor profile
  (`compose.tor.yml`) so your node is the only replica, and do not add third-party seeds
  to a private repo's allow-list.
