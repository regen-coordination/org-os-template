// shortcuts.mjs — the one decision behind the prompt bar's keys: should this
// key event move between pages? Free of the DOM so it can be tested.
// PromptBar.astro supplies the facts about the page.

/**
 * @param {{key: string, shiftKey: boolean, metaKey: boolean, ctrlKey: boolean, altKey: boolean, repeat: boolean, defaultPrevented: boolean}} event
 * @param {{activeTag: string | null, barVisible: boolean, dialogOpen: boolean}} page
 *   activeTag is the tag name of the focused element, or null when there is none.
 * @returns {"ArrowLeft" | "ArrowRight" | null} the hint to press, or null to leave the key alone
 */
export function pageShortcut(event, page) {
  if (event.defaultPrevented || event.repeat) return null;
  if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return null;
  if (!page.barVisible || page.dialogOpen) return null;
  // Only when nothing has focus: a focused code block, link, table or field
  // uses the arrow keys itself.
  if (page.activeTag !== null && page.activeTag !== "BODY" && page.activeTag !== "HTML") return null;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") return event.key;
  return null;
}
