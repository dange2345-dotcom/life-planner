// Инструмент для Claude: читать и менять данные «Планера» прямо в облаке (Supabase) от имени владельца.
// Записи пишутся в том же формате, что и приложение, — устройства подхватывают их при следующей синхронизации.
//
//   npm run planner -- habits [--all]
//   npm run planner -- add-habit --title "Зарядка" [--emoji 🏃] [--schedule daily|weekdays:1,3,5|weekly:3|monthly:2] [--start YYYY-MM-DD] [--until YYYY-MM-DD]
//   npm run planner -- edit-habit <ref> [--title …] [--emoji …] [--schedule …] [--start …] [--until YYYY-MM-DD|none]
//   npm run planner -- archive-habit <ref> [--date YYYY-MM-DD] | restore-habit <ref> | delete-habit <ref>
//   npm run planner -- mark <ref> [--date YYYY-MM-DD] [--undo]
//   npm run planner -- stats [--month YYYY-MM]
//   npm run planner -- remind <habit-ref> --at 08:00,18:30|none
//
//   npm run planner -- tasks [--all] | projects
//   npm run planner -- add-task --title "…" [--date YYYY-MM-DD|none] [--time HH:MM] [--priority 0-3] [--project <ref>] [--note …]
//   npm run planner -- edit-task <ref> [--title|--date|--time (none)|--priority|--project (none)|--note] | done-task <ref> [--undo] | delete-task <ref>
//   npm run planner -- add-project --title "…" [--emoji 📁] [--deadline YYYY-MM-DD] [--goal <ref>]
//
//   npm run planner -- money [--month YYYY-MM]
//   npm run planner -- add-expense|add-income --amount 1250 --category food [--date …] [--note …]   (категории: npm run planner -- categories)
//   npm run planner -- savings | add-saving --title "…" --target 100000 [--have 0] [--deadline …] [--emoji 💰] [--goal <ref>]
//   npm run planner -- deposit <saving-ref> --amount 10000 [--date …] [--note …] | withdraw <saving-ref> --amount …
//   npm run planner -- payments | add-payment --title "…" --amount 399 --next YYYY-MM-DD [--repeat monthly|yearly|weekly] [--kind subscription|credit|bill|other] [--until YYYY-MM-DD] [--category subscriptions] [--emoji 🔁]
//   npm run planner -- pay <payment-ref> [--due YYYY-MM-DD] [--undo]
//
//   npm run planner -- goals [--year 2026]
//   npm run planner -- add-goal --title "…" --sphere growth [--emoji 🎯] [--measure auto|count|manual] [--target 40] [--base 0] [--habit <ref>] [--value 30] [--deadline …] [--year …]
//   npm run planner -- edit-goal <ref> [те же поля] [--done|--undo]
//   npm run planner -- link <goal-ref> --habit|--project|--saving <ref> [--undo]
//
//   npm run planner -- notify [--morning HH:MM|off] [--evening HH:MM|off] [--habits on|off] [--tasks on|off] [--early on|off]
//     --early — задачам с высоким приоритетом ещё и за час до времени
//
// <ref> — начало id или часть названия (без учёта регистра).
// Ключ: SUPABASE_SECRET_KEY в life-planner/.env (только на этом компьютере, в git не попадает).

import { parseArgs } from 'node:util'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL } from '../src/config'
import type {
  Category,
  Goal,
  GoalMeasure,
  Habit,
  HabitLog,
  HabitSchedule,
  NotifySettings,
  Payment,
  PaymentKind,
  Priority,
  Project,
  Saving,
  SavingEntry,
  Setting,
  SyncMeta,
  Task,
  Transaction,
} from '../src/db/types'
import { addDaysKey, formatDayMonth, formatMonth, monthOf, todayKey, WEEKDAY_SHORT, type DateKey } from '../src/domain/dates'
import { goalCount, goalParts, goalProgress, sphereInfo, SPHERES, type GoalContext } from '../src/domain/goals'
import { buildLogIndex, monthStats, streak, todayItems } from '../src/domain/habit-stats'
import {
  buildPaidIndex,
  categoryInfo,
  EXPENSE_CATEGORIES,
  formatMoney,
  INCOME_CATEGORIES,
  monthMoney,
  nextDueDate,
  occurrences,
  parseAmount,
  paymentTxnId,
  remainingPayments,
  savingStats,
  scheduleFromDate,
  totalsByCategory,
} from '../src/domain/money'
import { groupTasks, projectProgress } from '../src/domain/tasks'

function fail(message: string): never {
  console.error(`✖ ${message}`)
  process.exit(1)
}

try {
  process.loadEnvFile(new URL('../.env', import.meta.url))
} catch {
  fail('Не найден файл life-planner/.env')
}
const SECRET = process.env.SUPABASE_SECRET_KEY?.trim()
if (!SECRET?.startsWith('sb_secret_')) fail('В life-planner/.env нет ключа SUPABASE_SECRET_KEY=sb_secret_…')

