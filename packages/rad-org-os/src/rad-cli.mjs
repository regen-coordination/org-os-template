import { spawn } from 'node:child_process';
import { WriteUnavailableError } from '../../org-os-host/src/errors.mjs';

// Detect the two "the operator's own node can't take this write" conditions the
// spec says must fail loudly with actionable guidance (never a silent HTTP fallback).
function nodeDown(stderr) {
  return /node is not running|connection refused|failed to connect|no such file|not running/i.test(stderr || '');
}
function radMissing(res) {
  return res.code === -1 || /ENOENT|command not found|not found/i.test(res.stderr || '');
}

export function makeRadCli({ exec = defaultExec(), cwd = '.' } = {}) {
  async function run(args, { input } = {}) {
    const res = await exec('rad', args, { input, cwd });
    if (radMissing(res)) {
      throw new WriteUnavailableError('rad CLI is not available', { hint: 'install rad: curl -sSf https://radicle.dev/install | sh' });
    }
    if (res.code !== 0 && nodeDown(res.stderr)) {
      throw new WriteUnavailableError('the local Radicle node is not reachable', { hint: 'start your node: rad node start' });
    }
    if (res.code !== 0) {
      throw new Error(`rad ${args.join(' ')} failed: ${res.stderr.trim() || `exit ${res.code}`}`);
    }
    return res.stdout;
  }
  return { run };
}

function defaultExec() {
  return (bin, args, { input, cwd = '.' } = {}) =>
    new Promise((resolve) => {
      const child = spawn(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('close', (code) => resolve({ code, stdout, stderr }));
      child.on('error', (err) => resolve({ code: -1, stdout, stderr: String(err.message || err) }));
      child.stdin.end(input ?? '');
    });
}
