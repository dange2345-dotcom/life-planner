import type { DateKey } from '../domain/dates'

/** 0/1 вместо boolean: IndexedDB не умеет индексировать boolean. */
export type Flag = 0 | 1

/** Служебные поля каждой синхронизируемой записи. */
export interface SyncMeta {
  id: string
  /** Время последнего изменения на устройстве, мс. При конфликте побеждает большее. */
  updatedAt: number
  /** Удаление = пометка, чтобы оно доехало до других устройств. */
  deleted: Flag
  /** 1 — изменение ещё не отправлено в облако. */
  dirty: Flag
}

export type HabitSchedule =
  | { type: 'daily' }
  /** Конкретные дни недели, ISO: 1 = пн … 7 = вс. */
  | { type: 'weekdays'; days: number[] }
  /** N раз в неделю, в любые дни. */
  | { type: 'weekly'; times: number }
  /** N раз в месяц, в любые дни. */
  | { type: 'monthly'; times: number }

export interface Habit extends SyncMeta {
  title: string
  emoji: string
  schedule: HabitSchedule
  /** С этого дня привычка планируется. */
  startDate: DateKey
  /** Последний день, когда привычка планировалась (архив). null — активна. */
  archivedAt: DateKey | null
  order: number
  /** Цель на год, к которой привязана привычка (этап 5). */
  goalId: string | null
}

/** Отметка «сделано» за день. id = `${habitId}:${date}` — одинаковый на всех устройствах, поэтому без дублей. */
export interface HabitLog extends SyncMeta {
  habitId: string
  date: DateKey
}

export interface MetaRow {
  key: string
  value: unknown
}