const supabase = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false, autoRefreshToken: false } })

/* ---------- облако ---------- */

interface Row {
  id: string
  kind: string
  data: Record<string, unknown>
  updated_at: number
  deleted: boolean
}

let ownerCache: string | null = null
async function ownerId(): Promise<string> {
  if (ownerCache) return ownerCache
  const { data, error } = await supabase.auth.admin.listUsers()
  if (error) fail(`Не удалось получить пользователя: ${error.message}`)
  const email = process.env.OWNER_EMAIL
  const owner = email ? data.users.find((u) => u.email === email) : data.users.length === 1 ? data.users[0] : undefined
  if (!owner) fail('Не удалось определить владельца: укажите OWNER_EMAIL в .env')
  return (ownerCache = owner.id)
}

async function load<T extends SyncMeta>(kind: string): Promise<T[]> {
  const rows: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('records')
      .select('id, kind, data, updated_at, deleted')
      .eq('kind', kind)
      .eq('user_id', await ownerId())
      .order('id')
      .range(from, from + 999)
    if (error) fail(`Ошибка чтения (${kind}): ${error.message}`)
    rows.push(...(data as Row[]))
    if (data.length < 1000) break
  }
  return rows.map(
    (row) =>
      ({
        ...row.data,
        id: row.id,
        updatedAt: Number(row.updated_at),
        deleted: row.deleted ? 1 : 0,
        dirty: 0,
      }) as unknown as T,
  )
}

async function save<T extends SyncMeta>(kind: string, entity: T, deleted = false) {
  const { id, updatedAt, deleted: _deleted, dirty: _dirty, ...data } = entity
  const { error } = await supabase.from('records').upsert(
    {
      id,
      kind,
      data,
      // Строго позже прошлой версии — иначе сервер (и устройства) посчитают правку устаревшей.
      updated_at: Math.max(Date.now(), (updatedAt ?? 0) + 1),
      deleted,
      user_id: await ownerId(),
    },
    { onConflict: 'id' },
  )
  if (error) fail(`Ошибка записи: ${error.message}`)
}

/* ---------- привычки ---------- */

async function loadHabits(includeDeleted = false): Promise<Habit[]> {
  const habits = await load<Habit>('habit')
  return habits.filter((h) => includeDeleted || !h.deleted).sort((a, b) => a.order - b.order)
}

function findHabit(habits: Habit[], ref: string | undefined): Habit {
  if (!ref) fail('Не указана привычка (<ref>: начало id или часть названия)')
  const needle = ref.toLowerCase()
  const byId = habits.filter((h) => h.id.startsWith(ref))
  const matches = byId.length ? byId : habits.filter((h) => h.title.toLowerCase().includes(needle))
  if (matches.length === 0) fail(`Привычка «${ref}» не найдена`)
  if (matches.length > 1) fail(`«${ref}» подходит к нескольким: ${matches.map((h) => `${h.id.slice(0, 8)} ${h.title}`).join('; ')}`)
  return matches[0]
}

function parseSchedule(text: string): HabitSchedule {
  if (text === 'daily') return { type: 'daily' }
  const [type, value = ''] = text.split(':')
  if (type === 'weekdays') {
    const days = [...new Set(value.split(',').map(Number))].sort()
    if (!days.length || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) fail('weekdays: дни 1–7 через запятую, 1 = пн')
    return { type, days }
  }
  if (type === 'weekly' || type === 'monthly') {
    const times = Number(value)
    const max = type === 'weekly' ? 7 : 31
    if (!Number.isInteger(times) || times < 1 || times > max) fail(`${type}: число от 1 до ${max}`)
    return { type, times }
  }
  fail(`Непонятное расписание «${text}». Варианты: daily, weekdays:1,3,5, weekly:3, monthly:2`)
}

function describeSchedule(s: HabitSchedule): string {
  switch (s.type) {
    case 'daily':
      return 'каждый день'
    case 'weekdays':
      return s.days.map((d) => WEEKDAY_SHORT[d - 1].toLowerCase()).join(', ')
    case 'weekly':
      return `${s.times} р. в неделю`
    case 'monthly':
      return `${s.times} р. в месяц`
  }
}

function describe(h: Habit): string {
  const archived = !h.archivedAt
    ? ''
    : h.archivedAt >= todayKey()
      ? ` · до ${formatDayMonth(h.archivedAt)}`
      : ` · в архиве с ${formatDayMonth(addDaysKey(h.archivedAt, 1))}`
  return `${h.id.slice(0, 8)}  ${h.emoji} ${h.title} — ${describeSchedule(h.schedule)} · с ${formatDayMonth(h.startDate)}${archived}`
}

function checkDate(value: string | undefined, fallback: DateKey): DateKey {
  const date = value ?? fallback
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`Дата «${date}» — нужен формат YYYY-MM-DD`)
  return date
}

