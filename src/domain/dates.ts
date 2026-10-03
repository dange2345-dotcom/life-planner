import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  format,
  getISODay,
  parseISO,
  startOfISOWeek,
  startOfMonth,
} from 'date-fns'
import { ru } from 'date-fns/locale'

// Все даты в приложении — строки «YYYY-MM-DD» в локальном времени устройства.
// Их можно сравнивать как строки (лексикографический порядок = хронологический).
export type DateKey = string

export function toKey(date: Date): DateKey {
  return format(date, 'yyyy-MM-dd')
}

export function fromKey(key: DateKey): Date {
  return parseISO(key) // для строки без времени date-fns возвращает локальную полночь
}

export function todayKey(now: Date = new Date()): DateKey {
  return toKey(now)
}

export function addDaysKey(key: DateKey, days: number): DateKey {
  return toKey(addDays(fromKey(key), days))
}

export function diffDays(a: DateKey, b: DateKey): number {
  return differenceInCalendarDays(fromKey(a), fromKey(b))
}

/** День недели по ISO: 1 = понедельник … 7 = воскресенье. */
export function isoWeekday(key: DateKey): number {
  return getISODay(fromKey(key))
}

/** Понедельник недели, в которую входит дата. */
export function weekStart(key: DateKey): DateKey {
  return toKey(startOfISOWeek(fromKey(key)))
}

/** Неделя относится к тому месяцу, в который попадает её четверг (правило ISO) — так каждая неделя принадлежит ровно одному месяцу. */
export function weekMonth(weekStartKey: DateKey): string {
  return addDaysKey(weekStartKey, 3).slice(0, 7)
}

/** «YYYY-MM» */
export type MonthKey = string

export function monthOf(key: DateKey): MonthKey {
  return key.slice(0, 7)
}

export function monthStart(month: MonthKey): DateKey {
  return `${month}-01`
}

export function monthEnd(month: MonthKey): DateKey {
  return toKey(endOfMonth(fromKey(monthStart(month))))
}

export function addMonthsKey(month: MonthKey, months: number): MonthKey {
  return toKey(addMonths(startOfMonth(fromKey(monthStart(month))), months)).slice(0, 7)
}

/** Все дни в диапазоне [from, to] включительно. */
export function daysBetween(from: DateKey, to: DateKey): DateKey[] {
  const days: DateKey[] = []
  for (let day = from; day <= to; day = addDaysKey(day, 1)) days.push(day)
  return days
}

export function weekDays(weekStartKey: DateKey): DateKey[] {
  return daysBetween(weekStartKey, addDaysKey(weekStartKey, 6))
}

/** Понедельники недель, относящихся к месяцу (по правилу четверга). */
export function weeksOfMonth(month: MonthKey): DateKey[] {
  const weeks: DateKey[] = []
  for (let monday = weekStart(monthStart(month)); monday <= monthEnd(month); monday = addDaysKey(monday, 7)) {
    if (weekMonth(monday) === month) weeks.push(monday)
  }
  return weeks
}

export const WEEKDAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export function formatLong(key: DateKey): string {
  return format(fromKey(key), 'EEEE, d MMMM', { locale: ru })
}

export function formatMonth(month: MonthKey): string {
  const text = format(fromKey(monthStart(month)), 'LLLL yyyy', { locale: ru })
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function formatMonthName(month: MonthKey, kind: 'nominative' | 'genitive' = 'nominative'): string {
  return format(fromKey(monthStart(month)), kind === 'nominative' ? 'LLLL' : 'MMMM', { locale: ru })
}

export function formatDayMonth(key: DateKey): string {
  return format(fromKey(key), 'd MMM', { locale: ru }).replace('.', '')
}

export function formatWeekRange(weekStartKey: DateKey): string {
  const end = addDaysKey(weekStartKey, 6)
  const sameMonth = monthOf(weekStartKey) === monthOf(end)
  const left = sameMonth ? format(fromKey(weekStartKey), 'd') : formatDayMonth(weekStartKey)
  return `${left} – ${formatDayMonth(end)}`
}
