import { defineBlock } from './registry.ts'
import { renderMarkdown } from './markdown.tsx'

type NoteCfg = { title?: string; text?: string }

export const noteBlock = defineBlock<NoteCfg>({
  type: 'note',
  label: 'Note',
  config: [{ key: 'text', label: 'text', input: 'markdown' }],
  title: c => c.title ?? 'Note',
  // The empty sentence is the view's (P4b's frame reads view.empty; Arrange's new note sets one, R-8).
  useData: c => (c.text && c.text.trim() !== '' ? { state: 'ready', data: c.text } : { state: 'empty', count: 0 }),
  // Page prose (§14.2): the workspace's measure and type, its quoted lines callouts.
  Body: ({ data }) => <div className="ed-prose">{renderMarkdown(String(data))}</div>,
})
