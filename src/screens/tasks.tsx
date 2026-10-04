import { useState } from 'preact/hooks'
import { useApp } from '../app-context'
import { togglePaid } from '../data/money'
import { createTask, moveTasks } from '../data/tasks'
import { useRows } from '../data/use-data'
import type { Project, Task } from '../db/types'
import {
  addDaysKey,
  addMonthsKey,
  formatDate,
  formatDayLong,
  formatMonth,
  formatRelative,
  fromKey,
  monthEnd,
  monthOf,
  monthStart,
  weekStart,
  WEEKDAY_SHORT,
  type DateKey,
  type MonthKey,
} from '../domain/dates'
import { buildPaidIndex, formatMoney, occurrences, type Occurrence } from '../domain/money'
import { groupTasks, projectProgress, tasksByDay } from '../domain/tasks'
import { useLocalSetting, useToday } from '../lib/hooks'
import { plural } from '../lib/plural'
import { CheckButton, EmptyState, PeriodNav, ProgressBar, ScreenHeader, Segmented } from '../ui/components'
import { IconPlus } from '../ui/icons'
import { ProjectForm, ProjectSheet, QuickAdd, TaskForm, TaskRow } from './task-parts'

type Mode = 'list' | 'projects' | 'calendar'

export function TasksScreen() {
  const { db } = useApp()
  const today = useToday()
  const [mode, setMode] = useLocalSetting<Mode>('tasks.mode', 'list')
  const tasks = useRows('tasks')
  const projects = useRows('projects') ?? []
  const goals = useRows('goals') ?? []
  const [month, setMonth] = useState(() => monthOf(today))
  const [selected, setSelected] = useState(today)
  const [taskForm, setTaskForm] = useState<{ task?: Task; defaults?: Partial<Task> } | null>(null)
  const [projectForm, setProjectForm] = useState<{ project?: Project } | null>(null)
  const [openProject, setOpenProject] = useState<string | null>(null)

  const projectById = new Map(projects.map((p) => [p.id, p]))
  const list = tasks ?? []
  const viewedProject = openProject ? projectById.get(openProject) : undefined

  function newTask() {
    if (mode === 'calendar') setTaskForm({ defaults: { date: selected } })
    else if (mode === 'projects' && viewedProject) setTaskForm({ defaults: { projectId: viewedProject.id, date: null } })
    else if (mode === 'projects') setProjectForm({})
    else setTaskForm({ defaults: { date: today } })
  }

  return (
    <>
      <ScreenHeader
        title="Задачи"
        action={
          <button class="btn btn--small btn--primary" onClick={newTask}>
            <IconPlus size={18} />
            <span class="desktop-only">{mode === 'projects' ? 'Проект' : 'Задача'}</span>
          </button>
        }
      />

      <div class="toolbar">
        <Segmented
          label="Вид"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'list', label: 'Список' },
            { value: 'projects', label: 'Проекты' },
            { value: 'calendar', label: 'Календарь' },
          ]}
        />
        {mode === 'calendar' && (
          <PeriodNav
            title={formatMonth(month)}
            onShift={(d) => setMonth(addMonthsKey(month, d))}
            onToday={() => {
              setMonth(monthOf(today))
              setSelected(today)
            }}
            isCurrent={month === monthOf(today)}
          />
        )}
      </div>

      {tasks !== undefined && mode === 'list' && (
        <TaskList tasks={list} projects={projectById} today={today} onOpen={(task) => setTaskForm({ task })} onAdd={(title) => createTask(db, { title, date: today })} />
      )}
      {mode === 'projects' && (
        <ProjectList projects={projects} tasks={list} today={today} onOpen={(p) => setOpenProject(p.id)} onCreate={() => setProjectForm({})} />
      )}
      {mode === 'calendar' && (
        <TaskCalendar
          tasks={list}
          projects={projectById}
          month={month}
          today={today}
          selected={selected}
          onSelect={setSelected}
          onOpen={(task) => setTaskForm({ task })}
        />
      )}

      {/* Поверх карточки проекта открывается форма задачи — карточка возвращается после закрытия формы. */}
      {taskForm ? (
        <TaskForm task={taskForm.task} defaults={taskForm.defaults} today={today} projects={projects} onClose={() => setTaskForm(null)} />
      ) : projectForm ? (
        <ProjectForm project={projectForm.project} goals={goals} onClose={() => setProjectForm(null)} onDeleted={() => setOpenProject(null)} />
      ) : (
        viewedProject && (
          <ProjectSheet
            project={viewedProject}
            tasks={list}
            today={today}
            onClose={() => setOpenProject(null)}
            onEdit={() => setProjectForm({ project: viewedProject })}
            onOpenTask={(task) => setTaskForm({ task })}
          />
        )
      )}
    </>
  )
}

