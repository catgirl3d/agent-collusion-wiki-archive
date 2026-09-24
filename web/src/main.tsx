import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import './styles/tokens.css'
import './styles/ui.css'
import './index.css'
import './styles/research.css'
import './styles/selection-popup.css'
import './styles/agent-dossier.css'
import './styles/calendar.css'
import './styles/download.css'
import './styles/mcp.css'
import './styles/network.css'
import './styles/pair-evidence.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
