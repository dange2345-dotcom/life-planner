import type { RouteSettings, StudySession } from '../db/types'
import { addDaysKey, type DateKey } from './dates'

/** Цель по часам в неделю, пока не задана своя. */
export const DEFAULT_WEEKLY_HOURS = 18

/** id настройки с идущим таймером занятия. */
export const STUDY_TIMER_ID = 'study-timer'

/** Таймер дольше этого — скорее всего, забыли выключить: при записи показываем предупреждение. */
export const LONG_SESSION_MINUTES = 6 * 60

/** Настройки маршрута с подставленными значениями по умолчанию. */
export function readRouteSettings(value: unknown): { branch: string | undefined; weeklyHours: number } {
  const saved = (value && typeof value === 'object' ? value : {}) as RouteSettings
  const hours = Number(saved.weeklyHours)
  return { branch: saved.branch, weeklyHours: hours > 0 ? hours : DEFAULT_WEEKLY_HOURS }
}

export interface WeekStudy {
  /** Минут за неделю. */
  total: number
  /** Минут по дням, пн … вс. */
  byDay: number[]
  /** Занятия недели: новые дни сверху. */
  sessions: StudySession[]
}

/** Занятия недели, которая начинается в понедельник weekStartKey. */
export function weekStudy(sessions: StudySession[], weekStartKey: DateKey): WeekStudy {
  const end = addDaysKey(weekStartKey, 6)
  const byDay = [0, 0, 0, 0, 0, 0, 0]
  const list = sessions.filter((s) => !s.deleted && s.date >= weekStartKey && s.date <= end)
  for (const s of list) {
    byDay[Math.round((Date.parse(s.date) - Date.parse(weekStartKey)) / 86_400_000)] += s.minutes
  }
  list.sort((a, b) => (a.date === b.date ? b.updatedAt - a.updatedAt : a.date < b.date ? 1 : -1))
  return { total: byDay.reduce((sum, m) => sum + m, 0), byDay, sessions: list }
}

/** Минут учёбы в этот день. */
export function dayMinutes(sessions: StudySession[], day: DateKey): number {
  return sessions.reduce((sum, s) => (!s.deleted && s.date === day ? sum + s.minutes : sum), 0)
}

/** «45 мин», «2 ч», «1 ч 30 мин». */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (h === 0) return `${rest} мин`
  return rest ? `${h} ч ${rest} мин` : `${h} ч`
}

/** Сколько минут шёл таймер (не меньше минуты). */
export function timerMinutes(startedAt: number, now: number): number {
  return Math.max(1, Math.round((now - startedAt) / 60_000))
}

/** «0:42:10» — для идущего таймера. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${Math.floor(total / 3600)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`
}

/** Процент недельной цели (0–100). */
export function weekPct(totalMinutes: number, weeklyHours: number): number {
  return weeklyHours > 0 ? Math.min(100, Math.floor((totalMinutes / (weeklyHours * 60)) * 100)) : 0
}
