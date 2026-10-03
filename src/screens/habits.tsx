import { useEffect, useRef, useState } from 'preact/hooks'
import { useApp } from '../app-context'
import { toggleHabitLog } from '../data/habits'
import { useHabitsData } from '../data/use-habits'
import type { Habit } from '../db/types'
import {
  addDaysKey,
  addMonthsKey,
  daysBetween,
  formatDayMonth,
  formatMonth,
  formatWeekRange,
  fromKey,
  isoWeekday,
  monthEnd,
  monthOf,
  monthStart,
  weekDays,
  weekMonth,
  weekStart,
  weeksOfMonth,
  WEEKDAY_SHORT,
  type DateKey,
  type MonthKey,
} from '../domain/dates'
import {
  habitProgress,
  isActiveOn,
  isDayBased,
  isDueOn,
  monthStats,
  percent,
  periodCount,
  type LogIndex,
} from '../domain/habit-stats'
import { useLocalSetting, useMediaQuery, useToday } from '../lib/hooks'
import { EmptyState, ProgressBar, Ring, ScreenHeader, Segmented } from '../ui/components'
import { IconCheck, IconChevronLeft, IconChevronRight, IconPlus } from '../ui/icons'
import { LineChart } from '../ui/line-chart'
import { HabitForm } from './habit-form'

type Mode = 'week' | 'month'

