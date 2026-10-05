import { Fragment } from 'preact'
import { useState } from 'preact/hooks'
import { useApp } from '../app-context'
import { setRouteBranch, setRouteMark } from '../data/route'
import { useRouteData } from '../data/use-route'
import type { Route, RouteFork, RouteItem, RouteStage, StudyTimer } from '../db/types'
import { ROUTE_ID, onBranch, routeProgress, topicCount, type StageProgress } from '../domain/route'
import { EmptyState, ProgressBar, Ring, ScreenHeader } from '../ui/components'
import { IconCheck, IconChevronRight } from '../ui/icons'
import { StudyHours } from './study-hours'

export function StudyScreen() {
  const { db } = useApp()
  const { route, done, branch, weeklyHours, timer } = useRouteData()

  if (route === undefined) return <ScreenHeader title="Учёба" />
  if (route === null) {
    return (
      <>
        <ScreenHeader title="Учёба" />
        <EmptyState
          title="Маршрута пока нет"
          text="Маршрут загружает Claude из вашего учебного плана. Напишите ему: «загрузи маршрут в Планер» — и он появится здесь на всех устройствах."
        />
      </>
    )
  }

  const toggle = (key: string) => void setRouteMark(db, ROUTE_ID, key, !done.has(key))
  return (
    <RouteView
      route={route}
      branch={branch}
      done={done}
      weeklyHours={weeklyHours}
      timer={timer}
      onToggle={toggle}
      onBranch={(b) => void setRouteBranch(db, ROUTE_ID, b)}
    />
  )
}

interface ViewProps {
  route: Route
  branch: string
  done: ReadonlySet<string>
  weeklyHours: number
  timer: StudyTimer | null
  onToggle: (key: string) => void
  onBranch: (branch: string) => void
}

