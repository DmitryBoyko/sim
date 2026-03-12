import { useCallback, useEffect, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import * as api from '../api'
import { useWebSocket } from '../hooks/useWebSocket'
import { useSessionPageState } from '../sessionState'
import { logError } from '../lib/frontendLog'
import { formatDateTime, formatDurationSeconds, formatTripInterval, formatMs, round1 } from '../utils/format'
import type { AppSettings, DataPoint, DetectedTrip, OperationalStats, RecognitionAnalysisState } from '../api'

const CHART_MINUTES_OPTIONS = [30, 60, 90, 120] as const
const TRIPS_LIMIT_OPTIONS = [10, 20, 50] as const

const iconStyle = { stroke: 'currentColor', fill: 'none' as const, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const OPERATIONAL_SESSION_DEFAULTS = {
  chartMinutes: 30,
  tripsLimit: 10,
  showChartPoints: false,
  showSlideZone: false,
}

export default function Operational() {
  const [session, setSession] = useSessionPageState('operational', OPERATIONAL_SESSION_DEFAULTS)
  const { chartMinutes, tripsLimit, showChartPoints, showSlideZone } = session

  const [points, setPoints] = useState<DataPoint[]>([])
  const [trips, setTrips] = useState<DetectedTrip[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [analysis, setAnalysis] = useState<RecognitionAnalysisState | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<'start' | 'stop' | 'clear' | null>(null)
  const [selectedFrom, setSelectedFrom] = useState<number | null>(null)
  const [selectedTo, setSelectedTo] = useState<number | null>(null)
  const [stats, setStats] = useState<OperationalStats | null>(null)
  const [statsTick, setStatsTick] = useState(0)
  const zoomRef = useRef<{ start: number; end: number } | null>(null)
  const tripsLimitRef = useRef(tripsLimit)
  tripsLimitRef.current = tripsLimit

  const loadData = useCallback(async (minutes: number) => {
    try {
      const { points: p } = await api.getOperationalData(minutes)
      setPoints(p || [])
    } catch (e) {
      setError(String(e))
    }
  }, [])

  const loadTrips = useCallback(async () => {
    try {
      const { trips: t } = await api.getTrips({ limit: tripsLimit })
      setTrips(t || [])
    } catch (e) {
      setError(String(e))
    }
  }, [tripsLimit])

  useWebSocket({
    onPoint: (p) => {
      setPoints((prev) => {
        const next = [...prev, p]
        const cutoff = Date.now() - chartMinutes * 60 * 1000
        return next.filter((x) => new Date(x.t).getTime() > cutoff)
      })
    },
    onTripFound: (t) => {
      setTrips((prev) => [
        {
          id: t.id,
          started_at: t.started_at,
          ended_at: t.ended_at,
          template_name: t.template_name,
          match_threshold_percent: t.match_threshold_percent,
          match_percent: t.match_percent,
          phases: t.phases,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ].slice(0, tripsLimitRef.current))
    },
    onGeneratorStatus: (s) => setRunning(s.running),
    onAnalysisState: setAnalysis,
  })

  useEffect(() => {
    loadData(chartMinutes)
    loadTrips()
  }, [loadData, loadTrips, chartMinutes, tripsLimit])

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {})
  }, [])

  useEffect(() => {
    api.getRecognitionAnalysis().then(setAnalysis).catch(() => {})
  }, [])

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => api.getRecognitionAnalysis().then(setAnalysis).catch(() => {}), 1000)
    return () => clearInterval(id)
  }, [running])

  const loadStats = useCallback(async () => {
    try {
      const data = await api.getOperationalStats()
      setStats(data)
      setRunning(data.running)
    } catch (e) {
      logError('Operational stats load failed', {
        component: 'Operational',
        function: 'loadStats',
        url: '/api/data/operational/stats',
        error: String(e),
      })
    }
  }, [])

  useEffect(() => {
    loadStats()
    const intervalMs = running ? 2000 : 30000
    const id = setInterval(loadStats, intervalMs)
    return () => clearInterval(id)
  }, [loadStats, running])

  useEffect(() => {
    if (!running || !stats?.last_started_at) return
    const id = setInterval(() => setStatsTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [running, stats?.last_started_at])

  const recognitionEnabled = settings?.recognition?.enabled ?? false
  const handleToggleRecognition = async () => {
    if (!settings) return
    const next = !settings.recognition.enabled
    try {
      await api.putSettings({
        ...settings,
        recognition: { ...settings.recognition, enabled: next },
      })
      setSettings((prev) => (prev ? { ...prev, recognition: { ...prev.recognition, enabled: next } } : null))
    } catch (e) {
      setError(String(e))
    }
  }

  const handleStart = async () => {
    setError(null)
    try {
      await api.controlStart()
      setRunning(true)
    } catch (e) {
      setError(String(e))
    }
  }

  const handleStop = async () => {
    try {
      await api.controlStop()
      setRunning(false)
    } catch (e) {
      setError(String(e))
    }
  }

  const handleClear = async () => {
    try {
      await api.controlClear()
      setPoints([])
      setTrips([])
    } catch (e) {
      setError(String(e))
    }
  }

  const runConfirmedAction = async () => {
    if (confirmAction === 'start') await handleStart()
    else if (confirmAction === 'stop') await handleStop()
    else if (confirmAction === 'clear') await handleClear()
    setConfirmAction(null)
  }

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

  const slidingWindowMarkArea =
    showSlideZone &&
    analysis?.window_interval_start &&
    analysis?.window_interval_end &&
    points.length > 0
      ? (() => {
          const t1 = new Date(analysis.window_interval_start).getTime()
          const t2 = new Date(analysis.window_interval_end).getTime()
          const from = points.findIndex((p) => new Date(p.t).getTime() >= t1)
          let to = -1
          for (let i = points.length - 1; i >= 0; i--) {
            if (new Date(points[i].t).getTime() <= t2) {
              to = i
              break
            }
          }
          if (from < 0 || to < 0 || from > to) return undefined
          return {
            silent: true,
            data: [[{ xAxis: from, label: { show: true, formatter: 'Слайд', fontSize: 10, color: '#888' } }, { xAxis: to }]],
            itemStyle: { color: 'rgba(88, 166, 255, 0.12)' },
          }
        })()
      : undefined

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
        markArea: slidingWindowMarkArea,
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
  }

  return (
    <div>
      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <button
          type="button"
          className="primary"
          onClick={() => setConfirmAction('start')}
          disabled={running}
          title="Запустить генерацию"
        >
          <svg viewBox="0 0 24 24" width={20} height={20} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} {...iconStyle}>
            <path d="M5 3l14 9-14 9V3z" />
          </svg>
          Старт
        </button>
        <button
          type="button"
          onClick={() => setConfirmAction('stop')}
          disabled={!running}
          title="Остановить генерацию"
        >
          <svg viewBox="0 0 24 24" width={20} height={20} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} {...iconStyle}>
            <rect x="6" y="6" width="12" height="12" />
          </svg>
          Стоп
        </button>
        <button type="button" onClick={() => setConfirmAction('clear')} title="Очистить оперативные данные и буфер распознавания">
          <svg viewBox="0 0 24 24" width={20} height={20} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} {...iconStyle}>
            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6" />
          </svg>
          Очистить
        </button>
        {confirmAction && (
          <div className="modal-overlay" onClick={() => setConfirmAction(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3 style={{ marginTop: 0 }}>
                {confirmAction === 'start' && 'Запустить генерацию?'}
                {confirmAction === 'stop' && 'Остановить генерацию?'}
                {confirmAction === 'clear' && 'Очистить данные?'}
              </h3>
              <p style={{ color: 'var(--muted)', marginBottom: '1rem', whiteSpace: 'pre-line' }}>
                {confirmAction === 'start' && 'При выполнении:\n• Начнётся генерация имитационных данных (скорость и вес) по фазам рейса.\n• Точки будут поступать в поток и отображаться на графике.\n• При включённом распознавании слайд будет сравниваться с шаблонами.'}
                {confirmAction === 'stop' && 'При выполнении:\n• Генерация будет остановлена.\n• Новые точки перестанут поступать; уже накопленные данные и график сохранятся.\n• Распознавание прекратит обновляться до следующего запуска.'}
                {confirmAction === 'clear' && 'При выполнении:\n• Очистятся оперативные данные: очередь точек, запись в БД, буфер окна распознавания.\n• График «Скорость и вес» и таблица «Найденные рейсы» на странице обнулятся.\n• Записи о ранее найденных рейсах в БД не удаляются (они остаются в «История рейсов»).'}
              </p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className={confirmAction === 'start' ? 'primary' : ''}
                  onClick={runConfirmedAction}
                >
                  {confirmAction === 'start' && 'Запустить'}
                  {confirmAction === 'stop' && 'Остановить'}
                  {confirmAction === 'clear' && 'Очистить'}
                </button>
                <button type="button" onClick={() => setConfirmAction(null)}>
                  Отмена
                </button>
              </div>
            </div>
          </div>
        )}
        <span className={`generation-status ${running ? 'running' : ''}`} style={{ marginLeft: '1rem' }}>
          <span className="generation-status-text">{running ? 'Генерация идёт' : 'Остановлено'}</span>
        </span>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: '1rem', cursor: 'pointer' }}>
          <span style={{ fontSize: '0.9rem' }}>Включить распознавание</span>
          <input
            type="checkbox"
            checked={recognitionEnabled}
            onChange={handleToggleRecognition}
            style={{ width: '1.1rem', height: '1.1rem' }}
          />
        </label>
        {error && <span style={{ color: 'var(--danger)' }}>{error}</span>}
      </div>

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'stretch', marginTop: '1rem', minHeight: 0 }}>
        <div className="card" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <h3 style={{ margin: 0 }}>Скорость и вес</h3>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted)', fontSize: '0.9rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showSlideZone}
                onChange={(e) => setSession({ showSlideZone: e.target.checked })}
                style={{ width: '1rem', height: '1rem' }}
              />
              <span>Показывать анализируемый интервал (Слайд)</span>
            </label>
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
              Диапазон:
              <select
                value={chartMinutes}
                onChange={(e) => setSession({ chartMinutes: Number(e.target.value) })}
                style={{ padding: '0.25rem 0.5rem' }}
              >
                {CHART_MINUTES_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m} мин
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ flex: 1, minHeight: 360 }}>
            <ReactECharts option={option} style={{ height: '100%', minHeight: 360 }} opts={{ notMerge: true }} onEvents={{ dataZoom: onDataZoom }} />
          </div>
        </div>

        <div className="card" style={{ width: 540, flexShrink: 0 }}>
          <h3 style={{ marginTop: 0 }}>Анализ</h3>
          {analysis ? (
            <>
              <div style={{ background: 'rgba(255, 255, 255, 0.05)', borderRadius: 6, padding: '0.75rem 1rem', marginBottom: '0.75rem' }}>
                <p style={{ margin: '0.5rem 0', fontSize: '0.95rem' }}>
                  <strong>Загружено шаблонов:</strong> {analysis.templates_loaded}
                </p>
                <p style={{ margin: '0.5rem 0', fontSize: '0.95rem' }}>
                  <strong>Накоплено точек:</strong> скорость {analysis.speed_points}, вес {analysis.weight_points}
                </p>
                {analysis.window_interval_start && analysis.window_interval_end && (
                  <p style={{ margin: '0.5rem 0', fontSize: '0.95rem' }}>
                    <strong>Интервал:</strong> с {formatDateTime(analysis.window_interval_start)} по {formatDateTime(analysis.window_interval_end)}
                  </p>
                )}
                <p style={{ margin: '0.5rem 0', fontSize: '0.95rem' }}>
                  <strong>Вектор для слайда посчитан:</strong> {analysis.vector_computed ? 'Да' : 'Нет'}
                </p>
                {(analysis.vector_compute_time_ms != null || analysis.vector_computed) && (
                  <p style={{ margin: '0.5rem 0', fontSize: '0.95rem' }}>
                    <strong>Время расчета вектора:</strong> {analysis.vector_compute_time_ms != null ? `${formatMs(analysis.vector_compute_time_ms)} мс` : '—'}
                  </p>
                )}
                {(analysis.template_compare_time_ms != null || analysis.vector_computed) && (
                  <p style={{ margin: '0.5rem 0', fontSize: '0.95rem' }}>
                    <strong>Время сравнения вектора по шаблонам:</strong> {analysis.template_compare_time_ms != null ? `${formatMs(analysis.template_compare_time_ms)} мс` : '—'}
                  </p>
                )}
                {analysis.best_match_window && (
                  <p style={{ margin: '0.5rem 0', fontSize: '0.95rem' }}>
                    <strong>Лучшее совпадение:</strong> окно {analysis.best_match_window}, шаблон «{analysis.best_match_name}» — {analysis.best_match_percent.toFixed(1)}%
                  </p>
                )}
              </div>
              {analysis.comparisons && analysis.comparisons.length > 0 && (
                <div style={{ background: 'rgba(255, 255, 255, 0.05)', borderRadius: 6, padding: '0.75rem 1rem' }}>
                  <strong style={{ fontSize: '0.9rem' }}>Сравнение с шаблонами:</strong>
                  <ul style={{ listStyle: 'none', padding: 0, margin: '0.25rem 0 0', fontSize: '0.9rem', maxHeight: '12rem', overflowY: 'auto' }}>
                    {[...analysis.comparisons]
                      .sort((a, b) => b.match_percent - a.match_percent)
                      .map((c, i) => (
                        <li key={c.template_id + String(i)} style={{ padding: '0.25rem 0', borderBottom: '1px solid var(--border)' }}>
                          {(c.template_name || 'не найден')} (скорость {c.speed_count}, вес {c.weight_count}) — {c.match_percent.toFixed(1)}%
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p style={{ color: 'var(--muted)', margin: 0 }}>Загрузка…</p>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'stretch', marginTop: '1rem', minHeight: 0 }}>
        <div className="card" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ marginTop: 0 }}>Найденные рейсы</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>Показать последние:</span>
            {TRIPS_LIMIT_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                className={tripsLimit === n ? 'primary' : ''}
                onClick={() => {
                  setSession({ tripsLimit: n })
                }}
              >
                {n}
              </button>
            ))}
          </div>
          <div style={{ overflowX: 'auto', flex: 1, minHeight: 0 }}>
            <table className="data-table data-table-trips data-table-trips-found">
              <thead>
                <tr>
                  <th>Начало</th>
                  <th>Конец</th>
                  <th>Интервал</th>
                  <th>Порог, %</th>
                  <th>Совпадение, %</th>
                  <th className="col-template">Шаблон</th>
                </tr>
              </thead>
              <tbody>
                {trips.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ color: 'var(--muted)' }}>Нет найденных рейсов</td>
                  </tr>
                )}
                {trips.map((t) => (
                  <tr key={t.id}>
                    <td>{formatDateTime(t.started_at)}</td>
                    <td>{formatDateTime(t.ended_at)}</td>
                    <td>{formatTripInterval(t.started_at, t.ended_at)}</td>
                    <td>{t.match_threshold_percent != null ? `${t.match_threshold_percent.toFixed(0)}%` : '—'}</td>
                    <td>{t.match_percent.toFixed(1)}%</td>
                    <td className="col-template"><span className="cell-clip">{t.template_name || 'не найден'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ width: 540, flexShrink: 0 }}>
        <h3 style={{ marginTop: 0 }}>Статистика</h3>
        {stats ? (
          <div style={{ background: 'rgba(255, 255, 255, 0.05)', borderRadius: 6, padding: '0.75rem 1rem' }}>
            <p style={{ margin: '0.5rem 0', fontSize: '0.95rem' }}>
              <strong>Последний запуск:</strong>{' '}
              {stats.last_started_at ? formatDateTime(stats.last_started_at) : '—'}
            </p>
            <p style={{ margin: '0.5rem 0', fontSize: '0.95rem' }}>
              <strong>Длительность сеанса:</strong>{' '}
              {stats.last_started_at && running
                ? formatDurationSeconds((Date.now() - new Date(stats.last_started_at).getTime()) / 1000)
                : '—'}
            </p>
            <p style={{ margin: '0.5rem 0', fontSize: '0.95rem' }}>
              <strong>Точек (скорость):</strong> {stats.points_since_start.toLocaleString()}
            </p>
            <p style={{ margin: '0.5rem 0', fontSize: '0.95rem' }}>
              <strong>Точек (вес):</strong> {stats.points_since_start.toLocaleString()}
            </p>
            <p style={{ margin: '0.5rem 0', fontSize: '0.95rem' }}>
              <strong>Рейсов найдено:</strong> {stats.trips_since_start.toLocaleString()}
            </p>
            <p style={{ margin: '0.5rem 0', fontSize: '0.95rem' }}>
              <strong>Активных процессов:</strong> {stats.active_jobs_count}
            </p>
            {stats.last_trip_at && (
              <p style={{ margin: '0.5rem 0', fontSize: '0.95rem' }}>
                <strong>Последний рейс:</strong> {formatDateTime(stats.last_trip_at)}
              </p>
            )}
          </div>
        ) : (
          <p style={{ color: 'var(--muted)', margin: 0 }}>Загрузка…</p>
        )}
        </div>
      </div>
    </div>
  )
}
