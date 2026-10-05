// Where the two planes live. The canon is the instance itself; the public plane is named in the
// canon's kms.yaml:
//
//   planes:
//     public:
//       instance: my-commons          # the `instance:` the public plane's own kms.yaml must carry
//       dir: repos/my-commons         # optional; this is the default (repos/<instance>)
//
// COMMONS_DIR overrides the directory (tests, CI) — never the instance name the target must prove.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

/**
 * @param {{ root: string, config?: object }} opts config = the canon's parsed kms.yaml (read from root when omitted)
 * @returns {{ instance: string, dir: string }}
 */
export function resolvePublicPlane({ root, config }) {
  if (!root) throw new Error('resolvePublicPlane: root (the canon directory) is required');
  let cfg = config;
  if (cfg === undefined) {
    const file = path.join(root, 'kms.yaml');
    cfg = fs.existsSync(file) ? yaml.load(fs.readFileSync(file, 'utf8'), { filename: file }) || {} : {};
  }
  const pub = cfg?.planes?.public;
  if (!pub || typeof pub.instance !== 'string' || !pub.instance)
    throw new Error(`no public plane is configured: ${path.join(root, 'kms.yaml')} has no planes.public.instance`);
  const dir = process.env.COMMONS_DIR
    ? path.resolve(process.env.COMMONS_DIR)
    : path.resolve(root, pub.dir || path.join('repos', pub.instance));
  return { instance: pub.instance, dir };
}
