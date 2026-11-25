// search.mjs — the decisions behind the Search control, free of the DOM so
// they can be tested. Search.astro supplies load/show/fallback.

/**
 * Load the search assets and show the dialog. If either step fails — the dev
 * server has no index, the viewer is offline, a blocker ate the script — send
 * the viewer to the docs index rather than leaving a control that does nothing.
 * @returns {Promise<"shown" | "fallback">}
 */
export async function openSearch({ load, show, fallback }) {
  try {
    await load();
    show();
    return "shown";
  } catch {
    fallback();
    return "fallback";
  }
}

/** True when a keystroke belongs to a field, not to a page shortcut. */
export function isTypingTarget(el) {
  if (!el) return false;
  return el.isContentEditable === true || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName ?? "");
}
