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

  async pull(config = {}, { cursor } = {}, deps = {}) {
    const gh = deps.ghJSON || ghJSON;
    const repos = config.repos || [];
    const include = config.include || ['issues'];
    const cur = cursor || {};                 // per-stream watermarks: { issues, releases }
    const sinceIssues = cur.issues || config.since || null;
    const sinceReleases = cur.releases || config.since || null;
    const ISSUE_LIMIT = 500, RELEASE_LIMIT = 200;
    const records = [];
    const warnings = [];
    let hiIssues = sinceIssues, hiReleases = sinceReleases;
    const bumpI = (ts) => { if (ts && (!hiIssues || ts > hiIssues)) hiIssues = ts; };
    const bumpR = (ts) => { if (ts && (!hiReleases || ts > hiReleases)) hiReleases = ts; };
    const HANDLED = new Set(['issues', 'releases']);
    for (const t of include) if (!HANDLED.has(t)) warnings.push(`github: unhandled include type "${t}" (only issues, releases are implemented)`);

    for (const repo of repos) {
      if (include.includes('issues')) {
        const args = ['issue', 'list', '--repo', repo, '--state', 'all', '--limit', String(ISSUE_LIMIT),
          '--json', 'number,title,body,url,updatedAt,author'];
        if (sinceIssues) args.push('--search', `updated:>=${String(sinceIssues).slice(0, 10)}`);
        const issues = gh(args);
        if (issues.length >= ISSUE_LIMIT) warnings.push(`github ${repo}: issue window saturated at ${ISSUE_LIMIT}; updates older than the window may be missed (follow-on: server-side pagination)`);
        for (const it of issues) {
          if (sinceIssues && it.updatedAt <= sinceIssues) continue;
          records.push({ kind: 'issue', repo, ...it });
          bumpI(it.updatedAt);
        }
      }
      if (include.includes('releases')) {
        const rels = gh(['release', 'list', '--repo', repo, '--limit', String(RELEASE_LIMIT), '--json', 'name,tagName,publishedAt']);
        if (rels.length >= RELEASE_LIMIT) warnings.push(`github ${repo}: release window saturated at ${RELEASE_LIMIT}`);
        for (const r of rels) {
          if (sinceReleases && r.publishedAt <= sinceReleases) continue;
          // gh release list has no `url` field — construct the canonical tag URL.
          records.push({ kind: 'release', repo, name: r.name || r.tagName, url: `https://github.com/${repo}/releases/tag/${r.tagName}`, publishedAt: r.publishedAt, body: '' });
          bumpR(r.publishedAt);
        }
      }
    }
    for (const w of warnings) console.warn(`⚠ ${w}`);
    return { records, cursor: { issues: hiIssues, releases: hiReleases }, warnings };
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
