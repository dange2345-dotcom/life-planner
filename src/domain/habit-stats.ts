import type { Habit, HabitLog } from '../db/types'
import {
  addDaysKey,
  addMonthsKey,
  daysBetween,
  isoWeekday,
  monthEnd,
  monthOf,
  monthStart,
  weekStart,
  type DateKey,
  type MonthKey,
} from './dates'

// Правило подсчёта процентов (одно для всех расписаний):
// период (день / неделя / месяц) попадает в «запланировано», когда он уже закончился ИЛИ уже выполнен.
// Поэтому утром невыполненный сегодняшний день, а в середине недели невыполненная недельная привычка
// процент не портят — он честно показывает результат по завершённым периодам.

/** habitId → множество дат с отметкой «сделано». */
export type LogIndex = Map<string, Set<DateKey>>

export function buildLogIndex(logs: HabitLog[]): LogIndex {
  const index: LogIndex = new Map()
  for (const log of logs) {
    if (log.deleted) continue
    let days = index.get(log.habitId)
    if (!days) index.set(log.habitId, (days = new Set()))
    days.add(log.date)
  }
  return index
}

export interface Progress {
  done: number
  planned: number
}

export function percent({ done, planned }: Progress): number | null {
  return planned > 0 ? Math.round((done / planned) * 100) : null
}

export function isActiveOn(habit: Habit, day: DateKey): boolean {
  return day >= habit.startDate && (habit.archivedAt === null || day <= habit.archivedAt)
}

/** Привычка с отметками по конкретным дням (каждый день / по дням недели), а не «N раз за период». */
export function isDayBased(habit: Habit): boolean {
  return habit.schedule.type === 'daily' || habit.schedule.type === 'weekdays'
}

export function isDueOn(habit: Habit, day: DateKey): boolean {
  if (!isActiveOn(habit, day)) return false
  switch (habit.schedule.type) {
    case 'daily':
      return true
    case 'weekdays':
      return habit.schedule.days.includes(isoWeekday(day))
    default:
      return false
  }
}

function countBetween(done: Set<DateKey> | undefined, from: DateKey, to: DateKey): number {
  if (!done) return 0
  let count = 0
  for (const day of done) if (day >= from && day <= to) count++
  return count
}

const maxKey = (a: DateKey, b: DateKey) => (a > b ? a : b)
const minKey = (a: DateKey, b: DateKey) => (a < b ? a : b)

/** Активная часть периода [from, to] для привычки или null, если привычка в нём не активна. */
function activeRange(habit: Habit, from: DateKey, to: DateKey): [DateKey, DateKey] | null {
  const start = maxKey(from, habit.startDate)
  const end = habit.archivedAt ? minKey(to, habit.archivedAt) : to
  return start <= end ? [start, end] : null
}

/** Сколько раз за период [from, to] привычку нужно было выполнить и сколько выполнено (будущее не учитывается). */
export function habitProgress(
  habit: Habit,
  done: Set<DateKey> | undefined,
  from: DateKey,
  to: DateKey,
  today: DateKey,
): Progress {
  const result: Progress = { done: 0, planned: 0 }
  const schedule = habit.schedule

  if (schedule.type === 'daily' || schedule.type === 'weekdays') {
    const range = activeRange(habit, from, minKey(to, today))
    if (!range) return result
    for (const day of daysBetween(range[0], range[1])) {
      if (!isDueOn(habit, day)) continue
      const isDone = done?.has(day) ?? false
      if (day < today || isDone) {
        result.planned++
        if (isDone) result.done++
      }
    }
    return result
  }

  const addPeriod = (periodStart: DateKey, periodEnd: DateKey) => {
    if (periodStart > today) return
    const range = activeRange(habit, periodStart, periodEnd)
    if (!range) return
    const count = countBetween(done, range[0], range[1])
    const complete = count >= schedule.times
    if (periodEnd < today || complete) {
      result.planned += schedule.times
      result.done += Math.min(count, schedule.times)
    }
  }

  if (schedule.type === 'weekly') {
    // Неделя относится к периоду, если в него попадает её четверг (правило ISO).
    for (let monday = weekStart(from); addDaysKey(monday, 3) <= to; monday = addDaysKey(monday, 7)) {
      if (addDaysKey(monday, 3) >= from) addPeriod(monday, addDaysKey(monday, 6))
    }
  } else {
    for (let month = monthOf(from); month <= monthOf(to); month = addMonthsKey(month, 1)) {
      addPeriod(monthStart(month), monthEnd(month))
    }
  }
  return result
}

