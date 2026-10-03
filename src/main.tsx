import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// handy for debugging and browser tests
if (import.meta.env.DEV) import('./store').then(({ useStore }) => ((window as any).__store = useStore))
