import { useState } from 'react'
import Operational from './pages/Operational'
import Settings from './pages/Settings'
import History from './pages/History'
import Templates from './pages/Templates'
import Processes from './pages/Processes'
import Log from './pages/Log'
import Docs from './pages/Docs'

type Tab = 'operational' | 'settings' | 'templates' | 'history' | 'processes' | 'log' | 'docs'

const TAB_TITLES: Record<Tab, string> = {
  operational: 'Симуляция',
  settings: 'Настройки',
  templates: 'Шаблоны рейсов',
  history: 'История',
  processes: 'Процессы',
  log: 'Лог',
  docs: 'Документация',
}

const iconStyle = { stroke: 'currentColor', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }

export default function App() {
  const [tab, setTab] = useState<Tab>('operational')
  const [menuOpen, setMenuOpen] = useState(false)

  const go = (t: Tab) => {
    setTab(t)
    setMenuOpen(false)
  }

  return (
    <div className={`app-layout ${menuOpen ? 'sidebar-open' : ''}`}>
      <aside className="sidebar">
        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'}
          title={menuOpen ? 'Закрыть меню' : 'Открыть меню'}
        >
          <svg className="icon icon-hamburger" viewBox="0 0 24 24" width={24} height={24} {...iconStyle}>
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
        <nav className="sidebar-nav">
          <button type="button" className={tab === 'operational' ? 'active' : ''} onClick={() => go('operational')} title="Симуляция">
            <svg className="nav-icon" viewBox="0 0 24 24" width={24} height={24} {...iconStyle}>
              <path d="M3 3v18h18" />
              <path d="M7 14l4-4 4 2 5-6" />
            </svg>
            <span className="nav-label">Симуляция</span>
          </button>
          <button type="button" className={tab === 'templates' ? 'active' : ''} onClick={() => go('templates')} title="Шаблоны рейсов">
            <svg className="nav-icon" viewBox="0 0 24 24" width={24} height={24} {...iconStyle}>
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
              <rect x="9" y="3" width="6" height="4" rx="1" />
              <path d="M9 12h6M9 16h6" />
            </svg>
            <span className="nav-label">Шаблоны</span>
          </button>
          <button type="button" className={tab === 'history' ? 'active' : ''} onClick={() => go('history')} title="История">
            <svg className="nav-icon" viewBox="0 0 24 24" width={24} height={24} {...iconStyle}>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <span className="nav-label">История</span>
          </button>
          <button type="button" className={tab === 'processes' ? 'active' : ''} onClick={() => go('processes')} title="Процессы">
            <svg className="nav-icon" viewBox="0 0 24 24" width={24} height={24} {...iconStyle}>
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            <span className="nav-label">Процессы</span>
          </button>
          <button type="button" className={tab === 'log' ? 'active' : ''} onClick={() => go('log')} title="Лог">
            <svg className="nav-icon" viewBox="0 0 24 24" width={24} height={24} {...iconStyle}>
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
            </svg>
            <span className="nav-label">Лог</span>
          </button>
          <button type="button" className={tab === 'settings' ? 'active' : ''} onClick={() => go('settings')} title="Настройки">
            <svg className="nav-icon" viewBox="0 0 24 24" width={24} height={24} {...iconStyle}>
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5.64 5.64l2.12 2.12M16.24 16.24l2.12 2.12M5.64 18.36l2.12-2.12M16.24 7.76l2.12-2.12" />
            </svg>
            <span className="nav-label">Настройки</span>
          </button>
          <button type="button" className={tab === 'docs' ? 'active' : ''} onClick={() => go('docs')} title="Документация">
            <svg className="nav-icon" viewBox="0 0 24 24" width={24} height={24} {...iconStyle}>
              <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
              <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
            </svg>
            <span className="nav-label">Документация</span>
          </button>
        </nav>
      </aside>
      {menuOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
        />
      )}
      <main className="page">
        <header className="page-header">{TAB_TITLES[tab]}</header>
        <div className="page-content">
          {tab === 'operational' && <Operational />}
          {tab === 'settings' && <Settings />}
          {tab === 'templates' && <Templates />}
          {tab === 'history' && <History />}
          {tab === 'processes' && <Processes />}
          {tab === 'log' && <Log />}
          {tab === 'docs' && <Docs />}
        </div>
      </main>
    </div>
  )
}
