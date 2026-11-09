/** Reads `git status --porcelain=v2 --branch` output: the branch (null when detached), how far it is ahead and
 *  behind its upstream (null with none), and whether any file differs (any line not starting with `#`). */
export function parseStatusV2(text) {
  let branch = null, ahead = null, behind = null, dirty = false
  for (const line of String(text).split('\n')) {
    if (line === '') continue
    if (!line.startsWith('#')) { dirty = true; continue }
    const head = /^# branch\.head (.+)$/.exec(line)
    if (head) { branch = head[1] === '(detached)' ? null : head[1]; continue }
    const ab = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line)
    if (ab) { ahead = Number(ab[1]); behind = Number(ab[2]) }
  }
  return { branch, ahead, behind, dirty }
}
