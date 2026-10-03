import type { PlannerDB } from '../db/db'
import { emitLocalChange, nextStamp } from '../db/changes'
import type { Habit, HabitLog, HabitSchedule } from '../db/types'
import type { DateKey } from '../domain/dates'

// Все изменения привычек проходят здесь: запись помечается dirty, время изменения растёт,
// а движок синхронизации получает сигнал отправить её в облако.

export interface HabitInput {
  title: string
  emoji: string
  schedule: HabitSchedule
  startDate: DateKey
  /** Последний день (курс на срок); null — без срока. */
  archivedAt?: DateKey | null
}

export async function createHabit(db: PlannerDB, input: HabitInput): Promise<string> {
  const id = crypto.randomUUID()
  await db.transaction('rw', db.habits, async () => {
    const all = await db.habits.toArray()
    const order = all.reduce((max, habit) => Math.max(max, habit.order), 0) + 1
    await db.habits.add({
      ...input,
      id,
      order,
      archivedAt: input.archivedAt ?? null,
      goalId: null,
      updatedAt: nextStamp(),
      deleted: 0,
      dirty: 1,
    })
  })
  emitLocalChange()
  return id
}

export async function updateHabit(db: PlannerDB, id: string, changes: Partial<Omit<Habit, keyof SyncMetaKeys>>) {
  await db.transaction('rw', db.habits, async () => {
    const prev = await db.habits.get(id)
    if (!prev) return
    await db.habits.put({ ...prev, ...changes, updatedAt: nextStamp(prev), dirty: 1 })
  })
  emitLocalChange()
}

/** В архив: с этого дня привычка больше не планируется, история и проценты прошлых дней сохраняются. */
export function archiveHabit(db: PlannerDB, id: string, lastDay: DateKey) {
  return updateHabit(db, id, { archivedAt: lastDay })
}

export function restoreHabit(db: PlannerDB, id: string) {
  return updateHabit(db, id, { archivedAt: null })
}

export async function deleteHabit(db: PlannerDB, id: string) {
  await db.transaction('rw', db.habits, async () => {
    const prev = await db.habits.get(id)
    if (!prev) return
    await db.habits.put({ ...prev, deleted: 1, updatedAt: nextStamp(prev), dirty: 1 })
  })
  emitLocalChange()
}

export async function moveHabit(db: PlannerDB, id: string, direction: -1 | 1) {
  await db.transaction('rw', db.habits, async () => {
    const list = (await db.habits.toArray()).filter((h) => !h.deleted).sort((a, b) => a.order - b.order)
    const index = list.findIndex((h) => h.id === id)
    const other = list[index + direction]
    if (index < 0 || !other) return
    const current = list[index]
    await db.habits.bulkPut([
      { ...current, order: other.order, updatedAt: nextStamp(current), dirty: 1 },
      { ...other, order: current.order, updatedAt: nextStamp(other), dirty: 1 },
    ])
  })
  emitLocalChange()
}

export function habitLogId(habitId: string, date: DateKey): string {
  return `${habitId}:${date}`
}

/** Отметить / снять отметку за день. Снятая отметка хранится как deleted, чтобы снятие доехало до других устройств. */
export async function toggleHabitLog(db: PlannerDB, habitId: string, date: DateKey): Promise<boolean> {
  const id = habitLogId(habitId, date)
  let done = false
  await db.transaction('rw', db.habitLogs, async () => {
    const prev = await db.habitLogs.get(id)
    done = !prev || prev.deleted === 1
    const log: HabitLog = {
      id,
      habitId,
      date,
      updatedAt: nextStamp(prev),
      deleted: done ? 0 : 1,
      dirty: 1,
    }
    await db.habitLogs.put(log)
  })
  emitLocalChange()
  return done
}

type SyncMetaKeys = { id: 1; updatedAt: 1; deleted: 1; dirty: 1 }
