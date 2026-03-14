import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LineChart, Settings } from 'lucide-react'
import ReactECharts from 'echarts-for-react'
import * as api from '../api'
import { useSessionPageState } from '../sessionState'
import { useNotifications } from '../contexts/Notifications'
import { formatDateTime, formatDateTimeShortYear, formatTripInterval, formatDurationSeconds, round1, toDateTimeLocalValue } from '../utils/format'
import { logInfo } from '../lib/frontendLog'
import type { BackgroundJob, DataPoint, DetectedTrip, TripPhase, TripPhasesResponse, TripTemplate } from '../api'

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

function getTodayRange(): { from: string; to: string } {
  const now = new Date()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)
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
  historyTripsPanelWidthPxV3: 1200,
}
const HISTORY_TRIPS_PANEL_MIN_PX = 220
const HISTORY_TRIPS_PANEL_MAX_PX = 1250
const HISTORY_RESIZER_WIDTH_PX = 6
const HISTORY_PHASES_PANEL_MIN_PX = 256

function getPhaseType(ph: { phase_type?: string; phase?: string }): string {
  const t = ph.phase_type ?? ph.phase ?? ''
  if (t === 'load') return 'loading'
  if (t === 'unload') return 'unloading'
  return t
}

export default function History() {
  const defaultSession = useMemo(
    () => {
      const today = getTodayRange()
      return { ...HISTORY_SESSION_DEFAULTS, from: today.from, to: today.to }
    },
    []
  )
  const [session, setSession] = useSessionPageState('history', defaultSession)
  const { chartMinutes, showChartPoints, tripsPageSize, tripsPage, rangeBegin, rangeEnd, templateName, historyTripsPanelWidthPxV3 } = session
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
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null)
  const [tripPhasesData, setTripPhasesData] = useState<TripPhasesResponse | null>(null)
  const [loadingPhases, setLoadingPhases] = useState(false)
  const zoomRef = useRef<{ start: number; end: number } | null>(null)
  const historyTripsPhasesContainerRef = useRef<HTMLDivElement>(null)
  const historyTripsTableWrapperRef = useRef<HTMLDivElement>(null)
  const historyResizeStartX = useRef(0)
  const historyResizeStartWidth = useRef(0)
  const [historyResizing, setHistoryResizing] = useState(false)
  const [historyTripsSettingsModalOpen, setHistoryTripsSettingsModalOpen] = useState(false)
  const [historyChartSettingsModalOpen, setHistoryChartSettingsModalOpen] = useState(false)
  const [chartTripsPhases, setChartTripsPhases] = useState<Record<string, TripPhasesResponse>>({})
  const { addToast } = useNotifications()

  useEffect(() => {
    if (chartTrips.length === 0) {
      setChartTripsPhases({})
      return
    }
    let cancelled = false
    Promise.all(chartTrips.map((t) => api.getTripPhases(t.id)))
      .then((results) => {
        if (cancelled) return
        const map: Record<string, TripPhasesResponse> = {}
        chartTrips.forEach((t, i) => {
          if (results[i]) map[t.id] = results[i]
        })
        setChartTripsPhases(map)
      })
      .catch(() => {
        if (!cancelled) setChartTripsPhases({})
      })
    return () => { cancelled = true }
  }, [chartTrips])

  const phaseTypeLabel: Record<string, string> = {
    loading: 'Погрузка',
    transport: 'Транспортировка',
    unloading: 'Разгрузка',
    return: 'Возврат',
  }
  const phaseTypeColor: Record<string, string> = {
    loading: '#F59E0B',
    transport: '#10B981',
    unloading: '#EF4444',
    return: '#3B82F6',
  }

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
      throw e
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
      throw e
    } finally {
      setLoadingTrips(false)
    }
  }

  const load = async () => {
    await loadChart()
    await loadTrips()
  }
  const loadWithToast = async () => {
    try {
      await load()
      addToast('График и рейсы загружены.', 'success')
    } catch {
      addToast('Ошибка загрузки.', 'error')
    }
  }
  const loadTripsWithToast = async () => {
    try {
      await loadTrips()
      addToast('Рейсы загружены.', 'success')
    } catch {
      addToast('Ошибка загрузки рейсов.', 'error')
    }
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

  // Initial load for current session window (С/По) when page is opened.
  // Сохраняет состояние графика и рейсов при возвращении на страницу «История».
  useEffect(() => {
    // При первом монтировании загружаем данные для текущего диапазона.
    // useSessionPageState восстанавливает from/to, так что после навигации
    // будет подтянуто то же окно.
    load().catch(() => {
      // ошибка уже будет отражена через setError внутри loadChart/loadTrips
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDeleteAllTrips = async () => {
    setDeleting(true)
    setError(null)
    try {
      await api.deleteAllTrips()
      setShowDeleteAllConfirm(false)
      // Очистить график и список рейсов на клиентах сразу после успешного удаления.
      setPoints([])
      setChartTrips([])
      setTrips([])
      setSelectedTripId(null)
      setTripPhasesData(null)
      addToast('Все рейсы удалены.', 'success')
    } catch (e) {
      const msg = String(e)
      setError(msg)
      addToast(msg, 'error')
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

  useEffect(() => {
    if (!historyResizing) return
    const container = historyTripsPhasesContainerRef.current
    const onMove = (e: MouseEvent) => {
      if (!container) return
      const rect = container.getBoundingClientRect()
      const maxLeft = rect.width - HISTORY_RESIZER_WIDTH_PX - HISTORY_PHASES_PANEL_MIN_PX
      const deltaX = e.clientX - historyResizeStartX.current
      const next = Math.round(
        Math.max(HISTORY_TRIPS_PANEL_MIN_PX, Math.min(maxLeft, historyResizeStartWidth.current + deltaX))
      )
      setSession({ historyTripsPanelWidthPxV3: next })
    }
    const onUp = () => setHistoryResizing(false)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [historyResizing, setSession])

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
      addToast('Шаблон сохранён.', 'success')
    } catch (e) {
      const msg = String(e)
      setError(msg)
      addToast(msg, 'error')
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

  const handleSelectTrip = useCallback((t: DetectedTrip) => {
    setSelectedTripId(t.id)
    setTripPhasesData(null)
    setLoadingPhases(true)
    api.getTripPhases(t.id).then((data) => {
      setTripPhasesData(data)
    }).catch(() => {
      setTripPhasesData(null)
    }).finally(() => {
      setLoadingPhases(false)
    })
  }, [])

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

  const timeToIndex = (t: string) => {
    const i = times.findIndex((x) => x >= t)
    return i >= 0 ? i : times.length - 1
  }

  const markAreaData = chartTrips.map((t) => {
    const i1 = times.findIndex((x) => x >= t.started_at)
    const i2 = times.findIndex((x) => x >= t.ended_at)
    const start = i1 >= 0 ? i1 : 0
    const end = i2 >= 0 ? i2 : times.length - 1
    const name = t.template_name || 'не найден'
    const startStr = formatDateTime(t.started_at)
    const endStr = formatDateTime(t.ended_at)
    const phasesData = chartTripsPhases[t.id]
    const payloadStr = phasesData != null ? `Ср. вес: ${phasesData.payload_ton.toFixed(1)} т` : (t.payload_ton != null ? `Ср. вес: ${t.payload_ton.toFixed(1)} т` : '')
    const labelText = payloadStr ? `${name}\n${startStr} — ${endStr}\n${payloadStr}` : `${name}\n${startStr} — ${endStr}`
    return [
      [
        {
          xAxis: start,
          label: {
            show: true,
            formatter: () => labelText,
            fontSize: 10,
            color: '#888',
            offset: [0, -2],
            position: 'top',
          },
        },
        { xAxis: end },
      ],
    ]
  }).flat()

  const phaseColors: Record<string, string> = {
    loading: 'rgba(245, 158, 11, 0.35)',
    transport: 'rgba(16, 185, 129, 0.35)',
    unloading: 'rgba(239, 68, 68, 0.35)',
    return: 'rgba(59, 130, 246, 0.35)',
  }

  const phaseMarkAreaData: [unknown, unknown][] = []
  const markLineData: { xAxis: number }[] = []
  chartTrips.forEach((t) => {
    const phasesData = chartTripsPhases[t.id]
    if (!phasesData?.phases?.length) return
    const phases = phasesData.phases
    phases.forEach((ph, i) => {
      const phStart = timeToIndex(ph.started_at)
      const phEnd = timeToIndex(ph.ended_at)
      if (phEnd > phStart) {
        const phaseType = (ph as TripPhase).phase_type ?? getPhaseType(ph)
        phaseMarkAreaData.push([
          { xAxis: phStart, itemStyle: { color: phaseColors[phaseType] ?? 'rgba(128,128,128,0.3)' } },
          { xAxis: phEnd },
        ])
      }
      if (i < phases.length - 1) {
        const boundaryIdx = timeToIndex(ph.ended_at)
        markLineData.push({ xAxis: boundaryIdx })
      }
    })
  })

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
        markArea:
          markAreaData.length || phaseMarkAreaData.length
            ? {
                silent: true,
                data: [...markAreaData, ...phaseMarkAreaData],
                itemStyle: { color: 'rgba(88, 166, 255, 0.15)' },
              }
            : undefined,
        markLine:
          markLineData.length > 0
            ? {
                silent: true,
                symbol: ['none', 'none'],
                label: { show: false },
                lineStyle: { type: 'dashed', color: 'rgba(255,255,255,0.55)', width: 1 },
                data: markLineData,
              }
            : undefined,
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
        <label className="history-datetime-row">
          С <input type="datetime-local" value={from} onChange={(e) => setSession({ from: e.target.value })} />
        </label>
        <label className="history-datetime-row">
          По <input type="datetime-local" value={to} onChange={(e) => setSession({ to: e.target.value })} />
        </label>
        <button className="primary" onClick={loadWithToast} disabled={loading || loadingTrips}>
          {loading || loadingTrips ? 'Поиск…' : 'Найти'}
        </button>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginLeft: 'auto' }}>
          <button type="button" className="danger" onClick={() => setShowDeleteAllConfirm(true)}>
            Удалить все рейсы
          </button>
          <button
            type="button"
            onClick={() => setRecalcConfirmMode('recalc')}
            disabled={!!recalcJob}
            title={recalcJob ? `Идёт перерасчёт: ${recalcJob.progress_pct.toFixed(0)}%` : 'Перерасчитать рейсы по выбранному диапазону (С–По) по текущей логике распознавания'}
          >
            {recalcJob ? `Перерасчёт… ${recalcJob.progress_pct.toFixed(0)}%` : 'Перерасчитать рейсы за период'}
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
            {recalcJob ? `Перерасчёт… ${recalcJob.progress_pct.toFixed(0)}%` : 'Удалить и перерасчитать рейсы за период'}
          </button>
        </div>
        {error && <span style={{ color: 'var(--danger)' }}>{error}</span>}
      </div>

      {recalcConfirmMode && (
        <div className="modal-overlay" onClick={() => setRecalcConfirmMode(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>
              {recalcConfirmMode === 'recalc' ? 'Перерасчитать рейсы за период?' : 'Удалить и перерасчитать рейсы за период?'}
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <h3 style={{ margin: 0 }}>Исторические данные и рейсы</h3>
            <button
              type="button"
              onClick={() => setHistoryChartSettingsModalOpen(true)}
              title="Настройки графика"
              aria-label="Настройки графика"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 40,
                minHeight: 40,
                padding: 0,
                boxSizing: 'border-box',
              }}
            >
              <Settings size={20} strokeWidth={2} />
            </button>
          </div>
          {historyChartSettingsModalOpen && (
            <div className="modal-overlay" onClick={() => setHistoryChartSettingsModalOpen(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>Настройки графика</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted)', fontSize: '0.9rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={showChartPoints}
                      onChange={(e) => setSession({ showChartPoints: e.target.checked })}
                      style={{ width: '1rem', height: '1rem' }}
                    />
                    <span>Показывать точки на графике</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted)', fontSize: '0.9rem' }}>
                    Окно:
                    <select
                      value={chartMinutes}
                      onChange={(e) => handleWindowChange(Number(e.target.value))}
                      style={{ padding: '0.35rem 0.5rem', marginLeft: '0.5rem' }}
                    >
                      {CHART_MINUTES_OPTIONS.map((m) => (
                        <option key={m} value={m}>
                          {m} мин
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div style={{ marginTop: '1.25rem' }}>
                  <button type="button" onClick={() => setHistoryChartSettingsModalOpen(false)}>
                    Закрыть
                  </button>
                </div>
              </div>
            </div>
          )}
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

      <div className="card" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0 }}>История рейсов</h3>
          <button
            type="button"
            onClick={() => setHistoryTripsSettingsModalOpen(true)}
            title="Настройки таблицы"
            aria-label="Настройки таблицы"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 40,
              minHeight: 40,
              padding: 0,
              boxSizing: 'border-box',
            }}
          >
            <Settings size={20} strokeWidth={2} />
          </button>
        </div>
        {historyTripsSettingsModalOpen && (
          <div className="modal-overlay" onClick={() => setHistoryTripsSettingsModalOpen(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>Настройки таблицы</h3>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted)', fontSize: '0.9rem' }}>
                Показать:
                <select
                  value={tripsPageSize}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (!Number.isNaN(n)) setSession({ tripsPageSize: n, tripsPage: 1 })
                  }}
                  aria-label="Количество на странице"
                  style={{ padding: '0.35rem 0.5rem', marginLeft: '0.5rem' }}
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ marginTop: '1.25rem' }}>
                <button type="button" onClick={() => setHistoryTripsSettingsModalOpen(false)}>
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        )}
        <div
          ref={historyTripsPhasesContainerRef}
          style={{ display: 'flex', flex: 1, minHeight: 200, alignItems: 'stretch' }}
        >
          <div
            className="history-trips-table-wrap"
            style={{
              width: Math.max(HISTORY_TRIPS_PANEL_MIN_PX, Math.min(HISTORY_TRIPS_PANEL_MAX_PX, Number(historyTripsPanelWidthPxV3) ?? HISTORY_SESSION_DEFAULTS.historyTripsPanelWidthPxV3)),
              minWidth: HISTORY_TRIPS_PANEL_MIN_PX,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              ref={historyTripsTableWrapperRef}
              role="grid"
              aria-label="История рейсов"
              tabIndex={0}
              style={{ flex: 1, minHeight: 0, overflow: 'auto', outline: 'none' }}
              onKeyDown={(e) => {
                if (tripsPaginated.length === 0) return
                if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
                e.preventDefault()
                const idx = selectedTripId ? tripsPaginated.findIndex((t) => t.id === selectedTripId) : -1
                let nextIdx: number
                if (e.key === 'ArrowDown') {
                  nextIdx = idx < tripsPaginated.length - 1 ? idx + 1 : (idx < 0 ? 0 : idx)
                } else {
                  nextIdx = idx > 0 ? idx - 1 : (idx < 0 ? tripsPaginated.length - 1 : idx)
                }
                if (nextIdx >= 0 && nextIdx < tripsPaginated.length) handleSelectTrip(tripsPaginated[nextIdx])
              }}
            >
              <table className="data-table data-table-trips data-table-trips-history">
                <thead>
                  <tr>
                    <th>Начало</th>
                    <th>Конец</th>
                    <th>Интервал</th>
                    <th>Порог, %</th>
                    <th>Совпадение, %</th>
                    <th>Груз, т</th>
                    <th>Ср. вес (трансп.)</th>
                    <th>Шаблон</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {tripsPaginated.length === 0 && (
                    <tr>
                      <td colSpan={9} style={{ color: 'var(--muted)' }}>
                        Нет найденных рейсов
                      </td>
                    </tr>
                  )}
                  {tripsPaginated.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => {
                        historyTripsTableWrapperRef.current?.focus()
                        handleSelectTrip(t)
                      }}
                      className={selectedTripId === t.id ? 'selected' : ''}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>{formatDateTimeShortYear(t.started_at)}</td>
                      <td>{formatDateTimeShortYear(t.ended_at)}</td>
                      <td>{formatTripInterval(t.started_at, t.ended_at)}</td>
                      <td>{t.match_threshold_percent != null ? `${t.match_threshold_percent.toFixed(0)}%` : '—'}</td>
                      <td>{t.match_percent.toFixed(1)}%</td>
                      <td>{t.payload_ton != null ? t.payload_ton.toFixed(1) : '—'}</td>
                      <td>{t.transport_avg_weight_ton != null ? `${round1(t.transport_avg_weight_ton)} т` : '—'}</td>
                      <td><span className="cell-clip" title={t.template_name || 'не найден'}>{t.template_name || 'не найден'}</span></td>
                      <td style={{ whiteSpace: 'nowrap' }} onClick={(ev) => ev.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => handleShowTripOnChart(t)}
                          title="На графике"
                          aria-label="На графике"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            minWidth: 40,
                            minHeight: 40,
                            padding: 0,
                            boxSizing: 'border-box',
                          }}
                        >
                          <LineChart size={20} strokeWidth={2} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginTop: '0.5rem', flexWrap: 'wrap', flexShrink: 0 }}>
              <span style={{ fontWeight: 600 }}>Всего: {tripsTotal}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
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

          <div
            role="separator"
            aria-label="Изменить ширину секций"
            tabIndex={0}
            onMouseDown={(e) => {
              historyResizeStartX.current = e.clientX
              historyResizeStartWidth.current = Math.max(
                HISTORY_TRIPS_PANEL_MIN_PX,
                Math.min(HISTORY_TRIPS_PANEL_MAX_PX, Number(historyTripsPanelWidthPxV3) ?? HISTORY_SESSION_DEFAULTS.historyTripsPanelWidthPxV3)
              )
              setHistoryResizing(true)
            }}
            style={{
              width: HISTORY_RESIZER_WIDTH_PX,
              flexShrink: 0,
              cursor: 'col-resize',
              background: 'transparent',
              alignSelf: 'stretch',
            }}
          />

          <div className="card" style={{ flex: 1, minWidth: HISTORY_PHASES_PANEL_MIN_PX, display: 'flex', flexDirection: 'column', minHeight: 0, marginTop: 0 }}>
            <h3 style={{ marginTop: 0, flexShrink: 0 }}>Фазы рейса</h3>
            <div style={{ height: 4, marginTop: 2, marginBottom: 6, flexShrink: 0 }}>
              <div
                className="phases-loading-bar"
                style={{
                  opacity: loadingPhases ? 1 : 0,
                  transition: 'opacity 0.25s ease-out',
                  pointerEvents: 'none',
                }}
                aria-hidden
              />
            </div>
            {!selectedTripId ? (
              <p style={{ color: 'var(--muted)', margin: 0 }}>Выберите рейс в таблице слева</p>
            ) : loadingPhases ? (
              <div style={{ flex: 1, minHeight: 0 }} />
            ) : tripPhasesData && tripPhasesData.phases.length > 0 ? (
              <div style={{ overflowX: 'auto', flex: 1, minHeight: 0 }}>
                <table className="data-table operational-phases-table">
                  <thead>
                    <tr>
                      <th>Фаза</th>
                      <th>Начало</th>
                      <th>Конец</th>
                      <th>Длительность</th>
                      <th>Ср. скорость</th>
                      <th>Ср. вес</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tripPhasesData.phases.map((ph: TripPhase, i: number) => {
                      const phaseType = getPhaseType(ph)
                      const phaseColor = phaseTypeColor[phaseType] ?? '#888'
                      return (
                        <tr key={i}>
                          <td className="phase-cell-with-bar" style={{ position: 'relative', paddingLeft: 14 }}>
                            <span
                              className="phase-row-bar"
                              style={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                bottom: 0,
                                width: 6,
                                backgroundColor: phaseColor,
                                borderRadius: 2,
                              }}
                            />
                            {phaseTypeLabel[phaseType] ?? phaseType}
                          </td>
                          <td>{formatDateTimeShortYear(ph.started_at ?? '')}</td>
                          <td>{formatDateTimeShortYear(ph.ended_at ?? '')}</td>
                          <td>{formatDurationSeconds(ph.duration_sec ?? 0)}</td>
                          <td>{round1(ph.avg_speed_kmh ?? 0)} км/ч</td>
                          <td>{round1(ph.avg_weight_ton ?? 0)} т</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ color: 'var(--muted)', margin: 0 }}>Нет данных о фазах</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
