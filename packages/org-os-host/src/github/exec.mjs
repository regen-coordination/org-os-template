import { spawn } from 'node:child_process';

// The single place github logic touches a subprocess. Returns { code, stdout, stderr }.
// Never throws on non-zero exit — callers decide what a non-zero code means.
export function makeExec({ cwd = '.' } = {}) {
  return function exec(bin, args, { input, cwd: callCwd } = {}) {
    return new Promise((resolve) => {
      const child = spawn(bin, args, { cwd: callCwd ?? cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('close', (code) => resolve({ code, stdout, stderr }));
      child.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err.message || err) }));
      if (input != null) child.stdin.end(input);
      else child.stdin.end();
    });
  };
}
