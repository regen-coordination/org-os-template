// packages/org-os-kms/src/connectors/hypercerts/timeout.mjs — a deadline for one request.
// A hung server must not stall a pull before its records or cursor are written. The request gets an AbortSignal (so a
// real fetch stops) AND is raced against the deadline (so a fetch that ignores the signal still ends). A ref'd timer,
// not AbortSignal.timeout: that one is unref'd, so a hung request could let the process exit mid-pull.
export const DEFAULT_TIMEOUT_MS = 10_000;

export class RequestTimeout extends Error {
  constructor(ms) { super(`timed out after ${ms} ms`); this.name = 'RequestTimeout'; this.timeoutMs = ms; }
}

// setTimeout holds a delay in a signed 32-bit integer: above 2^31-1 ms it fires after 1 ms. Cap at a day, far beyond any sane request.
export const MAX_TIMEOUT_MS = 86_400_000;

/** The configured timeout (at most a day), or the default when it is missing, not a number, or not positive. */
export const timeoutOf = (ms) => (Number.isFinite(ms) && ms > 0 ? Math.min(ms, MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS);

/** Run `run(signal)`; reject with RequestTimeout if it has not settled after `ms`. */
export function withTimeout(ms, run) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { reject(new RequestTimeout(ms)); controller.abort(); }, ms); });
  return Promise.race([Promise.resolve().then(() => run(controller.signal)), deadline]).finally(() => clearTimeout(timer));
}
