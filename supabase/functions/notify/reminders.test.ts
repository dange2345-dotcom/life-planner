import { describe, expect, it } from 'vitest'
import type { Habit, Payment } from '../../../src/db/types'
import { addDaysKey, isoWeekday } from '../../../src/domain/dates'
import { buildLogIndex, todayItems } from '../../../src/domain/habit-stats'
import { dueDates } from '../../../src/domain/money'
import {
  addDays,
  addMinutes,
  anythingDue,
  DEFAULT_SETTINGS,
  dueMessages,
  habitsToday,
  localNow,
  paymentDueOn,
  weekday,
  type UserData,
} from './reminders.ts'

// Опорные даты: 4 октября 2026 — воскресенье.
const TODAY = '2026-10-04'
const meta = { updatedAt: 1, deleted: 0 as const, dirty: 0 as const }

function habit(id: string, schedule: Habit['schedule'], extra: Partial<Habit> = {}): Habit {
  return { id, title: id, emoji: '✅', schedule, startDate: '2026-09-01', archivedAt: null, order: 1, goalId: null, ...meta, ...extra }
}

function payment(schedule: Payment['schedule'], extra: Partial<Payment> = {}): Payment {
  return {
    id: 'p',
    title: 'Кредит',
    emoji: '🏦',
    kind: 'credit',
    amount: 15000,
    category: 'credit',
    schedule,
    startDate: '2026-01-10',
    endDate: '2027-03-10',
    note: '',
    order: 1,
    ...meta,
    ...extra,
  }
}

function data(extra: Partial<UserData> = {}): UserData {
  return { settings: DEFAULT_SETTINGS, habits: [], logs: new Set(), tasks: [], payments: [], paid: new Set(), ...extra }
}

describe('время и даты', () => {
  it('местное время в часовом поясе владельца', () => {
    expect(localNow(new Date('2026-10-04T05:00:00Z'), 'Europe/Moscow')).toEqual({ date: '2026-10-04', time: '08:00' })
    expect(localNow(new Date('2026-10-04T21:30:00Z'), 'Europe/Moscow')).toEqual({ date: '2026-10-05', time: '00:30' })
    expect(localNow(new Date('2026-10-04T21:30:00Z'), 'Asia/Novosibirsk')).toEqual({ date: '2026-10-05', time: '04:30' })
  })

  it('совпадает с датами приложения', () => {
    for (let day = '2026-01-01'; day <= '2027-01-10'; day = addDaysKey(day, 9)) {
      expect(weekday(day)).toBe(isoWeekday(day))
      expect(addDays(day, 40)).toBe(addDaysKey(day, 40))
    }
  })
})

describe('сверка с расчётами приложения', () => {
  const habits = [
    habit('daily', { type: 'daily' }),
    habit('weekdays', { type: 'weekdays', days: [2, 4, 7] }),
    habit('weekly', { type: 'weekly', times: 2 }),
    habit('monthly', { type: 'monthly', times: 3 }),
    habit('course', { type: 'daily' }, { archivedAt: '2026-10-10' }),
    habit('future', { type: 'daily' }, { startDate: '2026-10-20' }),
  ]
  const logs = ['weekly:2026-09-29', 'weekly:2026-10-01', 'monthly:2026-10-02', 'daily:2026-10-12', 'monthly:2026-10-12', 'weekdays:2026-10-13']
  const index = buildLogIndex(logs.map((id) => ({ id, habitId: id.split(':')[0], date: id.split(':')[1], ...meta })))

  it('привычки на день — те же, что на экране «Сегодня»', () => {
    for (let day = '2026-09-28'; day <= '2026-10-25'; day = addDaysKey(day, 1)) {
      const app = todayItems(habits, index, day).map((i) => [i.habit.id, i.doneToday, i.period?.count ?? null])
      const server = habitsToday(habits, new Set(logs), day).map((i) => [i.habit.id, i.done, i.period?.count ?? null])
      expect(server, day).toEqual(app)
    }
  })

  it('даты платежей — те же, что в разделе «Финансы»', () => {
    const list = [
      payment({ type: 'monthly', day: 31 }),
      payment({ type: 'monthly', day: 10 }),
      payment({ type: 'yearly', month: 2, day: 29 }, { endDate: null }),
      payment({ type: 'weekly', weekday: 3 }),
    ]
    for (const p of list) {
      const app = new Set(dueDates(p, '2025-12-01', '2028-03-31'))
      for (let day = '2025-12-01'; day <= '2028-03-31'; day = addDaysKey(day, 1)) {
        expect(paymentDueOn(p, day), `${JSON.stringify(p.schedule)} ${day}`).toBe(app.has(day))
      }
    }
  })
})