export interface HabitMonthRow extends Progress {
  habit: Habit
  pct: number | null
}

export interface DayPoint {
  day: DateKey
  done: number
  due: number
  pct: number | null
}

export interface MonthStats extends Progress {
  perHabit: HabitMonthRow[]
  /** По дням — только привычки «по дням» (как строка «Прогресс %» в таблице-референсе). */
  perDay: DayPoint[]
}

export function monthStats(habits: Habit[], index: LogIndex, month: MonthKey, today: DateKey): MonthStats {
  const from = monthStart(month)
  const to = monthEnd(month)

  const perHabit = habits.map((habit) => {
    const progress = habitProgress(habit, index.get(habit.id), from, to, today)
    return { habit, ...progress, pct: percent(progress) }
  })

  const perDay: DayPoint[] = daysBetween(from, minKey(to, today)).map((day) => {
    let due = 0
    let done = 0
    for (const habit of habits) {
      if (!isDueOn(habit, day)) continue
      due++
      if (index.get(habit.id)?.has(day)) done++
    }
    return { day, due, done, pct: percent({ done, planned: due }) }
  })

  return {
    done: perHabit.reduce((sum, row) => sum + row.done, 0),
    planned: perHabit.reduce((sum, row) => sum + row.planned, 0),
    perHabit,
    perDay,
  }
}

/** Отметки за неделю/месяц, в которые входит день — для «N раз в неделю/месяц». */
export function periodCount(habit: Habit, done: Set<DateKey> | undefined, day: DateKey): number {
  const [from, to] =
    habit.schedule.type === 'weekly'
      ? [weekStart(day), addDaysKey(weekStart(day), 6)]
      : [monthStart(monthOf(day)), monthEnd(monthOf(day))]
  const range = activeRange(habit, from, to)
  return range ? countBetween(done, range[0], range[1]) : 0
}

/**
 * Серия: сколько периодов подряд (дней / недель / месяцев) выполнено, считая назад от текущего.
 * Текущий невыполненный период серию не обрывает — он ещё не закончился.
 */
export function streak(habit: Habit, done: Set<DateKey> | undefined, today: DateKey): number {
  const schedule = habit.schedule
  let count = 0

  if (schedule.type === 'daily' || schedule.type === 'weekdays') {
    for (let day = today, guard = 0; day >= habit.startDate && guard < 3700; day = addDaysKey(day, -1), guard++) {
      if (!isDueOn(habit, day)) continue
      if (done?.has(day)) count++
      else if (day !== today) break
    }
    return count
  }

  if (schedule.type === 'weekly') {
    const current = weekStart(today)
    for (let monday = current; addDaysKey(monday, 6) >= habit.startDate; monday = addDaysKey(monday, -7)) {
      if (periodCount(habit, done, monday) >= schedule.times) count++
      else if (monday !== current) break
    }
    return count
  }

  const current = monthOf(today)
  for (let month = current; monthEnd(month) >= habit.startDate; month = addMonthsKey(month, -1)) {
    if (periodCount(habit, done, monthStart(month)) >= schedule.times) count++
    else if (month !== current) break
  }
  return count
}

export interface TodayItem {
  habit: Habit
  doneToday: boolean
  /** Для «N раз в неделю/месяц»: сколько уже сделано за период. */
  period: { count: number; times: number; unit: 'week' | 'month' } | null
  streak: number
}

/**
 * Что показать на экране «Сегодня»: привычки, запланированные на сегодня,
 * и «N раз за период», если план периода ещё не выполнен (или отметка сделана сегодня).
 */
export function todayItems(habits: Habit[], index: LogIndex, today: DateKey): TodayItem[] {
  const items: TodayItem[] = []
  for (const habit of [...habits].sort((a, b) => a.order - b.order)) {
    if (!isActiveOn(habit, today)) continue
    const done = index.get(habit.id)
    const doneToday = done?.has(today) ?? false
    const schedule = habit.schedule

    if (schedule.type === 'daily' || schedule.type === 'weekdays') {
      if (!isDueOn(habit, today)) continue
      items.push({ habit, doneToday, period: null, streak: streak(habit, done, today) })
      continue
    }

    const count = periodCount(habit, done, today)
    if (count >= schedule.times && !doneToday) continue
    items.push({
      habit,
      doneToday,
      period: { count, times: schedule.times, unit: schedule.type === 'weekly' ? 'week' : 'month' },
      streak: streak(habit, done, today),
    })
  }
  return items
}
