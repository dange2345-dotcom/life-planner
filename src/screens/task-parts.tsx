import { useState } from 'preact/hooks'
import { useApp } from '../app-context'
import { createProject, createTask, deleteProject, deleteTask, toggleTask, updateProject, updateTask } from '../data/tasks'
import type { Goal, Priority, Project, Task } from '../db/types'
import { addDaysKey, formatDate, formatRelative, type DateKey } from '../domain/dates'
import { isOverdue, PRIORITIES, projectProgress } from '../domain/tasks'
import { CheckButton, ProgressBar, Segmented, Sheet } from '../ui/components'
import { IconClock, IconFlag, IconPlus } from '../ui/icons'

/* ===================== Строка задачи ===================== */

export function TaskRow(props: { task: Task; today: DateKey; project?: Project; showDate?: boolean; onOpen: () => void }) {
  const { db } = useApp()
  const { task, today, project } = props
  const done = task.doneAt !== null
  const overdue = isOverdue(task, today)

  return (
    <div class={`task-row${done ? ' task-row--done' : ''}`}>
      <CheckButton done={done} onClick={() => void toggleTask(db, task, today)} label={done ? 'Вернуть в работу' : 'Отметить сделанной'} />
      <button type="button" class="task-row__body" onClick={props.onOpen}>
        <span class="task-row__title">{task.title}</span>
        {(overdue || (props.showDate && task.date) || task.time || project || task.priority > 0) && (
          <span class="task-row__meta">
            {overdue ? (
              <span class="meta-overdue">с {formatRelative(task.date!, today).toLowerCase()}</span>
            ) : (
              props.showDate && task.date && <span>{formatRelative(task.date, today)}</span>
            )}
            {task.time && (
              <span class="meta-icon">
                <IconClock size={13} />
                {task.time}
              </span>
            )}
            {task.priority > 0 && (
              <span class={`meta-icon prio prio--${task.priority}`}>
                <IconFlag size={13} />
                {PRIORITIES[task.priority].short}
              </span>
            )}
            {project && (
              <span>
                {project.emoji} {project.title}
              </span>
            )}
          </span>
        )}
      </button>
    </div>
  )
}

/** Поле «новая задача» + кнопка: Enter — и задача добавлена. */
export function QuickAdd(props: { placeholder: string; onAdd: (title: string) => unknown }) {
  const [text, setText] = useState('')
  return (
    <form
      class="quick-add"
      onSubmit={(event) => {
        event.preventDefault()
        const title = text.trim()
        if (!title) return
        props.onAdd(title)
        setText('')
      }}
    >
      <input value={text} onInput={(e) => setText(e.currentTarget.value)} placeholder={props.placeholder} aria-label={props.placeholder} enterKeyHint="done" maxLength={200} />
      <button class="icon-btn icon-btn--filled" type="submit" disabled={!text.trim()} aria-label="Добавить">
        <IconPlus size={18} />
      </button>
    </form>
  )
}

/* ===================== Форма задачи ===================== */

