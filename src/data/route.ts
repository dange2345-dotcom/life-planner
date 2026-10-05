import type { PlannerDB } from '../db/db'
import { routeBranchSettingId, routeMarkId } from '../domain/route'
import { insert, remove } from './entities'

/** Отметить пункт маршрута пройденным или снять отметку (снятие = удаление, повторная отметка «оживляет» запись). */
export async function setRouteMark(db: PlannerDB, routeId: string, key: string, done: boolean) {
  const id = routeMarkId(routeId, key)
  if (done) await insert(db, 'routeMarks', { routeId, key }, id)
  else await remove(db, 'routeMarks', id)
}

/** Запомнить выбранную ветку маршрута (одна настройка на маршрут, общая для всех устройств). */
export function setRouteBranch(db: PlannerDB, routeId: string, branch: string) {
  return insert(db, 'settings', { value: { branch } }, routeBranchSettingId(routeId))
}
