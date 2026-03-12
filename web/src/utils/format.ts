/** Время в виде "YYYY-MM-DD HH:mm:ss" (без T и Z) */
export function formatDateTime(dateStr: string | number | Date): string {
  const d = new Date(dateStr)
  const pad = (n: number) => (n < 10 ? '0' + n : String(n))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Значение для input type="datetime-local" (локальное время) */
export function toDateTimeLocalValue(dateStr: string | number | Date): string {
  const d = new Date(dateStr)
  const pad = (n: number) => (n < 10 ? '0' + n : String(n))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Длительность интервала в секундах (для фильтрации). Возвращает null, если даты нет. */
export function tripIntervalSeconds(start: string | undefined, end: string | undefined): number | null {
  if (!start || !end) return null
  const a = new Date(start).getTime()
  const b = new Date(end).getTime()
  const sec = Math.round((b - a) / 1000)
  return sec >= 0 ? sec : null
}

/** Длительность в секундах в читаемый вид: "5 сек", "2 мин 30 сек", "1 ч 15 мин" */
export function formatDurationSeconds(sec: number): string {
  if (sec < 0 || !Number.isFinite(sec)) return '—'
  const s = Math.floor(sec)
  if (s < 60) return `${s} сек`
  const min = Math.floor(s / 60)
  const restSec = s % 60
  if (min < 60) return restSec > 0 ? `${min} мин ${restSec} сек` : `${min} мин`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`
}

/** Интервал между началом и концом рейса (разница ended_at − started_at), например "12 мин 30 сек" */
export function formatTripInterval(startedAt: string, endedAt: string): string {
  const start = new Date(startedAt).getTime()
  const end = new Date(endedAt).getTime()
  const sec = Math.round((end - start) / 1000)
  if (sec < 0) return '—'
  if (sec < 60) return `${sec} сек`
  const min = Math.floor(sec / 60)
  const s = sec % 60
  if (min < 60) return s > 0 ? `${min} мин ${s} сек` : `${min} мин`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`
}

/** Округление до 1 знака после запятой */
export function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** Формат миллисекунд для отображения (дробные значения < 1 мс видны) */
export function formatMs(ms: number): string {
  return ms < 1 ? ms.toFixed(2) : ms.toFixed(1)
}
