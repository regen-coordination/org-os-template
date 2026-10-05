// yaml.dump conventions shared by every generated file — if two writers disagree the output restyles.
export const YAML_OPTS = { lineWidth: 100, noRefs: true, sortKeys: false };
// Code-unit comparison, never localeCompare: sort order must not shift under another ICU build or LANG.
export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
