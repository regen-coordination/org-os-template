import yaml from 'js-yaml';

// Pure genesis-file content generators for a Radicle-first org-os instance.
// The operator's canonical id IS their did:key (identity sovereignty tracks hosting
// sovereignty, per the spec); a github handle is an optional alias for reach.
export function buildMembersYaml({ did, alias, github } = {}) {
  const member = { id: did, alias };
  if (github) member.handles = { github };
  return yaml.dump({ members: [member] });
}

export function buildFederationYaml({ rid, seed, name, threshold = 1 } = {}) {
  return yaml.dump({
    identity: { name, type: 'LocalNode', rid },
    network: 'radicle',
    platforms: { canonical: 'radicle', seed_node: seed, deployment: 'radicle-node' },
    agent: { runtime: 'open-model', workspace: '.' },
    governance: { proposal_threshold: threshold, decision_model: 'delegate-quorum' },
    peers: [],
    metadata: { framework_version: '0.5' },
  });
}

export function buildGenesisStamp({ commit, now } = {}) {
  return { created: now, genesis_commit: commit, last_sync_commit: null };
}
