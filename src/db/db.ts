import Dexie, { type EntityTable } from 'dexie'
import type {
  Category,
  Goal,
  Habit,
  HabitLog,
  MetaRow,
  Payment,
  Project,
  PushSub,
  Route,
  RouteMark,
  Saving,
  StudySession,
  SavingEntry,
  Setting,
  SyncMeta,
  Task,
  Transaction,
} from './types'

/** Синхронизируемые таблицы и тип их записей. */
export interface SyncedTables {
  habits: Habit
  habitLogs: HabitLog
  projects: Project
  tasks: Task
  transactions: Transaction
  categories: Category
  payments: Payment
  savings: Saving
  savingEntries: SavingEntry
  goals: Goal
  settings: Setting
  pushSubs: PushSub
  routes: Route
  routeMarks: RouteMark
  studySessions: StudySession
}

export type PlannerDB = Dexie & { [K in keyof SyncedTables]: EntityTable<SyncedTables[K], 'id'> } & {
  meta: EntityTable<MetaRow, 'key'>
}

/** Какие локальные таблицы синхронизируются и под каким kind они лежат в облачной таблице records. */
export const SYNCED_TABLES = [
  { table: 'habits', kind: 'habit' },
  { table: 'habitLogs', kind: 'habitLog' },
  { table: 'projects', kind: 'project' },
  { table: 'tasks', kind: 'task' },
  { table: 'transactions', kind: 'transaction' },
  { table: 'categories', kind: 'category' },
  { table: 'payments', kind: 'payment' },
  { table: 'savings', kind: 'saving' },
  { table: 'savingEntries', kind: 'savingEntry' },
  { table: 'goals', kind: 'goal' },
  { table: 'settings', kind: 'setting' },
  { table: 'pushSubs', kind: 'pushSub' },
  { table: 'routes', kind: 'route' },
  { table: 'routeMarks', kind: 'routeMark' },
  { table: 'studySessions', kind: 'studySession' },
] as const satisfies readonly { table: keyof SyncedTables; kind: string }[]

export type SyncedTableName = (typeof SYNCED_TABLES)[number]['table']

export function createDb(name = 'planner'): PlannerDB {
  const db = new Dexie(name) as PlannerDB
  db.version(1).stores({
    habits: 'id, dirty',
    habitLogs: 'id, dirty, date, habitId',
    meta: 'key',
  })
  // Этапы 2–5: задачи, финансы, цели, настройки уведомлений.
  db.version(2).stores({
    projects: 'id, dirty',
    tasks: 'id, dirty, projectId, date',
    transactions: 'id, dirty, date',
    categories: 'id, dirty',
    payments: 'id, dirty',
    savings: 'id, dirty',
    savingEntries: 'id, dirty, savingId',
    goals: 'id, dirty',
    settings: 'id, dirty',
    pushSubs: 'id, dirty',
  })
  // Учёба: маршрут (содержание) и отметки пройденного.
  db.version(3).stores({
    routes: 'id, dirty',
    routeMarks: 'id, dirty, routeId',
  })
  // Учёба: занятия (часы).
  db.version(4).stores({
    studySessions: 'id, dirty, date',
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
