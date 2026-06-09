import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'

// Gdy nowy Service Worker (po deployu) przejmie kontrolę — odśwież stronę raz, żeby
// świeży kod wszedł automatycznie (bez ręcznego czyszczenia cache). Nie przeładowuje
// przy PIERWSZEJ instalacji (gdy wcześniej nie było SW).
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller
  let refreshing = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return
    refreshing = true
    if (hadController) window.location.reload()
  })
}
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