export function TaskForm(props: { task?: Task; defaults?: Partial<Task>; today: DateKey; projects: Project[]; onClose: () => void }) {
  const { db } = useApp()
  const editing = props.task
  const initial = { ...props.defaults, ...editing }
  const [title, setTitle] = useState(initial.title ?? '')
  const [note, setNote] = useState(initial.note ?? '')
  const [date, setDate] = useState<string>(initial.date === undefined ? props.today : (initial.date ?? ''))
  const [time, setTime] = useState(initial.time ?? '')
  const [priority, setPriority] = useState<Priority>(initial.priority ?? 0)
  const [projectId, setProjectId] = useState(initial.projectId ?? '')
  const [error, setError] = useState<string | null>(null)
  const tomorrow = addDaysKey(props.today, 1)

  async function onSubmit(event: Event) {
    event.preventDefault()
    if (!title.trim()) return setError('Что нужно сделать?')
    const fields = {
      title: title.trim(),
      note: note.trim(),
      date: date || null,
      time: date && time ? time : null,
      priority,
      projectId: projectId || null,
    }
    if (editing) await updateTask(db, editing.id, fields)
    else await createTask(db, fields)
    props.onClose()
  }

  async function onDelete() {
    if (!editing || !confirm(`Удалить задачу «${editing.title}»?`)) return
    await deleteTask(db, editing.id)
    props.onClose()
  }

  const activeProjects = props.projects.filter((p) => !p.doneAt || p.id === projectId)

  return (
    <Sheet title={editing ? 'Задача' : 'Новая задача'} onClose={props.onClose}>
      <form class="form" onSubmit={onSubmit}>
        <label class="field">
          <span>Что сделать</span>
          <input value={title} onInput={(e) => setTitle(e.currentTarget.value)} placeholder="Например, записаться к врачу" enterKeyHint="done" maxLength={200} />
        </label>

        <div class="field">
          <span>Когда</span>
          <div class="chips chips--wrap" role="group" aria-label="Когда">
            {[
              { value: props.today, label: 'Сегодня' },
              { value: tomorrow, label: 'Завтра' },
              { value: '', label: 'Без даты' },
            ].map((option) => (
              <button type="button" class={`chip${date === option.value ? ' chip--active' : ''}`} aria-pressed={date === option.value} onClick={() => setDate(option.value)}>
                {option.label}
              </button>
            ))}
          </div>
          <div class="field-row">
            <input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} aria-label="Дата" />
            <input type="time" value={time} disabled={!date} onInput={(e) => setTime(e.currentTarget.value)} aria-label="Время напоминания" />
          </div>
          {date && <span class="hint">{time ? `Напомню в ${time}` : 'Укажите время — придёт напоминание'}</span>}
        </div>

        <div class="field">
          <span>Приоритет</span>
          <Segmented
            label="Приоритет"
            value={String(priority)}
            options={PRIORITIES.map((p) => ({ value: String(p.value), label: p.label }))}
            onChange={(value) => setPriority(Number(value) as Priority)}
          />
        </div>

        {activeProjects.length > 0 && (
          <label class="field">
            <span>Проект</span>
            <select value={projectId} onChange={(e) => setProjectId(e.currentTarget.value)}>
              <option value="">Без проекта</option>
              {activeProjects.map((p) => (
                <option value={p.id}>
                  {p.emoji} {p.title}
                </option>
              ))}
            </select>
          </label>
        )}

        <label class="field">
          <span>Заметка</span>
          <textarea value={note} onInput={(e) => setNote(e.currentTarget.value)} rows={2} maxLength={2000} />
        </label>

        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}

        <button class="btn btn--primary" type="submit">
          {editing ? 'Сохранить' : 'Добавить задачу'}
        </button>

        {editing && (
          <div class="form__secondary">
            <button
              type="button"
              class="btn btn--ghost"
              onClick={async () => {
                await toggleTask(db, editing, props.today)
                props.onClose()
              }}
            >
              {editing.doneAt ? 'Вернуть в работу' : 'Сделано'}
            </button>
            <button type="button" class="btn btn--ghost btn--danger" onClick={onDelete}>
              Удалить
            </button>
          </div>
        )}
      </form>
    </Sheet>
  )
}

/* ===================== Проект ===================== */

const PROJECT_EMOJIS = ['📁', '🎯', '🏠', '💼', '📚', '🛠️', '✈️', '💡', '🎨', '💪', '🧹', '🚗', '🎓', '❤️', '🌱', '💻']

