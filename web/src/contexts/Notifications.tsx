import { createContext, useCallback, useContext, useState } from 'react'

export type Toast = {
  id: string
  message: string
  type?: 'success' | 'error' | 'info'
}

type NotificationsContextValue = {
  toasts: Toast[]
  addToast: (message: string, type?: Toast['type']) => void
  removeToast: (id: string) => void
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null)

let toastId = 0
function nextId() {
  return 'toast-' + ++toastId
}

const AUTO_DISMISS_MS = 5000

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = nextId()
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => removeToast(id), AUTO_DISMISS_MS)
  }, [removeToast])

  return (
    <NotificationsContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <div className="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast-${t.type ?? 'info'}`}
            role="alert"
          >
            <span className="toast-message">{t.message}</span>
            <button
              type="button"
              className="toast-dismiss"
              onClick={() => removeToast(t.id)}
              aria-label="Закрыть"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </NotificationsContext.Provider>
  )
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider')
  return ctx
}
