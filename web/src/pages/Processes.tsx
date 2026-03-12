import { useCallback, useEffect, useState } from 'react'
import * as api from '../api'
import { useNotifications } from '../contexts/Notifications'
import { useSessionPageState } from '../sessionState'
import { formatDateTime, formatTripInterval } from '../utils/format'
import type { BackgroundJob } from '../api'

const JOB_KIND_LABEL: Record<string, string> = {
  recalculate_trips: 'Перерасчёт рейсов',
}

function jobDescription(job: BackgroundJob): string {
  const kindLabel = JOB_KIND_LABEL[job.kind] ?? job.kind
  const p = job.payload as { from?: string; to?: string } | undefined
  if (p?.from && p?.to) {
    try {
      return `${kindLabel}: С ${formatDateTime(p.from)} по ${formatDateTime(p.to)}`
    } catch {
      return kindLabel
    }
  }
  return kindLabel
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'В очереди',
  running: 'Выполняется',
  completed: 'Завершён',
  failed: 'Ошибка',
  cancelled: 'Отменён',
}

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status
}

const POLL_INTERVAL_MS = 2000

const PROCESSES_SESSION_DEFAULTS = { filter: 'all' as 'all' | 'active' }

export default function Processes() {
  const { addToast } = useNotifications()
  const [session, setSession] = useSessionPageState('processes', PROCESSES_SESSION_DEFAULTS)
  const filter = session.filter

  const [jobs, setJobs] = useState<BackgroundJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deletingAllCompleted, setDeletingAllCompleted] = useState(false)
  const [showDeleteAllCompletedConfirm, setShowDeleteAllCompletedConfirm] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params =
        filter === 'active'
          ? { status: 'pending,running', limit: 50 }
          : { limit: 50 }
      const { jobs: list } = await api.getJobList(params)
      setJobs(Array.isArray(list) ? list : [])
    } catch (e) {
      setError(String(e))
      setJobs((prev) => (Array.isArray(prev) ? prev : []))
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    load()
  }, [load])

  const safeJobs = Array.isArray(jobs) ? jobs : []
  const hasActive = safeJobs.some((j) => j.status === 'running' || j.status === 'pending')
  useEffect(() => {
    if (!hasActive) return
    const t = setInterval(load, POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [hasActive, load])

  const handleCancel = async (id: string) => {
    setCancellingId(id)
    setError(null)
    try {
      await api.cancelJob(id)
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setCancellingId(null)
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    setError(null)
    try {
      await api.deleteJob(id)
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setDeletingId(null)
    }
  }

  const handleDeleteAllCompleted = async () => {
    setShowDeleteAllCompletedConfirm(false)
    setDeletingAllCompleted(true)
    setError(null)
    try {
      const { deleted } = await api.deleteCompletedJobs()
      await load()
      if (deleted > 0) {
        addToast(`Удалено завершённых процессов: ${deleted}`, 'success')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setDeletingAllCompleted(false)
    }
  }

  return (
    <div>
      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
        <span style={{ fontWeight: 600 }}>Фоновые процессы</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>Показать:</span>
          <select
            value={filter}
            onChange={(e) => setSession({ filter: e.target.value as 'all' | 'active' })}
            className="history-window-select"
          >
            <option value="all">Все (последние 50)</option>
            <option value="active">Только активные</option>
          </select>
        </label>
        <button type="button" onClick={load} disabled={loading}>
          {loading ? 'Загрузка…' : 'Обновить'}
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => setShowDeleteAllCompletedConfirm(true)}
          disabled={deletingAllCompleted || !safeJobs.some((j) => j.status === 'completed')}
          title="Удалить все процессы со статусом «Завершён»"
        >
          {deletingAllCompleted ? 'Удаление…' : 'Удалить все завершённые'}
        </button>
        {showDeleteAllCompletedConfirm && (
          <div className="card" style={{ padding: '1rem', marginTop: '0.5rem', border: '1px solid var(--danger)' }}>
            <p style={{ margin: '0 0 0.75rem 0' }}>Удалить все завершённые процессы? Это действие нельзя отменить.</p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="danger" onClick={handleDeleteAllCompleted} disabled={deletingAllCompleted}>
                Удалить
              </button>
              <button type="button" onClick={() => setShowDeleteAllCompletedConfirm(false)} disabled={deletingAllCompleted}>
                Отмена
              </button>
            </div>
          </div>
        )}
        {error && <span style={{ color: 'var(--danger)' }}>{error}</span>}
      </div>
      <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: '0.5rem' }}>
        Здесь отображаются длительные задачи (перерасчёт рейсов и др.). Можно отменить выполнение активного процесса.
      </p>
      <div className="card" style={{ marginTop: '1rem' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Назначение</th>
                <th>Статус</th>
                <th>Прогресс</th>
                <th>Начало</th>
                <th>Окончание</th>
                <th>Длительность</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {safeJobs.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} style={{ color: 'var(--muted)' }}>
                    Нет процессов
                  </td>
                </tr>
              )}
              {safeJobs.map((job) => (
                <tr key={job.id}>
                  <td style={{ maxWidth: 320 }} title={job.id}>
                    <span className="cell-clip">{jobDescription(job)}</span>
                  </td>
                  <td>{statusLabel(job.status)}</td>
                  <td>
                    {job.status === 'running' || job.status === 'pending'
                      ? `${job.progress_pct.toFixed(0)}%`
                      : '—'}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {job.started_at ? formatDateTime(job.started_at) : '—'}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {job.finished_at ? formatDateTime(job.finished_at) : '—'}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {job.started_at && job.finished_at
                      ? formatTripInterval(job.started_at, job.finished_at)
                      : '—'}
                  </td>
                  <td>
                    {(job.status === 'running' || job.status === 'pending') && (
                      <button
                        type="button"
                        className="danger"
                        onClick={() => handleCancel(job.id)}
                        disabled={cancellingId === job.id}
                      >
                        {cancellingId === job.id ? 'Отмена…' : 'Отменить'}
                      </button>
                    )}
                    {job.status === 'completed' && (
                      <button
                        type="button"
                        className="danger"
                        onClick={() => handleDelete(job.id)}
                        disabled={deletingId === job.id}
                        title="Удалить запись о процессе навсегда"
                      >
                        {deletingId === job.id ? 'Удаление…' : 'Удалить'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
