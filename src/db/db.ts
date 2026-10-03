import Dexie, { type EntityTable } from 'dexie'
import type { Habit, HabitLog, MetaRow, SyncMeta } from './types'

export type PlannerDB = Dexie & {
  habits: EntityTable<Habit, 'id'>
  habitLogs: EntityTable<HabitLog, 'id'>
  meta: EntityTable<MetaRow, 'key'>
}

/** Какие локальные таблицы синхронизируются и под каким kind они лежат в облачной таблице records. */
export const SYNCED_TABLES = [
  { table: 'habits', kind: 'habit' },
  { table: 'habitLogs', kind: 'habitLog' },
] as const

export type SyncedTableName = (typeof SYNCED_TABLES)[number]['table']

export function createDb(name = 'planner'): PlannerDB {
  const db = new Dexie(name) as PlannerDB
  db.version(1).stores({
    habits: 'id, dirty',
    habitLogs: 'id, dirty, date, habitId',
    meta: 'key',
  })
  return db
}

export function syncedTable(db: PlannerDB, name: SyncedTableName): EntityTable<SyncMeta, 'id'> {
  return db.table(name)
}

export async function clearAll(db: PlannerDB): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })
}