/* ===================== Список ===================== */

function TaskList(props: {
  tasks: Task[]
  projects: Map<string, Project>
  today: DateKey
  onOpen: (task: Task) => void
  onAdd: (title: string) => unknown
}) {
  const { db } = useApp()
  const { today } = props
  const groups = groupTasks(props.tasks, today)
  const [showDone, setShowDone] = useState(false)
  const empty =
    !groups.overdue.length && !groups.today.length && !groups.tomorrow.length && !groups.later.length && !groups.someday.length

  const rows = (list: Task[], showDate = false) => (
    <ul class="task-list">
      {list.map((task) => (
        <li key={task.id}>
          <TaskRow task={task} today={today} project={task.projectId ? props.projects.get(task.projectId) : undefined} showDate={showDate} onOpen={() => props.onOpen(task)} />
        </li>
      ))}
    </ul>
  )

  return (
    <>
      <section class="card stack-sm">
        <QuickAdd placeholder="Новая задача на сегодня" onAdd={props.onAdd} />
        {empty && <p class="muted">Задач нет. Добавьте первую — дату, время и приоритет можно задать, нажав на задачу.</p>}
      </section>

      {groups.overdue.length > 0 && (
        <section class="card">
          <div class="card__head">
            <h2 class="text-overdue">Просрочено · {groups.overdue.length}</h2>
            <button class="btn btn--ghost btn--small" onClick={() => void moveTasks(db, groups.overdue.map((t) => t.id), today)}>
              Всё на сегодня
            </button>
          </div>
          {rows(groups.overdue)}
        </section>
      )}

      {groups.today.length > 0 && (
        <section class="card">
          <h2>Сегодня · {groups.today.length}</h2>
          {rows(groups.today)}
        </section>
      )}

      {groups.tomorrow.length > 0 && (
        <section class="card">
          <h2>Завтра · {groups.tomorrow.length}</h2>
          {rows(groups.tomorrow)}
        </section>
      )}

      {groups.later.length > 0 && (
        <section class="card">
          <h2>Позже</h2>
          {groups.later.map(({ date, tasks }) => (
            <div key={date} class="day-group">
              <h3 class="section-title">{formatRelative(date, today)}</h3>
              {rows(tasks)}
            </div>
          ))}
        </section>
      )}

      {groups.someday.length > 0 && (
        <section class="card">
          <h2>Без даты · {groups.someday.length}</h2>
          {rows(groups.someday)}
        </section>
      )}

      {groups.done.length > 0 && (
        <section class="card">
          <button class="disclosure" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
            <h2>Сделано за 2 недели · {groups.done.length}</h2>
            <span aria-hidden="true">{showDone ? '−' : '+'}</span>
          </button>
          {showDone && rows(groups.done, true)}
        </section>
      )}
    </>
  )
}

/* ===================== Проекты ===================== */

