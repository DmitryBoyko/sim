import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { NotificationsProvider } from './contexts/Notifications'
import { installGlobalHandlers } from './lib/frontendLog'
import './index.css'

installGlobalHandlers()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <NotificationsProvider>
      <App />
    </NotificationsProvider>
  </React.StrictMode>,
)
