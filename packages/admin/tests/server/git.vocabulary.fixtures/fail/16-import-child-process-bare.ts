import { spawn } from 'child_process'

export const f = () => spawn('git', ['clean', '-fd'])
