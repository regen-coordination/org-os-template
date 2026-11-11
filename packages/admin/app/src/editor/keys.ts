// The editor's keys (L6 spec §5.4). They never take the frame's: ⌘K stays the palette (L4 §5.7), so it is
// bound to nothing here; a link is the toolbar's Link or ⌘⇧L, which asks the chrome for one (onLink).
// `/` and `@` are not keys: view.ts reads them as typed text (the slash menu, the mention picker).
import type { Schema } from 'prosemirror-model'
import type { Command } from 'prosemirror-state'
import { chainCommands, toggleMark } from 'prosemirror-commands'
import { undo, redo } from 'prosemirror-history'
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list'
import { goToNextCell } from 'prosemirror-tables'
import { inputRules, textblockTypeInputRule, wrappingInputRule, type InputRule } from 'prosemirror-inputrules'
import type { Plugin } from 'prosemirror-state'

/** The palette's key; the editor leaves it alone. */
export const PALETTE_KEY = 'Mod-k'

export interface KeyHooks {
  /** ⌘⇧L: the chrome opens its link field. */
  onLink(): void
}

/** Enter in a task item starts another (unchecked) task item; in any other item, a plain one. */
function splitItem(schema: Schema): Command {
  return (state, dispatch) => {
    const { $from } = state.selection
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d)
      if (node.type === schema.nodes.list_item) {
        return splitListItem(schema.nodes.list_item, node.attrs.checked === null ? undefined : { checked: false })(state, dispatch)
      }
    }
    return false
  }
}

const hardBreak = (schema: Schema): Command => (state, dispatch) => {
  if (dispatch) dispatch(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView())
  return true
}

/** The Hub's bindings, ahead of prosemirror-commands' baseKeymap. */
export function hubKeymap(schema: Schema, hooks: KeyHooks): Record<string, Command> {
  const item = schema.nodes.list_item
  const keys: Record<string, Command> = {
    'Mod-b': toggleMark(schema.marks.strong),
    'Mod-i': toggleMark(schema.marks.em),
    'Mod-Shift-x': toggleMark(schema.marks.strike),
    'Mod-e': toggleMark(schema.marks.code),
    'Mod-Shift-l': () => {
      hooks.onLink()
      return true
    },
    'Mod-z': undo,
    'Mod-Shift-z': redo,
    'Mod-y': redo,
    Enter: splitItem(schema),
    'Shift-Enter': hardBreak(schema),
    Tab: chainCommands(goToNextCell(1), sinkListItem(item)),
    'Shift-Tab': chainCommands(goToNextCell(-1), liftListItem(item)),
  }
  // With Shift held a browser reports the capital letter as the key; bind both spellings.
  for (const name of Object.keys(keys)) {
    const m = /^(.*Shift-)([a-z])$/.exec(name)
    if (m) keys[m[1] + m[2].toUpperCase()] = keys[name]
  }
  return keys
}

/** Markdown typed at the start of a block: `# `…`#### `, `> `, `- `, `1. `, ```` ``` ````. */
export function hubInputRules(schema: Schema): Plugin {
  const n = schema.nodes
  const rules: InputRule[] = [
    textblockTypeInputRule(/^(#{1,4})\s$/, n.heading, (m) => ({ level: m[1].length })),
    wrappingInputRule(/^\s*>\s$/, n.blockquote),
    wrappingInputRule(/^\s*[-*+]\s$/, n.bullet_list, { tight: true, bullet: '-' }),
    wrappingInputRule(/^(\d+)\.\s$/, n.ordered_list, (m) => ({ order: Number(m[1]), tight: true }), (m, node) => node.childCount + node.attrs.order === Number(m[1])),
    textblockTypeInputRule(/^```$/, n.code_block),
  ]
  return inputRules({ rules })
}
