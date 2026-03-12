import { useMemo, useState } from 'react'
import * as api from '../api'
import { useNotifications } from '../contexts/Notifications'
import { useSessionPageState } from '../sessionState'
import { formatDateTime, toDateTimeLocalValue } from '../utils/format'
import type { AppLogEntry } from '../api'

const LOG_SESSION_DEFAULTS = {
  from: '',
  to: '',
  source: '' as '' | 'backend' | 'frontend',
  order: 'desc' as 'asc' | 'desc',
  limit: 500,
}

function getDefaultRange(): { from: string; to: string } {
  const end = new Date()
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000)
  return {
    from: toDateTimeLocalValue(start),
    to: toDateTimeLocalValue(end),
  }
}

const SOURCE_OPTIONS: { value: '' | 'backend' | 'frontend'; label: string }[] = [
  { value: '', label: 'Все' },
  { value: 'backend', label: 'Backend' },
  { value: 'frontend', label: 'Frontend' },
]

const ORDER_OPTIONS: { value: 'asc' | 'desc'; label: string }[] = [
  { value: 'desc', label: 'Сначала новые' },
  { value: 'asc', label: 'Сначала старые' },
]

const LIMIT_OPTIONS = [200, 500, 1000] as const

export default function Log() {
  const defaultRange = useMemo(getDefaultRange, [])
  const defaultSession = useMemo(
    () => ({ ...LOG_SESSION_DEFAULTS, from: defaultRange.from, to: defaultRange.to }),
    [defaultRange.from, defaultRange.to]
  )
  const [session, setSession] = useSessionPageState('log', defaultSession)
  const { from, to, source, order, limit } = session

  const [logs, setLogs] = useState<AppLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { addToast } = useNotifications()

  const load = async () => {
    if (!from || !to) {
      setError('Укажите период (от и до)')
      return
    }
    const fromISO = new Date(from).toISOString()
    const toISO = new Date(to).toISOString()
    if (new Date(from) > new Date(to)) {
      setError('«От» должно быть раньше «до»')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { logs: list } = await api.getLogs({
        from: fromISO,
        to: toISO,
        source: source || undefined,
        order,
        limit,
      })
      setLogs(list || [])
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteLog = async () => {
    if (!from || !to) {
      addToast('Укажите период (От и До)', 'error')
      return
    }
    const fromISO = new Date(from).toISOString()
    const toISO = new Date(to).toISOString()
    if (new Date(from) > new Date(to)) {
      addToast('«От» должно быть раньше «До»', 'error')
      return
    }
    setDeleting(true)
    try {
      const { deleted } = await api.deleteLogs({ from: fromISO, to: toISO })
      addToast(`Удалено записей лога: ${deleted}`, 'success')
      setShowDeleteConfirm(false)
      load()
    } catch (e) {
      addToast(String(e), 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>От</span>
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setSession({ from: e.target.value })}
            style={{ padding: '0.35rem 0.5rem' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>До</span>
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setSession({ to: e.target.value })}
            style={{ padding: '0.35rem 0.5rem' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>Источник</span>
          <select
            value={source}
            onChange={(e) => setSession({ source: (e.target.value || '') as '' | 'backend' | 'frontend' })}
            style={{ padding: '0.35rem 0.5rem', minWidth: '8rem' }}
          >
            {SOURCE_OPTIONS.map((o) => (
              <option key={o.value || 'all'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>Сортировка</span>
          <select
            value={order}
            onChange={(e) => setSession({ order: e.target.value as 'asc' | 'desc' })}
            style={{ padding: '0.35rem 0.5rem', minWidth: '10rem' }}
          >
            {ORDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>Лимит</span>
          <select
            value={limit}
            onChange={(e) => setSession({ limit: Number(e.target.value) })}
            style={{ padding: '0.35rem 0.5rem' }}
          >
            {LIMIT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="primary" onClick={load} disabled={loading}>
          {loading ? 'Загрузка…' : 'Загрузить'}
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => setShowDeleteConfirm(true)}
          disabled={loading}
          title="Удалить записи лога за выбранный период (От–До)"
        >
          Удалить лог
        </button>
        {error && <span style={{ color: 'var(--danger)' }}>{error}</span>}
      </div>

      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => !deleting && setShowDeleteConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Удалить лог?</h3>
            <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
              Будут удалены все записи лога в выбранном диапазоне дат (От–До). Это действие нельзя отменить. Продолжить?
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="danger" onClick={handleDeleteLog} disabled={deleting}>
                {deleting ? 'Удаление…' : 'Удалить'}
              </button>
              <button type="button" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: '1rem', overflow: 'hidden' }}>
        <h3 style={{ marginTop: 0 }}>Записи лога</h3>
        {logs.length === 0 && !loading && (
          <p style={{ color: 'var(--muted)', margin: 0 }}>Выберите период и нажмите «Загрузить».</p>
        )}
        {logs.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table data-table-logs">
              <thead>
                <tr>
                  <th>Время</th>
                  <th>Источник</th>
                  <th>Уровень</th>
                  <th>Сообщение</th>
                  <th>Детали</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((entry) => (
                  <tr key={entry.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(entry.created_at)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{entry.source}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className={`log-level log-level-${entry.level}`}>{entry.level}</span>
                    </td>
                    <td style={{ wordBreak: 'break-word', maxWidth: '40rem' }}>{entry.message}</td>
                    <td style={{ wordBreak: 'break-word', maxWidth: '28rem', fontSize: '0.85rem', color: 'var(--muted)' }}>
                      {entry.payload != null && entry.payload !== undefined
                        ? (() => {
                            const raw = typeof entry.payload === 'string'
                              ? entry.payload
                              : JSON.stringify(entry.payload, null, 2)
                            return raw.length > 600 ? raw.slice(0, 600) + '…' : raw
                          })()
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
