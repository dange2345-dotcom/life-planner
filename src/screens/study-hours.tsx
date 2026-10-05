import { useEffect, useState } from 'preact/hooks'
import { useApp } from '../app-context'
import { addStudySession, deleteStudySession, startStudyTimer, stopStudyTimer, updateRouteSettings } from '../data/route'
import { useRows } from '../data/use-data'
import type { StudyTimer } from '../db/types'
import { addDaysKey, formatRelative, formatWeekRange, todayKey, toKey, weekStart, WEEKDAY_SHORT, type DateKey } from '../domain/dates'
import { ROUTE_ID } from '../domain/route'
import { formatClock, formatMinutes, LONG_SESSION_MINUTES, timerMinutes, weekPct, weekStudy } from '../domain/study'
import { useToday } from '../lib/hooks'
import { PeriodNav, ProgressBar, Sheet } from '../ui/components'

/** Часы учёбы за неделю: цель, по дням, таймер и быстрый ввод. */
export function StudyHours(props: { weeklyHours: number; timer: StudyTimer | null }) {
  const { db } = useApp()
  const today = useToday()
  const current = weekStart(today)
  const [week, setWeek] = useState(current)
  const [sheet, setSheet] = useState<null | 'add' | 'finish' | 'target'>(null)
  const sessions = useRows('studySessions') ?? []
  const stats = weekStudy(sessions, week)
  const pct = weekPct(stats.total, props.weeklyHours)
  const isCurrent = week === current
  const days = Array.from({ length: 7 }, (_, i) => addDaysKey(week, i))
  const scale = Math.max(...stats.byDay, (props.weeklyHours * 60) / 7, 1)

  const quick = (minutes: number) => void addStudySession(db, ROUTE_ID, { date: today, minutes })

  return (
    <section class="card study-hours">
      <div class="study-hours__head">
        <h2>Часы учёбы</h2>
        <PeriodNav title={formatWeekRange(week)} onShift={(d) => setWeek(addDaysKey(week, d * 7))} onToday={() => setWeek(current)} isCurrent={isCurrent} />
      </div>

      <div class="study-hours__total">
        <span>
          <b class="tabular">{formatMinutes(stats.total)}</b> <span class="muted">из {props.weeklyHours} ч</span>
        </span>
        <button type="button" class="btn btn--ghost btn--small" onClick={() => setSheet('target')}>
          Цель {props.weeklyHours} ч/нед
        </button>
      </div>
      <ProgressBar value={pct} tone={pct >= 100 ? 'pink' : 'blue'} />

      <div class="study-days" aria-label="По дням">
        {days.map((day, i) => (
          <div class={`study-day${day === today ? ' study-day--today' : ''}`} title={formatMinutes(stats.byDay[i])}>
            <span class="study-day__value tabular">{stats.byDay[i] ? hoursShort(stats.byDay[i]) : ''}</span>
            <span class="study-day__track">
              <span class="study-day__fill" style={{ height: `${Math.min(100, (stats.byDay[i] / scale) * 100)}%` }} />
            </span>
            <span class="study-day__label">{WEEKDAY_SHORT[i]}</span>
          </div>
        ))}
      </div>

      {isCurrent &&
        (props.timer ? (
          <TimerBar timer={props.timer} onFinish={() => setSheet('finish')} onCancel={() => confirm('Сбросить таймер без записи?') && void stopStudyTimer(db)} />
        ) : (
          <div class="study-actions">
            <button type="button" class="btn btn--primary btn--small" onClick={() => void startStudyTimer(db)}>
              ▶ Начать занятие
            </button>
            <button type="button" class="btn btn--secondary btn--small" onClick={() => quick(30)}>
              +30 мин
            </button>
            <button type="button" class="btn btn--secondary btn--small" onClick={() => quick(60)}>
              +1 ч
            </button>
            <button type="button" class="btn btn--secondary btn--small" onClick={() => quick(120)}>
              +2 ч
            </button>
            <button type="button" class="btn btn--ghost btn--small" onClick={() => setSheet('add')}>
              Другое…
            </button>
          </div>
        ))}

      {stats.sessions.length > 0 ? (
        <ul class="study-list">
          {stats.sessions.map((s) => (
            <li key={s.id}>
              <span class="study-list__day">{formatRelative(s.date, today)}</span>
              <span class="study-list__min tabular">{formatMinutes(s.minutes)}</span>
              {s.note && <span class="muted small study-list__note">{s.note}</span>}
              <button type="button" class="icon-btn icon-btn--small" aria-label="Удалить запись" onClick={() => void deleteStudySession(db, s.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p class="hint">{isCurrent ? 'На этой неделе занятий ещё нет. Запустите таймер или добавьте время кнопкой.' : 'В эту неделю занятий не было.'}</p>
      )}

      {sheet === 'target' && <TargetSheet hours={props.weeklyHours} onClose={() => setSheet(null)} />}
      {sheet === 'add' && <SessionSheet title="Занятие" date={today} onClose={() => setSheet(null)} />}
      {sheet === 'finish' && props.timer && (
        <SessionSheet
          title="Записать занятие"
          date={toKey(new Date(props.timer.startedAt))}
          minutes={timerMinutes(props.timer.startedAt, Date.now())}
          fromTimer
          onClose={() => setSheet(null)}
        />
      )}
    </section>
  )
}

/** «1,5» — часы для подписи столбика. */
function hoursShort(minutes: number): string {
  return (Math.round((minutes / 60) * 10) / 10).toString().replace('.', ',')
}

function TimerBar(props: { timer: StudyTimer; onFinish: () => void; onCancel: () => void }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const since = new Date(props.timer.startedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return (
    <div class="study-timer" role="timer" aria-live="off">
      <span class="study-timer__dot" aria-hidden="true" />
      <span class="study-timer__clock tabular">{formatClock(now - props.timer.startedAt)}</span>
      <span class="muted small">с {since}</span>
      <span class="study-timer__actions">
        <button type="button" class="btn btn--ghost btn--small" onClick={props.onCancel}>
          Сбросить
        </button>
        <button type="button" class="btn btn--primary btn--small" onClick={props.onFinish}>
          Закончить
        </button>
      </span>
    </div>
  )
}

function SessionSheet(props: { title: string; date: DateKey; minutes?: number; fromTimer?: boolean; onClose: () => void }) {
  const { db } = useApp()
  const [hours, setHours] = useState(props.minutes ? String(Math.floor(props.minutes / 60)) : '')
  const [mins, setMins] = useState(props.minutes ? String(props.minutes % 60) : '')
  const [date, setDate] = useState(props.date)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const total = (Number(hours) || 0) * 60 + (Number(mins) || 0)

  async function onSubmit(event: Event) {
    event.preventDefault()
    if (!(total > 0)) return setError('Сколько длилось занятие?')
    if (total > 16 * 60) return setError('Больше 16 часов за раз — проверьте время')
    await addStudySession(db, ROUTE_ID, { date: date || todayKey(), minutes: total, note })
    if (props.fromTimer) await stopStudyTimer(db)
    props.onClose()
  }

  return (
    <Sheet title={props.title} onClose={props.onClose}>
      <form class="form" onSubmit={onSubmit}>
        <div class="field-row">
          <label class="field">
            <span>Часов</span>
            <input type="number" inputMode="numeric" min={0} max={16} value={hours} onInput={(e) => setHours(e.currentTarget.value)} placeholder="1" />
          </label>
          <label class="field">
            <span>Минут</span>
            <input type="number" inputMode="numeric" min={0} max={59} value={mins} onInput={(e) => setMins(e.currentTarget.value)} placeholder="30" />
          </label>
        </div>
        {props.fromTimer && (props.minutes ?? 0) > LONG_SESSION_MINUTES && (
          <p class="hint">Таймер шёл больше 6 часов — возможно, его забыли выключить. Поправьте время перед записью.</p>
        )}
        <label class="field">
          <span>День</span>
          <input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} />
        </label>
        <label class="field">
          <span>Что делал (необязательно)</span>
          <input value={note} onInput={(e) => setNote(e.currentTarget.value)} placeholder="Например, две темы и пять задач" maxLength={200} />
        </label>
        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
        <button class="btn btn--primary" type="submit">
          Записать {total > 0 ? formatMinutes(total) : ''}
        </button>
      </form>
    </Sheet>
  )
}

function TargetSheet(props: { hours: number; onClose: () => void }) {
  const { db } = useApp()
  const [value, setValue] = useState(String(props.hours))
  const hours = Number(value)
  const valid = hours >= 1 && hours <= 80

  async function onSubmit(event: Event) {
    event.preventDefault()
    if (!valid) return
    await updateRouteSettings(db, ROUTE_ID, { weeklyHours: Math.round(hours * 2) / 2 })
    props.onClose()
  }

  return (
    <Sheet title="Цель на неделю" onClose={props.onClose}>
      <form class="form" onSubmit={onSubmit}>
        <label class="field">
          <span>Часов учёбы в неделю</span>
          <input type="number" inputMode="decimal" min={1} max={80} step={0.5} value={value} onInput={(e) => setValue(e.currentTarget.value)} />
        </label>
        <p class="hint">Сроки маршрута рассчитаны на 18 часов в неделю: при 15 путь длиннее, при 20 — короче.</p>
        <button class="btn btn--primary" type="submit" disabled={!valid}>
          Сохранить
        </button>
      </form>
    </Sheet>
  )
}
