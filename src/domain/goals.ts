import type { Goal, Habit, Project, Saving, SavingEntry, Task } from '../db/types'
import { plural } from '../lib/plural'
import type { DateKey } from './dates'
import { habitProgress, percent, type LogIndex } from './habit-stats'
import { savingStats } from './money'
import { projectProgress } from './tasks'

/** Сферы жизни. id не менять — на них ссылаются цели. */
export const SPHERES: { id: string; title: string; emoji: string }[] = [
  { id: 'health', title: 'Здоровье', emoji: '❤️' },
  { id: 'growth', title: 'Саморазвитие', emoji: '📚' },
  { id: 'career', title: 'Работа и карьера', emoji: '💼' },
  { id: 'money', title: 'Финансы', emoji: '💰' },
  { id: 'relations', title: 'Семья и отношения', emoji: '💞' },
  { id: 'home', title: 'Дом и быт', emoji: '🏠' },
  { id: 'hobby', title: 'Отдых и хобби', emoji: '🎨' },
  { id: 'travel', title: 'Путешествия', emoji: '✈️' },
]

export function sphereInfo(id: string): { id: string; title: string; emoji: string } {
  return SPHERES.find((s) => s.id === id) ?? { id, title: 'Другое', emoji: '🎯' }
}

export interface GoalContext {
  habits: Habit[]
  index: LogIndex
  projects: Project[]
  tasks: Task[]
  savings: Saving[]
  savingEntries: SavingEntry[]
  today: DateKey
}

export interface GoalPart {
  kind: 'habit' | 'project' | 'saving' | 'steps'
  id: string
  title: string
  emoji: string
  /** Процент этой части; null — пока нечего считать (например, привычка ещё не начиналась). */
  pct: number | null
  detail: string
}

/** Привязанные к цели привычки, проекты, накопления и шаги — с процентами. */
export function goalParts(goal: Goal, ctx: GoalContext): GoalPart[] {
  const parts: GoalPart[] = []
  const from = `${goal.year}-01-01`
  const to = `${goal.year}-12-31`

  for (const habit of ctx.habits) {
    if (habit.goalId !== goal.id) continue
    const progress = habitProgress(habit, ctx.index.get(habit.id), from, to, ctx.today)
    parts.push({
      kind: 'habit',
      id: habit.id,
      title: habit.title,
      emoji: habit.emoji,
      pct: percent(progress),
      detail: progress.planned ? `${progress.done} из ${progress.planned}` : 'ещё не начиналась',
    })
  }

  for (const project of ctx.projects) {
    if (project.goalId !== goal.id) continue
    const progress = projectProgress(project.id, ctx.tasks)
    const pct = project.doneAt ? 100 : progress.pct
    parts.push({
      kind: 'project',
      id: project.id,
      title: project.title,
      emoji: project.emoji,
      pct,
      detail: progress.total ? `${progress.done} из ${progress.total} ${plural(progress.total, 'задачи', 'задач', 'задач')}` : project.doneAt ? 'завершён' : 'нет задач',
    })
  }

  for (const saving of ctx.savings) {
    if (saving.goalId !== goal.id) continue
    const stats = savingStats(saving, ctx.savingEntries, ctx.today)
    parts.push({ kind: 'saving', id: saving.id, title: saving.title, emoji: saving.emoji, pct: stats.pct, detail: '' })
  }

  if (goal.steps.length > 0) {
    const done = goal.steps.filter((s) => s.done).length
    parts.push({
      kind: 'steps',
      id: 'steps',
      title: 'Шаги',
      emoji: '🪜',
      pct: Math.round((done / goal.steps.length) * 100),
      detail: `${done} из ${goal.steps.length}`,
    })
  }
  return parts
}

/** Сколько сделано для цели-счётчика: отметки привязанной привычки + то, что было до начала учёта. */
export function goalCount(goal: Goal, index: LogIndex): number {
  const logs = goal.countHabitId ? (index.get(goal.countHabitId)?.size ?? 0) : 0
  return goal.countBase + logs
}

/** Процент цели (0–100) или null, если считать пока не из чего. */
export function goalProgress(goal: Goal, ctx: GoalContext): number | null {
  if (goal.doneAt) return 100
  if (goal.measure === 'manual') return clamp(goal.manualValue)
  if (goal.measure === 'count') {
    if (goal.countTarget <= 0) return null
    return clamp(Math.floor((goalCount(goal, ctx.index) / goal.countTarget) * 100))
  }
  const values = goalParts(goal, ctx)
    .map((part) => part.pct)
    .filter((pct): pct is number => pct !== null)
  if (values.length === 0) return null
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length)
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export interface YearSummary {
  total: number
  reached: number
  /** Средний процент по целям, у которых он есть. */
  pct: number | null
}

export function yearSummary(goals: Goal[], ctx: GoalContext): YearSummary {
  const values = goals.map((g) => goalProgress(g, ctx)).filter((v): v is number => v !== null)
  return {
    total: goals.length,
    reached: goals.filter((g) => g.doneAt !== null).length,
    pct: values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : null,
  }
}
