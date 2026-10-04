// Какие напоминания отправить в эту минуту и с каким текстом. Чистые функции без зависимостей:
// работают в Deno (функция Supabase) и проверяются тестами в Node. Правила «что запланировано на день»
// повторяют src/domain/habit-stats.ts и src/domain/money.ts — тесты сверяют их между собой.

import type { PushMessage } from './webpush.ts'

export type DateKey = string

export type HabitSchedule =
  | { type: 'daily' }
  | { type: 'weekdays'; days: number[] }
  | { type: 'weekly'; times: number }
  | { type: 'monthly'; times: number }

export interface HabitRec {
  id: string
  title: string
  emoji: string
  schedule: HabitSchedule
  startDate: DateKey
  archivedAt: DateKey | null
  order: number
  remindAt?: string[]
}

export interface TaskRec {
  id: string
  title: string
  date: DateKey | null
  time: string | null
  doneAt: DateKey | null
}

export type PaymentSchedule =
  | { type: 'monthly'; day: number }
  | { type: 'yearly'; month: number; day: number }
  | { type: 'weekly'; weekday: number }

export interface PaymentRec {
  id: string
  title: string
  emoji: string
  amount: number
  schedule: PaymentSchedule
  startDate: DateKey
  endDate: DateKey | null
}

export interface NotifySettings {
  morning: { enabled: boolean; time: string }
  evening: { enabled: boolean; time: string }
  habits: boolean
  tasks: boolean
  timezone: string
}

export const DEFAULT_SETTINGS: NotifySettings = {
  morning: { enabled: true, time: '08:00' },
  evening: { enabled: true, time: '21:30' },
  habits: true,
  tasks: true,
  timezone: 'Europe/Moscow',
}

export interface UserData {
  settings: NotifySettings
  habits: HabitRec[]
  /** Отметки привычек (достаточно за последние ~40 дней): ключ `${habitId}:${date}`. */
  logs: Set<string>
  tasks: TaskRec[]
  payments: PaymentRec[]
  /** id операций-оплат: `pay:${paymentId}:${dueDate}`. */
  paid: Set<string>
}

/* ===================== Даты ===================== */

export interface LocalNow {
  date: DateKey
  /** «HH:MM» */
  time: string
}

/** Дата и время в часовом поясе владельца. */
export function localNow(at: Date, timeZone: string): LocalNow {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

function toUtc(key: DateKey): Date {
  return new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))))
}