export function ProjectForm(props: { project?: Project; goals: Goal[]; onClose: () => void; onDeleted?: () => void }) {
  const { db } = useApp()
  const editing = props.project
  const [title, setTitle] = useState(editing?.title ?? '')
  const [emoji, setEmoji] = useState(editing?.emoji ?? '📁')
  const [deadline, setDeadline] = useState(editing?.deadline ?? '')
  const [goalId, setGoalId] = useState(editing?.goalId ?? '')
  const [note, setNote] = useState(editing?.note ?? '')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: Event) {
    event.preventDefault()
    if (!title.trim()) return setError('Как назовём проект?')
    const fields = { title: title.trim(), emoji, deadline: deadline || null, goalId: goalId || null, note: note.trim() }
    if (editing) await updateProject(db, editing.id, fields)
    else await createProject(db, fields)
    props.onClose()
  }

  async function onDelete() {
    if (!editing) return
    const count = (await db.tasks.where('projectId').equals(editing.id).toArray()).filter((t) => !t.deleted).length
    const question = count ? `Удалить проект «${editing.title}» вместе с задачами (${count})?` : `Удалить проект «${editing.title}»?`
    if (!confirm(question)) return
    await deleteProject(db, editing.id, true)
    props.onDeleted?.()
    props.onClose()
  }

  return (
    <Sheet title={editing ? 'Проект' : 'Новый проект'} onClose={props.onClose}>
      <form class="form" onSubmit={onSubmit}>
        <EmojiPicker list={PROJECT_EMOJIS} value={emoji} onChange={setEmoji} />
        <label class="field">
          <span>Название</span>
          <input value={title} onInput={(e) => setTitle(e.currentTarget.value)} placeholder="Например, ремонт в ванной" maxLength={120} />
        </label>
        <label class="field">
          <span>Срок (необязательно)</span>
          <input type="date" value={deadline} onInput={(e) => setDeadline(e.currentTarget.value)} />
        </label>
        {props.goals.length > 0 && (
          <label class="field">
            <span>Цель на год</span>
            <select value={goalId} onChange={(e) => setGoalId(e.currentTarget.value)}>
              <option value="">Не привязан</option>
              {props.goals.map((g) => (
                <option value={g.id}>
                  {g.emoji} {g.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <label class="field">
          <span>Заметка</span>
          <textarea value={note} onInput={(e) => setNote(e.currentTarget.value)} rows={2} maxLength={2000} />
        </label>
        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
        <button class="btn btn--primary" type="submit">
          {editing ? 'Сохранить' : 'Создать проект'}
        </button>
        {editing && (
          <div class="form__secondary">
            <button type="button" class="btn btn--ghost btn--danger" onClick={onDelete}>
              Удалить проект
            </button>
          </div>
        )}
      </form>
    </Sheet>
  )
}

/** Карточка проекта поверх экрана: прогресс, задачи, добавление задач. */
export function ProjectSheet(props: {
  project: Project
  tasks: Task[]
  today: DateKey
  onClose: () => void
  onEdit: () => void
  onOpenTask: (task: Task) => void
}) {
  const { db } = useApp()
  const { project, today } = props
  const own = props.tasks.filter((t) => t.projectId === project.id)
  const open = own.filter((t) => t.doneAt === null).sort((a, b) => b.priority - a.priority || a.order - b.order)
  const done = own.filter((t) => t.doneAt !== null).sort((a, b) => (a.doneAt! > b.doneAt! ? -1 : 1))
  const progress = projectProgress(project.id, props.tasks)

  return (
    <Sheet title={`${project.emoji} ${project.title}`} onClose={props.onClose}>
      <div class="stack">
        <div class="project-progress">
          <ProgressBar value={progress.pct} />
          <span class="muted tabular">
            {progress.total ? `${progress.done} из ${progress.total} · ${progress.pct}%` : 'Задач пока нет'}
            {project.deadline && ` · срок ${formatDate(project.deadline, today)}`}
          </span>
        </div>
        {project.note && <p class="note">{project.note}</p>}

        <QuickAdd placeholder="Добавить задачу в проект" onAdd={(title) => createTask(db, { title, projectId: project.id })} />

        {open.length > 0 && (
          <ul class="task-list">
            {open.map((task) => (
              <li key={task.id}>
                <TaskRow task={task} today={today} showDate onOpen={() => props.onOpenTask(task)} />
              </li>
            ))}
          </ul>
        )}
        {done.length > 0 && (
          <>
            <h3 class="section-title">Сделано · {done.length}</h3>
            <ul class="task-list">
              {done.map((task) => (
                <li key={task.id}>
                  <TaskRow task={task} today={today} onOpen={() => props.onOpenTask(task)} />
                </li>
              ))}
            </ul>
          </>
        )}

        <div class="form__secondary">
          <button type="button" class="btn btn--ghost" onClick={props.onEdit}>
            Изменить проект
          </button>
          <button type="button" class="btn btn--ghost" onClick={() => void updateProject(db, project.id, { doneAt: project.doneAt ? null : today })}>
            {project.doneAt ? 'Вернуть в работу' : 'Завершить проект'}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

/* ===================== Общее ===================== */

export function EmojiPicker(props: { list: string[]; value: string; onChange: (emoji: string) => void }) {
  const list = props.list.includes(props.value) ? props.list : [props.value, ...props.list]
  return (
    <div class="emoji-row" role="radiogroup" aria-label="Значок">
      {list.map((item) => (
        <button type="button" role="radio" aria-checked={item === props.value} class={`emoji-btn${item === props.value ? ' emoji-btn--active' : ''}`} onClick={() => props.onChange(item)}>
          {item}
        </button>
      ))}
    </div>
  )
}
