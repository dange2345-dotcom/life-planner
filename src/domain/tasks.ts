import type { Priority, Task } from '../db/types'
import { addDaysKey, type DateKey } from './dates'

export const PRIORITIES: { value: Priority; label: string; short: string }[] = [
  { value: 0, label: 'Нет', short: '' },
  { value: 1, label: 'Низкий', short: 'низкий' },
  { value: 2, label: 'Средний', short: 'средний' },
  { value: 3, label: 'Высокий', short: 'высокий' },
]

/** Порядок внутри дня: приоритет выше → раньше, затем по времени (без времени — в конце), затем как добавляли. */
export function compareTasks(a: Task, b: Task): number {
  if (a.priority !== b.priority) return b.priority - a.priority
  if (a.time !== b.time) {
    if (a.time === null) return 1
    if (b.time === null) return -1
    return a.time < b.time ? -1 : 1
  }
  return a.order - b.order
}

export function isOverdue(task: Task, today: DateKey): boolean {
  return task.doneAt === null && task.date !== null && task.date < today
}

export interface TaskGroups {
  /** Несделанные с прошедших дней — сами «переносятся» в сегодня. */
  overdue: Task[]
  today: Task[]
  tomorrow: Task[]
  /** Дальше завтрашнего дня — по датам. */
  later: { date: DateKey; tasks: Task[] }[]
  /** Без даты. */
  someday: Task[]
  /** Выполненные за последние 14 дней, свежие сверху. */
  done: Task[]
}

export function groupTasks(tasks: Task[], today: DateKey): TaskGroups {
  const tomorrow = addDaysKey(today, 1)
  const doneSince = addDaysKey(today, -14)
  const groups: TaskGroups = { overdue: [], today: [], tomorrow: [], later: [], someday: [], done: [] }
  const later = new Map<DateKey, Task[]>()

  for (const task of tasks) {
    if (task.doneAt !== null) {
      if (task.doneAt >= doneSince) groups.done.push(task)
    } else if (task.date === null) groups.someday.push(task)
    else if (task.date < today) groups.overdue.push(task)
    else if (task.date === today) groups.today.push(task)
    else if (task.date === tomorrow) groups.tomorrow.push(task)
    else later.set(task.date, [...(later.get(task.date) ?? []), task])
  }

  // Просроченные: сначала самые старые — их дольше всего откладывали.
  groups.overdue.sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : compareTasks(a, b)))
  groups.today.sort(compareTasks)
  groups.tomorrow.sort(compareTasks)
  groups.someday.sort(compareTasks)
  groups.later = [...later.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, list]) => ({ date, tasks: list.sort(compareTasks) }))
  groups.done.sort((a, b) => (a.doneAt! > b.doneAt! ? -1 : a.doneAt! < b.doneAt! ? 1 : b.updatedAt - a.updatedAt))
  return groups
}

/** Задачи на экран «Сегодня»: просроченные + сегодняшние (включая уже сделанные сегодня). */
export function todayTasks(tasks: Task[], today: DateKey): { open: Task[]; doneToday: Task[] } {
  const open = tasks.filter((t) => t.doneAt === null && t.date !== null && t.date <= today)
  open.sort((a, b) => {
    const overdueA = a.date! < today
    const overdueB = b.date! < today
    if (overdueA !== overdueB) return overdueA ? -1 : 1
    return compareTasks(a, b)
  })
  const doneToday = tasks.filter((t) => t.doneAt === today && t.date !== null && t.date <= today).sort(compareTasks)
  return { open, doneToday }
}

export interface ProjectProgress {
  done: number
  total: number
  pct: number | null
}

export function projectProgress(projectId: string, tasks: Task[]): ProjectProgress {
  const own = tasks.filter((t) => t.projectId === projectId)
  const done = own.filter((t) => t.doneAt !== null).length
  return { done, total: own.length, pct: own.length ? Math.round((done / own.length) * 100) : null }
}

/** Несделанные задачи по дням в диапазоне — для календаря месяца (сделанные — по дате плана, отдельно). */
export function tasksByDay(tasks: Task[], from: DateKey, to: DateKey): Map<DateKey, Task[]> {
  const map = new Map<DateKey, Task[]>()
  for (const task of tasks) {
    if (task.date === null || task.date < from || task.date > to) continue
    map.set(task.date, [...(map.get(task.date) ?? []), task])
  }
  for (const list of map.values()) list.sort((a, b) => Number(a.doneAt !== null) - Number(b.doneAt !== null) || compareTasks(a, b))
  return map
}
