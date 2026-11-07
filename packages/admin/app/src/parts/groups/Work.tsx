import { useState } from 'react'
import { StatusMark } from '../../design/StatusMark.tsx'
import { Amount } from '../../elements/atoms/Amount.tsx'
import { Mention } from '../../elements/atoms/Mention.tsx'
import { ViewHeader } from '../../elements/views/ViewHeader.tsx'
import { TableView } from '../../elements/views/TableView.tsx'
import { EditorBar } from '../../elements/workspace/EditorBar.tsx'
import { SaveState, type Save } from '../../elements/workspace/SaveState.tsx'
import { Callout, Commented, Current, EmbedRecord, EmbedView, PageBody, Selected } from '../../elements/workspace/PageBody.tsx'
import { SelectionToolbar } from '../../elements/workspace/SelectionToolbar.tsx'
import { SlashMenu } from '../../elements/workspace/SlashMenu.tsx'
import { CommentThread } from '../../elements/workspace/CommentThread.tsx'
import { Composer } from '../../elements/workspace/Composer.tsx'
import { MentionPicker } from '../../elements/workspace/MentionPicker.tsx'
import { mentionables } from '../../elements/workspace/mentions.ts'
import { ViewAsProvider } from '../../viewAs/ViewAs.tsx'
import { FIXTURE_SOURCE } from '../../viewAs/visibility.ts'
import { COMMENTS, ME, MENTIONABLES, PAGE, TASKS, TASK_VIEWS } from '../../test/fixtures/house/workspace.ts'
import { FIXED_NOW } from '../../test/fixtures/parts.ts'
import { taskColumns } from './Views.tsx'
import { Card, State } from './spec.tsx'

const noop = () => {}
const LEVEL = FIXTURE_SOURCE.visibilityOf(PAGE)
const READ = { state: 'fresh' as const, readAt: new Date(FIXED_NOW.getTime() - 4 * 60_000).toISOString() }
const OPEN = COMMENTS.filter(c => !c.resolved).length
const EMPTY = { title: 'No tasks yet.', line: 'Tasks link to projects, meetings and proposals.' }

/** The page's prose, as the gallery's: a selection, a record mention, a callout, the Safe embedded, the block the
 *  caret is in (with the commented passage and two mentions), and the Tasks collection embedded as a view. */
function Prose() {
  const [view, setView] = useState('table')
  return (
    <>
      <p>The treasury is one Safe at the same address on seven chains. <Selected>Any four of its eight signers can move funds</Selected>, and the
        signers are whoever wears the <Mention kind="record" recordKind="hat" text="Treasury signer" href="/roles" /> hat.</p>
      <Callout icon="key">The Hub prepares every transaction and reads it back. It never signs: signers do that in the Safe app.</Callout>
      <h2>What it holds</h2>
      <EmbedRecord kind="safe" name="Treasury" read={READ} now={FIXED_NOW} item={{ facts: { visibility: 'members' } }} rows={[
        { label: 'USDGLO on Celo', value: <Amount value="12480.22" unit="USDGLO" decimals={2} /> },
        { label: 'G$ on Celo', value: <Amount value="27561390.98" unit="G$" decimals={2} /> },
      ]} />
      <Current>
        <p>When a pool’s funds sit unused for a season, <Commented anchor={PAGE.anchor.id}>{PAGE.anchor.text}</Commented> — as{' '}
          <Mention kind="record" recordKind="proposal" text="DR-2026-010" href="/proposals" /> did. Ask <Mention kind="person" text="Ops lead" href="/people/ops-lead" /> before
          you <a href="/workspace/knowledge/pools">move a pool</a>.</p>
      </Current>
      <h3>Open tasks</h3>
      <EmbedView label="Tasks" item={{ facts: { visibility: 'members' } }}>
        <ViewHeader label="Tasks" views={[...TASK_VIEWS]} value={view} onView={setView} filters={[]} onFilters={noop} />
        <TableView label="Treasury tasks" rows={TASKS.filter(t => t.project === 'Treasury' && t.status !== 'Done')} columns={taskColumns()} rowKey={t => t.id} empty={EMPTY} />
      </EmbedView>
    </>
  )
}

