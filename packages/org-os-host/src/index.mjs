import { registerDriver, getDriver, assertDriver, HOST_DRIVER_METHODS } from './driver.mjs';
import { resolveDriver, resolveRemoteScheme } from './resolve.mjs';
import { makeGithubDriver } from './github/driver.mjs';
import { makeExec } from './github/exec.mjs';

// Register the github driver with a real exec by default; callers/tests can override
// via getDriver('github', { exec }) since makeGithubDriver takes injected deps.
registerDriver('github', (config = {}) =>
  makeGithubDriver({ exec: config.exec || makeExec({ cwd: config.cwd || '.' }), cwd: config.cwd || '.', fetchFn: config.fetchFn }));

export { registerDriver, getDriver, assertDriver, HOST_DRIVER_METHODS, resolveDriver, resolveRemoteScheme };
export { WriteUnavailableError, NotImplementedError } from './errors.mjs';