describe('напоминания', () => {
  const now = { date: TODAY, time: '08:00' }

  it('утренний план: привычки, задачи, платежи сегодня и завтра', () => {
    const messages = dueMessages(
      data({
        habits: [habit('a', { type: 'daily' }), habit('b', { type: 'daily' })],
        logs: new Set(['b:2026-10-04']),
        tasks: [
          { id: 't1', title: 'Позвонить в банк', date: TODAY, time: null, doneAt: null },
          { id: 't2', title: 'Старое', date: '2026-10-01', time: null, doneAt: null },
          { id: 't3', title: 'Готово', date: TODAY, time: null, doneAt: TODAY },
        ],
        payments: [payment({ type: 'monthly', day: 5 }, { title: 'Интернет', amount: 650 })],
      }),
      now,
    )
    expect(messages).toHaveLength(1)
    expect(messages[0].title).toBe('План на сегодня')
    expect(messages[0].body.replace(/ | /g, ' ')).toBe(
      'Сделать: Старое, Позвонить в банк (1 просрочена)\nПривычки: 1\nЗавтра платёж: 🏦 Интернет — 650 ₽',
    )
  })

  it('оплаченный платёж и пустой день — без утреннего сообщения', () => {
    const p = payment({ type: 'monthly', day: 4 })
    expect(dueMessages(data({ payments: [p], paid: new Set(['pay:p:2026-10-04']) }), now)).toEqual([])
  })

  it('напоминание привычки — только если ещё не отмечена', () => {
    const pill = habit('pill', { type: 'daily' }, { title: 'Витамины', emoji: '💊', remindAt: ['07:30', '18:30'] })
    const at = { date: TODAY, time: '18:30' }
    expect(dueMessages(data({ habits: [pill] }), at).map((m) => m.title)).toEqual(['💊 Витамины'])
    expect(dueMessages(data({ habits: [pill], logs: new Set(['pill:2026-10-04']) }), at)).toEqual([])
    expect(dueMessages(data({ habits: [pill], settings: { ...DEFAULT_SETTINGS, habits: false } }), at)).toEqual([])
    expect(anythingDue(DEFAULT_SETTINGS, [pill], [], at)).toBe(true)
    expect(anythingDue(DEFAULT_SETTINGS, [pill], [], { date: TODAY, time: '18:31' })).toBe(false)
  })

  it('задача со временем и вечерний итог', () => {
    const tasks = [{ id: 't', title: 'Отправить отчёт', date: TODAY, time: '21:30', doneAt: null }]
    const messages = dueMessages(
      data({ habits: [habit('a', { type: 'daily' }, { title: 'Зубы', emoji: '🦷' })], tasks }),
      { date: TODAY, time: '21:30' },
    )
    expect(messages.map((m) => m.title)).toEqual(['📌 Отправить отчёт', 'Ещё осталось сегодня'])
    expect(messages[1].body).toBe('Не отмечено (1 из 1): 🦷 Зубы\nНе сделано: Отправить отчёт')
  })

  it('важная задача — ещё и за час; обычная — только в срок', () => {
    const tasks = [
      { id: 'hi', title: 'Сдать отчёт', date: TODAY, time: '15:00', priority: 3, doneAt: null },
      { id: 'mid', title: 'Позвонить', date: TODAY, time: '15:00', priority: 2, doneAt: null },
      { id: 'old', title: 'Старая без приоритета', date: TODAY, time: '15:00', doneAt: null },
    ]
    const early = dueMessages(data({ tasks }), { date: TODAY, time: '14:00' })
    expect(early).toEqual([{ title: '❗ Сдать отчёт', body: 'Через час, в 15:00 · высокий приоритет', tag: 'task-early:hi', url: '#/tasks' }])
    expect(dueMessages(data({ tasks }), { date: TODAY, time: '15:00' }).map((m) => m.tag)).toEqual(['task:hi', 'task:mid', 'task:old'])
    expect(anythingDue(DEFAULT_SETTINGS, [], tasks, { date: TODAY, time: '14:00' })).toBe(true)
    expect(anythingDue(DEFAULT_SETTINGS, [], tasks, { date: TODAY, time: '14:01' })).toBe(false)

    const off = { ...DEFAULT_SETTINGS, tasksEarly: false }
    expect(dueMessages(data({ tasks, settings: off }), { date: TODAY, time: '14:00' })).toEqual([])
    expect(anythingDue(off, [], tasks, { date: TODAY, time: '14:00' })).toBe(false)
    const done = [{ ...tasks[0], doneAt: TODAY }]
    expect(dueMessages(data({ tasks: done }), { date: TODAY, time: '14:00' })).toEqual([])
  })

  it('за час — через полночь', () => {
    const tasks = [{ id: 'n', title: 'Рейс', date: '2026-10-05', time: '00:30', priority: 3, doneAt: null }]
    expect(dueMessages(data({ tasks }), { date: TODAY, time: '23:30' }).map((m) => m.tag)).toEqual(['task-early:n'])
    expect(addMinutes({ date: '2026-12-31', time: '23:15' }, 60)).toEqual({ date: '2027-01-01', time: '00:15' })
    expect(addMinutes({ date: TODAY, time: '09:59' }, 60)).toEqual({ date: TODAY, time: '10:59' })
  })

  it('вечером всё сделано — не беспокоим', () => {
    const at = { date: TODAY, time: '21:30' }
    expect(dueMessages(data({ habits: [habit('a', { type: 'daily' })], logs: new Set(['a:2026-10-04']) }), at)).toEqual([])
  })
})
