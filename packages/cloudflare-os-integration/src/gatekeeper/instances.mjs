// ── Instance registry validation ────────────────────────────────────────────
// An "instance" entry is one org-os deployment the gatekeeper is allowed to
// read from — an allowlist, not a discovery mechanism. `id` is the name a
// capability caller uses to select an instance (e.g. `get_page({ instance:
// "org-os", ... })`); `owner`/`repo` are interpolated directly into GitHub
// API URLs by `GitHubSubstrate`, so they must be validated here rather than
// trusted at the point of use. Each field:
//
//   id     — caller-facing name, must match /^[a-z0-9][a-z0-9-]*$/ and be
//            unique across the list.
//   owner  — GitHub org/user that owns the repo. Non-empty string.
//   repo   — GitHub repo name. Non-empty string.
//   ref    — git ref (branch, tag, or sha) to read from. Defaults to "main".
//   trust  — informational only for the read-only pilot; no capability
//            currently branches on it and no enum is enforced here. M3 will
//            define what values mean once writes exist — don't build that
//            model prematurely. Must be a string if present. Defaults to
//            "read".
//
// `validateInstances` runs once, at Worker startup (Task 12's
// `createGatekeeper`), so a misconfigured deployment fails loudly here
// instead of producing confusing per-request errors later. It throws a plain
// `Error` on any violation — this is a config-validation failure, not a
// `SubstrateError` (reserved for substrate `NOT_FOUND`/`UPSTREAM` failures,
// see `memory-substrate.mjs`), so it deliberately isn't one.

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function validateInstances(instances) {
  if (!Array.isArray(instances)) {
    throw new Error(`instances config must be an array, got ${typeof instances}`);
  }

  const seenIds = new Set();
  const out = [];

  instances.forEach((entry, index) => {
    const { id, owner, repo, ref = "main", trust = "read" } = entry ?? {};

    if (typeof id !== "string" || !ID_PATTERN.test(id)) {
      throw new Error(`instances[${index}]: id must match ${ID_PATTERN}, got ${JSON.stringify(id)}`);
    }
    if (typeof owner !== "string" || owner === "") {
      throw new Error(`instances[${index}] (id: "${id}"): owner must be a non-empty string, got ${JSON.stringify(owner)}`);
    }
    if (typeof repo !== "string" || repo === "") {
      throw new Error(`instances[${index}] (id: "${id}"): repo must be a non-empty string, got ${JSON.stringify(repo)}`);
    }
    if (typeof trust !== "string") {
      throw new Error(`instances[${index}] (id: "${id}"): trust must be a string, got ${JSON.stringify(trust)}`);
    }
    if (seenIds.has(id)) {
      throw new Error(`instances[${index}]: duplicate id "${id}"`);
    }
    seenIds.add(id);

    out.push({ id, owner, repo, ref, trust });
  });

  return out;
}
