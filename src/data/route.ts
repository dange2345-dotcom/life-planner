import type { PlannerDB } from '../db/db'
import type { RouteSettings, StudyTimer } from '../db/types'
import { routeBranchSettingId, routeMarkId } from '../domain/route'
import { STUDY_TIMER_ID } from '../domain/study'
import { insert, remove } from './entities'

/** Отметить пункт маршрута пройденным или снять отметку (снятие = удаление, повторная отметка «оживляет» запись). */
export async function setRouteMark(db: PlannerDB, routeId: string, key: string, done: boolean) {
  const id = routeMarkId(routeId, key)
  if (done) await insert(db, 'routeMarks', { routeId, key }, id)
  else await remove(db, 'routeMarks', id)
}

/** Изменить настройки маршрута (ветка, цель по часам) — остальные поля сохраняются. Одна запись на маршрут, общая для устройств. */
export async function updateRouteSettings(db: PlannerDB, routeId: string, patch: RouteSettings) {
  const id = routeBranchSettingId(routeId)
  const row = await db.settings.get(id)
  const prev = row && !row.deleted ? ((row.value ?? {}) as RouteSettings) : {}
  await insert(db, 'settings', { value: { ...prev, ...patch } }, id)
}

export function setRouteBranch(db: PlannerDB, routeId: string, branch: string) {
  return updateRouteSettings(db, routeId, { branch })
}

/* ===================== Занятия ===================== */

export function addStudySession(db: PlannerDB, routeId: string, input: { date: string; minutes: number; note?: string }) {
  return insert(db, 'studySessions', { routeId, date: input.date, minutes: Math.round(input.minutes), note: input.note?.trim() ?? '' })
}

export function deleteStudySession(db: PlannerDB, id: string) {
  return remove(db, 'studySessions', id)
}

/** Запустить таймер занятия. Запись общая: можно закончить на другом устройстве. */
export function startStudyTimer(db: PlannerDB, startedAt = Date.now()) {
  const value: StudyTimer = { startedAt }
  return insert(db, 'settings', { value }, STUDY_TIMER_ID)
}

export function stopStudyTimer(db: PlannerDB) {
  return remove(db, 'settings', STUDY_TIMER_ID)
}
