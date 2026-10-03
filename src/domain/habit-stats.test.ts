import { describe, expect, it } from 'vitest'
import type { Habit, HabitSchedule } from '../db/types'
import { isoWeekday, weekMonth, weeksOfMonth } from './dates'
import {
  buildLogIndex,
  habitProgress,
  monthStats,
  percent,
  streak,
  todayItems,
} from './habit-stats'

// Опорные даты: 1 октября 2026 — четверг, 4 октября — воскресенье, 5 октября — понедельник.

function habit(schedule: HabitSchedule, extra: Partial<Habit> = {}): Habit {
  return {
    id: extra.id ?? 'h1',
    title: 'Привычка',
    emoji: '✅',
    schedule,
    startDate: '2026-09-01',
    archivedAt: null,
    order: 1,
    goalId: null,
    updatedAt: 1,
    deleted: 0,
    dirty: 0,
    ...extra,
  }
}

const days = (...list: string[]) => new Set(list)

describe('даты', () => {
  it('опорные дни недели', () => {
    expect(isoWeekday('2026-10-01')).toBe(4)
    expect(isoWeekday('2026-10-04')).toBe(7)
    expect(isoWeekday('2026-10-05')).toBe(1)
  })

  it('неделя относится к месяцу своего четверга', () => {
    expect(weekMonth('2026-09-28')).toBe('2026-10') // пн 28 сен, чт 1 окт
    expect(weeksOfMonth('2026-10')).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'])
    expect(weeksOfMonth('2026-09')).toEqual(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21'])
  })
})

describe('habitProgress — каждый день', () => {
  const h = habit({ type: 'daily' }, { startDate: '2026-10-01' })

  it('сегодняшний невыполненный день не портит процент', () => {
    const p = habitProgress(h, days('2026-10-01', '2026-10-02'), '2026-10-01', '2026-10-31', '2026-10-04')
    expect(p).toEqual({ done: 2, planned: 3 })
    expect(percent(p)).toBe(67)
  })

  it('сегодняшний выполненный день засчитывается', () => {
    const p = habitProgress(h, days('2026-10-01', '2026-10-02', '2026-10-04'), '2026-10-01', '2026-10-31', '2026-10-04')
    expect(p).toEqual({ done: 3, planned: 4 })
  })

  it('учитывает дату начала и архив', () => {
    const short = habit({ type: 'daily' }, { startDate: '2026-10-10', archivedAt: '2026-10-12' })
    const p = habitProgress(short, days('2026-10-11', '2026-10-15'), '2026-10-01', '2026-10-31', '2026-10-20')
    expect(p).toEqual({ done: 1, planned: 3 })
  })

  it('будущий месяц — пусто', () => {
    expect(habitProgress(h, undefined, '2026-11-01', '2026-11-30', '2026-10-04')).toEqual({ done: 0, planned: 0 })
    expect(percent({ done: 0, planned: 0 })).toBeNull()
  })
})

describe('habitProgress — по дням недели', () => {
  it('считает только запланированные дни (пн/ср/пт в сентябре 2026 — 13)', () => {
    const h = habit({ type: 'weekdays', days: [1, 3, 5] })
    const mondays = ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']
    const p = habitProgress(h, days(...mondays, '2026-09-01' /* вторник — не в плане */), '2026-09-01', '2026-09-30', '2026-10-04')
    expect(p).toEqual({ done: 4, planned: 13 })
  })
})

describe('habitProgress — N раз в неделю', () => {
  const h = habit({ type: 'weekly', times: 3 })

  it('октябрь: завершённые недели + выполненная текущая; незавершённая текущая не считается', () => {
    const logs = days(
      '2026-09-29', '2026-10-01', '2026-10-03', // неделя 28 сен (относится к октябрю) — 3/3
      '2026-10-06', '2026-10-08', //               неделя 5 окт — 2/3, закончилась
      '2026-10-13', //                             неделя 12 окт — идёт, 1/3
    )
    const p = habitProgress(h, logs, '2026-10-01', '2026-10-31', '2026-10-14')
    expect(p).toEqual({ done: 5, planned: 6 })
  })

  it('перевыполнение не даёт больше 100%', () => {
    const logs = days('2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02')
    expect(habitProgress(h, logs, '2026-10-01', '2026-10-31', '2026-10-05')).toEqual({ done: 3, planned: 3 })
  })
})

describe('habitProgress — N раз в месяц', () => {
  it('сентябрь закончился (1/2), октябрь выполнен (2/2)', () => {
    const h = habit({ type: 'monthly', times: 2 })
    const logs = days('2026-09-10', '2026-10-02', '2026-10-09')
    expect(habitProgress(h, logs, '2026-09-01', '2026-12-31', '2026-10-14')).toEqual({ done: 3, planned: 4 })
  })
})

describe('streak', () => {
  it('каждый день: сегодняшний невыполненный день серию не рвёт', () => {
    const h = habit({ type: 'daily' }, { startDate: '2026-09-25' })
    const logs = days('2026-10-01', '2026-10-02', '2026-10-03')
    expect(streak(h, logs, '2026-10-04')).toBe(3)
    expect(streak(h, days('2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'), '2026-10-04')).toBe(4)
    expect(streak(h, days('2026-10-01', '2026-10-03'), '2026-10-04')).toBe(1)
  })

  it('по дням недели: пропускает незапланированные дни', () => {
    const h = habit({ type: 'weekdays', days: [1, 3, 5] })
    // пт 25.09, пн 28.09, ср 30.09, пт 2.10 — подряд по плану
    expect(streak(h, days('2026-09-25', '2026-09-28', '2026-09-30', '2026-10-02'), '2026-10-04')).toBe(4)
  })

  it('N раз в неделю: недели подряд', () => {
    const h = habit({ type: 'weekly', times: 2 })
    const logs = days('2026-09-21', '2026-09-22', '2026-09-28', '2026-09-30', '2026-10-05')
    expect(streak(h, logs, '2026-10-06')).toBe(2) // текущая неделя 1/2 — не рвёт, две прошлые выполнены
  })

  it('без отметок — 0', () => {
    expect(streak(habit({ type: 'daily' }), undefined, '2026-10-04')).toBe(0)
    expect(streak(habit({ type: 'monthly', times: 1 }), undefined, '2026-10-04')).toBe(0)
  })
})

describe('todayItems', () => {
  const daily = habit({ type: 'daily' }, { id: 'd', order: 1 })
  const monFri = habit({ type: 'weekdays', days: [1, 5] }, { id: 'w', order: 2 })
  const gym = habit({ type: 'weekly', times: 2 }, { id: 'g', order: 3 })

  it('показывает привычки на сегодня и недоделанные «N раз в неделю»', () => {
    const index = buildLogIndex([])
    const items = todayItems([gym, monFri, daily], index, '2026-10-05') // понедельник
    expect(items.map((i) => i.habit.id)).toEqual(['d', 'w', 'g'])
    expect(items[2].period).toEqual({ count: 0, times: 2, unit: 'week' })
  })

  it('прячет выполненную на неделе привычку, если сегодня её не отмечали', () => {
    const logs = [
      { id: 'g:2026-10-05', habitId: 'g', date: '2026-10-05', updatedAt: 1, deleted: 0 as const, dirty: 0 as const },
      { id: 'g:2026-10-06', habitId: 'g', date: '2026-10-06', updatedAt: 1, deleted: 0 as const, dirty: 0 as const },
    ]
    expect(todayItems([gym], buildLogIndex(logs), '2026-10-07')).toEqual([])
    expect(todayItems([gym], buildLogIndex(logs), '2026-10-06')[0].doneToday).toBe(true)
  })

  it('снятые отметки (deleted) не учитываются', () => {
    const logs = [{ id: 'd:2026-10-05', habitId: 'd', date: '2026-10-05', updatedAt: 2, deleted: 1 as const, dirty: 0 as const }]
    expect(todayItems([daily], buildLogIndex(logs), '2026-10-05')[0].doneToday).toBe(false)
  })
})

describe('monthStats', () => {
  it('суммирует по привычкам и считает дневную линию только по привычкам «по дням»', () => {
    const daily = habit({ type: 'daily' }, { id: 'd', startDate: '2026-10-01' })
    const gym = habit({ type: 'weekly', times: 1 }, { id: 'g', startDate: '2026-10-01' })
    const index = new Map([
      ['d', days('2026-10-01', '2026-10-03')],
      ['g', days('2026-10-02')],
    ])
    const stats = monthStats([daily, gym], index, '2026-10', '2026-10-04')
    expect(stats.perDay.map((p) => p.pct)).toEqual([100, 0, 100, 0])
    expect(stats.perHabit.map((r) => [r.done, r.planned])).toEqual([
      [2, 3],
      [1, 1],
    ])
    expect([stats.done, stats.planned]).toEqual([3, 4])
  })
})
