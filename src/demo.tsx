// Демо-режим для проверки внешнего вида (скриншоты): без входа и без облака, с тестовыми привычками.
// Включается только сборкой с VITE_DEMO=1 (см. CLAUDE.md); в обычную сборку не попадает.
import { useEffect, useMemo, useState } from 'preact/hooks'
import { AppContext, type AppContextValue } from './app-context'
import { createDb, type PlannerDB } from './db/db'
import type { Habit, HabitLog, Route, SyncMeta } from './db/types'
import { addDaysKey, todayKey, weekStart } from './domain/dates'
import { ROUTE_ID, routeMarkId, stageKeys } from './domain/route'
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
  await seedHabits(db)
  if ((await db.tasks.count()) === 0) await seedSections(db)
  if ((await db.routes.count()) === 0) await seedRoute(db)
}

const row = { updatedAt: 1, deleted: 0 as const, dirty: 0 as const }

type RouteContent = Omit<Route, keyof SyncMeta>

// Настоящий маршрут для скриншотов — private/demo-route.json (только на компьютере владельца, в git не попадает).
// Если файла нет — короткий пример.
const localRoutes = import.meta.glob<RouteContent>('../private/demo-route.json', { eager: true, import: 'default' })

const DEMO_ROUTE: RouteContent = {
  title: 'Учебный маршрут',
  subtitle: 'Пример маршрута',
  facts: [
    { value: '≈ 20 недель', label: 'до цели' },
    { value: '10 ч', label: 'в неделю' },
  ],
  rules: [
    { title: 'Цель — часы, а не темы', text: 'Время можно спланировать, объём темы — нет.' },
    { title: 'Пробелы — это нормально', text: 'Тема не далась — отметьте и вернитесь через пару дней.' },
  ],
  stages: [
    {
      id: 's0', no: '0', title: 'Старт', weeks: 'неделя 0 · ≈ 5 ч', what: 'Редактор, аккаунты, расписание.', why: 'Без среды первые недели уходят на установку.',
      example: 'Расписать неделю в календаре.', result: 'Всё установлено.', nar: 'Тренажёр с задачами.',
      milestones: [{ k: 'm.s0.0', t: 'Всё установлено' }, { k: 'm.s0.1', t: 'Неделя расписана' }],
      groups: [],
    },
    {
      id: 's1', no: '1', title: 'Основы', weeks: 'нед. 1–4 · ≈ 40 ч', what: 'Базовые понятия и первые упражнения.',
      why: 'Без базы дальше не продвинуться.', example: 'Мини-проект на выходных.', result: 'Три мини-проекта.', nar: 'Карточки каждый день.',
      milestones: [{ k: 'm.s1.0', t: 'Три мини-проекта' }, { k: 'm.s1.1', t: 'Объясню основы своими словами' }],
      groups: [
        { title: 'Теория', items: [{ k: 't.1', t: 'Тема 1' }, { k: 't.2', t: 'Тема 2' }, { k: 't.3', t: 'Тема 3' }, { k: 't.4', t: 'Тема 4' }] },
        { title: 'Практика', items: [{ k: 'p.1', t: 'Упражнение 1' }, { k: 'p.2', t: 'Упражнение 2' }] },
      ],
    },
    {
      id: 's2a', no: '2', branch: 'a', title: 'Направление A', weeks: 'нед. 5–12 · ≈ 80 ч', what: 'Углубление по направлению A.', why: 'Нужна специализация.',
      example: 'Проект по направлению.', result: 'Проект в портфолио.', nar: 'Вопросы по теме.',
      milestones: [{ k: 'm.s2a.0', t: 'Проект A' }],
      groups: [{ title: 'Темы A', items: [{ k: 'a.1', t: 'Тема A1' }, { k: 'a.2', t: 'Тема A2' }] }],
    },
    {
      id: 's2b', no: '2', branch: 'b', title: 'Направление B', weeks: 'нед. 5–12 · ≈ 80 ч', what: 'Углубление по направлению B.', why: 'Нужна специализация.',
      example: 'Проект по направлению.', result: 'Проект в портфолио.', nar: 'Вопросы по теме.',
      milestones: [{ k: 'm.s2b.0', t: 'Проект B' }],
      groups: [],
    },
  ],
  branches: [
    { id: 'a', label: 'Линия A', name: 'Направление A', hint: 'первый вариант' },
    { id: 'b', label: 'Линия B', name: 'Направление B', hint: 'второй вариант' },
  ],
  defaultBranch: 'a',
  fork: {
    after: 's1',
    weeks: 'конец нед. 4',
    title: 'Выбор направления',
    intro: 'Выберите ветку. Отметки в других ветках не пропадут.',
    table: [{ label: 'Чем занимаетесь', cells: ['Первое', 'Второе'] }],
    how: ['Посмотрите вакансии и выпишите требования.'],
  },
}

