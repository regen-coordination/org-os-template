import { registerDriver } from '../../org-os-host/src/index.mjs';
import { makeRadicleDriver } from './driver.mjs';

// Register the radicle driver. config carries platforms.seed_node (the org's httpd
// endpoint); fall back to a public seed for reads only. Writes still require a local rad.
registerDriver('radicle', (config = {}) =>
  makeRadicleDriver({
    seed: config.seed || config.platforms?.seed_node || 'https://seed.radicle.xyz',
    fetchFn: config.fetchFn,
    exec: config.exec,
    cwd: config.cwd || '.',
  }));

export { makeRadicleDriver };
