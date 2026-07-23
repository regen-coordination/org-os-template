import { defineConfig } from '@playwright/test'
// Dedicated port so we never reuse a stale dev server from another project
// (the vault runs several org-os previews on 4321-4324).
const PORT = 4399
export default defineConfig({
  testDir: 'e2e',
  webServer: { command: `npm run preview -- --port ${PORT}`, port: PORT, reuseExistingServer: false, timeout: 60000 },
  use: { baseURL: `http://localhost:${PORT}` },
})