export function addDays(key: DateKey, days: number): DateKey {
  const date = toUtc(key)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** ISO: 1 = пн … 7 = вс. */
export function weekday(key: DateKey): number {
  return toUtc(key).getUTCDay() || 7
}

function lastDayOfMonth(month: string): number {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
}

/* ===================== Привычки ===================== */

function isActive(habit: HabitRec, day: DateKey): boolean {
  return day >= habit.startDate && (habit.archivedAt === null || day <= habit.archivedAt)
}

export interface HabitToday {
  habit: HabitRec
  done: boolean
  /** Для «N раз в неделю/месяц»: сколько уже за период. */
  period: { count: number; times: number; unit: 'week' | 'month' } | null
}

/** Привычки на сегодня — как на экране «Сегодня» (habit-stats todayItems). */
export function habitsToday(habits: HabitRec[], logs: Set<string>, today: DateKey): HabitToday[] {
  const list: HabitToday[] = []
  for (const habit of [...habits].sort((a, b) => a.order - b.order)) {
    if (!isActive(habit, today)) continue
    const done = logs.has(`${habit.id}:${today}`)
    const s = habit.schedule
    if (s.type === 'daily' || (s.type === 'weekdays' && s.days.includes(weekday(today)))) {
      list.push({ habit, done, period: null })
      continue
    }
    if (s.type === 'weekdays') continue

    const from = s.type === 'weekly' ? addDays(today, 1 - weekday(today)) : `${today.slice(0, 7)}-01`
    const to = s.type === 'weekly' ? addDays(from, 6) : `${today.slice(0, 7)}-${lastDayOfMonth(today.slice(0, 7))}`
    let count = 0
    for (let day = from; day <= to; day = addDays(day, 1)) {
      if (isActive(habit, day) && logs.has(`${habit.id}:${day}`)) count++
    }
    if (count >= s.times && !done) continue
    list.push({ habit, done, period: { count, times: s.times, unit: s.type === 'weekly' ? 'week' : 'month' } })
  }
  return list
}

/* ===================== Платежи ===================== */

export function paymentDueOn(payment: PaymentRec, day: DateKey): boolean {
  if (day < payment.startDate || (payment.endDate !== null && day > payment.endDate)) return false
  const s = payment.schedule
  if (s.type === 'weekly') return weekday(day) === s.weekday
  const dayOfMonth = Number(day.slice(8, 10))
  const due = Math.min(s.day, lastDayOfMonth(day.slice(0, 7)))
  if (s.type === 'monthly') return dayOfMonth === due
  return Number(day.slice(5, 7)) === s.month && dayOfMonth === due
}

const money = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
export const formatMoney = (amount: number) => `${money.format(amount)} ₽`

/* ===================== Тексты ===================== */

function listNames(names: string[], max = 4): string {
  if (names.length <= max) return names.join(', ')
  return `${names.slice(0, max).join(', ')} и ещё ${names.length - max}`
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

function openTasks(tasks: TaskRec[], today: DateKey) {
  const open = tasks.filter((t) => t.doneAt === null && t.date !== null && t.date <= today)
  return { today: open.filter((t) => t.date === today), overdue: open.filter((t) => t.date! < today) }
}

function unpaid(data: UserData, day: DateKey): PaymentRec[] {
  return data.payments.filter((p) => paymentDueOn(p, day) && !data.paid.has(`pay:${p.id}:${day}`))
}

export function morningMessage(data: UserData, today: DateKey): PushMessage | null {
  const habits = habitsToday(data.habits, data.logs, today).filter((h) => !h.done)
  const tasks = openTasks(data.tasks, today)
  const payToday = unpaid(data, today)
  const payTomorrow = unpaid(data, addDays(today, 1))

  const lines: string[] = []
  if (habits.length) lines.push(`Привычки: ${habits.length}`)
  if (tasks.today.length || tasks.overdue.length) {
    const overdue = tasks.overdue.length ? ` (+${tasks.overdue.length} ${plural(tasks.overdue.length, 'просрочена', 'просрочены', 'просрочено')})` : ''
    lines.push(`Задачи: ${tasks.today.length}${overdue}${tasks.today.length ? ` — ${listNames(tasks.today.map((t) => t.title), 2)}` : ''}`)
  }
  for (const p of payToday) lines.push(`Сегодня платёж: ${p.emoji} ${p.title} — ${formatMoney(p.amount)}`)
  for (const p of payTomorrow) lines.push(`Завтра платёж: ${p.emoji} ${p.title} — ${formatMoney(p.amount)}`)
  if (lines.length === 0) return null
  return { title: 'План на сегодня', body: lines.join('\n'), tag: `morning:${today}`, url: '#/today' }
}

export function eveningMessage(data: UserData, today: DateKey): PushMessage | null {
  const habits = habitsToday(data.habits, data.logs, today)
  const left = habits.filter((h) => !h.done)
  const tasks = openTasks(data.tasks, today)
  const taskCount = tasks.today.length + tasks.overdue.length
  if (left.length === 0 && taskCount === 0) return null

  const lines: string[] = []
  if (left.length) {
    lines.push(`Отмечено ${habits.length - left.length} из ${habits.length}. Осталось: ${listNames(left.map((h) => `${h.habit.emoji} ${h.habit.title}`))}`)
  }
  if (taskCount) lines.push(`Не сделано ${taskCount} ${plural(taskCount, 'задача', 'задачи', 'задач')}: ${listNames([...tasks.overdue, ...tasks.today].map((t) => t.title), 3)}`)
  return { title: 'Как прошёл день?', body: lines.join('\n'), tag: `evening:${today}`, url: '#/today' }
}

/** Все напоминания, которые нужно отправить в эту минуту. */
export function dueMessages(data: UserData, now: LocalNow): PushMessage[] {
  const { settings } = data
  const messages: PushMessage[] = []

  if (settings.morning.enabled && settings.morning.time === now.time) {
    const message = morningMessage(data, now.date)
    if (message) messages.push(message)
  }

  if (settings.habits) {
    for (const item of habitsToday(data.habits, data.logs, now.date)) {
      if (item.done || !(item.habit.remindAt ?? []).includes(now.time)) continue
      const progress = item.period
        ? ` (${item.period.count} из ${item.period.times} ${item.period.unit === 'week' ? 'на этой неделе' : 'в этом месяце'})`
        : ''
      messages.push({
        title: `${item.habit.emoji} ${item.habit.title}`,
        body: `Пора! Сегодня ещё не отмечено${progress}`,
        tag: `habit:${item.habit.id}:${now.date}`,
        url: '#/today',
      })
    }
  }

  if (settings.tasks) {
    for (const task of data.tasks) {
      if (task.doneAt !== null || task.date !== now.date || task.time !== now.time) continue
      messages.push({ title: `📌 ${task.title}`, body: `Задача на ${task.time}`, tag: `task:${task.id}`, url: '#/tasks' })
    }
  }

  if (settings.evening.enabled && settings.evening.time === now.time) {
    const message = eveningMessage(data, now.date)
    if (message) messages.push(message)
  }
  return messages
}

/** Нужно ли в эту минуту вообще что-то проверять — чтобы не грузить отметки и платежи без надобности. */
export function anythingDue(settings: NotifySettings, habits: HabitRec[], tasks: TaskRec[], now: LocalNow): boolean {
  return (
    (settings.morning.enabled && settings.morning.time === now.time) ||
    (settings.evening.enabled && settings.evening.time === now.time) ||
    (settings.habits && habits.some((h) => (h.remindAt ?? []).includes(now.time))) ||
    (settings.tasks && tasks.some((t) => t.date === now.date && t.time === now.time))
  )
}
