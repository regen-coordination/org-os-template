import { getDriver } from './driver.mjs';

// Pick the driver for a repo/instance config. `config` is a parsed federation.yaml
// (or any object with an optional platforms.canonical). Defaults to github so every
// existing repo keeps working with no config change.
export function resolveDriver(config = {}, overrides = {}) {
  const canonical = config?.platforms?.canonical || 'github';
  return getDriver(canonical, { ...config, ...overrides });
}

// Detect the addressing scheme of a single remote/id. Radicle RIDs start with "rad:".
export function resolveRemoteScheme(idOrUrl) {
  if (typeof idOrUrl === 'string' && idOrUrl.startsWith('rad:')) return 'radicle';
  return 'github';
}
