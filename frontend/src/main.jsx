import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import VolunteerSignup from './VolunteerSignup.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/^\/volunteers(?:\/|$)/.test(window.location.pathname) ? <VolunteerSignup /> : <App />}
  </StrictMode>,
)
