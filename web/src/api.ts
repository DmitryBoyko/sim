import { logError } from './lib/frontendLog'

const BASE = ''

/** Внутренний fetch с асинхронным логированием ошибок в бэкенд. Не меняет поведение приложения. */
async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const url = BASE + path
  const method = options?.method ?? 'GET'
  let res: Response
  try {
    res = await fetch(url, options)
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logError(`api.fetch: ${err.message}`, {
      module: 'api',
      function: 'apiFetch',
      url,
      path,
      method,
      stack: err.stack,
    })
    throw e
  }
  if (!res.ok) {
    const text = await res.text()
    logError(`api.fetch: ${res.status} ${text || res.statusText}`, {
      module: 'api',
      function: 'apiFetch',
      url,
      path,
      method,
      status: res.status,
    })
    throw new Error(text)
  }
  return res
}

export type DataPoint = { t: string; speed: number; weight: number; phase: string }
export type AppSettings = {
  phases: {
    load_duration_sec: number
    transport_duration_sec: number
    unload_duration_sec: number
    return_duration_sec: number
    delay_after_unload_sec: number
    delay_before_load_sec: number
    phase_duration_deviation_percent: number
  }
  speed_weight: { v_min_kmh: number; v_max_kmh: number; m_max_ton: number; m_min_ton: number; m_empty_ton: number }
  noise: { speed_noise_kmh: number; weight_noise_ton: number; weight_noise_load_ton: number }
  intervals: { generation_interval_sec: number; chart_minutes: number }
  recognition: {
    match_threshold_percent: number
    enabled: boolean
    cooldown_after_trip_sec: number
    speed_baseline_kmh?: number
    weight_baseline_ton?: number
    use_z_normalization?: boolean
  }
  analysis?: {
    plateau_half_window: number
    plateau_noise_tolerance_ton: number
    payload_threshold_ton: number
    min_phase_points: number
    plateau_edge_dilation_enabled?: boolean
    plateau_gap_closing_enabled?: boolean
    plateau_max_gap_points?: number
  }
}
export type TripTemplate = {
  id: string
  name: string
  created_at: string
  interval_start?: string
  interval_end?: string
  speed_count: number
  weight_count: number
  raw_speed?: number[]
  raw_weight?: number[]
  raw_ts?: string[]
}
export type TripTemplateListItem = TripTemplate & { has_vector: boolean; has_z_vector?: boolean }
export type DetectedTrip = {
  id: string
  started_at: string
  ended_at: string
  template_id?: string
  template_name?: string
  match_threshold_percent?: number
  match_percent: number
  payload_ton?: number | null
  /** Средний вес фазы «Транспортировка» (из API списка рейсов). */
  transport_avg_weight_ton?: number | null
  phases?: { phase: string; from: string; to: string }[]
  created_at: string
}

export type TripPhase = {
  phase_type: 'loading' | 'transport' | 'unloading' | 'return'
  started_at: string
  ended_at: string
  duration_sec: number
  avg_speed_kmh: number
  avg_weight_ton: number
  point_count: number
  sort_order: number
}

export type TripPhasesResponse = {
  trip_id: string
  payload_ton: number
  phases: TripPhase[]
}

export async function getSettings(): Promise<AppSettings> {
  const r = await apiFetch('/api/settings')
  return r.json()
}

export async function putSettings(s: AppSettings): Promise<void> {
  await apiFetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) })
}

export async function controlStart(): Promise<void> {
  await apiFetch('/api/control/start', { method: 'POST' })
}

export async function controlStop(): Promise<void> {
  await apiFetch('/api/control/stop', { method: 'POST' })
}

export async function controlClear(): Promise<void> {
  await apiFetch('/api/control/clear', { method: 'POST' })
}

export async function getOperationalData(minutes = 30): Promise<{ points: DataPoint[] }> {
  const r = await apiFetch(`/api/data/operational?minutes=${minutes}`)
  return r.json()
}

