# org-os seed node

Run your org's home node in one container. Requirements: a Linux host with ~1-2 GB RAM,
10 GB disk, a public static IP/DNS name, and port 8776 reachable.

    cp .env.example .env    # set RAD_ALIAS + RAD_PASSPHRASE
    docker compose up -d    # node (8776) + read-only httpd API (8080)

High-threat / no-trusted-seed setup:

    docker compose -f compose.yml -f compose.tor.yml up -d

See `seeding-policy.md` for what to seed and the honest privacy framing. This node is
your org's sovereignty anchor — the federation may run a convenience mirror for public
content, but your private repos live only where you replicate them.
