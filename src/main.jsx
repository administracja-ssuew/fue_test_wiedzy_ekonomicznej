import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import App from './App.jsx'
import { ModulesProvider } from './context/ModulesContext.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import ConnectionBanner from './components/ConnectionBanner.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <ConnectionBanner />
      <ModulesProvider>
        <App />
      </ModulesProvider>
    </ErrorBoundary>
  </StrictMode>,
)
