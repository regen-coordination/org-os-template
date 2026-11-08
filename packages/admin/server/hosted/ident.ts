// One identity for every hosted commit (L9 spec §5.5, carry 2). A hosted Hub has no person at the machine whose git
// identity could be the actor of record, so every git process it starts commits as the Hub.
import { HOUSE_IDENT } from '../../lib/trailers.mjs'

/** Sets the four ident variables to `HOUSE_IDENT` in `env` (the process environment, at start). Every git process the
 *  server starts inherits them, so a commit site that was missed still commits as the Hub. */
export function useHubIdent(env: NodeJS.ProcessEnv): void {
  env.GIT_AUTHOR_NAME = HOUSE_IDENT.name
  env.GIT_AUTHOR_EMAIL = HOUSE_IDENT.email
  env.GIT_COMMITTER_NAME = HOUSE_IDENT.name
  env.GIT_COMMITTER_EMAIL = HOUSE_IDENT.email
}
