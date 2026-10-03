import { useState } from 'preact/hooks'
import { useApp } from '../app-context'
import {
  archiveHabit,
  createHabit,
  deleteHabit,
  habitLogId,
  moveHabit,
  restoreHabit,
  updateHabit,
} from '../data/habits'
import type { Habit, HabitSchedule } from '../db/types'
import { addDaysKey, WEEKDAY_SHORT, type DateKey } from '../domain/dates'
import { Segmented, Sheet } from '../ui/components'

const EMOJIS = ['✅', '🏃', '💪', '🧘', '📚', '💧', '🥗', '😴', '🚭', '🍬', '📝', '🗣️', '💰', '🧹', '🚶', '🎯', '🧠', '🙏', '📵', '☀️', '🦷', '💊', '🎸', '❤️']

type ScheduleType = HabitSchedule['type']

const SCHEDULE_OPTIONS: { value: ScheduleType; label: string }[] = [
  { value: 'daily', label: 'Каждый день' },
  { value: 'weekdays', label: 'По дням' },
  { value: 'weekly', label: 'В неделю' },
  { value: 'monthly', label: 'В месяц' },
]

export function HabitForm(props: { habit?: Habit; today: DateKey; onClose: () => void }) {
  const { db } = useApp()
  const editing = props.habit
  const initial = editing?.schedule

  const [title, setTitle] = useState(editing?.title ?? '')
  const [emoji, setEmoji] = useState(editing?.emoji ?? '✅')
  const [type, setType] = useState<ScheduleType>(initial?.type ?? 'daily')
  const [days, setDays] = useState<number[]>(initial?.type === 'weekdays' ? initial.days : [1, 2, 3, 4, 5])
  const [weekly, setWeekly] = useState(initial?.type === 'weekly' ? initial.times : 3)
  const [monthly, setMonthly] = useState(initial?.type === 'monthly' ? initial.times : 2)
  const [startDate, setStartDate] = useState(editing?.startDate ?? props.today)
  // Последний день курса (например, лекарства на 28 дней). Пусто — без срока.
  const [until, setUntil] = useState(editing?.archivedAt ?? '')
  const [error, setError] = useState<string | null>(null)
  const isArchived = editing?.archivedAt != null && editing.archivedAt < props.today

  function schedule(): HabitSchedule {
    switch (type) {
      case 'weekdays':
        return { type, days: [...days].sort() }
      case 'weekly':
        return { type, times: weekly }
      case 'monthly':
        return { type, times: monthly }
      default:
        return { type: 'daily' }
    }
  }

  async function onSubmit(event: Event) {
    event.preventDefault()
    if (!title.trim()) return setError('Как назовём привычку?')
    if (type === 'weekdays' && days.length === 0) return setError('Выберите хотя бы один день')
    if (!startDate) return setError('Укажите дату начала')
    if (until && until < startDate) return setError('Дата окончания раньше даты начала')

    const fields = { title: title.trim(), emoji, schedule: schedule(), startDate, archivedAt: until || null }
    if (editing) await updateHabit(db, editing.id, fields)
    else await createHabit(db, fields)
    props.onClose()
  }

  async function onArchive() {
    if (!editing) return
    if (isArchived) {
      await restoreHabit(db, editing.id)
    } else {
      // Сегодняшний день остаётся в плане, только если по нему уже есть отметка; иначе привычка заканчивается вчера.
      const todayLog = await db.habitLogs.get(habitLogId(editing.id, props.today))
      const lastDay = todayLog && !todayLog.deleted ? props.today : addDaysKey(props.today, -1)
      await archiveHabit(db, editing.id, lastDay)
    }
    props.onClose()
  }

  async function onDelete() {
    if (!editing) return
    if (!confirm(`Удалить «${editing.title}» вместе со всей историей отметок?\nЕсли хотите просто перестать отслеживать — лучше «В архив».`)) return
    await deleteHabit(db, editing.id)
    props.onClose()
  }

  const toggleDay = (day: number) =>
    setDays((current) => (current.includes(day) ? current.filter((d) => d !== day) : [...current, day]))

  return (
    <Sheet title={editing ? 'Привычка' : 'Новая привычка'} onClose={props.onClose}>
      <form class="form" onSubmit={onSubmit}>
        <div class="emoji-row" role="radiogroup" aria-label="Значок">
          {EMOJIS.map((item) => (
            <button
              type="button"
              role="radio"
              aria-checked={item === emoji}
              class={`emoji-btn${item === emoji ? ' emoji-btn--active' : ''}`}
              onClick={() => setEmoji(item)}
            >
              {item}
            </button>
          ))}
        </div>

        <label class="field">
          <span>Название</span>
          <input
            value={title}
            onInput={(e) => setTitle(e.currentTarget.value)}
            placeholder="Например, зарядка 15 минут"
            enterKeyHint="done"
            maxLength={80}
          />
        </label>

        <div class="field">
          <span>Как часто</span>
          <Segmented label="Как часто" value={type} options={SCHEDULE_OPTIONS} onChange={setType} />
        </div>

        {type === 'weekdays' && (
          <div class="chips" role="group" aria-label="Дни недели">
            {WEEKDAY_SHORT.map((label, i) => (
              <button
                type="button"
                aria-pressed={days.includes(i + 1)}
                class={`chip${days.includes(i + 1) ? ' chip--active' : ''}`}
                onClick={() => toggleDay(i + 1)}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {type === 'weekly' && <Stepper value={weekly} min={1} max={7} onChange={setWeekly} suffix="раз в неделю" />}
        {type === 'monthly' && <Stepper value={monthly} min={1} max={31} onChange={setMonthly} suffix="раз в месяц" />}

        <label class="field">
          <span>Начать с</span>
          <input type="date" value={startDate} onInput={(e) => setStartDate(e.currentTarget.value)} />
        </label>

        <label class="field">
          <span>Закончить после (необязательно — например, курс лекарств)</span>
          <input type="date" value={until} min={startDate} onInput={(e) => setUntil(e.currentTarget.value)} />
        </label>

        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}

        <button class="btn btn--primary" type="submit">
          {editing ? 'Сохранить' : 'Добавить привычку'}
        </button>

        {editing && (
          <div class="form__secondary">
            <button type="button" class="btn btn--ghost" onClick={() => void moveHabit(db, editing.id, -1)}>
              ↑ Выше
            </button>
            <button type="button" class="btn btn--ghost" onClick={() => void moveHabit(db, editing.id, 1)}>
              ↓ Ниже
            </button>
            <button type="button" class="btn btn--ghost" onClick={onArchive}>
              {isArchived ? 'Вернуть из архива' : 'В архив'}
            </button>
            <button type="button" class="btn btn--ghost btn--danger" onClick={onDelete}>
              Удалить
            </button>
          </div>
        )}
      </form>
    </Sheet>
  )
}

function Stepper(props: { value: number; min: number; max: number; onChange: (value: number) => void; suffix: string }) {
  return (
    <div class="stepper">
      <button
        type="button"
        class="stepper__btn"
        onClick={() => props.onChange(Math.max(props.min, props.value - 1))}
        disabled={props.value <= props.min}
        aria-label="Меньше"
      >
        −
      </button>
      <span class="stepper__value">
        <b>{props.value}</b> {props.suffix}
      </span>
      <button
        type="button"
        class="stepper__btn"
        onClick={() => props.onChange(Math.min(props.max, props.value + 1))}
        disabled={props.value >= props.max}
        aria-label="Больше"
      >
        +
      </button>
    </div>
  )
}
