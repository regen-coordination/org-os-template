// scripts/crew/identity.mjs
//
// Where an agent's identity prompt lives while it runs. core.mjs composes the text;
// this is the one place that puts it on disk and takes it away. The file sits
// outside every worktree (an untracked file there would stop release removing the
// worktree) and outside memory/crew/ (readTrail would take it for a record).
// See docs/superpowers/specs/2026-10-10-org-os-crew-design.md §4.1 and §5.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {string} dir The directory the files go in; made when first written.
 * @returns {{ write(id: string, text: string): string, remove(id: string): void }}
 */
export function createIdentityStore(dir) {
  const path = (id) => join(dir, `${id}.md`);
  return {
    /** Writes the prompt for an assignment and returns its absolute path. */
    write(id, text) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path(id), text);
      return path(id);
    },
    /** Removes it; a file that is already gone is not an error. */
    remove(id) {
      rmSync(path(id), { force: true });
    },
  };
}