export function HabitsScreen() {
  const today = useToday()
  const wide = useMediaQuery('(min-width: 900px)')
  const [mode, setMode] = useLocalSetting<Mode>('habits.mode', wide ? 'month' : 'week')
  const [week, setWeek] = useState(() => weekStart(today))
  const [month, setMonth] = useState(() => monthOf(today))
  const [form, setForm] = useState<{ habit?: Habit } | null>(null)
  const { habits, index, loaded } = useHabitsData()

  function changeMode(next: Mode) {
    if (next === 'month') setMonth(weekMonth(week))
    else setWeek(month === monthOf(today) ? weekStart(today) : weeksOfMonth(month)[0])
    setMode(next)
  }

  const isCurrent = mode === 'week' ? week === weekStart(today) : month === monthOf(today)
  const shift = (direction: -1 | 1) =>
    mode === 'week' ? setWeek(addDaysKey(week, 7 * direction)) : setMonth(addMonthsKey(month, direction))
  const goToday = () => (mode === 'week' ? setWeek(weekStart(today)) : setMonth(monthOf(today)))

  const archived = habits.filter((habit) => habit.archivedAt !== null && habit.archivedAt < today)
  const openForm = (habit?: Habit) => setForm({ habit })

  return (
    <>
      <ScreenHeader
        title="Привычки"
        action={
          <button class="btn btn--small btn--primary" onClick={() => openForm()}>
            <IconPlus size={18} />
            <span class="desktop-only">Добавить</span>
          </button>
        }
      />

      {loaded && habits.length === 0 ? (
        <EmptyState title="Привычек пока нет" text="Добавьте первую — и здесь появится сетка по дням, проценты и статистика.">
          <button class="btn btn--primary" onClick={() => openForm()}>
            Добавить привычку
          </button>
        </EmptyState>
      ) : (
        <>
          <div class="toolbar">
            <Segmented
              label="Период"
              value={mode}
              onChange={changeMode}
              options={[
                { value: 'week', label: 'Неделя' },
                { value: 'month', label: 'Месяц' },
              ]}
            />
            <div class="period-nav">
              <button class="icon-btn" onClick={() => shift(-1)} aria-label="Назад">
                <IconChevronLeft size={20} />
              </button>
              <span class="period-nav__title">{mode === 'week' ? formatWeekRange(week) : formatMonth(month)}</span>
              <button class="icon-btn" onClick={() => shift(1)} aria-label="Вперёд">
                <IconChevronRight size={20} />
              </button>
              {!isCurrent && (
                <button class="btn btn--ghost btn--small" onClick={goToday}>
                  Сегодня
                </button>
              )}
            </div>
          </div>

          {mode === 'week' ? (
            <WeekView habits={habits} index={index} week={week} today={today} onEdit={openForm} />
          ) : (
            <>
              <MonthGrid habits={habits} index={index} month={month} today={today} onEdit={openForm} />
              <MonthSummary habits={habits} index={index} month={month} today={today} />
            </>
          )}

          {archived.length > 0 && (
            <section class="card">
              <h2>Архив</h2>
              <ul class="archive-list">
                {archived.map((habit) => (
                  <li key={habit.id}>
                    <button class="link-row" onClick={() => openForm(habit)}>
                      <span aria-hidden="true">{habit.emoji}</span> {habit.title}
                      <span class="muted"> · до {formatDayMonth(habit.archivedAt!)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {form && <HabitForm habit={form.habit} today={today} onClose={() => setForm(null)} />}
    </>
  )
}

function activeIn(habit: Habit, from: DateKey, to: DateKey): boolean {
  return habit.startDate <= to && (habit.archivedAt === null || habit.archivedAt >= from)
}

function scheduleHint(habit: Habit): string {
  const s = habit.schedule
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

/* ===================== Неделя ===================== */

function WeekView(props: { habits: Habit[]; index: LogIndex; week: DateKey; today: DateKey; onEdit: (h: Habit) => void }) {
  const { habits, index, week, today } = props
  const days = weekDays(week)
  const end = days[6]
  const visible = habits.filter((habit) => activeIn(habit, week, end))

  return (
    <section class="card week">
      <div class="week__head" aria-hidden="true">
        {days.map((day, i) => (
          <span class={`week__day${day === today ? ' week__day--today' : ''}`}>
            <span>{WEEKDAY_SHORT[i]}</span>
            <b>{fromKey(day).getDate()}</b>
          </span>
        ))}
      </div>

      {visible.length === 0 && <p class="muted">На этой неделе привычки не отслеживались.</p>}

      {visible.map((habit) => {
        const done = index.get(habit.id)
        const schedule = habit.schedule
        let stat: string
        if (schedule.type === 'weekly') {
          stat = `${periodCount(habit, done, week)}/${schedule.times}`
        } else if (schedule.type === 'monthly') {
          const ref = today >= week && today <= end ? today : week
          stat = `${periodCount(habit, done, ref)}/${schedule.times} в мес`
        } else {
          const pct = percent(habitProgress(habit, done, week, end, today))
          stat = pct === null ? '—' : `${pct}%`
        }
        return (
          <div class="week__habit" key={habit.id}>
            <button class="habit-name" onClick={() => props.onEdit(habit)}>
              <span class="habit-name__emoji" aria-hidden="true">
                {habit.emoji}
              </span>
              <span class="habit-name__text">
                <span class="habit-name__title">{habit.title}</span>
                <span class="habit-name__hint">{scheduleHint(habit)}</span>
              </span>
              <span class="habit-name__stat tabular">{stat}</span>
            </button>
            <div class="week__cells">
              {days.map((day) => (
                <DayCell habit={habit} day={day} today={today} done={done?.has(day) ?? false} />
              ))}
            </div>
          </div>
        )
      })}
    </section>
  )
}

/* ===================== Клетка дня ===================== */

function DayCell(props: { habit: Habit; day: DateKey; today: DateKey; done: boolean; compact?: boolean }) {
  const { db } = useApp()
  const { habit, day, today, done } = props
  const active = isActiveOn(habit, day)
  const dayBased = isDayBased(habit)
  const planned = dayBased ? isDueOn(habit, day) : active
  const future = day > today

  let state: string
  if (!active) state = 'off'
  else if (done) state = 'done'
  else if (future) state = planned ? 'future' : 'off'
  else if (!planned) state = 'rest'
  else if (!dayBased) state = 'open'
  else if (day === today) state = 'today'
  else state = 'missed'

  // Будущее и незапланированные дни отметить нельзя; уже стоящую отметку снять можно всегда.
  const disabled = !done && (!active || future || !planned)
  const label = `${habit.title}, ${formatDayMonth(day)}: ${done ? 'выполнено' : planned ? 'не выполнено' : 'не по плану'}`

  return (
    <button
      type="button"
      class={`cell cell--${state}${day === today ? ' cell--is-today' : ''}${props.compact ? ' cell--compact' : ''}`}
      aria-label={label}
      aria-pressed={done}
      disabled={disabled}
      onClick={() => void toggleHabitLog(db, habit.id, day)}
    >
      {done && <IconCheck size={props.compact ? 13 : 16} />}
    </button>
  )
}

/* ===================== Месяц (сетка как в таблице-референсе) ===================== */

const WEEKDAY_LETTER = ['П', 'В', 'С', 'Ч', 'П', 'С', 'В']

function MonthGrid(props: { habits: Habit[]; index: LogIndex; month: MonthKey; today: DateKey; onEdit: (h: Habit) => void }) {
  const { habits, index, month, today } = props
  const from = monthStart(month)
  const to = monthEnd(month)
  const days = daysBetween(from, to)
  const visible = habits.filter((habit) => activeIn(habit, from, to))
  const stats = monthStats(visible, index, month, today)
  const perDay = new Map(stats.perDay.map((point) => [point.day, point]))

  // На узком экране сетка шире экрана — прокручиваем так, чтобы сегодняшний день был виден.
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = scroller.current
    const todayCell = box?.querySelector<HTMLElement>('.month__day--today')
    if (!box || !todayCell) return
    const nameCol = box.querySelector<HTMLElement>('.month__name-col')?.offsetWidth ?? 0
    const overflow = todayCell.offsetLeft + todayCell.offsetWidth - box.clientWidth
    if (overflow > 0) box.scrollLeft = Math.min(overflow + box.clientWidth / 3, todayCell.offsetLeft - nameCol - 12)
  }, [month, visible.length])

  if (visible.length === 0) {
    return (
      <section class="card">
        <p class="muted">В этом месяце привычки не отслеживались.</p>
      </section>
    )
  }

  return (
    <section class="card month">
      <div class="month__scroll" ref={scroller}>
        <table class="month__table">
          <thead>
            <tr>
              <th class="month__name-col" scope="col">
                Привычка
              </th>
              {days.map((day) => {
                const weekday = isoWeekday(day)
                return (
                  <th
                    scope="col"
                    class={`month__day${weekday >= 6 ? ' month__day--weekend' : ''}${day === today ? ' month__day--today' : ''}`}
                  >
                    <span>{WEEKDAY_LETTER[weekday - 1]}</span>
                    <b>{fromKey(day).getDate()}</b>
                  </th>
                )
              })}
              <th class="month__pct-col" scope="col">
                %
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.perHabit.map((row) => (
              <tr key={row.habit.id}>
                <th class="month__name-col" scope="row">
                  <button class="month__name" onClick={() => props.onEdit(row.habit)} title={row.habit.title}>
                    <span aria-hidden="true">{row.habit.emoji}</span> {row.habit.title}
                  </button>
                </th>
                {days.map((day) => (
                  <td>
                    <DayCell habit={row.habit} day={day} today={today} done={index.get(row.habit.id)?.has(day) ?? false} compact />
                  </td>
                ))}
                <td class="month__pct-col tabular">{row.pct === null ? '—' : `${row.pct}%`}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th class="month__name-col" scope="row">
                Прогресс за день
              </th>
              {days.map((day) => {
                const point = perDay.get(day)
                return <td class="month__foot tabular">{point && point.pct !== null ? point.pct : ''}</td>
              })}
              <td class="month__pct-col tabular">{percent(stats) === null ? '—' : `${percent(stats)}%`}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}

/* ===================== Итоги месяца ===================== */

function MonthSummary(props: { habits: Habit[]; index: LogIndex; month: MonthKey; today: DateKey }) {
  const { habits, index, month, today } = props
  const visible = habits.filter((habit) => activeIn(habit, monthStart(month), monthEnd(month)))
  const stats = monthStats(visible, index, month, today)
  const total = percent(stats)
  const ranked = stats.perHabit.filter((row) => row.pct !== null).sort((a, b) => b.pct! - a.pct!)
  const medals = ['🥇', '🥈', '🥉']

  if (visible.length === 0 || stats.perDay.length === 0) return null

  return (
    <div class="summary-grid">
      <section class="card summary-total">
        <h2>Итог месяца</h2>
        <div class="summary-total__body">
          <Ring value={total} size={112} stroke={12}>
            <span class="ring__big">{total === null ? '—' : `${total}%`}</span>
          </Ring>
          <div>
            <p class="summary-total__numbers">
              <b>{stats.done}</b> <span class="muted">из {stats.planned}</span>
            </p>
            <p class="muted">выполнено из запланированного{month === monthOf(today) ? ' на сегодня' : ''}</p>
          </div>
        </div>
      </section>

      <section class="card summary-chart">
        <h2>Выполнение по дням</h2>
        <LineChart
          ariaLabel={`Процент выполнения привычек по дням, ${formatMonth(month)}`}
          points={stats.perDay.map((point) => ({
            label: String(fromKey(point.day).getDate()),
            title: formatDayMonth(point.day),
            value: point.pct,
            detail: point.due ? `${point.done} из ${point.due}` : undefined,
          }))}
        />
      </section>

      <section class="card summary-rank">
        <h2>Самые стабильные</h2>
        {ranked.length === 0 ? (
          <p class="muted">Пока нечего сравнивать.</p>
        ) : (
          <ul class="rank-list">
            {ranked.map((row, i) => (
              <li key={row.habit.id} class="rank-row">
                <span class="rank-row__name">
                  <span aria-hidden="true">{i < 3 && row.pct! > 0 ? medals[i] : row.habit.emoji}</span> {row.habit.title}
                </span>
                <span class="rank-row__pct tabular">{row.pct}%</span>
                <ProgressBar value={row.pct} tone="pink" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
