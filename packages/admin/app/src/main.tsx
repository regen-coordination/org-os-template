import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.tsx'
import { applySkin, chosenSkin } from './skin.ts'
import './design/fonts/fonts.css'
import '@xyflow/react/dist/base.css'
import './design/skins/index.css'
import './design/base.css'
import './design/design.css'

applySkin(chosenSkin()) // before the first paint, so no frame is drawn without tokens
const queryClient = new QueryClient()
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