export type ResourceStatus = 'green' | 'yellow' | 'red'

export type OperationalStats = {
  running: boolean
  last_started_at?: string
  points_since_start: number
  trips_since_start: number
  active_jobs_count: number
  last_trip_at?: string
  memory_alloc_mb?: number
  memory_sys_mb?: number
  num_goroutine?: number
  memory_status?: ResourceStatus
  goroutines_status?: ResourceStatus
  resource_status?: ResourceStatus
}

export async function getOperationalStats(): Promise<OperationalStats> {
  const r = await apiFetch('/api/data/operational/stats')
  return r.json()
}

export async function getTemplates(params?: { limit?: number; offset?: number }): Promise<{
  templates: TripTemplateListItem[]
  total?: number
}> {
  const q = new URLSearchParams()
  if (params?.limit != null) q.set('limit', String(params.limit))
  if (params?.offset != null) q.set('offset', String(params.offset))
  const r = await apiFetch('/api/templates' + (q.toString() ? '?' + q.toString() : ''))
  return r.json()
}

export async function getTemplate(id: string): Promise<{ template: TripTemplate; has_vector: boolean }> {
  const r = await apiFetch(`/api/templates/${id}`)
  return r.json()
}

export async function updateTemplate(
  id: string,
  payload: { name?: string; from_index?: number; to_index?: number }
): Promise<void> {
  await apiFetch(`/api/templates/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function createTemplate(name: string, points: DataPoint[]): Promise<{ id: string }> {
  const r = await apiFetch('/api/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, points }),
  })
  return r.json()
}

export async function deleteTemplate(id: string): Promise<void> {
  await apiFetch(`/api/templates/${id}`, { method: 'DELETE' })
}

export async function getTrips(params?: { from?: string; to?: string; limit?: number }): Promise<{ trips: DetectedTrip[] }> {
  const q = new URLSearchParams()
  if (params?.from) q.set('from', params.from)
  if (params?.to) q.set('to', params.to)
  if (params?.limit) q.set('limit', String(params.limit))
  const r = await apiFetch('/api/trips?' + q.toString())
  return r.json()
}

export async function deleteAllTrips(): Promise<void> {
  await apiFetch('/api/trips', { method: 'DELETE' })
}

export async function getTripPhases(tripId: string): Promise<TripPhasesResponse> {
  const r = await apiFetch('/api/trips/' + encodeURIComponent(tripId) + '/phases')
  return r.json()
}

export async function getHistory(from: string, to: string): Promise<{ points: DataPoint[]; trips: DetectedTrip[] }> {
  const r = await apiFetch(`/api/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
  return r.json()
}

export type TemplateComparisonResult = {
  template_id: string
  template_name: string
  speed_count: number
  weight_count: number
  match_percent: number
}

export type RecognitionAnalysisState = {
  templates_loaded: number
  speed_points: number
  weight_points: number
  vector_computed: boolean
  vector_compute_time_ms?: number
  template_compare_time_ms?: number
  best_match_window?: string
  best_match_name?: string
  best_match_percent: number
  comparisons?: TemplateComparisonResult[]
  window_interval_start?: string
  window_interval_end?: string
  normalization_mode?: 'min-max' | 'z-norm'
}

export async function getRecognitionAnalysis(): Promise<RecognitionAnalysisState> {
  const r = await apiFetch('/api/recognition/analysis')
  return r.json()
}

// Background jobs (e.g. recalculate trips)
export type BackgroundJob = {
  id: string
  kind: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress_pct: number
  total_items: number
  processed_items: number
  started_at?: string
  finished_at?: string
  error_message?: string
  payload?: unknown
  created_at: string
}

export type JobListParams = {
  status?: string
  limit?: number
}

export async function getJobList(params?: JobListParams): Promise<{ jobs: BackgroundJob[] }> {
  const q = new URLSearchParams()
  if (params?.status) q.set('status', params.status)
  if (params?.limit != null) q.set('limit', String(params.limit))
  const r = await apiFetch('/api/jobs' + (q.toString() ? '?' + q.toString() : ''))
  return r.json()
}

export async function cancelJob(id: string): Promise<void> {
  await apiFetch('/api/jobs/' + encodeURIComponent(id) + '/cancel', { method: 'POST' })
}

export async function deleteJob(id: string): Promise<void> {
  await apiFetch('/api/jobs/' + encodeURIComponent(id), { method: 'DELETE' })
}

export async function deleteCompletedJobs(): Promise<{ deleted: number }> {
  const r = await apiFetch('/api/jobs/completed', { method: 'DELETE' })
  return r.json()
}

export async function startRecalculateTrips(from: string, to: string): Promise<{ job_id: string }> {
  const url = BASE + '/api/jobs/recalculate-trips'
  let r: Response
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    })
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logError(`api.startRecalculateTrips: ${err.message}`, {
      module: 'api',
      function: 'startRecalculateTrips',
      url,
      stack: err.stack,
    })
    throw e
  }
  if (r.status === 409) {
    const data = await r.json().catch(() => ({})) as { job_id?: string }
    if (data.job_id) return { job_id: data.job_id }
  }
  if (!r.ok) {
    const text = await r.text()
    logError(`api.startRecalculateTrips: ${r.status} ${text || r.statusText}`, {
      module: 'api',
      function: 'startRecalculateTrips',
      url,
      status: r.status,
    })
    throw new Error(text || 'Failed to start recalculate')
  }
  return r.json()
}

