/**
 * Асинхронная отправка логов на бэкенд. Не бросает исключений, не блокирует UI.
 * Очередь ограничена по размеру; при переполнении старые записи отбрасываются.
 */

const BASE = ''
const MAX_QUEUE = 100
const MAX_MESSAGE_LENGTH = 32000

type LogLevel = 'info' | 'warn' | 'error'

interface LogItem {
  level: LogLevel
  message: string
  payload?: unknown
}

const queue: LogItem[] = []
let flushScheduled = false

function truncate(msg: string): string {
  if (msg.length <= MAX_MESSAGE_LENGTH) return msg
  return msg.slice(0, MAX_MESSAGE_LENGTH) + '…'
}

function scheduleFlush(): void {
  if (flushScheduled || queue.length === 0) return
  flushScheduled = true
  setTimeout(flush, 0)
}

function flush(): void {
  flushScheduled = false
  if (queue.length === 0) return
  const item = queue.shift()!
  try {
    const body = JSON.stringify({
      level: item.level,
      message: truncate(item.message),
      payload: item.payload,
    })
    fetch(BASE + '/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).finally(() => {
      if (queue.length > 0) scheduleFlush()
    })
  } catch {
    if (queue.length > 0) scheduleFlush()
  }
}

/**
 * Добавляет запись в очередь и асинхронно отправляет на бэкенд.
 * Никогда не бросает исключений. При переполнении очереди удаляется самая старая запись.
 */
export function logToBackend(level: LogLevel, message: string, payload?: unknown): void {
  try {
    if (queue.length >= MAX_QUEUE) queue.shift()
    queue.push({ level, message, payload })
    scheduleFlush()
  } catch {
    // игнорируем любые ошибки (например, при сериализации)
  }
}

/** Логирование ошибки (глобальные и API). Добавляет в payload стек вызова, если не передан. */
export function logError(message: string, payload?: unknown): void {
  try {
    const enriched =
      payload != null && typeof payload === 'object' && !Array.isArray(payload)
        ? { ...payload } as Record<string, unknown>
        : (payload != null ? { value: payload } : {})
    if (enriched.stack == null) {
      const stack = new Error().stack
      if (stack) enriched.stack = stack
    }
    logToBackend('error', message, Object.keys(enriched).length > 0 ? enriched : undefined)
  } catch {
    logToBackend('error', message, payload)
  }
}

/** Логирование предупреждения. */
export function logWarn(message: string, payload?: unknown): void {
  logToBackend('warn', message, payload)
}

/** Логирование информационного события. */
export function logInfo(message: string, payload?: unknown): void {
  logToBackend('info', message, payload)
}

/**
 * Подключает глобальные обработчики ошибок. Вызывать один раз при старте приложения.
 */
export function installGlobalHandlers(): void {
  try {
    window.onerror = (message, source, lineno, colno, error) => {
      const msg =
        typeof message === 'string'
          ? message
          : error?.message ?? String(message)
      const stack = error?.stack
      const location = source != null && lineno != null ? ` [${source}:${lineno}${colno != null ? `:${colno}` : ''}]` : ''
      logToBackend('error', `window.onerror: ${msg}${location}`, {
        source: source ?? undefined,
        lineno: lineno ?? undefined,
        colno: colno ?? undefined,
        stack: stack ?? undefined,
      })
      return false
    }
    window.onunhandledrejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      const message =
        reason instanceof Error ? reason.message : String(reason)
      const stack = reason instanceof Error ? reason.stack : undefined
      logToBackend('error', `unhandledrejection: ${message}`, { stack, reason: String(reason) })
    }
  } catch {
    // не ломаем приложение при ошибке установки обработчиков
  }
}
