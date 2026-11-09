/** The folder name a clone of `url` gets by default: the repo's last path segment without `.git`. Pure, no node: imports,
 *  so the launcher and its page share it. */
export function cloneName(url) {
  const last = String(url).trim().replace(/\/+$/, '').split(/[/:]/).pop() ?? ''
  const name = last.replace(/\.git$/, '').replace(/[^A-Za-z0-9._-]/g, '')
  return name === '' || name === '.' || name === '..' ? 'instance' : name
}