/* ---------- общее для разделов ---------- */

async function loadAll<T extends SyncMeta>(kind: string): Promise<T[]> {
  return (await load<T>(kind)).filter((row) => !row.deleted)
}

function find<T extends { id: string; title: string }>(list: T[], what: string, needle: string | undefined): T {
  if (!needle) fail(`Не указано: ${what} (начало id или часть названия)`)
  const lower = needle.toLowerCase()
  const byId = list.filter((x) => x.id.startsWith(needle))
  const matches = byId.length ? byId : list.filter((x) => x.title.toLowerCase().includes(lower))
  if (matches.length === 0) fail(`${what} «${needle}» не найдено`)
  if (matches.length > 1) fail(`«${needle}» подходит к нескольким: ${matches.map((x) => `${x.id.slice(0, 8)} ${x.title}`).join('; ')}`)
  return matches[0]
}

const nextOrder = (list: { order: number }[]) => list.reduce((max, x) => Math.max(max, x.order), 0) + 1
const short = (id: string) => id.slice(0, 8)

function checkTime(value: string): string {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail(`Время «${value}» — нужен формат HH:MM`)
  return value
}

function money(value: string | undefined, what = '--amount'): number {
  const amount = value === undefined ? null : parseAmount(value)
  if (amount === null) fail(`Нужна сумма ${what}, например 1250 или 99.90`)
  return amount
}

function dateOrNone(value: string | undefined, fallback: DateKey | null): DateKey | null {
  if (value === undefined) return fallback
  return value === 'none' ? null : checkDate(value, today)
}

function describeTask(t: Task, projects: Project[]): string {
  const project = projects.find((p) => p.id === t.projectId)
  const parts = [
    t.date ? formatDayMonth(t.date) : 'без даты',
    t.time,
    t.priority ? `приоритет ${t.priority}` : null,
    project ? `${project.emoji} ${project.title}` : null,
    t.doneAt ? `✔ ${formatDayMonth(t.doneAt)}` : null,
  ].filter(Boolean)
  return `${short(t.id)}  ${t.doneAt ? '☑' : '☐'} ${t.title} — ${parts.join(' · ')}`
}

function describeGoal(g: Goal, ctx: GoalContext): string {
  const pct = goalProgress(g, ctx)
  const measure = g.measure === 'count' ? ` (${goalCount(g, ctx.index)} из ${g.countTarget})` : g.measure === 'manual' ? ' (вручную)' : ''
  const parts = goalParts(g, ctx).map((p) => `${p.emoji} ${p.title} ${p.pct ?? '—'}%`)
  const sphere = sphereInfo(g.sphere)
  return `${short(g.id)}  ${g.emoji} ${g.title} — ${g.doneAt ? 'достигнута' : `${pct ?? '—'}%`}${measure} · ${sphere.emoji} ${sphere.title}${parts.length ? `\n      ${parts.join(' · ')}` : ''}`
}

async function goalContext(): Promise<GoalContext> {
  return {
    habits: await loadHabits(),
    index: buildLogIndex(await load<HabitLog>('habitLog')),
    projects: await loadAll<Project>('project'),
    tasks: await loadAll<Task>('task'),
    savings: await loadAll<Saving>('saving'),
    savingEntries: await loadAll<SavingEntry>('savingEntry'),
    today,
  }
}

function goalFields(prev: Partial<Goal>, habits: Habit[]): Partial<Goal> {
  const changes: Partial<Goal> = {}
  if (values.title) changes.title = values.title.trim()
  if (values.emoji) changes.emoji = values.emoji
  if (values.sphere) {
    if (!SPHERES.some((s) => s.id === values.sphere)) fail(`Сфера: ${SPHERES.map((s) => `${s.id} (${s.title})`).join(', ')}`)
    changes.sphere = values.sphere
  }
  if (values.measure) {
    if (!['auto', 'count', 'manual'].includes(values.measure)) fail('--measure auto|count|manual')
    changes.measure = values.measure as GoalMeasure
  }
  if (values.target) changes.countTarget = Math.round(Number(values.target))
  if (values.base) changes.countBase = Math.round(Number(values.base))
  if (values.habit) changes.countHabitId = values.habit === 'none' ? null : find(habits, 'Привычка', values.habit).id
  if (values.value) changes.manualValue = Math.max(0, Math.min(100, Math.round(Number(values.value))))
  if (values.deadline) changes.deadline = dateOrNone(values.deadline, prev.deadline ?? null)
  if (values.year) changes.year = Number(values.year)
  if (values.note) changes.note = values.note
  return changes
}

