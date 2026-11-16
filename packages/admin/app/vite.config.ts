import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:4680', ws: true },
      '/instance-skin.css': { target: 'http://localhost:4680' }, // the instance's own skin (server/instanceSkin.ts)
      '/instance-assets': { target: 'http://localhost:4680' }, // its images (server/instanceAssets.ts)
    },
  },
})
