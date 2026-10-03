import { useState } from 'preact/hooks'
import { useApp } from '../app-context'
import { toggleHabitLog } from '../data/habits'
import { useHabitsData } from '../data/use-habits'
import type { Habit } from '../db/types'
import { formatLong } from '../domain/dates'
import { percent, todayItems, type TodayItem } from '../domain/habit-stats'
import { plural } from '../lib/plural'
import { useToday } from '../lib/hooks'
import { EmptyState, ProgressBar, Ring, ScreenHeader } from '../ui/components'
import { IconCheck, IconFlame, IconPlus } from '../ui/icons'
import { HabitForm } from './habit-form'

export function TodayScreen() {
  const { db } = useApp()
  const today = useToday()
  const { habits, index, loaded } = useHabitsData()
  const [form, setForm] = useState<{ habit?: Habit } | null>(null)

  const items = todayItems(habits, index, today)
  const done = items.filter((item) => item.doneToday).length
  const pct = percent({ done, planned: items.length })
  const subtitle = formatLong(today)

  return (
    <>
      <ScreenHeader title="Сегодня" subtitle={subtitle.charAt(0).toUpperCase() + subtitle.slice(1)} />

      {loaded && habits.length === 0 ? (
        <EmptyState
          title="Начнём с привычек"
          text="Добавьте то, что хотите делать регулярно: каждый день, по дням недели или несколько раз в неделю."
        >
          <button class="btn btn--primary" onClick={() => setForm({})}>
            Добавить привычку
          </button>
        </EmptyState>
      ) : (
        <>
          <section class="card day-summary">
            <Ring value={pct} size={76} stroke={8} />
            <div class="day-summary__text">
              <p class="day-summary__title">
                {items.length === 0
                  ? 'На сегодня ничего не запланировано'
                  : done === items.length
                    ? 'Всё сделано 🎉'
                    : `Выполнено ${done} из ${items.length}`}
              </p>
              <ProgressBar value={pct} />
            </div>
          </section>

          <section class="card">
            <div class="card__head">
              <h2>Привычки</h2>
              <button class="icon-btn" onClick={() => setForm({})} aria-label="Добавить привычку">
                <IconPlus size={20} />
              </button>
            </div>
            {items.length === 0 ? (
              <p class="muted">Сегодня по плану ничего — можно отдохнуть.</p>
            ) : (
              <ul class="today-list">
                {items.map((item) => (
                  <li key={item.habit.id}>
                    <TodayRow item={item} onToggle={() => void toggleHabitLog(db, item.habit.id, today)} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {form && <HabitForm habit={form.habit} today={today} onClose={() => setForm(null)} />}
    </>
  )
}

function TodayRow({ item, onToggle }: { item: TodayItem; onToggle: () => void }) {
  const { habit, doneToday, period, streak } = item
  const meta: string[] = []
  if (period) {
    const count = period.count
    meta.push(`${count} из ${period.times} ${period.unit === 'week' ? 'на этой неделе' : 'в этом месяце'}`)
  }

  return (
    <button type="button" class={`today-row${doneToday ? ' today-row--done' : ''}`} aria-pressed={doneToday} onClick={onToggle}>
      <span class="today-row__emoji" aria-hidden="true">
        {habit.emoji}
      </span>
      <span class="today-row__text">
        <span class="today-row__title">{habit.title}</span>
        {(meta.length > 0 || streak > 1) && (
          <span class="today-row__meta">
            {meta.join(' · ')}
            {streak > 1 && (
              <span class="streak">
                <IconFlame size={14} />
                {streakText(streak, period?.unit)}
              </span>
            )}
          </span>
        )}
      </span>
      <span class="check" aria-hidden="true">
        <IconCheck size={18} />
      </span>
    </button>
  )
}

function streakText(n: number, unit?: 'week' | 'month'): string {
  if (unit === 'week') return `${n} ${plural(n, 'неделя', 'недели', 'недель')} подряд`
  if (unit === 'month') return `${n} ${plural(n, 'месяц', 'месяца', 'месяцев')} подряд`
  return `${n} ${plural(n, 'день', 'дня', 'дней')} подряд`
}
