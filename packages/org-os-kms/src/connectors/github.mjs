// src/connectors/github.mjs — REAL connector. GitHub as a knowledge source. pull shells out
// to the `gh` CLI (already a workspace dependency — no token wrangling); map is pure.
// Cursor = the highest issue/discussion updatedAt seen (ISO string), so pulls are incremental.
import { execFileSync } from 'node:child_process';

function ghJSON(args) {
  const out = execFileSync('gh', args, { encoding: 'utf8' });
  return JSON.parse(out || '[]');
}

export const githubConnector = {
  name: 'github',
  protocol: 'GitHub (gh CLI)',
  capabilities: { ingest: true, subscribe: false, publish: false },

  describe(config = {}) {
    const repos = config.repos || [];
    return {
      title: config.title || `GitHub: ${repos.join(', ') || 'unconfigured'}`,
      type: 'repo',
      steward: config.steward || 'GitHub repo maintainers',
      return_path: config.return_path || (repos[0] ? `https://github.com/${repos[0]}/issues` : 'https://github.com'),
      url: repos[0] ? `https://github.com/${repos[0]}` : 'https://github.com',
    };
  },

  async pull(config = {}, { cursor } = {}) {
    const repos = config.repos || [];
    const include = config.include || ['issues'];
    const since = cursor || config.since || null;
    const records = [];
    let high = since;
    const bump = (ts) => { if (ts && (!high || ts > high)) high = ts; };

    for (const repo of repos) {
      if (include.includes('issues')) {
        const issues = ghJSON(['issue', 'list', '--repo', repo, '--state', 'all', '--limit', '200',
          '--json', 'number,title,body,url,updatedAt,author']);
        for (const it of issues) {
          if (since && it.updatedAt <= since) continue;
          records.push({ kind: 'issue', repo, ...it });
          bump(it.updatedAt);
        }
      }
      if (include.includes('releases')) {
        const rels = ghJSON(['release', 'list', '--repo', repo, '--limit', '100', '--json', 'name,tagName,url,publishedAt']);
        for (const r of rels) {
          if (since && r.publishedAt <= since) continue;
          records.push({ kind: 'release', repo, name: r.name || r.tagName, url: r.url, publishedAt: r.publishedAt, body: '' });
          bump(r.publishedAt);
        }
      }
    }
    return { records, cursor: high };
  },

  map(record, _config = {}) {
    if (record.kind === 'issue') {
      return [{ schema: 'signal', object: {
        title: record.title,
        type: 'signal',
        signal_type: 'content',
        interpretation: record.body || '',
        source_lineage: record.url,
        steward: (record.author && record.author.login) || 'unknown',
      } }];
    }
    if (record.kind === 'release') {
      return [{ schema: 'resource', object: {
        title: record.name,
        type: 'resource',
        resource_type: 'release',
        url: record.url,
        source_lineage: record.url,
      } }];
    }
    return [];
  },
};
