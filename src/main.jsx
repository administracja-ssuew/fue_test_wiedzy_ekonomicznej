import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import App from './App.jsx'
import { ModulesProvider } from './context/ModulesContext.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import ConnectionBanner from './components/ConnectionBanner.jsx'

// Fallback dla ekranów ładowanych leniwie (AdminPanel/Practice/LiveView) — minimalny,
// w kolorze tła aplikacji, żeby nie było migotania przy code-splittingu.
const Loading = () => (
  <div style={{ minHeight: '100vh', background: 'var(--fue-bg, #070215)' }} />
)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <ConnectionBanner />
      <ModulesProvider>
        <Suspense fallback={<Loading />}>
          <App />
        </Suspense>
      </ModulesProvider>
    </ErrorBoundary>
  </StrictMode>,
)