/* ---------- команды ---------- */

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    title: { type: 'string' },
    emoji: { type: 'string' },
    schedule: { type: 'string' },
    start: { type: 'string' },
    until: { type: 'string' },
    date: { type: 'string' },
    month: { type: 'string' },
    undo: { type: 'boolean' },
    all: { type: 'boolean' },
    done: { type: 'boolean' },
    at: { type: 'string' },
    time: { type: 'string' },
    priority: { type: 'string' },
    project: { type: 'string' },
    note: { type: 'string' },
    deadline: { type: 'string' },
    goal: { type: 'string' },
    amount: { type: 'string' },
    category: { type: 'string' },
    target: { type: 'string' },
    have: { type: 'string' },
    next: { type: 'string' },
    repeat: { type: 'string' },
    kind: { type: 'string' },
    due: { type: 'string' },
    sphere: { type: 'string' },
    measure: { type: 'string' },
    base: { type: 'string' },
    habit: { type: 'string' },
    saving: { type: 'string' },
    value: { type: 'string' },
    year: { type: 'string' },
    morning: { type: 'string' },
    evening: { type: 'string' },
    habits: { type: 'string' },
    tasks: { type: 'string' },
    early: { type: 'string' },
  },
})
const [command, ref] = positionals
const today = todayKey()

