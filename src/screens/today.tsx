import { useState } from 'preact/hooks'
import { useApp } from '../app-context'
import { toggleHabitLog } from '../data/habits'
import { togglePaid } from '../data/money'
import { createTask } from '../data/tasks'
import { useHabitsData } from '../data/use-habits'
import { useRows } from '../data/use-data'
import type { Habit, Task } from '../db/types'
import { addDaysKey, formatLong, formatRelative } from '../domain/dates'
import { percent, todayItems, type TodayItem } from '../domain/habit-stats'
import { buildPaidIndex, formatMoney, occurrences } from '../domain/money'
import { todayTasks } from '../domain/tasks'
import { plural } from '../lib/plural'
import { useToday } from '../lib/hooks'
import { CheckButton, ProgressBar, Ring, ScreenHeader } from '../ui/components'
import { IconCheck, IconFlame, IconPlus } from '../ui/icons'
import { HabitForm } from './habit-form'
import { QuickAdd, TaskForm, TaskRow } from './task-parts'

export function TodayScreen() {
  const { db } = useApp()
  const today = useToday()
  const { habits, index, loaded } = useHabitsData()
  const tasks = useRows('tasks') ?? []
  const projects = useRows('projects') ?? []
  const payments = useRows('payments') ?? []
  const transactions = useRows('transactions') ?? []
  const [form, setForm] = useState<{ habit?: Habit } | null>(null)
  const [taskForm, setTaskForm] = useState<{ task?: Task } | null>(null)

  const items = todayItems(habits, index, today)
  const habitsDone = items.filter((item) => item.doneToday).length
  const dayTasks = todayTasks(tasks, today)
  const tasksTotal = dayTasks.open.length + dayTasks.doneToday.length
  const done = habitsDone + dayTasks.doneToday.length
  const planned = items.length + tasksTotal
  const pct = percent({ done, planned })
  const subtitle = formatLong(today)
  const projectById = new Map(projects.map((p) => [p.id, p]))

  // Платежи: неоплаченные просроченные (до месяца) + сегодня и завтра.
  const pays = occurrences(payments, buildPaidIndex(transactions), addDaysKey(today, -30), addDaysKey(today, 1)).filter(
    (o) => o.dueDate >= today || !o.paid,
  )

  return (
    <>
      <ScreenHeader title="Сегодня" subtitle={subtitle.charAt(0).toUpperCase() + subtitle.slice(1)} />

      <section class="card day-summary">
        <Ring value={pct} size={76} stroke={8} />
        <div class="day-summary__text">
          <p class="day-summary__title">
            {planned === 0 ? 'На сегодня ничего не запланировано' : done === planned ? 'Всё сделано 🎉' : `Выполнено ${done} из ${planned}`}
          </p>
          <ProgressBar value={pct} />
          {planned > 0 && (
            <p class="muted small">
              привычки {habitsDone}/{items.length} · задачи {dayTasks.doneToday.length}/{tasksTotal}
            </p>
          )}
        </div>
      </section>

      <section class="card">
        <div class="card__head">
          <h2>Привычки</h2>
          <button class="icon-btn" onClick={() => setForm({})} aria-label="Добавить привычку">
            <IconPlus size={20} />
          </button>
        </div>
        {loaded && habits.length === 0 ? (
          <div class="stack-sm">
            <p class="muted">Добавьте то, что хотите делать регулярно: каждый день, по дням недели или несколько раз в неделю.</p>
            <button class="btn btn--secondary" onClick={() => setForm({})}>
              Добавить привычку
            </button>
          </div>
        ) : items.length === 0 ? (
          <p class="muted">Сегодня по плану ничего — можно отдохнуть.</p>
        ) : (
          <ul class="today-list">
            {items.map((item) => (
              <li key={item.habit.id}>
                <TodayRow item={item} onToggle={() => void toggleHabitLog(db, item.habit.id, today)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section class="card">
        <div class="card__head">
          <h2>Задачи</h2>
          <a class="btn btn--ghost btn--small" href="#/tasks">
            Все задачи
          </a>
        </div>
        <div class="stack-sm">
          {tasksTotal > 0 && (
            <ul class="task-list">
              {[...dayTasks.open, ...dayTasks.doneToday].map((task) => (
                <li key={task.id}>
                  <TaskRow task={task} today={today} project={task.projectId ? projectById.get(task.projectId) : undefined} onOpen={() => setTaskForm({ task })} />
                </li>
              ))}
            </ul>
          )}
          <QuickAdd placeholder="Задача на сегодня" onAdd={(title) => createTask(db, { title, date: today })} />
        </div>
      </section>

      {pays.length > 0 && (
        <section class="card">
          <div class="card__head">
            <h2>Платежи</h2>
            <a class="btn btn--ghost btn--small" href="#/finance">
              Финансы
            </a>
          </div>
          <ul class="task-list">
            {pays.map((o) => {
              const overdue = !o.paid && o.dueDate < today
              return (
                <li key={`${o.payment.id}:${o.dueDate}`}>
                  <div class={`task-row${o.paid ? ' task-row--done' : ''}`}>
                    <CheckButton done={o.paid !== null} onClick={() => void togglePaid(db, o.payment, o.dueDate, today)} label={o.paid ? 'Снять оплату' : 'Оплачено'} />
                    <span class="task-row__body task-row__body--static">
                      <span class="task-row__title">
                        {o.payment.emoji} {o.payment.title}
                      </span>
                      <span class={`task-row__meta${overdue ? ' meta-overdue' : ''}`}>
                        {overdue ? `просрочен с ${formatRelative(o.dueDate, today).toLowerCase()}` : formatRelative(o.dueDate, today)}
                      </span>
                    </span>
                    <span class="task-row__amount tabular">{formatMoney(o.payment.amount)}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {form && <HabitForm habit={form.habit} today={today} onClose={() => setForm(null)} />}
      {taskForm && <TaskForm task={taskForm.task} today={today} projects={projects} onClose={() => setTaskForm(null)} />}
    </>
  )
}

function TodayRow({ item, onToggle }: { item: TodayItem; onToggle: () => void }) {
  const { habit, doneToday, period, streak } = item
  const meta: string[] = []
  if (period) {
    const count = period.count
    meta.push(`${count} из ${period.times} ${period.unit === 'week' ? 'на этой неделе' : 'в этом месяце'}`)
  }

  return (
    <button type="button" class={`today-row${doneToday ? ' today-row--done' : ''}`} aria-pressed={doneToday} onClick={onToggle}>
      <span class="today-row__emoji" aria-hidden="true">
        {habit.emoji}
      </span>
      <span class="today-row__text">
        <span class="today-row__title">{habit.title}</span>
        {(meta.length > 0 || streak > 1) && (
          <span class="today-row__meta">
            {meta.join(' · ')}
            {streak > 1 && (
              <span class="streak">
                <IconFlame size={14} />
                {streakText(streak, period?.unit)}
              </span>
            )}
          </span>
        )}
      </span>
      <span class="check" aria-hidden="true">
        <IconCheck size={18} />
      </span>
    </button>
  )
}

function streakText(n: number, unit?: 'week' | 'month'): string {
  if (unit === 'week') return `${n} ${plural(n, 'неделя', 'недели', 'недель')} подряд`
  if (unit === 'month') return `${n} ${plural(n, 'месяц', 'месяца', 'месяцев')} подряд`
  return `${n} ${plural(n, 'день', 'дня', 'дней')} подряд`
}
