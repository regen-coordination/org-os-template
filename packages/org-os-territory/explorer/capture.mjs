// explorer/capture.mjs — the facts the explorer is built from. Reuses the demo's territory and pack-info scenarios unmodified, adds
// perspectives and streamsFor. Fail-closed: a contradicted expectation throws, so the page can never show what the code did not produce.
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { territory } from '../demo/capture/territory.mjs';
import { packInfo } from '../demo/capture/pack-info.mjs';
import { cleanup, expect } from '../demo/capture/env.mjs';
import { indexUnits } from '../src/units.mjs';
import { perspectives } from './capture/perspectives.mjs';
import { streamsFor } from './capture/streams-for.mjs';
import { EXTRA_NOTE, PRIVATE_NOTE_UNIT } from './sample-extra.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const commit = () => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'unknown'; } };

/** The pack in a visitor's words: its types, what each falls back to, its own description. A mis-parsed entity aborts the build. */
export function packFacts(info) {
  const types = Object.entries(info.territory.added.entities).map(([name, e]) => {
    expect(Object.keys(e).sort().join() === 'description,maps_to_core', `pack entity "${name}" must carry exactly maps_to_core + description, got: ${Object.keys(e).join()}`);
    return { name, mapsToCore: e.maps_to_core, description: e.description };
  });
  return { name: info.territory.manifest.name, version: info.territory.manifest.version, types, optInLine: `extensions: [${info.territory.manifest.name}]` };
}

export async function capture() {
  try {
    const t = territory();
    const facts = {
      meta: { commit: commit(), node: process.version, capturedAt: new Date().toISOString() },
      territory: { ...t, extraNote: EXTRA_NOTE, privateNoteUnit: PRIVATE_NOTE_UNIT },
      pack: packFacts(packInfo()),
      perspectives: await perspectives(),
      streamsFor: streamsFor(t.units, t.streams.streams, indexUnits(t.units)),
    };
    return facts;
  } finally { cleanup(); }
}