async function seedRoute(db: PlannerDB) {
  const content = Object.values(localRoutes)[0] ?? DEMO_ROUTE
  await db.routes.put({ ...content, id: ROUTE_ID, ...row })
  // Для вида: первый этап пройден, второй — начат.
  const [first, second] = content.stages
  const keys = [...stageKeys(first), ...(second ? stageKeys(second).filter((_, i) => i % 3 === 0) : [])]
  await db.routeMarks.bulkPut(keys.map((key) => ({ id: routeMarkId(ROUTE_ID, key), routeId: ROUTE_ID, key, ...row })))
  // Часы: прошлая неделя целиком и эта — до сегодняшнего дня включительно.
  const today = todayKey()
  const monday = addDaysKey(weekStart(today), -7)
  const minutes = [120, 90, 0, 150, 60, 240, 180, 90, 120, 0, 150, 60, 240, 180]
  await db.studySessions.bulkPut(
    minutes
      .map((m, i) => ({ date: addDaysKey(monday, i), m }))
      .filter(({ date, m }) => m > 0 && date <= today)
      .map(({ date, m }) => ({ id: `study-${date}`, routeId: ROUTE_ID, date, minutes: m, note: date === today ? 'повторение и задачи' : '', ...row })),
  )
}

async function seedSections(db: PlannerDB) {
  const today = todayKey()
  const day = (shift: number) => addDaysKey(today, shift)
  const month = today.slice(0, 7)
  const dom = Number(today.slice(8, 10))

  await db.goals.bulkPut([
    {
      id: 'g-en', title: 'Выучить английский', emoji: '🗣️', sphere: 'growth', year: Number(today.slice(0, 4)), deadline: null, note: '',
      measure: 'count', countTarget: 40, countBase: 8, countHabitId: 'demo-3', manualValue: 0, steps: [], doneAt: null, order: 1, ...row,
    },
    {
      id: 'g-money', title: 'Подушка безопасности', emoji: '💰', sphere: 'money', year: Number(today.slice(0, 4)), deadline: null, note: '',
      measure: 'auto', countTarget: 0, countBase: 0, countHabitId: null, manualValue: 0, steps: [], doneAt: null, order: 2, ...row,
    },
    {
      id: 'g-run', title: 'Пробежать полумарафон', emoji: '🏃', sphere: 'health', year: Number(today.slice(0, 4)), deadline: null, note: '',
      measure: 'auto', countTarget: 0, countBase: 0, countHabitId: null, manualValue: 0, doneAt: null, order: 3, ...row,
      steps: [
        { id: 's1', title: '10 км без остановки', done: true },
        { id: 's2', title: '15 км', done: false },
        { id: 's3', title: 'Забег 21 км', done: false },
      ],
    },
    {
      id: 'g-home', title: 'Обновить ванную', emoji: '🏠', sphere: 'home', year: Number(today.slice(0, 4)), deadline: `${today.slice(0, 4)}-12-31`, note: '',
      measure: 'auto', countTarget: 0, countBase: 0, countHabitId: null, manualValue: 0, steps: [], doneAt: null, order: 4, ...row,
    },
  ])
  await db.habits.update('demo-0', { goalId: 'g-run' })

  await db.projects.bulkPut([
    { id: 'p-bath', title: 'Ремонт в ванной', emoji: '🛠️', note: '', deadline: `${today.slice(0, 4)}-12-31`, goalId: 'g-home', doneAt: null, order: 1, ...row },
    { id: 'p-trip', title: 'Отпуск в горах', emoji: '✈️', note: '', deadline: null, goalId: null, doneAt: null, order: 2, ...row },
  ])

  const task = (id: string, title: string, extra: Partial<import('./db/types').Task>) => ({
    id, title, note: '', projectId: null, date: today, time: null, priority: 0 as const, doneAt: null, order: Number(id.slice(2)), ...row, ...extra,
  })
  await db.tasks.bulkPut([
    task('t-1', 'Позвонить в банк по карте', { time: '11:00', priority: 3 }),
    task('t-2', 'Купить подарок маме', { priority: 2 }),
    task('t-3', 'Оплатить квартиру', { date: day(-2) }),
    task('t-4', 'Записаться к стоматологу', { doneAt: today }),
    task('t-5', 'Выбрать плитку', { projectId: 'p-bath', date: day(1) }),
    task('t-6', 'Вызвать замерщика', { projectId: 'p-bath', doneAt: day(-3), date: day(-3) }),
    task('t-7', 'Купить смеситель', { projectId: 'p-bath', date: day(5) }),
    task('t-8', 'Демонтаж старой плитки', { projectId: 'p-bath', doneAt: day(-1), date: day(-1) }),
    task('t-9', 'Найти бригаду', { projectId: 'p-bath', date: null }),
    task('t-10', 'Купить билеты', { projectId: 'p-trip', date: day(9), priority: 1 }),
    task('t-11', 'Разобрать гардероб', { date: null }),
  ])

  const tx = (id: string, type: 'expense' | 'income', amount: number, category: string, shift: number, note = '') => ({
    id, type, amount, category, date: day(-Math.min(shift, dom - 1)), note, paymentId: null, dueDate: null, ...row,
  })
  await db.transactions.bulkPut([
    tx('x-1', 'income', 85000, 'in-salary', 3, 'Аванс'),
    tx('x-2', 'expense', 4380, 'food', 0, 'Перекрёсток'),
    tx('x-3', 'expense', 650, 'cafe', 0, 'Кофе с коллегой'),
    tx('x-4', 'expense', 1200, 'transport', 1),
    tx('x-5', 'expense', 7400, 'home', 2, 'Коммуналка'),
    tx('x-6', 'expense', 2890, 'health', 2, 'Аптека'),
    tx('x-7', 'expense', 3150, 'food', 3),
    tx('x-8', 'expense', 1990, 'fun', 4, 'Кино'),
    tx('x-9', 'income', 3500, 'in-cashback', 1),
  ])

  const dueDay = (shift: number) => Number(day(shift).slice(8, 10))
  await db.payments.bulkPut([
    {
      id: 'pay-plus', title: 'Яндекс Плюс', emoji: '🎵', kind: 'subscription', amount: 399, category: 'subscriptions',
      schedule: { type: 'monthly', day: dueDay(1) }, startDate: `${month}-01`, endDate: null, note: '', order: 1, ...row,
    },
    {
      id: 'pay-credit', title: 'Кредит за машину', emoji: '🏦', kind: 'credit', amount: 15400, category: 'credit',
      schedule: { type: 'monthly', day: dueDay(6) }, startDate: `${month}-01`, endDate: addDaysKey(day(6), 300), note: '', order: 2, ...row,
    },
    {
      id: 'pay-net', title: 'Интернет', emoji: '🌐', kind: 'bill', amount: 650, category: 'connection',
      schedule: { type: 'monthly', day: dueDay(-1) }, startDate: day(-1), endDate: null, note: '', order: 3, ...row,
    },
  ])

  await db.savings.bulkPut([
    { id: 'sv-1', title: 'Подушка безопасности', emoji: '🛡️', target: 300000, deadline: addDaysKey(today, 330), goalId: 'g-money', order: 1, ...row },
    { id: 'sv-2', title: 'Отпуск', emoji: '🏖️', target: 80000, deadline: null, goalId: null, order: 2, ...row },
  ])
  await db.savingEntries.bulkPut([
    { id: 'se-1', savingId: 'sv-1', amount: 120000, date: day(-40), note: 'Уже было', ...row },
    { id: 'se-2', savingId: 'sv-1', amount: 15000, date: day(-1), note: '', ...row },
    { id: 'se-3', savingId: 'sv-2', amount: 22000, date: day(-10), note: '', ...row },
  ])
}

async function seedHabits(db: PlannerDB) {
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
