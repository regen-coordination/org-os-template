# @org-os/rad

The Radicle driver for `@org-os/host`. Reads go through the `radicle-httpd`
JSON API (v6.1.0); writes go through the `rad` CLI and fail loudly (a
`WriteUnavailableError`) when `rad` is missing or the local node is down —
never a silent HTTP fallback. Registers itself as the `radicle` host driver.

## rad-bootstrap

Zero → live self-owned org-os on Radicle (no GitHub):

    node bootstrap/cli.mjs ./my-org --name my-org --private --seed https://my-node.example

Then run your seed node (see `seed-node/README.md`) so your repos stay available.
