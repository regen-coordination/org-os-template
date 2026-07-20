# The org's sovereignty anchor: a radicle-node + radicle-httpd read gateway.
# Runs on any small Linux host (1-2 GB RAM, 10 GB disk, a public static IP, port 8776).
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

# Install Radicle (rad, radicle-node, radicle-httpd).
RUN curl -sSf https://radicle.dev/install | sh
ENV PATH="/root/.radicle/bin:${PATH}"

# The node's peer-to-peer port (gossip).
EXPOSE 8776
# The read-only HTTP JSON API gateway.
EXPOSE 8080

# An identity must be provisioned on first run (rad auth). rad reads the passphrase
# from RAD_PASSPHRASE in the environment directly — no --stdin here-string, since
# debian's /bin/sh is dash and rejects `<<<`. Then the node runs in the foreground.
CMD ["sh", "-c", "rad auth --alias \"${RAD_ALIAS:-org-seed}\" || true; rad node start --foreground"]
