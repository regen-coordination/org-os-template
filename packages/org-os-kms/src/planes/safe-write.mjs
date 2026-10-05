// Round B: assertCommonsTarget only vets a fixed, small list of paths ONCE, up front (outDir,
// outDir/data/kb). Individual writers build their OWN paths afterwards — outDir/data/kb/<schema>.
// yaml, outDir/content/sources.json, a preserved file's unlink target — which that up-front check
// never resolved. If a path segment BETWEEN outDir and the actual write target is a symlink
// pointing back into the canon (outDir/content -> <canon>/data, say), a write through it lands in
// the canon even though outDir and outDir/data/kb both checked out clean at assertCommonsTarget
// time. EVERY write, mkdir, or unlink that targets the commons MUST be routed through
// assertInsideCommons first — a future generator that constructs its own path under outDir and
// skips this call is exactly the failure mode this module exists to close.
import fs from 'node:fs';
import path from 'node:path';

// Round C: `fs.existsSync` FOLLOWS symlinks — a dangling link (its target does not exist yet)
// therefore reads as "does not exist" and used to be popped off and re-appended unresolved, same
// as a genuinely absent path. That is wrong: the directory entry for the link itself is very much
// there, and the OS will follow it (into nothing, or into wherever it eventually resolves) the
// instant a real write walks through it. `fs.lstatSync` inspects the entry itself without
// following it, so a dangling (or any other) symlink correctly counts as "present" here, and is
// handled explicitly below rather than silently skipped.
function lstatOrNull(p) {
  return fs.lstatSync(p, { throwIfNoEntry: false }) ?? null;
}

// Realpath the deepest lstat-VISIBLE ancestor of `p` (a dangling symlink is visible; a path that
// truly does not exist at all is not), then re-append whatever has no directory entry yet at all,
// unresolved — nothing not-yet-existing can be a symlink, so there is nothing left to resolve past
// that point. If the deepest visible ancestor is itself a symlink `fs.realpathSync` cannot follow
// (dangling, or a broken link further down its own chain), refuse and name it: a broken link
// anywhere inside a generated tree is never a legitimate thing to write through.
function resolveThroughExisting(p) {
  const abs = path.resolve(p);
  let dir = abs;
  const remainder = [];
  while (!lstatOrNull(dir)) {
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached the filesystem root; nothing further to walk up
    remainder.unshift(path.basename(dir));
    dir = parent;
  }
  let realDir;
  try {
    realDir = fs.realpathSync(dir);
  } catch (err) {
    throw new Error(`export-commons: refusing to write through a broken symlink at ${dir}: ${err?.message ?? String(err)}`);
  }
  return remainder.length ? path.join(realDir, ...remainder) : realDir;
}

/** Refuse a write/mkdir/unlink whose target does not resolve inside `outDir`. `outDir` itself
 *  must already exist by the time any writer runs (assertCommonsTarget requires its kms.yaml).
 *  Path-segment-aware containment (`p === dir || p.startsWith(dir + path.sep)`), never a bare
 *  startsWith, so a sibling like `<outDir>-evil` is never mistaken for being inside `outDir`.
 *
 *  Round C: the exact path being written/mkdir'd/unlinked — the FINAL component — gets one more,
 *  unconditional check before the general resolve-and-contain logic runs: a generated file (or the
 *  thing about to be unlinked) has no legitimate reason to itself be a symlink. A dangling one is
 *  refused outright (there is nothing to resolve it against). An existing one is refused unless it
 *  resolves to a directory — a directory symlink may legitimately sit at that exact path (e.g. a
 *  generated subtree relocated via a symlink) and is still subject to the normal containment check
 *  below; a symlink to a plain file is never legitimate here regardless of where it points, because
 *  every real caller either creates a fresh file/directory or unlinks one this writer itself owns —
 *  neither should ever find someone else's symlink already sitting at that name. */
export function assertInsideCommons(outDir, targetPath) {
  const realOut = fs.realpathSync(outDir);
  const abs = path.resolve(targetPath);

  const leaf = lstatOrNull(abs);
  if (leaf?.isSymbolicLink()) {
    let leafTarget;
    try {
      leafTarget = fs.realpathSync(abs);
    } catch {
      throw new Error(`export-commons: refusing to write through ${targetPath}: the final path component (${abs}) is a dangling symlink`);
    }
    if (!fs.statSync(leafTarget).isDirectory()) {
      throw new Error(`export-commons: refusing to write through ${targetPath}: the final path component (${abs}) is a symlink to a non-directory (${leafTarget})`);
    }
  }

  // FINAL REVIEW: a HARD LINK is the one write-through this module did not see. No symlink is
  // involved, so every resolve-and-contain check above passes — the path really is inside the
  // commons — yet the inode is shared with whatever else links it, and `writeFileSync` truncates
  // and rewrites that shared inode in place. A hard link from <outDir>/data/kb/resource.yaml to
  // the canon's own data/kb/resource.yaml therefore rewrites the CANON through a path that is
  // genuinely contained. Containment cannot answer this; link count can. A file this writer
  // legitimately owns is always freshly created and never linked elsewhere, so nlink > 1 on a
  // regular file at the write/unlink target is never legitimate here. Directories are exempt:
  // their nlink counts subdirectories (and is >= 2 for any directory with an entry) — it says
  // nothing about sharing.
  if (leaf?.isFile() && leaf.nlink > 1) {
    throw new Error(`export-commons: refusing to write through ${targetPath}: ${abs} is a hard link (${leaf.nlink} links to the same inode) — writing it would rewrite every other path sharing that inode, including one in the canon`);
  }

  const resolved = resolveThroughExisting(abs);
  const ok = resolved === realOut || resolved.startsWith(realOut + path.sep);
  if (!ok) {
    throw new Error(`export-commons: refusing to write outside the commons: ${targetPath} resolves to ${resolved}, not inside ${outDir} (${realOut})`);
  }
}
