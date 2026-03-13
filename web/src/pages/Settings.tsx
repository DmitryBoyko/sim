import { useEffect, useState } from 'react'
import * as api from '../api'
import { useNotifications } from '../contexts/Notifications'
import type { AppSettings } from '../api'

const defaultAnalysis = {
  plateau_half_window: 3,
  plateau_noise_tolerance_ton: 4,
  payload_threshold_ton: 20,
  min_phase_points: 2,
  plateau_edge_dilation_enabled: true,
  plateau_gap_closing_enabled: true,
  plateau_max_gap_points: 5,
}

export default function Settings() {
  const [s, setS] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { addToast } = useNotifications()
  const [sectionsOpen, setSectionsOpen] = useState({
    phases: true,
    speed: true,
    noise: false,
    intervals: false,
    recognition: false,
    analysis: false,
  })

  useEffect(() => {
    api.getSettings().then(setS).catch((e) => setError(String(e)))
  }, [])

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setS((prev) => (prev ? { ...prev, [key]: value } : null))
  }

  const save = async () => {
    if (!s) return
    setSaving(true)
    setError(null)
    try {
      const toSave: AppSettings = {
        ...s,
        analysis: { ...defaultAnalysis, ...s.analysis },
      }
      await api.putSettings(toSave)
      addToast('Настройки сохранены.', 'success')
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  if (!s) return <div className="card">Загрузка…</div>

  return (
    <div>
      {error && <div className="card" style={{ color: 'var(--danger)' }}>{error}</div>}
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ fontWeight: 600 }}>Секции настроек</div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setSectionsOpen({ phases: true, speed: true, noise: true, intervals: true, recognition: true, analysis: true })}
            aria-label="Развернуть все секции"
            title="Развернуть все"
            style={{
              width: 32,
              height: 32,
              minWidth: 32,
              minHeight: 32,
              maxWidth: 32,
              maxHeight: 32,
              borderRadius: '50%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              fontSize: 18,
              lineHeight: 0,
            }}
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setSectionsOpen({ phases: false, speed: false, noise: false, intervals: false, recognition: false, analysis: false })}
            aria-label="Свернуть все секции"
            title="Свернуть все"
            style={{
              width: 32,
              height: 32,
              minWidth: 32,
              minHeight: 32,
              maxWidth: 32,
              maxHeight: 32,
              borderRadius: '50%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              fontSize: 18,
              lineHeight: 0,
            }}
          >
            −
          </button>
        </div>
      </div>

      <div className="card">
        <button
          type="button"
          onClick={() => setSectionsOpen((prev) => ({ ...prev, phases: !prev.phases }))}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            padding: 0,
            margin: 0,
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <h3 style={{ margin: 0 }}>Фазы рейса (сек)</h3>
          <span style={{ fontSize: '1.1rem', color: 'var(--muted)' }}>
            {sectionsOpen.phases ? '▾' : '▸'}
          </span>
        </button>
        {sectionsOpen.phases && (
          <>
            <div className="form-row" style={{ marginTop: '0.75rem' }}>
              <label>Погрузка</label>
              <input
                type="number"
                value={s.phases.load_duration_sec}
                onChange={(e) => update('phases', { ...s.phases, load_duration_sec: +e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>Перевозка</label>
              <input
                type="number"
                value={s.phases.transport_duration_sec}
                onChange={(e) => update('phases', { ...s.phases, transport_duration_sec: +e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>Разгрузка</label>
              <input
                type="number"
                value={s.phases.unload_duration_sec}
                onChange={(e) => update('phases', { ...s.phases, unload_duration_sec: +e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>Возврат порожний</label>
              <input
                type="number"
                value={s.phases.return_duration_sec}
                onChange={(e) => update('phases', { ...s.phases, return_duration_sec: +e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>Отклонение длительности фаз, %</label>
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={s.phases.phase_duration_deviation_percent ?? 0}
                onChange={(e) => update('phases', { ...s.phases, phase_duration_deviation_percent: Math.max(0, +e.target.value) })}
              />
              <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                Для каждой фазы (погрузка, перевозка, разгрузка, возврат): ±% от значения, знак случайный
              </span>
            </div>
            <div className="form-row">
              <label>Задержка после разгрузки, сек</label>
              <input
                type="number"
                min={0}
                value={s.phases.delay_after_unload_sec ?? 20}
                onChange={(e) => update('phases', { ...s.phases, delay_after_unload_sec: +e.target.value })}
              />
              <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Техоперации / ожидание в зоне</span>
            </div>
            <div className="form-row">
              <label>Задержка перед погрузкой, сек</label>
              <input
                type="number"
                min={0}
                value={s.phases.delay_before_load_sec ?? 20}
                onChange={(e) => update('phases', { ...s.phases, delay_before_load_sec: +e.target.value })}
              />
            </div>
          </>
        )}
      </div>

      <div className="card">
        <button
          type="button"
          onClick={() => setSectionsOpen((prev) => ({ ...prev, speed: !prev.speed }))}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            padding: 0,
            margin: 0,
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <h3 style={{ margin: 0 }}>Скорость и вес</h3>
          <span style={{ fontSize: '1.1rem', color: 'var(--muted)' }}>
            {sectionsOpen.speed ? '▾' : '▸'}
          </span>
        </button>
        {sectionsOpen.speed && (
          <>
            <div className="form-row" style={{ marginTop: '0.75rem' }}>
              <label>Vmin, км/ч</label>
              <input
                type="number"
                step="0.1"
                value={s.speed_weight.v_min_kmh}
                onChange={(e) => update('speed_weight', { ...s.speed_weight, v_min_kmh: +e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>Vmax, км/ч</label>
              <input
                type="number"
                step="0.1"
                value={s.speed_weight.v_max_kmh}
                onChange={(e) => update('speed_weight', { ...s.speed_weight, v_max_kmh: +e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>M макс, т</label>
              <input
                type="number"
                step="0.1"
                value={s.speed_weight.m_max_ton}
                onChange={(e) => update('speed_weight', { ...s.speed_weight, m_max_ton: +e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>M мин, т</label>
              <input
                type="number"
                step="0.1"
                value={s.speed_weight.m_min_ton}
                onChange={(e) => update('speed_weight', { ...s.speed_weight, m_min_ton: +e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>M порожний, т</label>
              <input
                type="number"
                step="0.1"
                value={s.speed_weight.m_empty_ton}
                onChange={(e) => update('speed_weight', { ...s.speed_weight, m_empty_ton: +e.target.value })}
              />
            </div>
          </>
        )}
      </div>

      <div className="card">
        <button
          type="button"
          onClick={() => setSectionsOpen((prev) => ({ ...prev, noise: !prev.noise }))}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            padding: 0,
            margin: 0,
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <h3 style={{ margin: 0 }}>Шум</h3>
          <span style={{ fontSize: '1.1rem', color: 'var(--muted)' }}>
            {sectionsOpen.noise ? '▾' : '▸'}
          </span>
        </button>
        {sectionsOpen.noise && (
          <>
            <div className="form-row" style={{ marginTop: '0.75rem' }}>
              <label>Шум скорости, км/ч</label>
              <input
                type="number"
                step="0.1"
                value={s.noise.speed_noise_kmh}
                onChange={(e) => update('noise', { ...s.noise, speed_noise_kmh: +e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>Шум веса, т</label>
              <input
                type="number"
                step="0.1"
                value={s.noise.weight_noise_ton}
                onChange={(e) => update('noise', { ...s.noise, weight_noise_ton: +e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>Шум веса при погрузке, т</label>
              <input
                type="number"
                step="0.1"
                min={0}
                value={s.noise.weight_noise_load_ton ?? 2}
                onChange={(e) => update('noise', { ...s.noise, weight_noise_load_ton: +e.target.value })}
              />
              <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Амортизаторы при наращивании веса</span>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <button
          type="button"
          onClick={() => setSectionsOpen((prev) => ({ ...prev, intervals: !prev.intervals }))}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            padding: 0,
            margin: 0,
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <h3 style={{ margin: 0 }}>Интервалы</h3>
          <span style={{ fontSize: '1.1rem', color: 'var(--muted)' }}>
            {sectionsOpen.intervals ? '▾' : '▸'}
          </span>
        </button>
        {sectionsOpen.intervals && (
          <>
            <div className="form-row" style={{ marginTop: '0.75rem' }}>
              <label>Интервал генерации, сек</label>
              <input
                type="number"
                value={s.intervals.generation_interval_sec}
                onChange={(e) => update('intervals', { ...s.intervals, generation_interval_sec: +e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>Окно графика, мин</label>
              <input
                type="number"
                value={s.intervals.chart_minutes}
                onChange={(e) => update('intervals', { ...s.intervals, chart_minutes: +e.target.value })}
              />
            </div>
          </>
        )}
      </div>

      <div className="card">
        <button
          type="button"
          onClick={() => setSectionsOpen((prev) => ({ ...prev, recognition: !prev.recognition }))}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            padding: 0,
            margin: 0,
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <h3 style={{ margin: 0 }}>Распознавание рейсов</h3>
          <span style={{ fontSize: '1.1rem', color: 'var(--muted)' }}>
            {sectionsOpen.recognition ? '▾' : '▸'}
          </span>
        </button>
        {sectionsOpen.recognition && (
          <>
            <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: '0.75rem' }}>
              Размеры окна берутся из шаблонов (от меньшего к большему). Включение распознавания — на странице «Симуляция».
            </p>
            <div className="form-row">
              <label>Порог совпадения, %</label>
              <input
                type="number"
                step="0.1"
                value={s.recognition.match_threshold_percent}
                onChange={(e) => update('recognition', { ...s.recognition, match_threshold_percent: +e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>Период охлаждения, с</label>
              <input
                type="number"
                min={0}
                step={1}
                value={s.recognition.cooldown_after_trip_sec ?? 0}
                onChange={(e) => update('recognition', { ...s.recognition, cooldown_after_trip_sec: Math.max(0, +e.target.value) })}
              />
            </div>
            <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: '-0.25rem' }}>
              После найденного рейса новый рейс не может начаться раньше конца предыдущего плюс это число секунд. 0 — без охлаждения; рейсы не пересекаются по интервалам в любом случае.
            </p>
            <div className="form-row">
              <label>Скорость «у оси», км/ч</label>
              <input
                type="number"
                min={0}
                step={0.5}
                placeholder="0 = не проверять"
                value={s.recognition.speed_baseline_kmh ?? ''}
                onChange={(e) => update('recognition', { ...s.recognition, speed_baseline_kmh: Math.max(0, parseFloat(e.target.value) || 0) })}
              />
            </div>
            <div className="form-row">
              <label>Вес «у оси», т</label>
              <input
                type="number"
                min={0}
                step={1}
                placeholder="0 = не проверять"
                value={s.recognition.weight_baseline_ton ?? ''}
                onChange={(e) => update('recognition', { ...s.recognition, weight_baseline_ton: Math.max(0, parseFloat(e.target.value) || 0) })}
              />
            </div>
            <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: '-0.25rem' }}>
              Рейс сохраняется только если начало и конец окна у оси: скорость и вес не выше этих порогов. 0 — проверка отключена (как раньше). Рекомендуется задать, например, 5 км/ч и 15–20 т.
            </p>
            <div className="form-row" style={{ marginTop: '1rem' }}>
              <label>Метод нормализации</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="normalization"
                    checked={!s.recognition.use_z_normalization}
                    onChange={() => update('recognition', { ...s.recognition, use_z_normalization: false })}
                  />
                  <span>Min-Max вектор (по умолчанию)</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="normalization"
                    checked={!!s.recognition.use_z_normalization}
                    onChange={() => update('recognition', { ...s.recognition, use_z_normalization: true })}
                  />
                  <span>Z-нормализация</span>
                </label>
              </div>
            </div>
            <p
              style={{ color: 'var(--muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}
              title="Min-Max — деление на глобальные максимумы (Vmax, Mmax). Чувствителен к абсолютным значениям скорости и веса. Z-нормализация — приведение к среднему=0, σ=1. Сравнивает только форму сигнала, игнорируя абсолютные значения. Рекомендуется при различных условиях загрузки или дрейфе датчиков."
            >
              Min-Max — деление на глобальные максимумы (Vmax, Mmax). Чувствителен к абсолютным значениям. Z-нормализация — среднее=0, σ=1, сравнивает только форму сигнала. Рекомендуется при разных условиях загрузки или дрейфе датчиков.
            </p>
          </>
        )}
      </div>

      <div className="card">
        <button
          type="button"
          onClick={() => setSectionsOpen((prev) => ({ ...prev, analysis: !prev.analysis }))}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            padding: 0,
            margin: 0,
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <h3 style={{ margin: 0 }}>Анализ рейсов</h3>
          <span style={{ fontSize: '1.1rem', color: 'var(--muted)' }}>
            {sectionsOpen.analysis ? '▾' : '▸'}
          </span>
        </button>
        {sectionsOpen.analysis && (
          <>
            <p style={{ color: 'var(--muted)', fontSize: '0.9rem', marginTop: '0.75rem' }}>
              Анализ фаз рейса определяет участки плато по весу (Plateau Detection). Высокое плато = транспортировка, низкое = возврат. Переходные участки = погрузка и разгрузка. Вес груза = медиана(транспортировка) − медиана(возврат).
            </p>
            <div className="form-row">
              <label>Окно плато (точек)</label>
              <input
                type="number"
                min={1}
                max={20}
                value={s.analysis?.plateau_half_window ?? defaultAnalysis.plateau_half_window}
                onChange={(e) => update('analysis', { ...defaultAnalysis, ...s.analysis, plateau_half_window: Math.max(1, +e.target.value) })}
              />
              <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Полуширина окна для скользящего std (±30 сек при 10 с интервале)</span>
            </div>
            <div className="form-row">
              <label>Допуск шума плато, т</label>
              <input
                type="number"
                step={0.5}
                min={0}
                value={s.analysis?.plateau_noise_tolerance_ton ?? defaultAnalysis.plateau_noise_tolerance_ton}
                onChange={(e) => update('analysis', { ...defaultAnalysis, ...s.analysis, plateau_noise_tolerance_ton: Math.max(0, +e.target.value) })}
              />
            </div>
            <div className="form-row">
              <label>Порог груза, т</label>
              <input
                type="number"
                step={0.5}
                min={0}
                value={s.analysis?.payload_threshold_ton ?? defaultAnalysis.payload_threshold_ton}
                onChange={(e) => update('analysis', { ...defaultAnalysis, ...s.analysis, payload_threshold_ton: Math.max(0, +e.target.value) })}
              />
              <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Разделение «гружёный» / «порожний»</span>
            </div>
            <div className="form-row">
              <label>Мин. точек на фазу</label>
              <input
                type="number"
                min={1}
                max={20}
                value={s.analysis?.min_phase_points ?? defaultAnalysis.min_phase_points}
                onChange={(e) => update('analysis', { ...defaultAnalysis, ...s.analysis, min_phase_points: Math.max(1, +e.target.value) })}
              />
            </div>
            <div className="form-row">
              <label>Заполнение разрывов плато (Morphological Closing)</label>
              <input
                type="checkbox"
                checked={s.analysis?.plateau_gap_closing_enabled ?? defaultAnalysis.plateau_gap_closing_enabled}
                onChange={(e) =>
                  update('analysis', {
                    ...defaultAnalysis,
                    ...s.analysis,
                    plateau_gap_closing_enabled: e.target.checked,
                  })
                }
              />
            </div>
            <div className="form-row">
              <label>Макс. разрыв плато (точек)</label>
              <input
                type="number"
                min={1}
                max={50}
                value={s.analysis?.plateau_max_gap_points ?? defaultAnalysis.plateau_max_gap_points}
                onChange={(e) =>
                  update('analysis', {
                    ...defaultAnalysis,
                    ...s.analysis,
                    plateau_max_gap_points: Math.max(1, +e.target.value),
                  })
                }
              />
              <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                Заполняет короткие провалы внутри плато (разрывы длиной ≤ N точек), вызванные ямами, манёврами или шумом датчиков. При
                интервале 10 сек и значении 5: разрывы до 50 сек будут закрыты. Рекомендуется оставить включённым.
              </span>
            </div>
            <div className="form-row">
              <label>Коррекция краёв плато (дилатация)</label>
              <input
                type="checkbox"
                checked={s.analysis?.plateau_edge_dilation_enabled ?? defaultAnalysis.plateau_edge_dilation_enabled}
                onChange={(e) =>
                  update('analysis', {
                    ...defaultAnalysis,
                    ...s.analysis,
                    plateau_edge_dilation_enabled: e.target.checked,
                  })
                }
              />
              <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                Расширяет границы найденного плато на 1–5 точек в каждую сторону, если пограничная точка имеет вес на уровне плато и
                скорость ≤ порога. Уменьшает расчётное время погрузки и разгрузки. Рекомендуется оставить включённым.
              </span>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <button className="primary" onClick={save} disabled={saving}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>
    </div>
  )
}
