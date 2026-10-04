import { describe, expect, it } from 'vitest'
import type { Goal, Habit, Payment, Project, Saving, SavingEntry, Task, Transaction } from '../db/types'
import { buildLogIndex } from './habit-stats'
import { goalCount, goalParts, goalProgress, yearSummary, type GoalContext } from './goals'
import {
  buildPaidIndex,
  categoriesOf,
  dueDates,
  formatMoney,
  monthMoney,
  monthlyCost,
  nextDueDate,
  occurrences,
  parseAmount,
  paymentTxnId,
  remainingPayments,
  savingStats,
  scheduleFromDate,
  totalsByCategory,
} from './money'
import { groupTasks, projectProgress, tasksByDay, todayTasks } from './tasks'

// Опорные даты: 4 октября 2026 — воскресенье, 5 октября — понедельник.
const TODAY = '2026-10-04'
const meta = { updatedAt: 1, deleted: 0 as const, dirty: 0 as const }

function task(id: string, extra: Partial<Task> = {}): Task {
  return { id, title: id, note: '', projectId: null, date: TODAY, time: null, priority: 0, doneAt: null, order: 1, ...meta, ...extra }
}

function payment(extra: Partial<Payment> = {}): Payment {
  return {
    id: 'p1',
    title: 'Подписка',
    emoji: '🔁',
    kind: 'subscription',
    amount: 300,
    category: 'subscriptions',
    schedule: { type: 'monthly', day: 31 },
    startDate: '2026-01-01',
    endDate: null,
    note: '',
    order: 1,
    ...meta,
    ...extra,
  }
}

function txn(id: string, extra: Partial<Transaction> = {}): Transaction {
  return { id, type: 'expense', amount: 100, category: 'food', date: TODAY, note: '', paymentId: null, dueDate: null, ...meta, ...extra }
}

describe('задачи', () => {
  it('раскладывает по группам: просрочено, сегодня, завтра, позже, без даты, сделано', () => {
    const groups = groupTasks(
      [
        task('old', { date: '2026-10-01' }),
        task('older', { date: '2026-09-20' }),
        task('now'),
        task('tomorrow', { date: '2026-10-05' }),
        task('later2', { date: '2026-10-09' }),
        task('later1', { date: '2026-10-07' }),
        task('someday', { date: null }),
        task('done', { doneAt: '2026-10-03' }),
        task('ancient', { doneAt: '2026-09-01' }),
      ],
      TODAY,
    )
    expect(groups.overdue.map((t) => t.id)).toEqual(['older', 'old'])
    expect(groups.today.map((t) => t.id)).toEqual(['now'])
    expect(groups.tomorrow.map((t) => t.id)).toEqual(['tomorrow'])
    expect(groups.later.map((g) => g.date)).toEqual(['2026-10-07', '2026-10-09'])
    expect(groups.someday.map((t) => t.id)).toEqual(['someday'])
    expect(groups.done.map((t) => t.id)).toEqual(['done']) // старше 14 дней не показываем
  })

  it('внутри дня: приоритет, потом время, потом порядок', () => {
    const { today } = groupTasks(
      [
        task('a', { order: 1 }),
        task('b', { order: 2, time: '09:00' }),
        task('c', { order: 3, priority: 3 }),
        task('d', { order: 4, time: '08:00' }),
      ],
      TODAY,
    )
    expect(today.map((t) => t.id)).toEqual(['c', 'd', 'b', 'a'])
  })

  it('«Сегодня»: просроченные первыми, сделанные сегодня — отдельно', () => {
    const { open, doneToday } = todayTasks(
      [task('now'), task('old', { date: '2026-10-02' }), task('done', { doneAt: TODAY }), task('future', { date: '2026-10-06' })],
      TODAY,
    )
    expect(open.map((t) => t.id)).toEqual(['old', 'now'])
    expect(doneToday.map((t) => t.id)).toEqual(['done'])
  })

  it('процент проекта и календарь', () => {
    const tasks = [task('1', { projectId: 'p' }), task('2', { projectId: 'p', doneAt: TODAY }), task('3', { projectId: 'q' })]
    expect(projectProgress('p', tasks)).toEqual({ done: 1, total: 2, pct: 50 })
    expect(projectProgress('empty', tasks).pct).toBeNull()
    const byDay = tasksByDay(tasks, '2026-10-01', '2026-10-31')
    expect(byDay.get(TODAY)?.map((t) => t.id)).toEqual(['1', '3', '2']) // сделанные — в конце
  })
})

