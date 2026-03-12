import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import * as api from '../api'
import { useSessionPageState } from '../sessionState'
import { useNotifications } from '../contexts/Notifications'
import { formatDateTime, formatTripInterval, round1, toDateTimeLocalValue } from '../utils/format'
import { logInfo } from '../lib/frontendLog'
import type { BackgroundJob, DataPoint, DetectedTrip, TripTemplate } from '../api'

const PAGE_SIZE_OPTIONS = [5, 10] as const
const CHART_MINUTES_OPTIONS = [30, 60, 90, 120] as const

function getWindowRange(minutes: number): { from: string; to: string } {
  const end = new Date()
  const start = new Date(end.getTime() - minutes * 60 * 1000)
  return {
    from: start.toISOString().slice(0, 16),
    to: end.toISOString().slice(0, 16),
  }
}

const HISTORY_SESSION_DEFAULTS = {
  chartMinutes: 30,
  from: '',
  to: '',
  showChartPoints: false,
  tripsPageSize: 10,
  tripsPage: 1,
  rangeBegin: '',
  rangeEnd: '',
  templateName: '',
}

export default function History() {
  const defaultSession = useMemo(
    () => ({ ...HISTORY_SESSION_DEFAULTS, from: getWindowRange(30).from, to: getWindowRange(30).to }),
    []
  )
  const [session, setSession] = useSessionPageState('history', defaultSession)
  const { chartMinutes, showChartPoints, tripsPageSize, tripsPage, rangeBegin, rangeEnd, templateName } = session
  const from = session.from || defaultSession.from
  const to = session.to || defaultSession.to

  const [points, setPoints] = useState<DataPoint[]>([])
  const [chartTrips, setChartTrips] = useState<DetectedTrip[]>([])
  const [trips, setTrips] = useState<DetectedTrip[]>([])
  const [templates, setTemplates] = useState<TripTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingTrips, setLoadingTrips] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false)
  const [recalcConfirmMode, setRecalcConfirmMode] = useState<'recalc' | 'deleteRecalc' | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [selectedFrom, setSelectedFrom] = useState<number | null>(null)
  const [selectedTo, setSelectedTo] = useState<number | null>(null)
  const [recalcJob, setRecalcJob] = useState<BackgroundJob | null>(null)
  const zoomRef = useRef<{ start: number; end: number } | null>(null)
  const { addToast } = useNotifications()

  const loadTemplates = async () => {
    try {
      const { templates: t } = await api.getTemplates()
      setTemplates(t || [])
    } catch {
      // ignore
    }
  }

  const loadChart = async () => {
    const fromISO = new Date(from).toISOString()
    const toISO = new Date(to).toISOString()
    setLoading(true)
    setError(null)
    try {
      const data = await api.getHistory(fromISO, toISO)
      setPoints(data.points || [])
      setChartTrips(data.trips || [])
      await loadTemplates()
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const loadTrips = async () => {
    const fromISO = new Date(from).toISOString()
    const toISO = new Date(to).toISOString()
    setLoadingTrips(true)
    setError(null)
    try {
      const { trips: t } = await api.getTrips({ from: fromISO, to: toISO, limit: 500 })
      setTrips(t || [])
    } catch (e) {
      setError(String(e))
    } finally {
      setLoadingTrips(false)
    }
  }

  const load = async () => {
    await loadChart()
    await loadTrips()
  }

  const handleWindowChange = (minutes: number) => {
    const { from: f, to: t } = getWindowRange(minutes)
    setSession({ chartMinutes: minutes, from: f, to: t })
    setLoading(true)
    setError(null)
    const start = new Date(f)
    const end = new Date(t)
    api
      .getHistory(start.toISOString(), end.toISOString())
      .then((data) => {
        setPoints(data.points || [])
        setChartTrips(data.trips || [])
        return loadTemplates()
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
    loadTrips()
  }

  const handleDeleteAllTrips = async () => {
    setDeleting(true)
    setError(null)
    try {
      await api.deleteAllTrips()
      setShowDeleteAllConfirm(false)
      setChartTrips([])
      setTrips([])
      await loadTrips()
    } catch (e) {
      setError(String(e))
    } finally {
      setDeleting(false)
    }
  }

  // Load active recalculate job on mount (e.g. after page reload during long run)
  useEffect(() => {
    let cancelled = false
    api.getActiveJob('recalculate_trips').then((job) => {
      if (!cancelled && job) setRecalcJob(job)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Poll job status while running
  useEffect(() => {
    if (!recalcJob || (recalcJob.status !== 'running' && recalcJob.status !== 'pending')) return
    const interval = setInterval(async () => {
      try {
        const job = await api.getJob(recalcJob.id)
        if (!job) return
        setRecalcJob(job)
        if (job.status === 'completed') {
          addToast('Перерасчёт рейсов завершён.', 'success')
          setRecalcJob(null)
          await load()
        } else if (job.status === 'failed') {
          addToast('Перерасчёт рейсов завершился с ошибкой: ' + (job.error_message || 'неизвестная ошибка'), 'error')
          setRecalcJob(null)
        } else if (job.status === 'cancelled') {
          addToast('Перерасчёт рейсов отменён.', 'info')
          setRecalcJob(null)
        }
      } catch {
        // keep polling
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [recalcJob?.id, recalcJob?.status, addToast])

  const handleRecalculateTrips = useCallback(async (mode: 'recalc' | 'deleteRecalc') => {
    const fromISO = new Date(from).toISOString()
    const toISO = new Date(to).toISOString()
    setRecalcConfirmMode(null)
    setError(null)
    if (mode === 'deleteRecalc') {
      logInfo('Удалить и перерасчитать рейсы: запущен перерасчёт', { from: fromISO, to: toISO })
    } else {
      logInfo('Перерасчёт рейсов запущен', { from: fromISO, to: toISO })
    }
    try {
      const { job_id } = await api.startRecalculateTrips(fromISO, toISO)
      const job = await api.getJob(job_id)
      if (job) setRecalcJob(job)
    } catch (e) {
      setError(String(e))
    }
  }, [from, to])

  const hasValidInterval =
    (rangeBegin && rangeEnd) || (selectedFrom != null && selectedTo != null && selectedFrom <= selectedTo)
  const isDuplicateName = templateName.trim() && templates.some((t) => t.name.trim().toLowerCase() === templateName.trim().toLowerCase())
  const canSave = Boolean(templateName.trim() && hasValidInterval && !isDuplicateName)

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) {
      setError('Заполните имя шаблона')
      return
    }
    if (!hasValidInterval) {
      setError('Укажите интервал: поля «Начало» и «Конец» или выделение на графике')
      return
    }
    if (isDuplicateName) {
      setError('Шаблон с таким именем уже существует')
      return
    }
    let slice: DataPoint[]
    if (rangeBegin && rangeEnd) {
      const t1 = new Date(rangeBegin).getTime()
      const t2 = new Date(rangeEnd).getTime()
      if (t1 >= t2) {
        setError('Начало интервала должно быть раньше конца')
        return
      }
      slice = points.filter((p) => {
        const t = new Date(p.t).getTime()
        return t >= t1 && t <= t2
      })
    } else {
      slice = points.slice(selectedFrom!, selectedTo! + 1)
    }
    if (slice.length === 0) {
      setError('В выбранном интервале нет данных')
      return
    }
    setError(null)
    try {
      await api.createTemplate(templateName.trim(), slice)
      setSession({ templateName: '', rangeBegin: '', rangeEnd: '' })
      setSelectedFrom(null)
      setSelectedTo(null)
      zoomRef.current = null
      await loadTemplates()
    } catch (e) {
      setError(String(e))
    }
  }

  const handleResetSelection = () => {
    zoomRef.current = { start: 0, end: 100 }
    setSession({ rangeBegin: '', rangeEnd: '', templateName: '' })
    setSelectedFrom(null)
    setSelectedTo(null)
  }

  const syncDateRangeToChart = (begin: string, end: string) => {
    if (!begin || !end || !points.length) return
    const t1 = new Date(begin).getTime()
    const t2 = new Date(end).getTime()
    const from = points.findIndex((p) => new Date(p.t).getTime() >= t1)
    let to = -1
    for (let i = points.length - 1; i >= 0; i--) {
      if (new Date(points[i].t).getTime() <= t2) {
        to = i
        break
      }
    }
    if (from >= 0) setSelectedFrom(from)
    if (to >= 0) setSelectedTo(to)
    if (from >= 0 && to >= 0 && points.length > 0) {
      zoomRef.current = {
        start: (from / points.length) * 100,
        end: ((to + 1) / points.length) * 100,
      }
    }
  }

  const handleRangeBeginChange = (v: string) => {
    setSession({ rangeBegin: v })
    syncDateRangeToChart(v, rangeEnd)
  }

  const handleRangeEndChange = (v: string) => {
    setSession({ rangeEnd: v })
    syncDateRangeToChart(rangeBegin, v)
  }

  const handleShowTripOnChart = async (t: DetectedTrip) => {
    const t1 = new Date(t.started_at).getTime()
    const t2 = new Date(t.ended_at).getTime()
    const mid = (t1 + t2) / 2
    const halfMs = Math.max(15 * 60 * 1000, (t2 - t1) / 2)
    const windowStart = new Date(mid - halfMs)
    const windowEnd = new Date(mid + halfMs)
    setSession({ from: toDateTimeLocalValue(windowStart), to: toDateTimeLocalValue(windowEnd) })
    setLoading(true)
    setError(null)
    try {
      const data = await api.getHistory(windowStart.toISOString(), windowEnd.toISOString())
      setPoints(data.points || [])
      setChartTrips(data.trips || [])
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const onDataZoom = (params: { batch?: { start?: number; end?: number }[]; start?: number; end?: number }) => {
    const first = params.batch?.[0] ?? params
    const start = first.start ?? params.start ?? 0
    const end = first.end ?? params.end ?? 100
    if (points.length === 0) return
    zoomRef.current = { start, end }
    const from = Math.floor((start / 100) * points.length)
    const to = Math.min(points.length - 1, Math.max(from, Math.ceil((end / 100) * points.length) - 1))
    setSelectedFrom(from)
    setSelectedTo(to)
    setSession({ rangeBegin: toDateTimeLocalValue(points[from].t), rangeEnd: toDateTimeLocalValue(points[to].t) })
  }

  const tripsTotal = trips.length
  const tripsTotalPages = Math.max(1, Math.ceil(tripsTotal / tripsPageSize))
  const tripsPaginated = trips.slice((tripsPage - 1) * tripsPageSize, tripsPage * tripsPageSize)
  const canPrevTrips = tripsPage > 1
  const canNextTrips = tripsPage < tripsTotalPages

  useEffect(() => {
    if (tripsTotal > 0 && tripsPage > tripsTotalPages) {
      setSession((prev) => ({ ...prev, tripsPage: Math.max(1, prev.tripsPage - 1) }))
    }
  }, [tripsTotal, tripsPage, tripsTotalPages])

  const times = points.map((p) => p.t)
  const speedData = points.map((p) => round1(p.speed))
  const weightData = points.map((p) => round1(p.weight))

  const zoomStart =
    zoomRef.current != null
      ? zoomRef.current.start
      : selectedFrom != null && points.length > 0
        ? (selectedFrom / points.length) * 100
        : 0
  const zoomEnd =
    zoomRef.current != null
      ? zoomRef.current.end
      : selectedTo != null && points.length > 0
        ? ((selectedTo + 1) / points.length) * 100
        : 100

  const markAreaData = chartTrips.map((t) => {
    const i1 = times.findIndex((x) => x >= t.started_at)
    const i2 = times.findIndex((x) => x >= t.ended_at)
    const start = i1 >= 0 ? i1 : 0
    const end = i2 >= 0 ? i2 : times.length - 1
    const name = t.template_name || 'не найден'
    const startStr = formatDateTime(t.started_at)
    const endStr = formatDateTime(t.ended_at)
    const labelText = `${name}\n${startStr} — ${endStr}`
    return [
      [
        { xAxis: start, label: { show: true, formatter: () => labelText, fontSize: 10, color: '#888' } },
        { xAxis: end },
      ],
    ]
  }).flat()

  const option = {
    animation: false,
    tooltip: {
      trigger: 'axis',
      formatter: (params: { axisValue: string; marker: string; seriesName: string; value: number }[]) => {
        if (!params?.length) return ''
        const timeStr = formatDateTime(params[0].axisValue)
        const lines = params.map((p) => `${p.marker} ${p.seriesName}: ${Number(p.value).toFixed(1)}`)
        return timeStr + '<br/>' + lines.join('<br/>')
      },
    },
    legend: { show: false },
    grid: { left: 60, right: 40, top: 40, bottom: 80 },
    xAxis: {
      type: 'category',
      data: times,
      axisLabel: { formatter: (v: string) => (v ? formatDateTime(v) : '') },
    },
    yAxis: [
      { type: 'value', name: 'Скорость' },
      { type: 'value', name: 'Вес' },
    ],
    series: [
      {
        name: 'Скорость, км/ч',
        type: 'line',
        data: speedData,
        yAxisIndex: 0,
        symbol: showChartPoints ? 'circle' : 'none',
        symbolSize: showChartPoints ? 4 : undefined,
        markArea: markAreaData.length ? { silent: true, data: markAreaData, itemStyle: { color: 'rgba(88, 166, 255, 0.15)' } } : undefined,
      },
      {
        name: 'Вес, т',
        type: 'line',
        data: weightData,
        yAxisIndex: 1,
        symbol: showChartPoints ? 'circle' : 'none',
        symbolSize: showChartPoints ? 4 : undefined,
      },
    ],
    dataZoom: [
      { type: 'inside', start: zoomStart, end: zoomEnd },
      { id: 'zoom', start: zoomStart, end: zoomEnd },
    ],
  }

  return (
    <div>
      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
        <label className="history-window-row">
          <span className="history-window-label">Окно:</span>
          <select
            value={chartMinutes}
            onChange={(e) => handleWindowChange(Number(e.target.value))}
            className="history-window-select"
          >
            {CHART_MINUTES_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m} мин
              </option>
            ))}
          </select>
        </label>
        <label className="history-datetime-row">
          С <input type="datetime-local" value={from} onChange={(e) => setSession({ from: e.target.value })} />
        </label>
        <label className="history-datetime-row">
          По <input type="datetime-local" value={to} onChange={(e) => setSession({ to: e.target.value })} />
        </label>
        <button className="primary" onClick={load} disabled={loading}>
          {loading ? 'Загрузка…' : 'Загрузить график'}
        </button>
        <button type="button" onClick={loadTrips} disabled={loadingTrips}>
          {loadingTrips ? 'Загрузка…' : 'Загрузить рейсы'}
        </button>
        <button type="button" className="danger" onClick={() => setShowDeleteAllConfirm(true)}>
          Удалить все рейсы
        </button>
        <button
          type="button"
          onClick={() => setRecalcConfirmMode('recalc')}
          disabled={!!recalcJob}
          title={recalcJob ? `Идёт перерасчёт: ${recalcJob.progress_pct.toFixed(0)}%` : 'Перерасчитать рейсы по выбранному диапазону (С–По) по текущей логике распознавания'}
        >
          {recalcJob ? `Перерасчёт… ${recalcJob.progress_pct.toFixed(0)}%` : 'Перерасчитать рейсы'}
        </button>
        <button
          type="button"
          onClick={() => setRecalcConfirmMode('deleteRecalc')}
          disabled={!!recalcJob}
          title={
            recalcJob
              ? `Идёт перерасчёт: ${recalcJob.progress_pct.toFixed(0)}%`
              : 'Удалить рейсы в выбранном диапазоне (С–По) и заново рассчитать по оперативным данным'
          }
        >
          {recalcJob ? `Перерасчёт… ${recalcJob.progress_pct.toFixed(0)}%` : 'Удалить и перерасчитать рейсы'}
        </button>
        {error && <span style={{ color: 'var(--danger)' }}>{error}</span>}
      </div>

      {recalcConfirmMode && (
        <div className="modal-overlay" onClick={() => setRecalcConfirmMode(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>
              {recalcConfirmMode === 'recalc' ? 'Перерасчитать рейсы?' : 'Удалить и перерасчитать рейсы?'}
            </h3>
            <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
              {recalcConfirmMode === 'recalc'
                ? 'Рейсы в выбранном диапазоне (С–По) будут удалены и заново рассчитаны по оперативным данным и текущей логике распознавания. Продолжить?'
                : 'Рейсы, попадающие в выбранный диапазон (С–По), будут удалены и заново рассчитаны по оперативным данным. Это действие нельзя отменить.'}
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="primary" onClick={() => handleRecalculateTrips(recalcConfirmMode)}>
                Подтвердить
              </button>
              <button type="button" onClick={() => setRecalcConfirmMode(null)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteAllConfirm && (
        <div className="modal-overlay" onClick={() => !deleting && setShowDeleteAllConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Удалить все рейсы?</h3>
            <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
              Будут удалены все найденные рейсы из базы. Это действие нельзя отменить.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="danger" onClick={handleDeleteAllTrips} disabled={deleting}>
                {deleting ? 'Удаление…' : 'Удалить'}
              </button>
              <button type="button" onClick={() => setShowDeleteAllConfirm(false)} disabled={deleting}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'stretch', marginTop: '1rem', minHeight: 0 }}>
        <div className="card" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ marginTop: 0 }}>Исторические данные и рейсы</h3>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
            Прямоугольники на графике — найденные рейсы. Выделите участок ползунком или укажите интервал справа, чтобы сохранить его как шаблон.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted)', fontSize: '0.9rem', cursor: 'pointer', marginBottom: '0.5rem' }}>
            <input
              type="checkbox"
              checked={showChartPoints}
              onChange={(e) => setSession({ showChartPoints: e.target.checked })}
              style={{ width: '1rem', height: '1rem' }}
            />
            <span>Показывать точки на графике</span>
          </label>
          <ReactECharts
            option={option}
            style={{ height: 400, minHeight: 360 }}
            opts={{ notMerge: true }}
            onEvents={{ dataZoom: onDataZoom }}
          />
        </div>

        <div className="card" style={{ width: 480, flexShrink: 0 }}>
          <h3 style={{ marginTop: 0 }}>Сохранить участок как шаблон рейса</h3>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
            Укажите интервал времени <strong>или</strong> выделите участок ползунком под графиком.
          </p>
          <div className="form-row">
            <label>Начало интервала</label>
            <input
              type="datetime-local"
              value={rangeBegin}
              onChange={(e) => handleRangeBeginChange(e.target.value)}
              step="1"
            />
          </div>
          <div className="form-row">
            <label>Конец интервала</label>
            <input
              type="datetime-local"
              value={rangeEnd}
              onChange={(e) => handleRangeEndChange(e.target.value)}
              step="1"
            />
          </div>
          <div className="form-row">
            <label>Имя шаблона</label>
            <input
              value={templateName}
              onChange={(e) => setSession({ templateName: e.target.value })}
              placeholder="Например: Рейс из истории"
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button className="primary" onClick={handleSaveTemplate} disabled={!canSave}>
                Сохранить шаблон
              </button>
              <button type="button" onClick={handleResetSelection}>
                Сбросить
              </button>
            </div>
            {!hasValidInterval && (rangeBegin || rangeEnd || selectedFrom != null) && (
              <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>Заполните оба поля интервала или выделение на графике</span>
            )}
            {isDuplicateName && (
              <span style={{ color: 'var(--danger)', fontSize: '0.9rem' }}>Шаблон с таким именем уже есть</span>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>История рейсов</h3>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
          Рейсы загружаются по кнопке «Загрузить рейсы» для выбранного диапазона (С / По). Кнопка «На графике» подгружает данные графика за период рейса (не менее 30 мин) и показывает рейс прямоугольником.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          <span style={{ fontWeight: 600 }}>Всего: {tripsTotal}</span>
          <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>Показать:</span>
          {PAGE_SIZE_OPTIONS.map((size) => (
            <button
              key={size}
              type="button"
              className={tripsPageSize === size ? 'primary' : ''}
              onClick={() => {
                setSession({ tripsPageSize: size, tripsPage: 1 })
              }}
            >
              {size}
            </button>
          ))}
        </div>
        <div className="history-trips-table-wrap">
          <table className="data-table data-table-trips data-table-trips-history">
            <thead>
              <tr>
                <th>Начало</th>
                <th>Конец</th>
                <th>Интервал</th>
                <th>Порог, %</th>
                <th>Совпадение, %</th>
                <th>Шаблон</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {tripsPaginated.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: 'var(--muted)' }}>
                    Нет найденных рейсов
                  </td>
                </tr>
              )}
              {tripsPaginated.map((t) => (
                <tr key={t.id}>
                  <td>{formatDateTime(t.started_at)}</td>
                  <td>{formatDateTime(t.ended_at)}</td>
                  <td>{formatTripInterval(t.started_at, t.ended_at)}</td>
                  <td>{t.match_threshold_percent != null ? `${t.match_threshold_percent.toFixed(0)}%` : '—'}</td>
                  <td>{t.match_percent.toFixed(1)}%</td>
                  <td><span className="cell-clip">{t.template_name || 'не найден'}</span></td>
                  <td>
                    <button type="button" onClick={() => handleShowTripOnChart(t)}>
                      На графике
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          <button type="button" disabled={!canPrevTrips} onClick={() => setSession((prev) => ({ ...prev, tripsPage: prev.tripsPage - 1 }))}>
            Назад
          </button>
          <span style={{ color: 'var(--muted)' }}>
            {tripsPage} / {tripsTotalPages}
          </span>
          <button type="button" disabled={!canNextTrips} onClick={() => setSession((prev) => ({ ...prev, tripsPage: prev.tripsPage + 1 }))}>
            Вперед
          </button>
        </div>
      </div>
    </div>
  )
}
