import fs from 'node:fs'
import zlib from 'node:zlib'
const raw = fs.readFileSync('dist/graph.json')
const gz = zlib.gzipSync(raw).length
console.log(`graph.json: ${(raw.length / 1e6).toFixed(2)}MB raw, ${(gz / 1e6).toFixed(2)}MB gz`)
if (gz > 1_000_000) { console.error('✗ graph payload exceeds 1MB gzipped budget'); process.exit(1) }
console.log('✓ budgets ok')