describe('деньги', () => {
  it('разбирает суммы', () => {
    expect(parseAmount('1 299,5')).toBe(1299.5)
    expect(parseAmount('350+120')).toBe(470)
    expect(parseAmount('0')).toBeNull()
    expect(parseAmount('12,345')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('')).toBeNull()
  })

  it('форматирует суммы', () => {
    const plain = (s: string) => s.replace(/[  ]/g, ' ')
    expect(plain(formatMoney(1299))).toBe('1 299 ₽')
    expect(plain(formatMoney(1299.5))).toBe('1 299,50 ₽')
    expect(plain(formatMoney(-350, { sign: true }))).toBe('−350 ₽')
    expect(plain(formatMoney(350, { sign: true }))).toBe('+350 ₽')
  })

  it('итоги месяца и категории', () => {
    const transactions = [
      txn('1', { amount: 1000, category: 'food' }),
      txn('2', { amount: 500, category: 'cafe' }),
      txn('3', { amount: 500, category: 'food' }),
      txn('4', { type: 'income', amount: 50000, category: 'in-salary' }),
      txn('5', { amount: 999, date: '2026-09-30' }),
    ]
    const entries: SavingEntry[] = [
      { id: 'e1', savingId: 's', amount: 10000, date: TODAY, note: '', ...meta },
      { id: 'e2', savingId: 's', amount: -2000, date: TODAY, note: '', ...meta },
    ]
    expect(monthMoney(transactions, entries, '2026-10')).toEqual({ income: 50000, expense: 2000, saved: 8000, balance: 40000 })
    expect(totalsByCategory(transactions, '2026-10', 'expense')).toEqual([
      { category: 'food', amount: 1500, count: 2, share: 75 },
      { category: 'cafe', amount: 500, count: 1, share: 25 },
    ])
  })

  it('свои категории — перед «Другое»', () => {
    const list = categoriesOf('expense', [{ id: 'c1', type: 'expense', title: 'Кот', emoji: '🐈', order: 1, ...meta }])
    expect(list.slice(-2).map((c) => c.title)).toEqual(['Кот', 'Другое'])
  })
})

describe('регулярные платежи', () => {
  it('ежемесячный 31-го — в коротких месяцах в последний день', () => {
    expect(dueDates(payment(), '2027-01-01', '2027-04-30')).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'])
  })

  it('ежегодный 29 февраля и еженедельный', () => {
    const yearly = payment({ schedule: { type: 'yearly', month: 2, day: 29 } })
    expect(dueDates(yearly, '2027-01-01', '2028-12-31')).toEqual(['2027-02-28', '2028-02-29'])
    const weekly = payment({ schedule: { type: 'weekly', weekday: 1 } })
    expect(dueDates(weekly, TODAY, '2026-10-19')).toEqual(['2026-10-05', '2026-10-12', '2026-10-19'])
  })

  it('учитывает начало и окончание', () => {
    const credit = payment({ schedule: { type: 'monthly', day: 15 }, startDate: '2026-10-15', endDate: '2027-01-15' })
    expect(dueDates(credit, '2026-01-01', '2027-12-31')).toEqual(['2026-10-15', '2026-11-15', '2026-12-15', '2027-01-15'])
    expect(nextDueDate(credit, '2026-10-16')).toBe('2026-11-15')
    expect(nextDueDate(credit, '2027-01-16')).toBeNull()
  })

  it('оплата, остаток по кредиту, стоимость в месяц', () => {
    const credit = payment({ schedule: { type: 'monthly', day: 15 }, startDate: '2026-10-15', endDate: '2027-01-15', amount: 5000 })
    const paid = buildPaidIndex([txn(paymentTxnId('p1', '2026-10-15'), { paymentId: 'p1', dueDate: '2026-10-15' })])
    expect(remainingPayments(credit, paid)).toEqual({ count: 3, total: 15000 })
    const list = occurrences([credit], paid, '2026-10-01', '2026-11-30')
    expect(list.map((o) => [o.dueDate, o.paid !== null])).toEqual([
      ['2026-10-15', true],
      ['2026-11-15', false],
    ])
    expect(monthlyCost(payment({ amount: 1200, schedule: { type: 'yearly', month: 1, day: 1 } }))).toBe(100)
  })

  it('расписание по дате ближайшего платежа', () => {
    expect(scheduleFromDate('2026-10-05', 'monthly')).toEqual({ type: 'monthly', day: 5 })
    expect(scheduleFromDate('2026-10-05', 'yearly')).toEqual({ type: 'yearly', month: 10, day: 5 })
    expect(scheduleFromDate('2026-10-05', 'weekly')).toEqual({ type: 'weekly', weekday: 1 })
  })
})