/** The editor at work beside its thread: the comments toggle opens and closes it. */
function Editor() {
  const [open, setOpen] = useState(true)
  return (
    <div className="ed-page">
      <div className="ed">
        <EditorBar path={[...PAGE.path]} save="direct" presence={[...PAGE.presence]} visibility={LEVEL} onVisibility={noop}
          comments={OPEN} onComments={() => setOpen(o => !o)} commentsOpen={open} commentsId="pg-work-thread" />
        <PageBody meta={PAGE.meta} title={PAGE.title} from={PAGE.from} now={FIXED_NOW}><Prose /></PageBody>
      </div>
      {open && (
        <CommentThread id="pg-work-thread" comments={COMMENTS} visibility={LEVEL} me={ME} now={FIXED_NOW} form="panel"
          onSend={noop} onRetry={noop} onDiscard={noop} onResolve={noop} onTask={noop} />
      )}
    </div>
  )
}

const SAVES: Save[] = ['direct', 'saving', 'staged', 'conflict', 'offline']

/** /parts/work (§10.1–§10.6; the gallery's "work" section): the page editor beside its comment thread — the bar
 *  (path, save state, presence, the visibility control, the comments toggle), the body (meta and from mark, the
 *  Fraunces title, prose with a selection, commented text and the current block's rule, a callout, an embedded
 *  record and an embedded view) — then the selection toolbar and the slash menu, the composer with the mention
 *  picker, the save state in every state, the four kinds of write side by side, the editor under 760 px of it, the
 *  thread as a sheet, and the same chrome while previewing. Fixtures, read against FIXED_NOW. */
export default function Work() {
  return (
    <div className="pg">
      <p className="pg-lede">Pages are written, not administered: a Fraunces title, a 68-character measure, records and views embedded in the prose. Saving is a workspace write — direct by default, “needs approval” where the org raised it. Conversation lives beside the page and follows its visibility.</p>
      <Card cap="Page editor · the bar, the body, its thread">
        <Editor />
      </Card>
      <div className="pg-grid pg-two">
        <Card cap="Selection toolbar · Insert · /">
          <div className="pg-demo">
            <SelectionToolbar marks={{ bold: true, italic: false, heading: false }} onToggle={noop} onLink={noop} onMention={noop} onComment={noop} />
            <SlashMenu query="" onPick={noop} />
          </div>
        </Card>
        <Card cap="Composer · the mention picker">
          <Composer me={ME} onSend={noop} picker={<MentionPicker items={mentionables(MENTIONABLES, '')} onPick={noop} />} />
        </Card>
      </div>
      <div className="pg-grid pg-two">
        <Card cap="Save state · editor bar">
          {SAVES.map(s => <State key={s} name={s}><SaveState state={s} onCompare={noop} /></State>)}
        </Card>
        <Card cap="The three kinds of write, made visible (§10.6)">
          <State name="Governed record"><StatusMark mark="staged" label="Staged · in your change" /></State>
          <State name="Workspace write, direct"><SaveState state="direct" /></State>
          <State name="Workspace write, needs approval"><SaveState state="staged" /></State>
          <State name="Conversation"><span className="save">no save state · “Sending…” and “Not sent” on the comment</span></State>
        </Card>
      </div>
      <div className="pg-grid pg-two">
        <Card cap={`Editor · under 760 px of it`}>
          <div className="pg-narrow">
            <div className="ed">
              <EditorBar path={[...PAGE.path]} save="staged" presence={[...PAGE.presence]} visibility={LEVEL} onVisibility={noop} comments={OPEN} onComments={noop} />
              <PageBody meta="Edited 4 min ago by Ops lead" title={PAGE.title}>
                <p>The treasury is one Safe at the same address on seven chains.</p>
              </PageBody>
            </div>
          </div>
        </Card>
        <Card cap="Comments · a sheet under 1200 of frame width">
          <div className="pg-phone-sheet">
            <CommentThread comments={COMMENTS.slice(1)} visibility={LEVEL} me={ME} now={FIXED_NOW} form="sheet" inline
              onSend={noop} onRetry={noop} onDiscard={noop} onResolve={noop} onTask={noop} onClose={noop} />
          </div>
        </Card>
      </div>
      <Card cap="Previewing as the Ops hat · the level as a marker, no writes in the thread">
        <ViewAsProvider initial={{ as: 'hat', hat: 'ops', name: 'Ops' }}>
          <div className="ed-page">
            <div className="ed">
              <EditorBar path={[...PAGE.path]} save="direct" presence={[...PAGE.presence]} visibility={LEVEL} onVisibility={noop} comments={OPEN} onComments={noop} commentsOpen />
            </div>
            <CommentThread comments={COMMENTS.slice(0, 1)} visibility={LEVEL} me={ME} now={FIXED_NOW} form="panel"
              onSend={noop} onRetry={noop} onDiscard={noop} onResolve={noop} onTask={noop} />
          </div>
        </ViewAsProvider>
      </Card>
    </div>
  )
}
