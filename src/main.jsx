import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import App from './App.jsx'
import { ModulesProvider } from './context/ModulesContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ModulesProvider>
      <App />
    </ModulesProvider>
  </StrictMode>,
)
