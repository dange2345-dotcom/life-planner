import { describe, expect, it } from 'vitest'
import type { StudySession } from '../db/types'
import { dayMinutes, DEFAULT_WEEKLY_HOURS, formatClock, formatMinutes, readRouteSettings, timerMinutes, weekPct, weekStudy } from './study'

// 5 октября 2026 — понедельник.
const MON = '2026-10-05'
const meta = { updatedAt: 1, deleted: 0 as const, dirty: 0 as const }

function session(id: string, date: string, minutes: number, extra: Partial<StudySession> = {}): StudySession {
  return { id, routeId: 'main', date, minutes, note: '', ...meta, ...extra }
}

describe('учёба: часы', () => {
  it('неделя: сумма, по дням, без чужих недель и удалённых', () => {
    const list = [
      session('a', '2026-10-05', 90),
      session('b', '2026-10-05', 30, { updatedAt: 5 }),
      session('c', '2026-10-11', 240),
      session('d', '2026-10-12', 60), // следующая неделя
      session('e', '2026-10-04', 60), // прошлая неделя
      session('f', '2026-10-07', 45, { deleted: 1 }),
    ]
    const week = weekStudy(list, MON)
    expect(week.total).toBe(360)
    expect(week.byDay).toEqual([120, 0, 0, 0, 0, 0, 240])
    expect(week.sessions.map((s) => s.id)).toEqual(['c', 'b', 'a'])
    expect(dayMinutes(list, MON)).toBe(120)
    expect(dayMinutes(list, '2026-10-07')).toBe(0)
  })

  it('форматы', () => {
    expect(formatMinutes(45)).toBe('45 мин')
    expect(formatMinutes(120)).toBe('2 ч')
    expect(formatMinutes(90)).toBe('1 ч 30 мин')
    expect(formatMinutes(0)).toBe('0 мин')
    expect(formatClock(2_530_000)).toBe('0:42:10')
    expect(formatClock(3_600_000 * 2 + 5_000)).toBe('2:00:05')
  })

  it('таймер — не меньше минуты, округление до минуты', () => {
    expect(timerMinutes(0, 10_000)).toBe(1)
    expect(timerMinutes(0, 89_000)).toBe(1)
    expect(timerMinutes(0, 91_000)).toBe(2)
  })

  it('процент недельной цели не больше 100', () => {
    expect(weekPct(540, 18)).toBe(50)
    expect(weekPct(2000, 18)).toBe(100)
  })

  it('настройки маршрута: цель по умолчанию и своя', () => {
    expect(readRouteSettings(undefined)).toEqual({ branch: undefined, weeklyHours: DEFAULT_WEEKLY_HOURS })
    expect(readRouteSettings({ branch: 'b', weeklyHours: 15 })).toEqual({ branch: 'b', weeklyHours: 15 })
    expect(readRouteSettings({ weeklyHours: 0 }).weeklyHours).toBe(DEFAULT_WEEKLY_HOURS)
  })
})