switch (command) {
  case 'habits': {
    const habits = (await loadHabits()).filter((h) => values.all || !h.archivedAt || h.archivedAt >= today)
    console.log(habits.length ? habits.map(describe).join('\n') : 'Привычек нет')
    break
  }

  case 'add-habit': {
    if (!values.title?.trim()) fail('Нужно --title')
    const habits = await loadHabits(true)
    const habit: Habit = {
      id: randomUUID(),
      title: values.title.trim(),
      emoji: values.emoji ?? '✅',
      schedule: parseSchedule(values.schedule ?? 'daily'),
      startDate: checkDate(values.start, today),
      // Курс на срок: последний день, когда привычка планируется (дальше — сама уходит в архив).
      archivedAt: values.until ? checkDate(values.until, today) : null,
      order: habits.reduce((max, h) => Math.max(max, h.order), 0) + 1,
      goalId: null,
      updatedAt: 0,
      deleted: 0,
      dirty: 0,
    }
    await save('habit', habit)
    console.log(`✔ Добавлено: ${describe(habit)}`)
    break
  }

  case 'edit-habit': {
    const habit = findHabit(await loadHabits(), ref)
    const next: Habit = {
      ...habit,
      ...(values.title ? { title: values.title.trim() } : {}),
      ...(values.emoji ? { emoji: values.emoji } : {}),
      ...(values.schedule ? { schedule: parseSchedule(values.schedule) } : {}),
      ...(values.start ? { startDate: checkDate(values.start, today) } : {}),
      ...(values.until ? { archivedAt: values.until === 'none' ? null : checkDate(values.until, today) } : {}),
    }
    await save('habit', next)
    console.log(`✔ Изменено: ${describe(next)}`)
    break
  }

  case 'archive-habit': {
    const habit = findHabit(await loadHabits(), ref)
    const logs = await load<HabitLog>('habitLog')
    const doneToday = logs.some((l) => l.habitId === habit.id && l.date === today && !l.deleted)
    // Как в приложении: сегодня остаётся в плане, только если по нему уже есть отметка.
    const lastDay = checkDate(values.date, doneToday ? today : addDaysKey(today, -1))
    await save('habit', { ...habit, archivedAt: lastDay })
    console.log(`✔ В архиве (последний день — ${formatDayMonth(lastDay)}): ${habit.emoji} ${habit.title}`)
    break
  }

  case 'restore-habit': {
    const habit = findHabit(await loadHabits(), ref)
    await save('habit', { ...habit, archivedAt: null })
    console.log(`✔ Возвращена из архива: ${habit.emoji} ${habit.title}`)
    break
  }

  case 'delete-habit': {
    const habit = findHabit(await loadHabits(), ref)
    await save('habit', habit, true)
    console.log(`✔ Удалена: ${habit.emoji} ${habit.title}`)
    break
  }

  case 'mark': {
    const habit = findHabit(await loadHabits(), ref)
    const date = checkDate(values.date, today)
    const id = `${habit.id}:${date}`
    const existing = (await load<HabitLog>('habitLog')).find((l) => l.id === id)
    const log: HabitLog = existing ?? { id, habitId: habit.id, date, updatedAt: 0, deleted: 0, dirty: 0 }
    await save('habitLog', log, Boolean(values.undo))
    console.log(`✔ ${values.undo ? 'Снята отметка' : 'Отмечено'}: ${habit.emoji} ${habit.title}, ${formatDayMonth(date)}`)
    break
  }

  case 'stats': {
    const month = values.month ?? monthOf(today)
    if (!/^\d{4}-\d{2}$/.test(month)) fail('--month в формате YYYY-MM')
    const habits = await loadHabits()
    const index = buildLogIndex(await load<HabitLog>('habitLog'))
    const stats = monthStats(habits, index, month, today)
    const pct = stats.planned ? Math.round((stats.done / stats.planned) * 100) : null
    console.log(`${formatMonth(month)}: ${pct ?? '—'}% (${stats.done} из ${stats.planned})`)
    for (const row of stats.perHabit) {
      if (row.planned === 0 && row.done === 0) continue
      const s = streak(row.habit, index.get(row.habit.id), today)
      console.log(`  ${row.habit.emoji} ${row.habit.title} — ${row.pct ?? '—'}% (${row.done}/${row.planned})${s > 1 ? `, серия ${s}` : ''}`)
    }
    if (month === monthOf(today)) {
      const items = todayItems(habits, index, today)
      const done = items.filter((i) => i.doneToday)
      console.log(`Сегодня (${formatDayMonth(today)}): ${done.length} из ${items.length}`)
      const left = items.filter((i) => !i.doneToday)
      if (left.length) console.log(`  осталось: ${left.map((i) => `${i.habit.emoji} ${i.habit.title}`).join(', ')}`)
    }
    break
  }

  case 'remind': {
    const habit = findHabit(await loadHabits(), ref)
    if (!values.at) fail('Нужно --at 08:00,18:30 (или none)')
    const remindAt = values.at === 'none' ? [] : [...new Set(values.at.split(',').map((t) => checkTime(t.trim())))].sort()
    await save('habit', { ...habit, remindAt })
    console.log(`✔ ${habit.emoji} ${habit.title}: ${remindAt.length ? `напоминания в ${remindAt.join(', ')}` : 'без напоминаний'}`)
    break
  }

  /* ---------- задачи ---------- */

  case 'tasks': {
    const projects = await loadAll<Project>('project')
    const tasks = await loadAll<Task>('task')
    const groups = groupTasks(tasks, today)
    const section = (title: string, list: Task[]) => list.length && console.log(`${title}:\n${list.map((t) => `  ${describeTask(t, projects)}`).join('\n')}`)
    section('Просрочено', groups.overdue)
    section('Сегодня', groups.today)
    section('Завтра', groups.tomorrow)
    section('Позже', groups.later.flatMap((g) => g.tasks))
    section('Без даты', groups.someday)
    if (values.all) section('Сделано за 2 недели', groups.done)
    if (!tasks.length) console.log('Задач нет')
    break
  }

  case 'add-task': {
    if (!values.title?.trim()) fail('Нужно --title')
    const tasks = await loadAll<Task>('task')
    const projects = await loadAll<Project>('project')
    const task: Task = {
      id: randomUUID(),
      title: values.title.trim(),
      note: values.note ?? '',
      projectId: values.project ? find(projects, 'Проект', values.project).id : null,
      date: dateOrNone(values.date, values.project ? null : today),
      time: values.time ? checkTime(values.time) : null,
      priority: Math.max(0, Math.min(3, Number(values.priority ?? 0))) as Priority,
      doneAt: null,
      order: nextOrder(tasks),
      updatedAt: 0,
      deleted: 0,
      dirty: 0,
    }
    await save('task', task)
    console.log(`✔ Добавлено: ${describeTask(task, projects)}`)
    break
  }

  case 'edit-task':
  case 'done-task':
  case 'delete-task': {
    const tasks = await loadAll<Task>('task')
    const projects = await loadAll<Project>('project')
    const task = find(tasks, 'Задача', ref)
    if (command === 'delete-task') {
      await save('task', task, true)
      console.log(`✔ Удалена: ${task.title}`)
      break
    }
    const next: Task =
      command === 'done-task'
        ? { ...task, doneAt: values.undo ? null : (values.date ?? today) }
        : {
            ...task,
            ...(values.title ? { title: values.title.trim() } : {}),
            ...(values.note !== undefined ? { note: values.note } : {}),
            date: dateOrNone(values.date, task.date),
            ...(values.time ? { time: values.time === 'none' ? null : checkTime(values.time) } : {}),
            ...(values.priority ? { priority: Math.max(0, Math.min(3, Number(values.priority))) as Priority } : {}),
            ...(values.project ? { projectId: values.project === 'none' ? null : find(projects, 'Проект', values.project).id } : {}),
          }
    await save('task', next)
    console.log(`✔ ${describeTask(next, projects)}`)
    break
  }

  case 'projects': {
    const projects = (await loadAll<Project>('project')).sort((a, b) => a.order - b.order)
    const tasks = await loadAll<Task>('task')
    for (const p of projects) {
      const progress = projectProgress(p.id, tasks)
      console.log(`${short(p.id)}  ${p.emoji} ${p.title} — ${progress.pct ?? '—'}% (${progress.done}/${progress.total})${p.doneAt ? ' · завершён' : ''}`)
    }
    if (!projects.length) console.log('Проектов нет')
    break
  }

  case 'add-project': {
    if (!values.title?.trim()) fail('Нужно --title')
    const projects = await loadAll<Project>('project')
    const goals = await loadAll<Goal>('goal')
    const project: Project = {
      id: randomUUID(),
      title: values.title.trim(),
      emoji: values.emoji ?? '📁',
      note: values.note ?? '',
      deadline: dateOrNone(values.deadline, null),
      goalId: values.goal ? find(goals, 'Цель', values.goal).id : null,
      doneAt: null,
      order: nextOrder(projects),
      updatedAt: 0,
      deleted: 0,
      dirty: 0,
    }
    await save('project', project)
    console.log(`✔ Проект: ${short(project.id)} ${project.emoji} ${project.title}`)
    break
  }

  /* ---------- финансы ---------- */

  case 'categories': {
    const custom = await loadAll<Category>('category')
    const show = (title: string, list: { id: string; emoji: string; title: string }[]) =>
      console.log(`${title}: ${list.map((c) => `${c.id} (${c.emoji} ${c.title})`).join(', ')}`)
    show('Расходы', [...EXPENSE_CATEGORIES, ...custom.filter((c) => c.type === 'expense')])
    show('Доходы', [...INCOME_CATEGORIES, ...custom.filter((c) => c.type === 'income')])
    break
  }

  case 'add-expense':
  case 'add-income': {
    const type = command === 'add-expense' ? 'expense' : 'income'
    const custom = await loadAll<Category>('category')
    const known = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES, ...custom].filter((c) => c.type === type)
    const category = values.category ?? (type === 'expense' ? 'other' : 'in-other')
    const resolved = known.find((c) => c.id === category) ?? known.find((c) => c.title.toLowerCase().includes(category.toLowerCase()))
    if (!resolved) fail(`Нет категории «${category}». Список: npm run planner -- categories`)
    const txn: Transaction = {
      id: randomUUID(),
      type,
      amount: money(values.amount),
      category: resolved.id,
      date: checkDate(values.date, today),
      note: values.note ?? '',
      paymentId: null,
      dueDate: null,
      updatedAt: 0,
      deleted: 0,
      dirty: 0,
    }
    await save('transaction', txn)
    console.log(`✔ ${type === 'expense' ? 'Расход' : 'Доход'}: ${formatMoney(txn.amount)} · ${resolved.emoji} ${resolved.title} · ${formatDayMonth(txn.date)}${txn.note ? ` · ${txn.note}` : ''}`)
    break
  }

  case 'money': {
    const month = values.month ?? monthOf(today)
    const txns = await loadAll<Transaction>('transaction')
    const custom = await loadAll<Category>('category')
    const summary = monthMoney(txns, await loadAll<SavingEntry>('savingEntry'), month)
    console.log(
      `${formatMonth(month)}: доходы ${formatMoney(summary.income)}, расходы ${formatMoney(summary.expense)}, отложено ${formatMoney(summary.saved)}, остаток ${formatMoney(summary.balance)}`,
    )
    for (const row of totalsByCategory(txns, month, 'expense')) {
      const info = categoryInfo(row.category, custom)
      console.log(`  ${info.emoji} ${info.title} — ${formatMoney(row.amount)} (${row.share}%)`)
    }
    break
  }

  case 'savings': {
    const entries = await loadAll<SavingEntry>('savingEntry')
    for (const s of (await loadAll<Saving>('saving')).sort((a, b) => a.order - b.order)) {
      const stats = savingStats(s, entries, today)
      const pace = stats.perMonth !== null ? ` · ≈ ${formatMoney(stats.perMonth)}/мес до ${formatDayMonth(s.deadline!)}` : ''
      console.log(`${short(s.id)}  ${s.emoji} ${s.title} — ${formatMoney(stats.current)} из ${formatMoney(s.target)} (${stats.pct}%)${pace}`)
    }
    break
  }

  case 'add-saving': {
    if (!values.title?.trim()) fail('Нужно --title')
    const savings = await loadAll<Saving>('saving')
    const goals = await loadAll<Goal>('goal')
    const saving: Saving = {
      id: randomUUID(),
      title: values.title.trim(),
      emoji: values.emoji ?? '💰',
      target: money(values.target, '--target'),
      deadline: dateOrNone(values.deadline, null),
      goalId: values.goal ? find(goals, 'Цель', values.goal).id : null,
      order: nextOrder(savings),
      updatedAt: 0,
      deleted: 0,
      dirty: 0,
    }
    await save('saving', saving)
    const have = values.have ? money(values.have, '--have') : 0
    if (have > 0) {
      await save('savingEntry', { id: randomUUID(), savingId: saving.id, amount: have, date: today, note: 'Уже было', updatedAt: 0, deleted: 0, dirty: 0 } as SavingEntry)
    }
    console.log(`✔ Накопления: ${short(saving.id)} ${saving.emoji} ${saving.title} — цель ${formatMoney(saving.target)}${have ? `, уже ${formatMoney(have)}` : ''}`)
    break
  }

  case 'deposit':
  case 'withdraw': {
    const saving = find(await loadAll<Saving>('saving'), 'Накопления', ref)
    const amount = money(values.amount) * (command === 'withdraw' ? -1 : 1)
    const entry: SavingEntry = { id: randomUUID(), savingId: saving.id, amount, date: checkDate(values.date, today), note: values.note ?? '', updatedAt: 0, deleted: 0, dirty: 0 }
    await save('savingEntry', entry)
    const stats = savingStats(saving, [...(await loadAll<SavingEntry>('savingEntry')), entry], today)
    console.log(`✔ ${saving.emoji} ${saving.title}: ${formatMoney(amount, { sign: true })} → ${formatMoney(stats.current)} из ${formatMoney(saving.target)} (${stats.pct}%)`)
    break
  }

  case 'payments': {
    const payments = (await loadAll<Payment>('payment')).sort((a, b) => a.order - b.order)
    const paid = buildPaidIndex(await loadAll<Transaction>('transaction'))
    for (const p of payments) {
      const next = nextDueDate(p, today)
      const left = remainingPayments(p, paid)
      console.log(
        `${short(p.id)}  ${p.emoji} ${p.title} — ${formatMoney(p.amount)} (${p.schedule.type}) · следующий ${next ? formatDayMonth(next) : '—'}${left ? ` · осталось ${left.count} на ${formatMoney(left.total)}` : ''}`,
      )
    }
    const soon = occurrences(payments, paid, addDaysKey(today, -30), addDaysKey(today, 30)).filter((o) => !o.paid)
    if (soon.length) console.log(`Не оплачено (±30 дней): ${soon.map((o) => `${o.payment.title} ${formatDayMonth(o.dueDate)}`).join(', ')}`)
    if (!payments.length) console.log('Регулярных платежей нет')
    break
  }

  case 'add-payment': {
    if (!values.title?.trim()) fail('Нужно --title')
    const next = checkDate(values.next, today)
    const repeat = (values.repeat ?? 'monthly') as Payment['schedule']['type']
    if (!['monthly', 'yearly', 'weekly'].includes(repeat)) fail('--repeat monthly|yearly|weekly')
    const kind = (values.kind ?? 'subscription') as PaymentKind
    const payments = await loadAll<Payment>('payment')
    const payment: Payment = {
      id: randomUUID(),
      title: values.title.trim(),
      emoji: values.emoji ?? (kind === 'credit' ? '🏦' : kind === 'bill' ? '🧾' : '🔁'),
      kind,
      amount: money(values.amount),
      category: values.category ?? (kind === 'credit' ? 'credit' : kind === 'bill' ? 'home' : 'subscriptions'),
      schedule: scheduleFromDate(next, repeat),
      startDate: next,
      endDate: dateOrNone(values.until, null),
      note: values.note ?? '',
      order: nextOrder(payments),
      updatedAt: 0,
      deleted: 0,
      dirty: 0,
    }
    await save('payment', payment)
    console.log(`✔ Платёж: ${short(payment.id)} ${payment.emoji} ${payment.title} — ${formatMoney(payment.amount)}, ближайший ${formatDayMonth(next)}`)
    break
  }

  case 'pay': {
    const payment = find(await loadAll<Payment>('payment'), 'Платёж', ref)
    const txns = await load<Transaction>('transaction')
    const paid = buildPaidIndex(txns.filter((t) => !t.deleted))
    // По умолчанию — самый ранний неоплаченный за последний месяц или ближайший.
    const due =
      values.due ??
      occurrences([payment], paid, addDaysKey(today, -31), addDaysKey(today, 40)).find((o) => (values.undo ? o.paid : !o.paid))?.dueDate
    if (!due) fail('Не нашёл подходящую дату платежа — укажите --due YYYY-MM-DD')
    const id = paymentTxnId(payment.id, due)
    const existing = txns.find((t) => t.id === id)
    const txn: Transaction = existing ?? {
      id,
      type: 'expense',
      amount: payment.amount,
      category: payment.category,
      date: today,
      note: payment.title,
      paymentId: payment.id,
      dueDate: due,
      updatedAt: 0,
      deleted: 0,
      dirty: 0,
    }
    await save('transaction', txn, Boolean(values.undo))
    console.log(`✔ ${values.undo ? 'Снята оплата' : 'Оплачено'}: ${payment.emoji} ${payment.title} за ${formatDayMonth(due)} — ${formatMoney(payment.amount)}`)
    break
  }

  /* ---------- цели ---------- */

  case 'goals': {
    const year = Number(values.year ?? today.slice(0, 4))
    const ctx = await goalContext()
    const goals = (await loadAll<Goal>('goal')).filter((g) => g.year === year).sort((a, b) => a.order - b.order)
    console.log(goals.length ? goals.map((g) => describeGoal(g, ctx)).join('\n') : `Целей на ${year} год нет`)
    break
  }

  case 'add-goal': {
    if (!values.title?.trim()) fail('Нужно --title')
    const goals = await loadAll<Goal>('goal')
    const habits = await loadHabits()
    const goal: Goal = {
      id: randomUUID(),
      title: '',
      emoji: '🎯',
      sphere: 'growth',
      year: Number(today.slice(0, 4)),
      deadline: null,
      note: '',
      measure: 'auto',
      countTarget: 0,
      countBase: 0,
      countHabitId: null,
      manualValue: 0,
      steps: [],
      doneAt: null,
      order: nextOrder(goals),
      updatedAt: 0,
      deleted: 0,
      dirty: 0,
    }
    Object.assign(goal, goalFields(goal, habits))
    await save('goal', goal)
    console.log(`✔ Цель: ${describeGoal(goal, await goalContext())}`)
    break
  }

  case 'edit-goal': {
    const goal = find(await loadAll<Goal>('goal'), 'Цель', ref)
    const next: Goal = { ...goal, ...goalFields(goal, await loadHabits()) }
    if (values.done) next.doneAt = today
    if (values.undo) next.doneAt = null
    await save('goal', next)
    console.log(`✔ ${describeGoal(next, await goalContext())}`)
    break
  }

  case 'link': {
    const goal = find(await loadAll<Goal>('goal'), 'Цель', ref)
    const goalId = values.undo ? null : goal.id
    if (values.habit) {
      const habit = findHabit(await loadHabits(), values.habit)
      await save('habit', { ...habit, goalId })
      console.log(`✔ ${habit.emoji} ${habit.title} ${goalId ? '→' : '✕'} ${goal.title}`)
    } else if (values.project) {
      const project = find(await loadAll<Project>('project'), 'Проект', values.project)
      await save('project', { ...project, goalId })
      console.log(`✔ ${project.emoji} ${project.title} ${goalId ? '→' : '✕'} ${goal.title}`)
    } else if (values.saving) {
      const saving = find(await loadAll<Saving>('saving'), 'Накопления', values.saving)
      await save('saving', { ...saving, goalId })
      console.log(`✔ ${saving.emoji} ${saving.title} ${goalId ? '→' : '✕'} ${goal.title}`)
    } else fail('Нужно --habit, --project или --saving')
    break
  }

  /* ---------- уведомления ---------- */

  case 'notify': {
    const rows = await load<Setting>('setting')
    const row = rows.find((r) => r.id === 'notify')
    const current: NotifySettings = {
      morning: { enabled: true, time: '08:00' },
      evening: { enabled: true, time: '21:30' },
      habits: true,
      tasks: true,
      tasksEarly: true,
      timezone: 'Europe/Moscow',
      ...((row && !row.deleted ? row.value : {}) as Partial<NotifySettings>),
    }
    const slot = (value: string | undefined, prev: { enabled: boolean; time: string }) =>
      value === undefined ? prev : value === 'off' ? { ...prev, enabled: false } : { enabled: true, time: checkTime(value) }
    const flag = (value: string | undefined, prev: boolean) => (value === undefined ? prev : value === 'on')
    const next: NotifySettings = {
      ...current,
      morning: slot(values.morning, current.morning),
      evening: slot(values.evening, current.evening),
      habits: flag(values.habits, current.habits),
      tasks: flag(values.tasks, current.tasks),
      tasksEarly: flag(values.early, current.tasksEarly),
    }
    const changed = [values.morning, values.evening, values.habits, values.tasks, values.early].some((v) => v !== undefined)
    if (changed) await save('setting', { id: 'notify', value: next, updatedAt: row?.updatedAt ?? 0, deleted: 0, dirty: 0 } as Setting)
    const on = (s: { enabled: boolean; time: string }) => (s.enabled ? s.time : 'выкл')
    console.log(
      `${changed ? '✔ ' : ''}Утро ${on(next.morning)} · вечер ${on(next.evening)} · привычки ${next.habits ? 'вкл' : 'выкл'} · задачи ${next.tasks ? 'вкл' : 'выкл'} · важные за час ${next.tasksEarly ? 'вкл' : 'выкл'} · пояс ${next.timezone}`,
    )
    const subs = (await load<SyncMeta & { device: string }>('pushSub')).filter((s) => !s.deleted)
    console.log(`Устройства с уведомлениями: ${subs.length ? subs.map((s) => s.device).join(', ') : 'нет'}`)
    break
  }

  default:
    fail(
      'Команды: habits, add-habit, edit-habit, archive-habit, restore-habit, delete-habit, mark, stats, remind, ' +
        'tasks, add-task, edit-task, done-task, delete-task, projects, add-project, categories, add-expense, add-income, money, ' +
        'savings, add-saving, deposit, withdraw, payments, add-payment, pay, goals, add-goal, edit-goal, link, notify',
    )
}
