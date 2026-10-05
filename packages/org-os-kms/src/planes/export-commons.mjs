#!/usr/bin/env node
// One-way projection: canon data/kb/ → <commons>/data/kb/. Deterministic; no timestamps — `git diff`
// in the commons repo IS the publication change feed.
//
// OWNERSHIP: owns <commons>/data/kb/*.yaml EXCEPT source-system.yaml (the commons' self card).
// Writes nothing else. The Astro site renders pages from that store, so — unlike refi-dao-os —
// there is no markdown page projection here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { loadKb } from "./kb-loader.mjs";
import {
  isPublishable,
  validateCards,
  validateBoundaries,
} from "./publication-gate.mjs";
import { selectForPublication } from "./select-for-publication.mjs";
import { writePublishedKb } from "./write-published-kb.mjs";
import { assertInsideCommons } from "./safe-write.mjs";
import { loadCommonsPolicy } from "./kms-config.mjs";
import { resolvePublicPlane } from "./paths.mjs";
import { cmp } from "./constants.mjs";

/** Refuse, loudly, to write anywhere that is not the commons instance. */
export function assertCommonsTarget(root, outDir, commonsInstance = resolvePublicPlane({ root }).instance) {
  if (path.resolve(outDir) === path.resolve(root))
    throw new Error("export-commons: refusing to export into the canon itself");
  const cfgFile = path.join(outDir, "kms.yaml");
  if (!fs.existsSync(cfgFile))
    throw new Error(
      `export-commons: no kms.yaml at ${outDir} — is the commons repo scaffolded?`,
    );
  let cfg;
  try {
    cfg = yaml.load(fs.readFileSync(cfgFile, "utf8"));
  } catch (err) {
    throw new Error(
      `export-commons: malformed kms.yaml at ${cfgFile}: ${err?.message ?? String(err)}`,
    );
  }
  const instance = cfg?.instance;
  if (instance !== commonsInstance)
    throw new Error(
      `export-commons: ${outDir} is instance "${instance}", not the commons instance "${commonsInstance}"`,
    );

  // path.resolve alone follows a symlink's NAME, not its target: a commons repo whose data/kb is
  // symlinked into the canon passes every check above, then writePublishedKb deletes files it
  // thinks it owns — which are actually the canon's. Resolve real paths (falling back to
  // path.resolve for anything that does not exist yet — a fresh commons has no data/kb) and refuse
  // when the commons target actually lives inside the canon.
  //
  // EXCEPTION: <root>/repos/ is where the canon deliberately keeps nested checkouts (gitignored;
  // the public plane's default location is <root>/repos/<planes.public.instance>). A
  // target resolving STRICTLY BELOW repos/ is safe to allow: nothing that reads or rewrites canon
  // data (kb-loader, minting, writePublishedKb) ever walks into repos/, so a commons parked there
  // cannot be mistaken for canon material and the canon cannot be mistaken for commons material.
  // The symlink attack this guard exists for is still caught — a data/kb symlinked straight into
  // the canon's own data/kb resolves OUTSIDE repos/ regardless of where the symlink itself sits,
  // because realpath follows it all the way to its target.
  //
  // Two things narrow the exception so it cannot itself become the hole:
  //  - repos/ must be strictly ABOVE the target, not equal to it — <root>/repos itself is refused
  //    as a commons target (it is the parent of every real nested checkout, not one).
  //  - repos/ must be a REAL directory the canon controls, not a symlink. The safety argument above
  //    depends on repos/ actually living where the canon's own filesystem says it does; a symlinked
  //    repos/ could point anywhere — including back at the canon itself, or at a location that is
  //    safe today and re-pointed tomorrow — so it is refused outright, regardless of what it
  //    resolves to (a symlink into the canon and a symlink to some unrelated place outside it fail
  //    for the identical reason: repos/ itself must not be a redirection).
  if (
    fs
      .lstatSync(path.join(root, "repos"), { throwIfNoEntry: false })
      ?.isSymbolicLink()
  ) {
    throw new Error(
      `export-commons: ${path.join(root, "repos")} is a symlink — refusing (repos/ must be a real directory the canon controls, not a redirection)`,
    );
  }
  const real = (p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  const realRoot = real(root);
  const realRepos = path.join(realRoot, "repos"); // NOT realpath(repos) — repos/ was just proven not to be a symlink
  const isPathOrUnder = (p, dir) => p === dir || p.startsWith(dir + path.sep);
  const strictlyUnderRepos = (p) =>
    p !== realRepos && isPathOrUnder(p, realRepos);
  const unsafe = (p) => isPathOrUnder(p, realRoot) && !strictlyUnderRepos(p);
  const kbDir = path.join(outDir, "data", "kb");
  if (unsafe(real(outDir)) || (fs.existsSync(kbDir) && unsafe(real(kbDir)))) {
    throw new Error(
      `export-commons: ${outDir} resolves inside the canon (${root}) outside repos/ — refusing to write into the canon via a symlink; a commons may only live entirely outside the canon, or strictly nested under ${path.join(root, "repos")}`,
    );
  }
}

export function exportCommons({ root, outDir, instance, uuid } = {}) {
  if (!root) throw new Error("export-commons: root (the canon directory) is required");
  // The public plane is the canon's declaration (kms.yaml planes.public), never a constant here.
  // Resolved only for what the caller did not pass: an explicit outDir still has to prove, by its
  // own kms.yaml, that it is the instance the canon names.
  if (instance === undefined || outDir === undefined) {
    const plane = resolvePublicPlane({ root });
    instance ??= plane.instance;
    outDir ??= plane.dir;
  }
  assertCommonsTarget(root, outDir, instance);
  // FINAL REVIEW: containment of the one directory this export writes is asserted HERE, before
  // anything can mint. selectForPublication calls ensureIds({ write: true }), which rewrites canon
  // YAML to stamp new ids — so a write-time refusal further down (a symlinked, dangling or
  // hard-linked data/kb) used to leave the canon already modified by an export that then produced
  // nothing. A refused export must leave the canon byte-identical, and the cheapest way to
  // guarantee that is to fail before the first id is minted rather than after. This is the SAME
  // helper writePublishedKb uses per path, not a second copy of the rule; the per-path calls stay
  // (they are what catches a path constructed later), this one only moves the first failure
  // earlier.
  assertInsideCommons(outDir, path.join(outDir, "data", "kb"));

  // WHICH TYPES this export may publish is the COMMONS' decision, read from its own kms.yaml
  // (`extensions` loads a pack's schemas and registers its types; `publish.types_opt_in` is what
  // actually makes any of them publish-eligible). Read AFTER assertCommonsTarget: that check is
  // what established this directory is the commons at all, and loading a pack a stranger's
  // kms.yaml named is not something to do before knowing whose kms.yaml it is.
  const { types, fields } = loadCommonsPolicy({ commonsDir: outDir });
  const kb = loadKb(path.join(root, "data", "kb"));

  // Lint the canon's own control data BEFORE any verdict is computed. A malformed held_prefixes or
  // a boundary recorded in an unusable notation is a silent safety failure — the export is the
  // right moment to make it loud, because this is when material would leave the canon.
  const controlErrors = [
    ...validateCards(kb.sourceSystems),
    ...validateBoundaries(kb.boundaryRecords),
  ];
  if (controlErrors.length > 0) {
    throw new Error(
      `export-commons: refusing to export — malformed control data:\n${controlErrors.join("\n")}`,
    );
  }

  const verdicts = new Map();
  const skipped = [];
  for (const obj of Object.values(kb.objects)) {
    const key = `${obj.type}:${obj.slug}`;
    const verdict = isPublishable(obj, kb);
    verdicts.set(key, verdict);
    const isCard =
      obj.type === "source-system" || obj.type === "public-use-boundary";
    if (!verdict.ok && !isCard) skipped.push({ key, reason: verdict.reason });
  }
  skipped.sort((a, b) => cmp(a.key, b.key));
  const sel = selectForPublication({ root, verdicts, uuid, types });
  const pub = writePublishedKb({ selected: sel.selected, outDir, fields });
  const floorRejected = [...sel.floorRejected].sort((a, b) =>
    cmp(a.key, b.key),
  );
  // Which canon files minting rewrote — presentational (comments/scalar reflow via the vendored
  // adapter's update()), but a large diff in the private repo should read as expected, not alarming.
  const mintedFiles = [
    ...new Set(
      sel.mintedRefs.map((ref) =>
        path.relative(root, ref.slice(0, ref.lastIndexOf("#"))),
      ),
    ),
  ].sort(cmp);
  return {
    written: pub.written,
    publicFields: pub.publicFields,
    minted: sel.minted,
    skipped,
    floorRejected,
    mintedFiles,
  };
}
