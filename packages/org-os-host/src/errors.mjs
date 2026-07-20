// Typed errors so callers can distinguish "the host can't do this write right now"
// (actionable, e.g. start your node) from a generic failure.
export class WriteUnavailableError extends Error {
  constructor(message, { hint } = {}) {
    super(message);
    this.name = 'WriteUnavailableError';
    this.hint = hint || null;
  }
}

export class NotImplementedError extends Error {
  constructor(method) {
    super(`not implemented: ${method}`);
    this.name = 'NotImplementedError';
    this.method = method;
  }
}