function RouteView({ route, branch, done, weeklyHours, timer, onToggle, onBranch: chooseBranch }: ViewProps) {
  const progress = routeProgress(route, branch, done)
  const here = progress.here
  // Раскрыт этап «Вы здесь»; дальше пользователь раскрывает и сворачивает сам.
  const [open, setOpen] = useState<Set<string>>(() => new Set(here ? [here.id] : []))
  const flip = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const visible = route.stages.filter((s) => onBranch(s, branch))
  const branchInfo = route.branches.find((b) => b.id === branch)
  const topics = visible.filter((s) => !s.optional).reduce((n, s) => n + topicCount(s), 0)

  return (
    <>
      <ScreenHeader title={route.title} subtitle="Учёба" />

      <section class="card day-summary route-summary">
        <Ring value={progress.pct} size={76} stroke={8} />
        <div class="day-summary__text">
          <p class="day-summary__title">{here ? `Вы здесь: этап ${here.no} · ${here.title}` : 'Маршрут пройден 🎉'}</p>
          <p class="muted small">
            Отмечено {progress.done} из {progress.total}
            {branchInfo && ` · ${branchInfo.label}: ${branchInfo.name}`}
          </p>
        </div>
      </section>

      <StudyHours weeklyHours={weeklyHours} timer={timer} />

      {(route.facts.length > 0 || topics > 0) && (
        <div class="route-facts">
          {route.facts.map((f) => (
            <span class="part-chip">
              <b>{f.value}</b> {f.label}
            </span>
          ))}
          <span class="part-chip">
            <b>≈ {Math.round(topics / 10) * 10}</b> тем ядра
          </span>
        </div>
      )}

      {route.rules.length > 0 && (
        <details class="card route-rules">
          <summary>
            <span>Как идти по маршруту</span>
            <span class="muted small">{route.rules.length} правил</span>
            <IconChevronRight size={18} class="route-chevron" />
          </summary>
          <ul class="route-rules__list">
            {route.rules.map((rule) => (
              <li>
                <b>{rule.title}</b>
                <span class="muted">{rule.text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <ol class="route-list">
        {visible.map((stage) => (
          <Fragment key={stage.id}>
            <li>
              <StageCard
                stage={stage}
                route={route}
                progress={progress.stages.get(stage.id)!}
                isHere={here?.id === stage.id}
                isOpen={open.has(stage.id)}
                onFlip={() => flip(stage.id)}
                done={done}
                onToggle={onToggle}
              />
            </li>
            {route.fork?.after === stage.id && (
              <li key="fork">
                <ForkCard route={route} fork={route.fork} branch={branch} onBranch={chooseBranch} />
              </li>
            )}
          </Fragment>
        ))}
      </ol>
    </>
  )
}

function StageCard(props: {
  stage: RouteStage
  route: Route
  progress: StageProgress
  isHere: boolean
  isOpen: boolean
  onFlip: () => void
  done: ReadonlySet<string>
  onToggle: (key: string) => void
}) {
  const { stage, progress, isHere, isOpen, done, onToggle } = props
  const complete = progress.total > 0 && progress.done === progress.total
  const branchLabel = stage.branch ? props.route.branches.find((b) => b.id === stage.branch)?.label : null
  const topics = topicCount(stage)
  const cls = ['card', 'route-stage', isHere && 'route-stage--here', complete && 'route-stage--done', stage.optional && 'route-stage--optional']

  return (
    <section class={cls.filter(Boolean).join(' ')}>
      <button type="button" class="route-stage__head" aria-expanded={isOpen} onClick={props.onFlip}>
        <span class="route-stage__no" aria-hidden="true">
          {complete ? <IconCheck size={16} /> : stage.no}
        </span>
        <span class="route-stage__titles">
          <span class="route-stage__meta">
            {branchLabel ? `${branchLabel} · этап ${stage.no}` : `Этап ${stage.no}`} · {stage.weeks}
            {isHere && <span class="route-here">Вы здесь</span>}
          </span>
          <span class="route-stage__title">{stage.title}</span>
        </span>
        <IconChevronRight size={20} class="route-chevron" />
      </button>

      <p class="route-stage__what">{stage.what}</p>
      {progress.total > 0 && (
        <div class="route-stage__progress">
          <ProgressBar value={progress.pct} tone={complete ? 'pink' : 'blue'} />
          <span class="muted small tabular">
            {progress.done} из {progress.total}
          </span>
        </div>
      )}

      {isOpen && (
        <div class="route-stage__body">
          <dl class="route-facets">
            <Facet title="Зачем" text={stage.why} />
            <Facet title="Пример" text={stage.example} />
            <Facet title="Результат" text={stage.result} />
            <Facet title={props.route.trainer || 'Тренажёр'} text={stage.nar} tinted />
          </dl>

          {stage.milestones.length > 0 && (
            <>
              <h3 class="route-subhead">Вехи этапа</h3>
              <ul class="route-checks">
                {stage.milestones.map((m) => (
                  <li key={m.k}>
                    <CheckRow item={m} done={done.has(m.k)} onToggle={onToggle} milestone />
                  </li>
                ))}
              </ul>
            </>
          )}

          {topics > 0 && (
            <>
              <h3 class="route-subhead">Темы · {topics}</h3>
              <div class="route-groups">
                {stage.groups.map((group) => (
                  <TopicGroup key={group.title} title={group.title} note={group.note} items={group.items} done={done} onToggle={onToggle} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}

function Facet(props: { title: string; text: string; tinted?: boolean }) {
  if (!props.text) return null
  return (
    <div class={`route-facet${props.tinted ? ' route-facet--tinted' : ''}`}>
      <dt>{props.title}</dt>
      <dd>{props.text}</dd>
    </div>
  )
}

function TopicGroup(props: { title: string; note?: string; items: RouteItem[]; done: ReadonlySet<string>; onToggle: (key: string) => void }) {
  const [open, setOpen] = useState(false)
  const n = props.items.filter((item) => props.done.has(item.k)).length
  const full = n === props.items.length
  return (
    <div class={`route-group${open ? ' route-group--open' : ''}`}>
      <button type="button" class="route-group__head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span class="route-group__title">{props.title}</span>
        <span class={`route-group__count tabular${full ? ' route-group__count--full' : ''}`}>
          {n}/{props.items.length}
        </span>
        <IconChevronRight size={18} class="route-chevron" />
      </button>
      {open && (
        <>
          {props.note && <p class="hint route-group__note">{props.note}</p>}
          <ul class="route-checks route-checks--topics">
            {props.items.map((item) => (
              <li key={item.k}>
                <CheckRow item={item} done={props.done.has(item.k)} onToggle={props.onToggle} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function CheckRow(props: { item: RouteItem; done: boolean; onToggle: (key: string) => void; milestone?: boolean }) {
  const { item, done } = props
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      class={`route-check${done ? ' route-check--done' : ''}${props.milestone ? ' route-check--milestone' : ''}`}
      onClick={() => props.onToggle(item.k)}
    >
      <span class="route-check__box" aria-hidden="true">
        <IconCheck size={13} />
      </span>
      <span class="route-check__text">{item.t}</span>
    </button>
  )
}

function ForkCard(props: { route: Route; fork: RouteFork; branch: string; onBranch: (branch: string) => void }) {
  const { route, fork, branch } = props
  const [compare, setCompare] = useState(false)
  return (
    <section class="card route-fork">
      <p class="route-stage__meta">Развилка · {fork.weeks}</p>
      <h2 class="route-stage__title">{fork.title}</h2>
      <p class="route-stage__what">{fork.intro}</p>

      <div class="route-branches" role="radiogroup" aria-label="Направление">
        {route.branches.map((b) => (
          <button
            type="button"
            role="radio"
            aria-checked={b.id === branch}
            class={`route-branch${b.id === branch ? ' route-branch--active' : ''}`}
            onClick={() => props.onBranch(b.id)}
          >
            <span class="route-branch__label">
              {b.label}
              {b.id === route.defaultBranch && <span class="route-branch__rec">по умолчанию</span>}
            </span>
            <b>{b.name}</b>
            <span class="muted small">{b.hint}</span>
          </button>
        ))}
      </div>

      {fork.table.length > 0 && (
        <>
          <button type="button" class="btn btn--ghost btn--small route-fork__toggle" aria-expanded={compare} onClick={() => setCompare(!compare)}>
            {compare ? 'Свернуть' : 'Сравнить направления'}
          </button>
          {compare && (
            <>
              <div class="route-table">
                <table>
                  <thead>
                    <tr>
                      <th />
                      {route.branches.map((b) => (
                        <th>{b.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fork.table.map((row) => (
                      <tr>
                        <th>{row.label}</th>
                        {row.cells.map((cell) => (
                          <td>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {fork.how.length > 0 && (
                <ol class="route-how">
                  {fork.how.map((step) => (
                    <li>{step}</li>
                  ))}
                </ol>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}
