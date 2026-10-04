import { useMemo, useState } from 'preact/hooks'
import { useApp } from '../app-context'
import { createGoal, deleteGoal, setGoalLinks, updateGoal, type LinkTable } from '../data/goals'
import { useHabitsData } from '../data/use-habits'
import { useRows } from '../data/use-data'
import type { Goal, GoalMeasure, GoalStep, Habit, Project, Saving } from '../db/types'
import { formatDate, type DateKey } from '../domain/dates'
import { goalCount, goalParts, goalProgress, sphereInfo, SPHERES, yearSummary, type GoalContext } from '../domain/goals'
import { useToday } from '../lib/hooks'
import { EmptyState, PeriodNav, ProgressBar, Ring, ScreenHeader, Segmented, Sheet } from '../ui/components'
import { IconCheck, IconPlus } from '../ui/icons'
import { EmojiPicker } from './task-parts'

export function GoalsScreen() {
  const today = useToday()
  const currentYear = Number(today.slice(0, 4))
  const [year, setYear] = useState(currentYear)
  const [form, setForm] = useState<{ goal?: Goal } | null>(null)
  const goals = useRows('goals')
  const ctx = useGoalContext(today)

  const yearGoals = (goals ?? []).filter((g) => g.year === year)
  const summary = yearSummary(yearGoals, ctx)
  const bySphere = SPHERES.map((sphere) => ({
    sphere,
    goals: yearGoals.filter((g) => g.sphere === sphere.id).sort((a, b) => a.order - b.order),
  }))
  const unknown = yearGoals.filter((g) => !SPHERES.some((s) => s.id === g.sphere))
  if (unknown.length) bySphere.push({ sphere: sphereInfo('other'), goals: unknown })

  return (
    <>
      <ScreenHeader
        title="Цели"
        action={
          <button class="btn btn--small btn--primary" onClick={() => setForm({})}>
            <IconPlus size={18} />
            <span class="desktop-only">Цель</span>
          </button>
        }
      />

      <div class="toolbar">
        <PeriodNav title={`${year} год`} onShift={(d) => setYear(year + d)} onToday={() => setYear(currentYear)} isCurrent={year === currentYear} />
      </div>

      {goals !== undefined && yearGoals.length === 0 ? (
        <EmptyState
          title={`Целей на ${year} год пока нет`}
          text="Цель привязывается к привычкам, проектам и накоплениям — и процент считается сам. Или ведите счётчик: например, уроки курса."
        >
          <button class="btn btn--primary" onClick={() => setForm({})}>
            Поставить цель
          </button>
        </EmptyState>
      ) : (
        <>
          <section class="card day-summary">
            <Ring value={summary.pct} size={76} stroke={8} />
            <div class="day-summary__text">
              <p class="day-summary__title">
                {summary.total} {summary.total === 1 ? 'цель' : summary.total < 5 ? 'цели' : 'целей'} · достигнуто {summary.reached}
              </p>
              <p class="muted small">Средний прогресс по целям {year} года</p>
            </div>
          </section>

          <div class="goal-columns">
            {bySphere
              .filter((group) => group.goals.length > 0)
              .map(({ sphere, goals: list }) => (
                <section class="card" key={sphere.id}>
                  <h2 class="sphere-head">
                    <span aria-hidden="true">{sphere.emoji}</span> {sphere.title}
                  </h2>
                  <ul class="goal-list">
                    {list.map((goal) => (
                      <li key={goal.id}>
                        <GoalRow goal={goal} ctx={ctx} onOpen={() => setForm({ goal })} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        </>
      )}

      {form && <GoalForm goal={form.goal} year={year} ctx={ctx} onClose={() => setForm(null)} />}
    </>
  )
}

/** Всё, из чего считается прогресс целей. */
function useGoalContext(today: DateKey): GoalContext {
  const { habits, index } = useHabitsData()
  const projects = useRows('projects') ?? []
  const tasks = useRows('tasks') ?? []
  const savings = useRows('savings') ?? []
  const savingEntries = useRows('savingEntries') ?? []
  return useMemo(
    () => ({ habits, index, projects, tasks, savings, savingEntries, today }),
    [habits, index, projects, tasks, savings, savingEntries, today],
  )
}

function measureText(goal: Goal, ctx: GoalContext): string | null {
  if (goal.measure === 'count') return `${goalCount(goal, ctx.index)} из ${goal.countTarget}`
  if (goal.measure === 'manual') return 'вручную'
  return null
}

function GoalRow(props: { goal: Goal; ctx: GoalContext; onOpen: () => void }) {
  const { goal, ctx } = props
  const pct = goalProgress(goal, ctx)
  const parts = goalParts(goal, ctx)
  const measure = measureText(goal, ctx)
  return (
    <button class={`goal-row${goal.doneAt ? ' goal-row--done' : ''}`} onClick={props.onOpen}>
      <span class="goal-row__head">
        <span class="goal-row__emoji" aria-hidden="true">
          {goal.emoji}
        </span>
        <span class="goal-row__title">{goal.title}</span>
        <span class="goal-row__pct tabular">{goal.doneAt ? <IconCheck size={18} /> : pct === null ? '—' : `${pct}%`}</span>
      </span>
      <ProgressBar value={pct} tone={goal.doneAt ? 'pink' : 'blue'} />
      {(parts.length > 0 || measure || goal.deadline) && (
        <span class="goal-row__parts">
          {measure && <span class="part-chip">{measure}</span>}
          {parts
            .filter((p) => p.kind !== 'steps')
            .map((p) => (
              <span class="part-chip" title={p.detail}>
                {p.emoji} {p.title}
                {p.pct !== null && <b class="tabular"> {p.pct}%</b>}
              </span>
            ))}
          {goal.steps.length > 0 && (
            <span class="part-chip">
              🪜 шаги {goal.steps.filter((s) => s.done).length}/{goal.steps.length}
            </span>
          )}
          {goal.deadline && <span class="part-chip">до {formatDate(goal.deadline, ctx.today)}</span>}
        </span>
      )}
    </button>
  )
}

/* ===================== Форма цели ===================== */

const GOAL_EMOJIS = ['🎯', '🗣️', '💰', '🏃', '📚', '💪', '🧘', '❤️', '🏠', '✈️', '💼', '🎓', '🎨', '🌱', '🚭', '💍']

const MEASURES: { value: GoalMeasure; label: string }[] = [
  { value: 'auto', label: 'По привязкам' },
  { value: 'count', label: 'Счётчик' },
  { value: 'manual', label: 'Вручную' },
]

function GoalForm(props: { goal?: Goal; year: number; ctx: GoalContext; onClose: () => void }) {
  const { db } = useApp()
  const { ctx } = props
  const editing = props.goal
  const [title, setTitle] = useState(editing?.title ?? '')
  const [emoji, setEmoji] = useState(editing?.emoji ?? '🎯')
  const [sphere, setSphere] = useState(editing?.sphere ?? 'growth')
  const [deadline, setDeadline] = useState(editing?.deadline ?? '')
  const [note, setNote] = useState(editing?.note ?? '')
  const [measure, setMeasure] = useState<GoalMeasure>(editing?.measure ?? 'auto')
  const [countTarget, setCountTarget] = useState(String(editing?.countTarget || ''))
  const [countBase, setCountBase] = useState(String(editing?.countBase ?? 0))
  const [countHabitId, setCountHabitId] = useState(editing?.countHabitId ?? '')
  const [manualValue, setManualValue] = useState(editing?.manualValue ?? 0)
  const [steps, setSteps] = useState<GoalStep[]>(editing?.steps ?? [])
  const [newStep, setNewStep] = useState('')
  const [error, setError] = useState<string | null>(null)

  const linkedSet = (list: { id: string; goalId: string | null }[]) => new Set(editing ? list.filter((r) => r.goalId === editing.id).map((r) => r.id) : [])
  const [habitLinks, setHabitLinks] = useState(() => linkedSet(ctx.habits))
  const [projectLinks, setProjectLinks] = useState(() => linkedSet(ctx.projects))
  const [savingLinks, setSavingLinks] = useState(() => linkedSet(ctx.savings))

  const activeHabits = ctx.habits.filter((h) => h.archivedAt === null || h.archivedAt >= ctx.today || habitLinks.has(h.id))
  const activeProjects = ctx.projects.filter((p) => !p.doneAt || projectLinks.has(p.id))

  function fields() {
    return {
      title: title.trim(),
      emoji,
      sphere,
      year: editing?.year ?? props.year,
      deadline: deadline || null,
      note: note.trim(),
      measure,
      countTarget: Math.max(0, Math.round(Number(countTarget) || 0)),
      countBase: Math.max(0, Math.round(Number(countBase) || 0)),
      countHabitId: countHabitId || null,
      manualValue,
      steps,
    }
  }

  // Предпросмотр процента с несохранёнными изменениями.
  const preview: Goal = { ...(editing ?? { id: '__new', doneAt: null, order: 0, updatedAt: 0, deleted: 0, dirty: 0 }), ...fields() }
  const previewCtx: GoalContext = {
    ...ctx,
    habits: ctx.habits.map((h) => ({ ...h, goalId: habitLinks.has(h.id) ? preview.id : h.goalId === preview.id ? null : h.goalId })),
    projects: ctx.projects.map((p) => ({ ...p, goalId: projectLinks.has(p.id) ? preview.id : p.goalId === preview.id ? null : p.goalId })),
    savings: ctx.savings.map((s) => ({ ...s, goalId: savingLinks.has(s.id) ? preview.id : s.goalId === preview.id ? null : s.goalId })),
  }
  const previewPct = goalProgress(preview, previewCtx)

  async function onSubmit(event: Event) {
    event.preventDefault()
    if (!title.trim()) return setError('Сформулируйте цель')
    if (measure === 'count' && !(Number(countTarget) > 0)) return setError('Сколько всего нужно сделать? Например, уроков в курсе')
    const data = fields()
    const id = editing ? (await updateGoal(db, editing.id, data), editing.id) : await createGoal(db, { ...data, doneAt: null })
    const links: [LinkTable, Set<string>][] = [
      ['habits', habitLinks],
      ['projects', projectLinks],
      ['savings', savingLinks],
    ]
    for (const [table, set] of links) await setGoalLinks(db, id, table, set)
    props.onClose()
  }

  async function onToggleDone() {
    if (!editing) return
    await updateGoal(db, editing.id, { ...fields(), doneAt: editing.doneAt ? null : ctx.today })
    props.onClose()
  }

  async function onDelete() {
    if (!editing || !confirm(`Удалить цель «${editing.title}»? Привычки, проекты и накопления останутся.`)) return
    await deleteGoal(db, editing.id)
    props.onClose()
  }

  function addStep() {
    if (!newStep.trim()) return
    setSteps([...steps, { id: crypto.randomUUID(), title: newStep.trim(), done: false }])
    setNewStep('')
  }

  return (
    <Sheet title={editing ? 'Цель' : `Новая цель на ${props.year}`} onClose={props.onClose}>
      <form class="form" onSubmit={onSubmit}>
        <EmojiPicker list={GOAL_EMOJIS} value={emoji} onChange={setEmoji} />
        <label class="field">
          <span>Цель</span>
          <input value={title} onInput={(e) => setTitle(e.currentTarget.value)} placeholder="Например, выучить английский до B1" maxLength={120} />
        </label>

        <div class="field">
          <span>Сфера жизни</span>
          <div class="sphere-grid" role="radiogroup" aria-label="Сфера жизни">
            {SPHERES.map((s) => (
              <button type="button" role="radio" aria-checked={s.id === sphere} class={`cat-btn${s.id === sphere ? ' cat-btn--active' : ''}`} onClick={() => setSphere(s.id)}>
                <span aria-hidden="true">{s.emoji}</span>
                <span class="cat-btn__title">{s.title}</span>
              </button>
            ))}
          </div>
        </div>

        <div class="field">
          <span>Как считать прогресс{previewPct !== null && ` — сейчас ${previewPct}%`}</span>
          <Segmented label="Как считать прогресс" value={measure} options={MEASURES} onChange={setMeasure} />
        </div>

        {measure === 'auto' && <p class="hint">Среднее по привязанным привычкам (выполнение за год), проектам (доля сделанных задач), накоплениям и шагам.</p>}
        {measure === 'count' && (
          <div class="inline-panel stack-sm">
            <div class="field-row">
              <label class="field">
                <span>Нужно всего</span>
                <input type="number" inputMode="numeric" min={1} value={countTarget} onInput={(e) => setCountTarget(e.currentTarget.value)} placeholder="40" />
              </label>
              <label class="field">
                <span>Уже сделано раньше</span>
                <input type="number" inputMode="numeric" min={0} value={countBase} onInput={(e) => setCountBase(e.currentTarget.value)} />
              </label>
            </div>
            <label class="field">
              <span>Прибавлять отметки привычки</span>
              <select value={countHabitId} onChange={(e) => setCountHabitId(e.currentTarget.value)}>
                <option value="">Не прибавлять — меняю «уже сделано» сам</option>
                {activeHabits.map((h) => (
                  <option value={h.id}>
                    {h.emoji} {h.title}
                  </option>
                ))}
              </select>
            </label>
            <p class="hint">
              Сейчас: {goalCount(preview, ctx.index)} из {preview.countTarget || '…'}
              {countHabitId && ' — каждая отметка привычки прибавляет единицу'}
            </p>
          </div>
        )}
        {measure === 'manual' && (
          <label class="field">
            <span>Готово на {manualValue}%</span>
            <input type="range" min={0} max={100} step={5} value={manualValue} onInput={(e) => setManualValue(Number(e.currentTarget.value))} />
          </label>
        )}

        <div class="field">
          <span>Шаги (необязательно)</span>
          {steps.length > 0 && (
            <ul class="step-list">
              {steps.map((step) => (
                <li key={step.id}>
                  <label class="step">
                    <input type="checkbox" checked={step.done} onChange={() => setSteps(steps.map((s) => (s.id === step.id ? { ...s, done: !s.done } : s)))} />
                    <span>{step.title}</span>
                  </label>
                  <button type="button" class="icon-btn icon-btn--small" aria-label="Удалить шаг" onClick={() => setSteps(steps.filter((s) => s.id !== step.id))}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div class="field-row">
            <input
              value={newStep}
              onInput={(e) => setNewStep(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addStep()
                }
              }}
              placeholder="Например, сдать пробный тест"
              aria-label="Новый шаг"
              maxLength={120}
            />
            <button type="button" class="btn btn--secondary" onClick={addStep} disabled={!newStep.trim()}>
              Добавить
            </button>
          </div>
        </div>

        <LinkPicker
          title="Привычки"
          items={activeHabits}
          selected={habitLinks}
          onChange={setHabitLinks}
          empty="Привычек пока нет"
          describe={(h: Habit) => `${h.emoji} ${h.title}`}
        />
        <LinkPicker
          title="Проекты"
          items={activeProjects}
          selected={projectLinks}
          onChange={setProjectLinks}
          empty="Проекты — в разделе «Задачи»"
          describe={(p: Project) => `${p.emoji} ${p.title}`}
        />
        <LinkPicker
          title="Накопления"
          items={ctx.savings}
          selected={savingLinks}
          onChange={setSavingLinks}
          empty="Цели накоплений — в разделе «Финансы»"
          describe={(s: Saving) => `${s.emoji} ${s.title}`}
        />

        <div class="field-row">
          <label class="field">
            <span>Срок (необязательно)</span>
            <input type="date" value={deadline} onInput={(e) => setDeadline(e.currentTarget.value)} />
          </label>
        </div>
        <label class="field">
          <span>Зачем мне это (заметка)</span>
          <textarea value={note} onInput={(e) => setNote(e.currentTarget.value)} rows={2} maxLength={2000} />
        </label>

        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
        <button class="btn btn--primary" type="submit">
          {editing ? 'Сохранить' : 'Поставить цель'}
        </button>
        {editing && (
          <div class="form__secondary">
            <button type="button" class="btn btn--ghost" onClick={onToggleDone}>
              {editing.doneAt ? 'Вернуть в работу' : 'Цель достигнута 🎉'}
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

function LinkPicker<T extends { id: string }>(props: {
  title: string
  items: T[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
  empty: string
  describe: (item: T) => string
}) {
  const toggle = (id: string) => {
    const next = new Set(props.selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    props.onChange(next)
  }
  return (
    <div class="field">
      <span>
        Привязать: {props.title.toLowerCase()}
        {props.selected.size > 0 && ` · ${props.selected.size}`}
      </span>
      {props.items.length === 0 ? (
        <p class="hint">{props.empty}</p>
      ) : (
        <div class="link-chips">
          {props.items.map((item) => (
            <button type="button" class={`chip chip--link${props.selected.has(item.id) ? ' chip--active' : ''}`} aria-pressed={props.selected.has(item.id)} onClick={() => toggle(item.id)}>
              {props.describe(item)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