export async function getJob(id: string): Promise<BackgroundJob | null> {
  const r = await apiFetch('/api/jobs/' + encodeURIComponent(id))
  const data = await r.json()
  return data as BackgroundJob
}

export async function getActiveJob(kind: string): Promise<BackgroundJob | null> {
  const r = await apiFetch('/api/jobs/active?kind=' + encodeURIComponent(kind))
  const data = await r.json()
  return (data as { job: BackgroundJob | null }).job
}

// App logs (backend + frontend)
export type AppLogEntry = {
  id: number
  created_at: string
  source: 'backend' | 'frontend'
  level: 'info' | 'warn' | 'error'
  message: string
  payload?: unknown
}

export type GetLogsParams = {
  from?: string
  to?: string
  source?: 'backend' | 'frontend'
  order?: 'asc' | 'desc'
  limit?: number
}

export async function getLogs(params?: GetLogsParams): Promise<{ logs: AppLogEntry[] }> {
  const q = new URLSearchParams()
  if (params?.from) q.set('from', params.from)
  if (params?.to) q.set('to', params.to)
  if (params?.source) q.set('source', params.source)
  if (params?.order) q.set('order', params.order)
  if (params?.limit != null) q.set('limit', String(params.limit))
  const r = await apiFetch('/api/logs' + (q.toString() ? '?' + q.toString() : ''))
  return r.json()
}

export async function postLog(entry: { level?: string; message: string; payload?: unknown }): Promise<void> {
  await apiFetch('/api/logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      level: entry.level || 'info',
      message: entry.message,
      payload: entry.payload,
    }),
  })
}

export type DeleteLogsParams = {
  from: string // RFC3339
  to: string   // RFC3339
}

export async function deleteLogs(params: DeleteLogsParams): Promise<{ deleted: number }> {
  const q = new URLSearchParams({ from: params.from, to: params.to })
  const r = await apiFetch('/api/logs?' + q.toString(), { method: 'DELETE' })
  const data = await r.json()
  return data as { deleted: number }
}

/** Get markdown content for a doc. file: README.md | docs/BUILD_AND_RUN.md | docs/SECURITY.md | docs/API.md | docs/ARCHITECTURE.md | docs/MATH.md */
export async function getDoc(file: string): Promise<{ content: string }> {
  const r = await apiFetch('/api/docs?file=' + encodeURIComponent(file))
  const data = await r.json()
  return data as { content: string }
}
