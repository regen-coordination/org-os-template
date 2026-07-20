// The HostDriver contract: the methods every driver must implement. The read/write
// split is intentional — reads (top group) may degrade; writes (bottom group) go
// through the driver's own executor and fail loudly (see the radicle driver, Plan 2).
// Methods may be sync or async; callers await results. (e.g. whoami is sync in the
// github driver, async in the radicle driver — which shells `rad self`.)
export const HOST_DRIVER_METHODS = Object.freeze([
  // identity & addressing
  'resolveRemote', 'whoami',
  // read path
  'clone', 'fetchFile', 'listPeers', 'getCanonical', 'getDrift',
  // write path
  'push', 'openChange', 'createIssue', 'commentIssue', 'syncUpstream', 'webUrl',
]);

const REGISTRY = new Map(); // name -> factory(config) -> driver

export function registerDriver(name, factory) {
  if (typeof factory !== 'function') throw new TypeError(`driver factory for "${name}" must be a function`);
  REGISTRY.set(name, factory);
}

export function getDriver(name, config = {}) {
  const factory = REGISTRY.get(name);
  if (!factory) throw new Error(`unknown host driver: ${name}`);
  const driver = factory(config);
  assertDriver(driver, name);
  return driver;
}

export function assertDriver(driver, name = 'driver') {
  const missing = HOST_DRIVER_METHODS.filter((m) => typeof driver?.[m] !== 'function');
  if (missing.length) throw new Error(`host driver "${name}" is missing methods: ${missing.join(', ')}`);
  return driver;
}
