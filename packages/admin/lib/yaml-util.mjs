// packages/admin/lib/yaml-util.mjs
//
// Small helpers shared by the lib modules. Each lives here once (Ruling P11).

/** @param {unknown} v @returns {v is Record<string, unknown>} */
export const isMap = v => typeof v === 'object' && v !== null && !Array.isArray(v)