function ProjectList(props: { projects: Project[]; tasks: Task[]; today: DateKey; onOpen: (p: Project) => void; onCreate: () => void }) {
  const active = props.projects.filter((p) => !p.doneAt).sort((a, b) => a.order - b.order)
  const finished = props.projects.filter((p) => p.doneAt).sort((a, b) => (a.doneAt! > b.doneAt! ? -1 : 1))

  if (props.projects.length === 0) {
    return (
      <EmptyState title="Проектов пока нет" text="Проект — большая цель из нескольких шагов: ремонт, переезд, курс. Процент считается по выполненным задачам.">
        <button class="btn btn--primary" onClick={props.onCreate}>
          Создать проект
        </button>
      </EmptyState>
    )
  }

  return (
    <>
      <div class="project-grid">
        {active.map((project) => {
          const progress = projectProgress(project.id, props.tasks)
          return (
            <button key={project.id} class="card project-card" onClick={() => props.onOpen(project)}>
              <span class="project-card__head">
                <span class="project-card__emoji" aria-hidden="true">
                  {project.emoji}
                </span>
                <span class="project-card__title">{project.title}</span>
                <span class="project-card__pct tabular">{progress.pct === null ? '—' : `${progress.pct}%`}</span>
              </span>
              <ProgressBar value={progress.pct} />
              <span class="muted small">
                {progress.total ? `${progress.done} из ${progress.total} ${plural(progress.total, 'задачи', 'задач', 'задач')}` : 'Нет задач'}
                {project.deadline && ` · до ${formatDate(project.deadline, props.today)}`}
              </span>
            </button>
          )
        })}
        <button class="card project-card project-card--new" onClick={props.onCreate}>
          <IconPlus size={22} />
          <span>Новый проект</span>
        </button>
      </div>

      {finished.length > 0 && (
        <section class="card">
          <h2>Завершённые</h2>
          <ul class="archive-list">
            {finished.map((project) => (
              <li key={project.id}>
                <button class="link-row" onClick={() => props.onOpen(project)}>
                  <span aria-hidden="true">{project.emoji}</span> {project.title}
                  <span class="muted"> · {formatDate(project.doneAt!, props.today)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

/* ===================== Календарь ===================== */

function TaskCalendar(props: {
  tasks: Task[]
  projects: Map<string, Project>
  month: MonthKey
  today: DateKey
  selected: DateKey
  onSelect: (day: DateKey) => void
  onOpen: (task: Task) => void
}) {
  const { db } = useApp()
  const { month, today, selected } = props
  const payments = useRows('payments') ?? []
  const transactions = useRows('transactions') ?? []

  const first = weekStart(monthStart(month))
  const last = addDaysKey(weekStart(monthEnd(month)), 6)
  const byDay = tasksByDay(props.tasks, first, last)
  const paid = buildPaidIndex(transactions)
  const pays = new Map<DateKey, Occurrence[]>()
  for (const o of occurrences(payments, paid, first, last)) pays.set(o.dueDate, [...(pays.get(o.dueDate) ?? []), o])

  const days: DateKey[] = []
  for (let day = first; day <= last; day = addDaysKey(day, 1)) days.push(day)
  const dayTasks = byDay.get(selected) ?? []
  const dayPays = pays.get(selected) ?? []

  return (
    <>
      <section class="card cal">
        <div class="cal__grid" role="grid" aria-label={formatMonth(month)}>
          {WEEKDAY_SHORT.map((name) => (
            <span class="cal__weekday" aria-hidden="true">
              {name}
            </span>
          ))}
          {days.map((day) => {
            const list = byDay.get(day) ?? []
            const open = list.filter((t) => !t.doneAt).length
            const done = list.length - open
            const payCount = (pays.get(day) ?? []).filter((o) => !o.paid).length
            const classes = [
              'cal__day',
              monthOf(day) !== month && 'cal__day--other',
              day === today && 'cal__day--today',
              day === selected && 'cal__day--selected',
              day < today && open > 0 && 'cal__day--overdue',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <button
                type="button"
                class={classes}
                aria-pressed={day === selected}
                aria-label={`${formatDayLong(day)}: задач ${list.length}${payCount ? `, платежей ${payCount}` : ''}`}
                onClick={() => props.onSelect(day)}
              >
                <b>{fromKey(day).getDate()}</b>
                <span class="cal__dots" aria-hidden="true">
                  {Array.from({ length: Math.min(open, 3) }, () => (
                    <i class="dot dot--task" />
                  ))}
                  {open < 3 && Array.from({ length: Math.min(done, 3 - open) }, () => <i class="dot dot--done" />)}
                  {payCount > 0 && <i class="dot dot--pay" />}
                </span>
              </button>
            )
          })}
        </div>
        <p class="cal__legend muted small">
          <i class="dot dot--task" /> задачи <i class="dot dot--done" /> сделано <i class="dot dot--pay" /> платёж
        </p>
      </section>

      <section class="card">
        <h2>{formatDayLong(selected)}</h2>
        <div class="stack-sm">
          {dayPays.map((o) => (
            <div class={`task-row${o.paid ? ' task-row--done' : ''}`} key={`${o.payment.id}:${o.dueDate}`}>
              <CheckButton done={o.paid !== null} onClick={() => void togglePaid(db, o.payment, o.dueDate, today)} label={o.paid ? 'Снять оплату' : 'Оплачено'} />
              <span class="task-row__body task-row__body--static">
                <span class="task-row__title">
                  {o.payment.emoji} {o.payment.title}
                </span>
                <span class="task-row__meta">Платёж · {formatMoney(o.payment.amount)}</span>
              </span>
            </div>
          ))}
          {dayTasks.length > 0 && (
            <ul class="task-list">
              {dayTasks.map((task) => (
                <li key={task.id}>
                  <TaskRow task={task} today={today} project={task.projectId ? props.projects.get(task.projectId) : undefined} onOpen={() => props.onOpen(task)} />
                </li>
              ))}
            </ul>
          )}
          {dayTasks.length === 0 && dayPays.length === 0 && <p class="muted">На этот день ничего нет.</p>}
          <QuickAdd placeholder={`Задача на ${formatRelative(selected, today).toLowerCase()}`} onAdd={(title) => createTask(db, { title, date: selected })} />
        </div>
      </section>
    </>
  )
}
