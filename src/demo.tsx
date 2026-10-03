// Демо-режим для проверки внешнего вида (скриншоты): без входа и без облака, с тестовыми привычками.
// Включается только сборкой с VITE_DEMO=1 (см. CLAUDE.md); в обычную сборку не попадает.
import { useEffect, useMemo, useState } from 'preact/hooks'
import { AppContext, type AppContextValue } from './app-context'
import { createDb, type PlannerDB } from './db/db'
import type { Habit, HabitLog } from './db/types'
import { addDaysKey, todayKey } from './domain/dates'
import { habitLogId } from './data/habits'
import { createSyncEngine } from './sync/engine'
import { Shell } from './screens/shell'

const db = createDb('planner-demo')

export function DemoApp() {
  const engine = useMemo(() => createSyncEngine(db, { upsert: async () => {}, pullSince: async () => [] }), [])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    seed(db).then(() => {
      setReady(true)
      void engine.sync()
    })
  }, [engine])

  const context = useMemo<AppContextValue>(
    () => ({ db, sync: engine, email: 'demo@example.com', signOut: async () => {} }),
    [engine],
  )

  if (!ready) return null
  return (
    <AppContext.Provider value={context}>
      <Shell />
    </AppContext.Provider>
  )
}

async function seed(db: PlannerDB) {
  if ((await db.habits.count()) > 0) return
  const today = todayKey()
  const start = addDaysKey(today, -45)
  const habits: Habit[] = [
    ['🏃', 'Зарядка 15 минут', { type: 'daily' }, 0.85],
    ['📚', 'Читать 20 страниц', { type: 'daily' }, 0.7],
    ['💧', 'Два литра воды', { type: 'daily' }, 0.9],
    ['🗣️', 'Английский 30 минут', { type: 'weekdays', days: [1, 3, 5] }, 0.75],
    ['🍬', 'Без сладкого', { type: 'daily' }, 0.55],
    ['💪', 'Спортзал', { type: 'weekly', times: 3 }, 0.45],
    ['💰', 'Анализ расходов', { type: 'monthly', times: 2 }, 0.06],
  ].map(([emoji, title, schedule], i) => ({
    id: `demo-${i}`,
    emoji: emoji as string,
    title: title as string,
    schedule: schedule as Habit['schedule'],
    startDate: start,
    archivedAt: null,
    order: i + 1,
    goalId: null,
    updatedAt: 1,
    deleted: 0,
    dirty: 0,
  }))
  const rates = [0.85, 0.7, 0.9, 0.75, 0.55, 0.45, 0.06]

  let state = 42
  const random = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648)
  const logs: HabitLog[] = []
  for (let day = start; day <= today; day = addDaysKey(day, 1)) {
    habits.forEach((habit, i) => {
      const isToday = day === today
      if ((isToday && i % 2 === 0) || (!isToday && random() < rates[i])) {
        logs.push({ id: habitLogId(habit.id, day), habitId: habit.id, date: day, updatedAt: 1, deleted: 0, dirty: 0 })
      }
    })
  }
  await db.habits.bulkPut(habits)
  await db.habitLogs.bulkPut(logs)
}
