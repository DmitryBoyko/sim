import { useEffect, useState } from 'react'
import * as api from '../api'
import { useNotifications } from '../contexts/Notifications'
import type { AppSettings } from '../api'

export default function Settings() {
  const [s, setS] = useState<AppSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { addToast } = useNotifications()

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
      await api.putSettings(s)
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
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Фазы рейса (сек)</h3>
        <div className="form-row">
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
          <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>Для каждой фазы (погрузка, перевозка, разгрузка, возврат): ±% от значения, знак случайный</span>
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
      </div>

      <div className="card">
        <h3>Скорость и вес</h3>
        <div className="form-row">
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
      </div>

      <div className="card">
        <h3>Шум</h3>
        <div className="form-row">
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
      </div>

      <div className="card">
        <h3>Интервалы</h3>
        <div className="form-row">
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
      </div>

      <div className="card">
        <h3>Распознавание рейсов</h3>
        <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
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
      </div>

      <div className="card">
        <button className="primary" onClick={save} disabled={saving}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>
    </div>
  )
}
