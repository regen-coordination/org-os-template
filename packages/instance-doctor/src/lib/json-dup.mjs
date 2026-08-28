/**
 * json-dup.mjs — find duplicate object keys in raw JSON text.
 *
 * `JSON.parse` resolves duplicates last-wins and hands back an object that
 * looks perfectly healthy, so a duplicate key is invisible to every validator
 * that works on parsed data. regen-coordination-os has carried two
 * `scripts.initialize` entries for months for exactly that reason.
 *
 * This is a minimal scanner rather than a full parser: it tracks string
 * boundaries, escapes, and container nesting, and treats a string immediately
 * followed by `:` inside an object as a key. Malformed input yields `[]` —
 * reporting a parse error is the caller's job, not this function's.
 */

/**
 * @param {string|null|undefined} raw
 * @returns {string[]} dotted paths of duplicated keys, in first-seen order
 */
export function duplicateJsonKeys(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return [];

  const duplicates = [];
  /** @type {Array<{isObject: boolean, keys: Set<string>, name: string|null}>} */
  const stack = [];
  let i = 0;

  const pathOf = () =>
    stack
      .map((f) => f.name)
      .filter((n) => n !== null && n !== undefined)
      .join('.');

  while (i < raw.length) {
    const ch = raw[i];

    if (ch === '"') {
      // Read the string literal, honouring backslash escapes.
      let j = i + 1;
      let value = '';
      let closed = false;
      while (j < raw.length) {
        const c = raw[j];
        if (c === '\\') {
          value += raw[j + 1] ?? '';
          j += 2;
          continue;
        }
        if (c === '"') {
          closed = true;
          break;
        }
        value += c;
        j += 1;
      }
      if (!closed) return []; // unterminated string — malformed
      i = j + 1;

      // A string is a key when the enclosing container is an object and the
      // next non-whitespace character is a colon.
      let k = i;
      while (k < raw.length && /\s/.test(raw[k])) k += 1;
      const frame = stack[stack.length - 1];
      if (raw[k] === ':' && frame?.isObject) {
        if (frame.keys.has(value)) {
          const parent = stack
            .slice(0, -1)
            .map((f) => f.name)
            .filter(Boolean)
            .join('.');
          duplicates.push(parent ? `${parent}.${value}` : value);
        } else {
          frame.keys.add(value);
        }
        frame.name = value; // remember for nested paths
        i = k + 1;
      }
      continue;
    }

    if (ch === '{' || ch === '[') {
      const parent = stack[stack.length - 1];
      stack.push({
        isObject: ch === '{',
        keys: new Set(),
        // An object's path segment is the key it was assigned to; array
        // elements contribute nothing, so indices never appear in paths.
        name: parent?.isObject ? parent.name : null,
      });
      i += 1;
      continue;
    }

    if (ch === '}' || ch === ']') {
      if (stack.length === 0) return []; // unbalanced — malformed
      stack.pop();
      i += 1;
      continue;
    }

    i += 1;
  }

  if (stack.length !== 0) return []; // unbalanced — malformed
  return duplicates;
}
