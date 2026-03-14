import { useCallback, useEffect, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import * as api from '../api'
import { useNotifications } from '../contexts/Notifications'
import { useSessionPageState } from '../sessionState'
import { formatDateTime, formatTripInterval, round1, tripIntervalSeconds } from '../utils/format'
import type { TripTemplate, TripTemplateListItem } from '../api'

const PAGE_SIZE_OPTIONS = [5, 10, 50] as const
const iconStyle = { stroke: 'currentColor', fill: 'none' as const, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
/** Иконки-кнопки в таблице: мин. 40×40px (принятый минимум для кликабельной области). */
const iconButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 40,
  minHeight: 40,
  padding: 0,
  marginRight: '0.25rem',
  boxSizing: 'border-box',
}

const TEMPLATES_SESSION_DEFAULTS = {
  pageSize: 10,
  page: 1,
  searchName: '',
  searchDurationMinSec: '',
  searchDurationMaxSec: '',
}

/** Фильтрация по имени (подстрока) и длительности: от мин. сек (≥) до макс. сек (≤). */
function filterTemplates(
  items: TripTemplateListItem[],
  nameQuery: string,
  minSec: number | null,
  maxSec: number | null
): TripTemplateListItem[] {
  let result = items
  const name = nameQuery.trim().toLowerCase()
  if (name) {
    result = result.filter((t) => t.name.toLowerCase().includes(name))
  }
  if (minSec != null && minSec >= 0) {
    result = result.filter((t) => {
      const sec = tripIntervalSeconds(t.interval_start, t.interval_end)
      return sec !== null && sec >= minSec
    })
  }
  if (maxSec != null && maxSec >= 0) {
    result = result.filter((t) => {
      const sec = tripIntervalSeconds(t.interval_start, t.interval_end)
      return sec !== null && sec <= maxSec
    })
  }
  return result
}

export default function Templates() {
  const { addToast } = useNotifications()
  const [session, setSession] = useSessionPageState('templates', TEMPLATES_SESSION_DEFAULTS)
  const { pageSize, page, searchName, searchDurationMinSec, searchDurationMaxSec } = session

  const [list, setList] = useState<TripTemplateListItem[]>([])
  const [fullList, setFullList] = useState<TripTemplateListItem[]>([])
  const [total, setTotal] = useState(0)
  const [useSearch, setUseSearch] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<TripTemplate | null>(null)
  const [viewHasVector, setViewHasVector] = useState(false)
  const [mode, setMode] = useState<'view' | 'edit' | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editFromIndex, setEditFromIndex] = useState(0)
  const [editToIndex, setEditToIndex] = useState(0)
  const [editMaxPoints, setEditMaxPoints] = useState(0)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const zoomRef = useRef<{ start: number; end: number } | null>(null)
  const tableWrapperRef = useRef<HTMLDivElement>(null)

  const hasActiveSearch =
    searchName.trim() !== '' || searchDurationMinSec.trim() !== '' || searchDurationMaxSec.trim() !== ''

  const loadPaginated = useCallback(async (limit: number, offset: number) => {
    try {
      const res = await api.getTemplates({ limit, offset })
      const templates = res.templates || []
      setList(templates.slice(0, limit))
      setTotal(res.total ?? templates.length)
      setFullList([])
      setUseSearch(false)
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }, [])

  const loadAll = useCallback(async () => {
    try {
      const res = await api.getTemplates()
      const all = res.templates || []
      setFullList(all)
      setUseSearch(true)
      setError(null)
    } catch (e) {
      setError(String(e))
    }
  }, [])

  useEffect(() => {
    if (!hasActiveSearch) {
      loadPaginated(pageSize, (page - 1) * pageSize)
    }
  }, [hasActiveSearch, page, pageSize, loadPaginated])

  useEffect(() => {
    if (hasActiveSearch) loadAll()
  }, [hasActiveSearch, loadAll])

  useEffect(() => {
    if (useSearch && fullList.length === 0 && !hasActiveSearch) return
    if (!useSearch) return
    const minSecVal = searchDurationMinSec.trim() === '' ? null : parseInt(searchDurationMinSec, 10)
    const maxSecVal = searchDurationMaxSec.trim() === '' ? null : parseInt(searchDurationMaxSec, 10)
    const minSec = minSecVal !== null && !Number.isNaN(minSecVal) ? minSecVal : null
    const maxSec = maxSecVal !== null && !Number.isNaN(maxSecVal) ? maxSecVal : null
    const filtered = filterTemplates(fullList, searchName.trim(), minSec, maxSec)
    const start = (page - 1) * pageSize
    setList(filtered.slice(start, start + pageSize))
    setTotal(filtered.length)
  }, [useSearch, fullList, searchName, searchDurationMinSec, searchDurationMaxSec, page, pageSize])

  useEffect(() => {
    if (list.length === 0 && total > 0 && page > 1) {
      setSession((prev) => ({ ...prev, page: prev.page - 1 }))
    }
  }, [list.length, total, page])

  useEffect(() => {
    setFocusedIndex((prev) => (list.length ? Math.min(prev, list.length - 1) : 0))
  }, [list.length])

  useEffect(() => {
    if (hasActiveSearch) setSession((prev) => ({ ...prev, page: 1 }))
  }, [searchName.trim(), searchDurationMinSec.trim(), searchDurationMaxSec.trim()])

  const handleView = async (id: string) => {
    try {
      const { template, has_vector } = await api.getTemplate(id)
      setSelectedTemplate(template)
      setViewHasVector(has_vector)
      setSelectedId(id)
      setMode('view')
      zoomRef.current = null
    } catch (e) {
      setError(String(e))
    }
  }

  const handleEdit = async (t: TripTemplateListItem) => {
    try {
      const { template } = await api.getTemplate(t.id)
      const maxP = Math.max(template.speed_count, template.weight_count)
      setSelectedTemplate(template)
      setSelectedId(t.id)
      setEditId(t.id)
      setEditName(template.name)
      setEditFromIndex(0)
      setEditToIndex(maxP - 1)
      setEditMaxPoints(maxP)
      setMode('edit')
      zoomRef.current = { start: 0, end: 100 }
    } catch (e) {
      setError(String(e))
    }
  }

  const handleSaveEdit = async () => {
    if (!editId) return
    if (editFromIndex < 0 || editToIndex < editFromIndex) {
      setError('Некорректный диапазон (выделите участок ползунком на графике)')
      return
    }
    setError(null)
    const fullRange = editToIndex === editMaxPoints - 1 && editFromIndex === 0
    try {
      await api.updateTemplate(editId, {
        name: editName.trim() || undefined,
        ...(fullRange ? {} : { from_index: editFromIndex, to_index: editToIndex }),
      })
      setMode(null)
      setEditId(null)
      setSelectedId(null)
      setSelectedTemplate(null)
      zoomRef.current = null
      loadPaginated(pageSize, (page - 1) * pageSize)
      addToast('Шаблон обновлён.', 'success')
    } catch (e) {
      const msg = String(e)
      setError(msg)
      addToast(msg, 'error')
    }
  }

  const handleCancelEdit = () => {
    setMode('view')
    setEditId(null)
    if (selectedTemplate) {
      setEditName(selectedTemplate.name)
      const maxP = Math.max(selectedTemplate.speed_count, selectedTemplate.weight_count)
      setEditFromIndex(0)
      setEditToIndex(maxP - 1)
      setEditMaxPoints(maxP)
    }
    zoomRef.current = null
  }

  const handleCloseSelection = () => {
    setSelectedId(null)
    setSelectedTemplate(null)
    setMode(null)
    setEditId(null)
    zoomRef.current = null
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Удалить шаблон «${name}»?`)) return
    setError(null)
    try {
      await api.deleteTemplate(id)
      if (selectedId === id) handleCloseSelection()
      loadPaginated(pageSize, (page - 1) * pageSize)
      addToast('Шаблон удалён.', 'success')
    } catch (e) {
      const msg = String(e)
      setError(msg)
      addToast(msg, 'error')
    }
  }

  const rangeLabel = (t: TripTemplateListItem) =>
    `${t.speed_count} / ${t.weight_count}`

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const canPrev = page > 1
  const canNext = page < totalPages

  const speed = selectedTemplate?.raw_speed ?? []
  const weight = selectedTemplate?.raw_weight ?? []
  const speedData = speed.map(round1)
  const weightData = weight.map(round1)
  const xData = speed.map((_, i) => i)
  const isEdit = mode === 'edit'
  const zoomStart =
    zoomRef.current != null
      ? zoomRef.current.start
      : editFromIndex != null && editMaxPoints > 0
        ? (editFromIndex / editMaxPoints) * 100
        : 0
  const zoomEnd =
    zoomRef.current != null
      ? zoomRef.current.end
      : editToIndex != null && editMaxPoints > 0
        ? ((editToIndex + 1) / editMaxPoints) * 100
        : 100

  const chartOption = {
    animation: false,
    tooltip: {
      trigger: 'axis',
      formatter: (params: { axisValue: string; marker: string; seriesName: string; value: number }[]) => {
        if (!params?.length) return ''
        const pointIdx = params[0].axisValue
        const lines = params.map((p) => `${p.marker} ${p.seriesName}: ${Number(p.value).toFixed(1)}`)
        return `Точка ${pointIdx}<br/>` + lines.join('<br/>')
      },
    },
    legend: { data: ['Скорость, км/ч', 'Вес, т'], bottom: 0 },
    grid: { left: 60, right: 40, top: 40, bottom: 80 },
    xAxis: {
      type: 'category' as const,
      data: xData,
      name: 'Точка',
      axisLabel: { formatter: (v: string) => v },
    },
    yAxis: [
      { type: 'value' as const, name: 'Скорость' },
      { type: 'value' as const, name: 'Вес' },
    ],
    series: [
      { name: 'Скорость, км/ч', type: 'line' as const, data: speedData, yAxisIndex: 0, symbol: 'none' },
      { name: 'Вес, т', type: 'line' as const, data: weightData, yAxisIndex: 1, symbol: 'none' },
    ],
    ...(isEdit && speed.length > 0
      ? {
          dataZoom: [
            { type: 'inside' as const, start: zoomStart, end: zoomEnd },
            { id: 'zoom' as const, start: zoomStart, end: zoomEnd },
          ],
        }
      : {}),
  }

  const onDataZoom = (params: { batch?: { start?: number; end?: number }[]; start?: number; end?: number }) => {
    const first = params.batch?.[0] ?? params
    const start = first.start ?? params.start ?? 0
    const end = first.end ?? params.end ?? 100
    if (editMaxPoints <= 0) return
    zoomRef.current = { start, end }
    const from = Math.floor((start / 100) * editMaxPoints)
    const to = Math.min(editMaxPoints - 1, Math.max(from, Math.ceil((end / 100) * editMaxPoints) - 1))
    setEditFromIndex(from)
    setEditToIndex(to)
  }

  return (
    <div>
      <div className="card">
        {error && <p style={{ color: 'var(--danger)', marginBottom: '0.5rem' }}>{error}</p>}
        <div
          style={{
            background: 'var(--bg)',
            borderRadius: 8,
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem 1.25rem' }}>
            <span style={{ fontWeight: 600, fontSize: '0.95rem', marginRight: '0.25rem' }}>Поиск</span>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: 'var(--muted)', fontSize: '0.9rem' }}>
              Имя:
              <input
                id="templates-search-name"
                type="text"
                placeholder="подстрока"
                value={searchName}
                onChange={(e) => setSession({ searchName: e.target.value })}
                style={{ width: 140 }}
              />
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: 'var(--muted)', fontSize: '0.9rem' }}>
              Длительность от, сек:
              <input
                id="templates-search-duration-min"
                type="number"
                min={0}
                placeholder="мин"
                value={searchDurationMinSec}
                onChange={(e) => setSession({ searchDurationMinSec: e.target.value })}
                style={{ width: 72 }}
              />
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: 'var(--muted)', fontSize: '0.9rem' }}>
              Длительность до, сек:
              <input
                id="templates-search-duration-max"
                type="number"
                min={0}
                placeholder="макс"
                value={searchDurationMaxSec}
                onChange={(e) => setSession({ searchDurationMaxSec: e.target.value })}
                style={{ width: 72 }}
              />
            </label>
            {hasActiveSearch && (
              <button
                type="button"
                onClick={() =>
                  setSession({ searchName: '', searchDurationMinSec: '', searchDurationMaxSec: '' })
                }
              >
                Сбросить поиск
              </button>
            )}
          </div>
        </div>
        <div
          ref={tableWrapperRef}
          tabIndex={0}
          role="grid"
          aria-label="Шаблоны рейсов"
          style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto', outline: 'none' }}
          onKeyDown={(e) => {
            if (list.length === 0) return
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              const nextIndex = focusedIndex < list.length - 1 ? focusedIndex + 1 : focusedIndex
              setFocusedIndex(nextIndex)
              const t = list[nextIndex]
              if (t) handleView(t.id)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              const nextIndex = focusedIndex > 0 ? focusedIndex - 1 : focusedIndex
              setFocusedIndex(nextIndex)
              const t = list[nextIndex]
              if (t) handleView(t.id)
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const t = list[focusedIndex]
              if (t) handleView(t.id)
            }
          }}
        >
          <table className="data-table data-table-templates">
            <thead>
              <tr>
                <th>Начало интервала</th>
                <th>Конец интервала</th>
                <th>Длительность</th>
                <th>Наименование</th>
                <th>Диапазон (точек: скорость / вес)</th>
                <th>Min/Max вектор рассчитан</th>
                <th>Z-нормализация</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ color: 'var(--muted)' }}>
                    Нет шаблонов
                  </td>
                </tr>
              )}
              {list.map((t, idx) => (
                <tr
                  key={t.id}
                  className={selectedId === t.id ? 'selected' : idx === focusedIndex ? 'focused' : ''}
                  onClick={(e) => {
                    if (!(e.target as HTMLElement).closest('button')) {
                      setFocusedIndex(idx)
                      handleView(t.id)
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <td>{t.interval_start ? formatDateTime(t.interval_start) : '—'}</td>
                  <td>{t.interval_end ? formatDateTime(t.interval_end) : '—'}</td>
                  <td>{t.interval_start && t.interval_end ? formatTripInterval(t.interval_start, t.interval_end) : '—'}</td>
                  <td>{t.name}</td>
                  <td>{rangeLabel(t)}</td>
                  <td>{t.has_vector ? 'Да' : 'Нет'}</td>
                  <td>{t.has_z_vector ? 'Да' : 'Нет'}</td>
                  <td style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={(e) => { e.stopPropagation(); handleEdit(t) }} title="Изменить" aria-label="Изменить" style={iconButtonStyle}>
                      <svg viewBox="0 0 24 24" width={20} height={20} style={iconStyle}>
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button type="button" className="danger" onClick={(e) => { e.stopPropagation(); handleDelete(t.id, t.name) }} title="Удалить" aria-label="Удалить" style={{ ...iconButtonStyle, marginRight: 0 }}>
                      <svg viewBox="0 0 24 24" width={20} height={20} style={iconStyle}>
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--muted)', font: 'inherit' }}>Всего: {total}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted)', font: 'inherit' }}>
              Показать:
              <select
                value={String(pageSize)}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (!Number.isNaN(n)) setSession({ pageSize: n, page: 1 })
                }}
                aria-label="Количество на странице"
                style={{ padding: '0.5rem 1rem', minHeight: 44, font: 'inherit', boxSizing: 'border-box' }}
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" disabled={!canPrev} onClick={() => setSession((prev) => ({ ...prev, page: prev.page - 1 }))}>
              Назад
            </button>
            <span style={{ color: 'var(--muted)', font: 'inherit' }}>
              {page} / {totalPages}
            </span>
            <button type="button" disabled={!canNext} onClick={() => setSession((prev) => ({ ...prev, page: prev.page + 1 }))}>
              Вперед
            </button>
          </div>
        </div>
      </div>

      {selectedId && selectedTemplate && (
        <>
          <div className="card" style={{ marginTop: '1rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1rem', rowGap: '0.5rem' }}>
              {isEdit ? (
                <>
                  <div className="form-row" style={{ marginBottom: 0 }}>
                    <label>Наименование</label>
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      style={{ width: 280 }}
                    />
                  </div>
                  <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
                    Диапазон задайте ползунком на графике ниже.
                  </span>
                  <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
                    <button className="primary" onClick={handleSaveEdit}>
                      Сохранить
                    </button>
                    <button type="button" onClick={handleCancelEdit}>
                      Отмена
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h3 style={{ margin: 0 }}>
                    {selectedTemplate.name}
                    <span style={{ color: 'var(--muted)', fontWeight: 'normal', fontSize: '0.9rem' }}>
                      {' '}
                      — точек: {selectedTemplate.speed_count} / {selectedTemplate.weight_count}, вектор: {viewHasVector ? 'да' : 'нет'}
                    </span>
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      handleEdit({
                        id: selectedId,
                        name: selectedTemplate.name,
                        speed_count: selectedTemplate.speed_count,
                        weight_count: selectedTemplate.weight_count,
                        has_vector: viewHasVector,
                        created_at: selectedTemplate.created_at,
                      })
                    }
                  >
                    Изменить
                  </button>
                  <button type="button" onClick={handleCloseSelection}>
                    Закрыть
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="card" style={{ marginTop: '0.5rem' }}>
            <h3 style={{ marginTop: 0 }}>
              {isEdit ? 'Выделите участок ползунком для сохранения диапазона' : 'График шаблона'}
            </h3>
            {speed.length > 0 && weight.length > 0 ? (
              <ReactECharts
                option={chartOption}
                style={{ height: 360 }}
                opts={{ notMerge: true }}
                onEvents={isEdit ? { dataZoom: onDataZoom } : undefined}
              />
            ) : (
              <p style={{ color: 'var(--muted)' }}>Нет данных для отображения</p>
            )}
          </div>
        </>
      )}

      {!selectedId && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <p style={{ color: 'var(--muted)', margin: 0 }}>Выберите шаблон для просмотра или редактирования</p>
        </div>
      )}
    </div>
  )
}