describe('накопления', () => {
  const saving: Saving = { id: 's', title: 'Подушка', emoji: '💰', target: 360000, deadline: '2027-09-30', goalId: null, order: 1, ...meta }
  const entry = (amount: number): SavingEntry => ({ id: String(amount), savingId: 's', amount, date: TODAY, note: '', ...meta })

  it('сколько откладывать в месяц до срока (текущий месяц считается)', () => {
    const stats = savingStats(saving, [entry(120000)], TODAY)
    expect(stats).toMatchObject({ current: 120000, left: 240000, pct: 33, reached: false, monthsLeft: 12, perMonth: 20000 })
  })

  it('100% — только когда цель достигнута', () => {
    expect(savingStats(saving, [entry(359999)], TODAY).pct).toBe(99)
    expect(savingStats(saving, [entry(360000)], TODAY)).toMatchObject({ pct: 100, reached: true, perMonth: null })
  })

  it('срок прошёл — вся сумма сразу', () => {
    expect(savingStats({ ...saving, deadline: '2026-01-31' }, [], TODAY)).toMatchObject({ monthsLeft: 1, perMonth: 360000 })
  })
})

describe('цели', () => {
  const habit: Habit = {
    id: 'h',
    title: 'Урок',
    emoji: '📚',
    schedule: { type: 'daily' },
    startDate: '2026-10-01',
    archivedAt: null,
    order: 1,
    goalId: 'g',
    ...meta,
  }
  const goal: Goal = {
    id: 'g',
    title: 'Английский',
    emoji: '🗣️',
    sphere: 'growth',
    year: 2026,
    deadline: null,
    note: '',
    measure: 'auto',
    countTarget: 0,
    countBase: 0,
    countHabitId: null,
    manualValue: 0,
    steps: [],
    doneAt: null,
    order: 1,
    ...meta,
  }
  const project: Project = { id: 'p', title: 'Курс', emoji: '📁', note: '', deadline: null, goalId: 'g', doneAt: null, order: 1, ...meta }
  const logs = ['2026-10-01', '2026-10-02'].map((date) => ({ id: `h:${date}`, habitId: 'h', date, ...meta }))
  const ctx: GoalContext = {
    habits: [habit],
    index: buildLogIndex(logs),
    projects: [project],
    tasks: [task('1', { projectId: 'p', doneAt: TODAY }), task('2', { projectId: 'p' }), task('3', { projectId: 'p' }), task('4', { projectId: 'p' })],
    savings: [],
    savingEntries: [],
    today: TODAY,
  }

  it('авто: среднее по привязанным частям', () => {
    // привычка: 2 из 3 прошедших дней (сегодня ещё не отмечено и не считается) = 67%; проект: 1 из 4 = 25%
    expect(goalParts(goal, ctx).map((p) => [p.kind, p.pct])).toEqual([
      ['habit', 67],
      ['project', 25],
    ])
    expect(goalProgress(goal, ctx)).toBe(46)
    const withSteps = { ...goal, steps: [{ id: '1', title: 'a', done: true }, { id: '2', title: 'b', done: true }] }
    expect(goalProgress(withSteps, ctx)).toBe(64) // (67 + 25 + 100) / 3
  })

  it('счётчик: отметки привычки + пройдено раньше', () => {
    const counter = { ...goal, measure: 'count' as const, countTarget: 40, countBase: 8, countHabitId: 'h' }
    expect(goalCount(counter, ctx.index)).toBe(10)
    expect(goalProgress(counter, ctx)).toBe(25)
  })

  it('вручную, достигнута, нечего считать', () => {
    expect(goalProgress({ ...goal, measure: 'manual', manualValue: 30 }, ctx)).toBe(30)
    expect(goalProgress({ ...goal, doneAt: TODAY }, ctx)).toBe(100)
    expect(goalProgress({ ...goal, id: 'other' }, ctx)).toBeNull()
    expect(yearSummary([goal, { ...goal, id: 'x', doneAt: TODAY }], ctx)).toEqual({ total: 2, reached: 1, pct: 73 })
  })
})
