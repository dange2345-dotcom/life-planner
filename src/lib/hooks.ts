import { liveQuery } from 'dexie'
import { useEffect, useState } from 'preact/hooks'
import { todayKey, type DateKey } from '../domain/dates'
import type { SyncEngine, SyncState } from '../sync/engine'

/** Живой запрос к локальной базе: компонент перерисовывается при любом изменении затронутых данных. */
export function useLive<T>(query: () => Promise<T>, deps: unknown[]): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined)
  useEffect(() => {
    const subscription = liveQuery(query).subscribe({
      next: (next) => setValue(() => next),
      error: (error) => console.error(error),
    })
    return () => subscription.unsubscribe()
  }, deps)
  return value
}

export function useSyncState(engine: SyncEngine): SyncState {
  const [state, setState] = useState(engine.getState())
  useEffect(() => engine.subscribe(setState), [engine])
  return state
}

/** Сегодняшняя дата; сама меняется после полуночи и при возврате в приложение. */
export function useToday(): DateKey {
  const [today, setToday] = useState(todayKey())
  useEffect(() => {
    const check = () => setToday(todayKey())
    const timer = setInterval(check, 60_000)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])
  return today
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const onChange = () => setMatches(list.matches)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** Маленькая настройка интерфейса, которая помнится на этом устройстве (не синхронизируется). */
export function useLocalSetting<T extends string>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? fallback
    } catch {
      return fallback
    }
  })
  const update = (next: T) => {
    setValue(next)
    try {
      localStorage.setItem(key, next)
    } catch {
      // приватный режим / нет доступа к хранилищу — просто не запоминаем
    }
  }
  return [value, update]
}

export function useHashRoute(): string {
  const [route, setRoute] = useState(() => location.hash.replace(/^#\/?/, ''))
  useEffect(() => {
    const onChange = () => setRoute(location.hash.replace(/^#\/?/, ''))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
