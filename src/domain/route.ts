import type { Route, RouteItem, RouteStage } from '../db/types'

/** Учебный маршрут — пока один. */
export const ROUTE_ID = 'main'

/** id отметки: одинаковый на всех устройствах, поэтому без дублей. */
export function routeMarkId(routeId: string, key: string): string {
  return `${routeId}:${key}`
}

/** id настройки с выбранной веткой маршрута (запись в settings). */
export function routeBranchSettingId(routeId: string): string {
  return `route:${routeId}`
}

/** Все ключи этапа: вехи и темы. */
export function stageKeys(stage: RouteStage): string[] {
  return [...stage.milestones.map((m) => m.k), ...stage.groups.flatMap((g) => g.items.map((item) => item.k))]
}

/** Сколько тем в группах этапа (без вех). */
export function topicCount(stage: RouteStage): number {
  return stage.groups.reduce((sum, g) => sum + g.items.length, 0)
}

/** Этап на выбранной ветке: общие этапы — на любой. */
export function onBranch(stage: RouteStage, branch: string): boolean {
  return !stage.branch || stage.branch === branch
}

/** Ветка из настройки; если её нет или такой ветки в маршруте нет — ветка по умолчанию. */
export function resolveBranch(route: Pick<Route, 'branches' | 'defaultBranch'>, saved: unknown): string {
  const id = saved && typeof saved === 'object' && 'branch' in saved ? String((saved as { branch: unknown }).branch) : null
  return id && route.branches.some((b) => b.id === id) ? id : route.defaultBranch
}

export interface StageProgress {
  done: number
  total: number
  pct: number
}

export interface RouteProgress {
  done: number
  total: number
  pct: number
  /** Первый незавершённый этап на ветке («Вы здесь»); null — маршрут пройден. */
  here: RouteStage | null
  stages: Map<string, StageProgress>
}

/**
 * Прогресс маршрута. В общий процент входят этапы выбранной ветки, кроме необязательных;
 * отметки в других ветках не пропадают, просто не считаются.
 */
export function routeProgress(route: Pick<Route, 'stages'>, branch: string, done: ReadonlySet<string>): RouteProgress {
  const stages = new Map<string, StageProgress>()
  let all = 0
  let doneAll = 0
  let here: RouteStage | null = null
  for (const stage of route.stages) {
    const keys = stageKeys(stage)
    const n = keys.filter((k) => done.has(k)).length
    stages.set(stage.id, { done: n, total: keys.length, pct: percent(n, keys.length) })
    if (!onBranch(stage, branch) || stage.optional) continue
    all += keys.length
    doneAll += n
    if (!here && n < keys.length) here = stage
  }
  return { done: doneAll, total: all, pct: percent(doneAll, all), here, stages }
}

/** Округление вниз: 100% — только когда отмечено всё. */
function percent(n: number, total: number): number {
  return total ? Math.floor((n / total) * 100) : 0
}

export interface RouteHit {
  stage: RouteStage
  item: RouteItem
  milestone: boolean
}

/** Пункты по точному ключу или по части текста (без учёта регистра); текст ищется только на выбранной ветке. */
export function findRouteItems(route: Pick<Route, 'stages'>, branch: string, ref: string): RouteHit[] {
  const all = route.stages.flatMap((stage) => [
    ...stage.milestones.map((item) => ({ stage, item, milestone: true })),
    ...stage.groups.flatMap((g) => g.items.map((item) => ({ stage, item, milestone: false }))),
  ])
  const byKey = all.filter((hit) => hit.item.k === ref)
  if (byKey.length) return byKey
  const needle = ref.toLowerCase()
  return all.filter((hit) => onBranch(hit.stage, branch) && hit.item.t.toLowerCase().includes(needle))
}

/** Этап по номеру («3», «6») с учётом ветки или по id («s6b»). */
export function findStage(route: Pick<Route, 'stages'>, branch: string, ref: string): RouteStage | undefined {
  return route.stages.find((s) => s.id === ref) ?? route.stages.find((s) => s.no === ref && onBranch(s, branch))
}
