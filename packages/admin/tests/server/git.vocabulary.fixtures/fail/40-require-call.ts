declare const require: (m: string) => unknown

export const f = () => require('node:child_process')
