import { useMemo } from 'preact/hooks'
import type { Route, StudyTimer } from '../db/types'
import type { RouteSummary } from '../domain/goals'
import { resolveBranch, routeBranchSettingId, routeProgress, ROUTE_ID } from '../domain/route'
import { readRouteSettings, STUDY_TIMER_ID } from '../domain/study'
import { useRow, useRows } from './use-data'

export interface RouteData {
  /** undefined — ещё грузится (маршрут или отметки), null — маршрута нет. */
  route: Route | null | undefined
  done: ReadonlySet<string>
  branch: string
  weeklyHours: number
  timer: StudyTimer | null
  /** Для целей: название и прогресс; пусто, пока маршрута нет. */
  summaries: RouteSummary[]
}

/** Маршрут, отметки, настройки и таймер — живые, обновляются при любой правке и синхронизации. */
export function useRouteData(): RouteData {
  const route = useRow('routes', ROUTE_ID)
  const marks = useRows('routeMarks')
  const settings = useRow('settings', routeBranchSettingId(ROUTE_ID))
  const timerRow = useRow('settings', STUDY_TIMER_ID)

  return useMemo(() => {
    const done = new Set((marks ?? []).filter((m) => m.routeId === ROUTE_ID).map((m) => m.key))
    const { weeklyHours } = readRouteSettings(settings?.value)
    const timer = (timerRow?.value as StudyTimer | undefined) ?? null
    if (marks === undefined) return { route: undefined, done, branch: '', weeklyHours, timer, summaries: [] }
    if (!route) return { route, done, branch: '', weeklyHours, timer, summaries: [] }
    const branch = resolveBranch(route, settings?.value)
    const p = routeProgress(route, branch, done)
    return { route, done, branch, weeklyHours, timer, summaries: [{ id: route.id, title: route.title, done: p.done, total: p.total, pct: p.pct }] }
  }, [route, marks, settings, timerRow])
}
