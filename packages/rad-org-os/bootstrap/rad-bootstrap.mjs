import { join } from 'node:path';
import { defaultExec } from '../src/rad-cli.mjs';
import { WriteUnavailableError } from '../../org-os-host/src/errors.mjs';
import { buildMembersYaml, buildFederationYaml } from './generate.mjs';

export function parseRid(s) {
  const m = /rad:z[1-9A-HJ-NP-Za-km-z]+/.exec(s || '');
  return m ? m[0] : null;
}
export function parseDid(s) {
  const m = /did:key:z6[1-9A-HJ-NP-Za-km-z]+/.exec(s || '');
  return m ? m[0] : null;
}

// Zero -> live self-owned org-os on Radicle. Effects injected for testing.
// Steps (spec Section 4): auth (mint did) -> scaffold framework -> rad init (RID +
// rad remote + identity doc) -> mint members.yaml (did canonical) -> write
// federation.yaml (canonical: radicle) -> genesis stamp.
export async function bootstrap({
  targetDir, name, alias = name, visibility = 'private', seed, github,
  exec = defaultExec(), fs = realFs(), scaffold = defaultScaffold, now = new Date().toISOString(),
} = {}) {
  if (!['private', 'public'].includes(visibility)) throw new Error(`visibility must be private|public, got ${visibility}`);

  const run = async (bin, args) => {
    const res = await exec(bin, args, { cwd: targetDir });
    if (res.code === -1) throw new WriteUnavailableError(`${bin} is not available`, { hint: `install ${bin}` });
    if (res.code !== 0 && /node is not running|not running/i.test(res.stderr || '')) {
      throw new WriteUnavailableError('the local Radicle node is not reachable', { hint: 'start your node: rad node start' });
    }
    if (res.code !== 0) throw new Error(`${bin} ${args.join(' ')} failed: ${res.stderr.trim() || res.code}`);
    return res.stdout;
  };

  // Note: the git genesis commit + persisting the genesis stamp (buildGenesisStamp ->
  // federation.yaml metadata.genesis_commit) are deferred to Plan 4 (the /commit +
  // governance wiring). The currently-unused `buildGenesisStamp`/`now` are intentional
  // forward scaffolding, not dead code.

  // 1. identity (idempotent for an existing key)
  await run('rad', ['auth', '--alias', alias]);
  const did = parseDid(await run('rad', ['self']));
  if (!did) throw new Error('rad self did not return a did:key');

  // 2. scaffold org-os framework files into targetDir
  await fs.mkdir(targetDir, { recursive: true });
  await scaffold(targetDir, fs);

  // 3. rad init -> RID + rad remote + identity doc (creator = sole delegate, threshold 1)
  const initArgs = ['init', targetDir, '--name', name, '--default-branch', 'main', `--${visibility}`, '--scope', 'all'];
  const rid = parseRid(await run('rad', initArgs));
  if (!rid) throw new Error('rad init did not return an RID');

  // 4-5. genesis data files
  await fs.writeFile(join(targetDir, 'data/members.yaml'), buildMembersYaml({ did, alias, github }));
  await fs.writeFile(join(targetDir, 'federation.yaml'), buildFederationYaml({ rid, seed, name, threshold: 1 }));

  return { rid, did, visibility, seed: seed || null };
}

function realFs() {
  return {
    mkdir: (p, o) => import('node:fs/promises').then((m) => m.mkdir(p, o)),
    writeFile: (p, c) => import('node:fs/promises').then((m) => m.writeFile(p, c)),
  };
}
// Minimal default scaffold: create the data/ dir. A richer scaffold (copy framework
// files) can reuse scripts/clone-framework.mjs; kept injectable so tests stay pure.
async function defaultScaffold(targetDir, fs) {
  await fs.mkdir(join(targetDir, 'data'), { recursive: true });
}
