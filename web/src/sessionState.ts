/**
 * Состояние UI страниц в рамках сессии (sessionStorage).
 * При переключении вкладок параметры (даты, опции, фильтры) сохраняются и восстанавливаются.
 */

import { useCallback, useState } from 'react'

const STORAGE_KEY = 'app-session-ui'

function readRaw(): Record<string, unknown> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function writeRaw(data: Record<string, unknown>): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // ignore
  }
}

/** Читает сохранённое состояние страницы и мержит с дефолтами (новые ключи в defaults попадут в результат). */
export function getPageState<T extends Record<string, unknown>>(pageKey: string, defaults: T): T {
  const all = readRaw()
  const stored = all[pageKey]
  if (stored != null && typeof stored === 'object' && !Array.isArray(stored)) {
    return { ...defaults, ...(stored as Record<string, unknown>) } as T
  }
  return defaults
}

/** Сохраняет состояние страницы в sessionStorage. */
export function setPageState<T extends Record<string, unknown>>(pageKey: string, state: T): void {
  const all = readRaw()
  all[pageKey] = state
  writeRaw(all)
}

/**
 * Хук: состояние страницы, сохраняемое в sessionStorage при каждом изменении.
 * При возврате на страницу восстанавливаются последние значения.
 * setState принимает частичное обновление (merge) или функцию (prev) => partial.
 */
export function useSessionPageState<T extends Record<string, unknown>>(
  pageKey: string,
  defaultState: T
): [T, (next: Partial<T> | ((prev: T) => Partial<T>)) => void] {
  const [state, setState] = useState<T>(() => getPageState(pageKey, defaultState))

  const setAndPersist = useCallback(
    (next: Partial<T> | ((prev: T) => Partial<T>)) => {
      setState((prev) => {
        const partial = typeof next === 'function' ? next(prev) : next
        const resolved = { ...prev, ...partial } as T
        setPageState(pageKey, resolved)
        return resolved
      })
    },
    [pageKey]
  )

  return [state, setAndPersist]
}
