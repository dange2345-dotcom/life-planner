// Инструмент для Claude: читать и менять данные «Планера» прямо в облаке (Supabase) от имени владельца.
// Записи пишутся в том же формате, что и приложение, — устройства подхватывают их при следующей синхронизации.
//
//   npm run planner -- habits [--all]
//   npm run planner -- add-habit --title "Зарядка" [--emoji 🏃] [--schedule daily|weekdays:1,3,5|weekly:3|monthly:2] [--start YYYY-MM-DD]
//   npm run planner -- edit-habit <ref> [--title …] [--emoji …] [--schedule …] [--start …]
//   npm run planner -- archive-habit <ref> [--date YYYY-MM-DD] | restore-habit <ref> | delete-habit <ref>
//   npm run planner -- mark <ref> [--date YYYY-MM-DD] [--undo]
//   npm run planner -- stats [--month YYYY-MM]
//
// <ref> — начало id или часть названия привычки (без учёта регистра).
// Ключ: SUPABASE_SECRET_KEY в life-planner/.env (только на этом компьютере, в git не попадает).

import { parseArgs } from 'node:util'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL } from '../src/config'
import type { Habit, HabitLog, HabitSchedule, SyncMeta } from '../src/db/types'
import { addDaysKey, formatDayMonth, formatMonth, monthOf, todayKey, WEEKDAY_SHORT, type DateKey } from '../src/domain/dates'
import { buildLogIndex, monthStats, streak, todayItems } from '../src/domain/habit-stats'

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
  const archived = h.archivedAt ? ` · в архиве с ${formatDayMonth(addDaysKey(h.archivedAt, 1))}` : ''
  return `${h.id.slice(0, 8)}  ${h.emoji} ${h.title} — ${describeSchedule(h.schedule)} · с ${formatDayMonth(h.startDate)}${archived}`
}

function checkDate(value: string | undefined, fallback: DateKey): DateKey {
  const date = value ?? fallback
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`Дата «${date}» — нужен формат YYYY-MM-DD`)
  return date
}

/* ---------- команды ---------- */

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    title: { type: 'string' },
    emoji: { type: 'string' },
    schedule: { type: 'string' },
    start: { type: 'string' },
    date: { type: 'string' },
    month: { type: 'string' },
    undo: { type: 'boolean' },
    all: { type: 'boolean' },
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
      archivedAt: null,
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

  default:
    fail('Команды: habits, add-habit, edit-habit, archive-habit, restore-habit, delete-habit, mark, stats')
}
