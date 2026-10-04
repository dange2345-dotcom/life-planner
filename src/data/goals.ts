import type { PlannerDB } from '../db/db'
import type { Goal } from '../db/types'
import { insert, nextOrder, remove, update, updateMany, type Fields } from './entities'

export type GoalInput = Omit<Fields<Goal>, 'order'>

export async function createGoal(db: PlannerDB, input: GoalInput): Promise<string> {
  return insert(db, 'goals', { ...input, title: input.title.trim(), order: await nextOrder(db, 'goals') })
}

export function updateGoal(db: PlannerDB, id: string, changes: Partial<Fields<Goal>>) {
  return update(db, 'goals', id, changes)
}

/** Удалить цель; привязанные привычки, проекты и накопления остаются, но отвязываются. */
export async function deleteGoal(db: PlannerDB, id: string) {
  for (const table of ['habits', 'projects', 'savings'] as const) {
    const linked = (await db.table(table).toArray()) as { id: string; goalId: string | null; deleted: number }[]
    await updateMany(
      db,
      table,
      linked.filter((row) => row.goalId === id && !row.deleted).map((row) => row.id),
      () => ({ goalId: null }),
    )
  }
  await remove(db, 'goals', id)
}

export type LinkTable = 'habits' | 'projects' | 'savings'

/** Привязать / отвязать привычки, проекты, накопления: links — id, которые должны быть привязаны к цели. */
export async function setGoalLinks(db: PlannerDB, goalId: string, table: LinkTable, links: Set<string>) {
  const rows = ((await db.table(table).toArray()) as { id: string; goalId: string | null; deleted: number }[]).filter((r) => !r.deleted)
  const attach = rows.filter((r) => links.has(r.id) && r.goalId !== goalId).map((r) => r.id)
  const detach = rows.filter((r) => !links.has(r.id) && r.goalId === goalId).map((r) => r.id)
  await updateMany(db, table, attach, () => ({ goalId }))
  await updateMany(db, table, detach, () => ({ goalId: null }))
}
