import type { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { useApp } from '../app-context'
import { useSyncState } from '../lib/hooks'
import { IconCheck, IconChevronLeft, IconChevronRight, IconClose, IconSettings } from './icons'

/** Кольцо-«метр»: заливка — насыщенный голубой, дорожка — светлая ступень того же цвета. */
export function Ring(props: { value: number | null; size?: number; stroke?: number; children?: ComponentChildren }) {
  const { value, size = 72, stroke = 8 } = props
  const radius = (size - stroke) / 2
  const length = 2 * Math.PI * radius
  const filled = Math.max(0, Math.min(100, value ?? 0))
  return (
    <div class="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle class="ring__track" cx={size / 2} cy={size / 2} r={radius} stroke-width={stroke} />
        {filled > 0 && (
          <circle
            class="ring__value"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke-width={stroke}
            stroke-dasharray={length}
            stroke-dashoffset={length * (1 - filled / 100)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <div class="ring__label">{props.children ?? (value === null ? '—' : `${value}%`)}</div>
    </div>
  )
}

export function ProgressBar({ value, tone = 'blue' }: { value: number | null; tone?: 'blue' | 'pink' }) {
  const filled = Math.max(0, Math.min(100, value ?? 0))
  return (
    <div class={`bar bar--${tone}`} role="progressbar" aria-valuenow={filled} aria-valuemin={0} aria-valuemax={100}>
      <div class="bar__fill" style={{ width: `${filled}%` }} />
    </div>
  )
}

export function Segmented<T extends string>(props: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div class="segmented" role="radiogroup" aria-label={props.label}>
      {props.options.map((option) => (
        <button
          type="button"
          role="radio"
          aria-checked={option.value === props.value}
          class={`segmented__item${option.value === props.value ? ' segmented__item--active' : ''}`}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Панель поверх экрана: на телефоне выезжает снизу, на компьютере — по центру. */
export function Sheet(props: { title: string; onClose: () => void; children: ComponentChildren }) {
  const panel = useRef<HTMLDivElement>(null)
  // Через ref, чтобы эффект не перезапускался на каждой перерисовке (иначе фокус уходил бы из полей ввода).
  const onClose = useRef(props.onClose)
  onClose.current = props.onClose

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose.current()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [])

  return (
    <div class="sheet-backdrop" onClick={(event) => event.target === event.currentTarget && props.onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={props.title} tabIndex={-1} ref={panel}>
        <div class="sheet__head">
          <h2>{props.title}</h2>
          <button type="button" class="icon-btn" onClick={props.onClose} aria-label="Закрыть">
            <IconClose size={20} />
          </button>
        </div>
        <div class="sheet__body">{props.children}</div>
      </div>
    </div>
  )
}

/** Заголовок экрана: крупное название + индикатор синхронизации и настройки справа. */
export function ScreenHeader(props: { title: string; subtitle?: string; action?: ComponentChildren }) {
  return (
    <header class="screen-head">
      <div class="screen-head__text">
        <h1>{props.title}</h1>
        {props.subtitle && <p class="muted">{props.subtitle}</p>}
      </div>
      <div class="screen-head__actions">
        {props.action}
        <SyncPill />
        <a class="icon-btn mobile-only" href="#/settings" aria-label="Настройки">
          <IconSettings size={22} />
        </a>
      </div>
    </header>
  )
}

export function SyncPill() {
  const { sync } = useApp()
  const state = useSyncState(sync)
  const { tone, text } = syncLabel(state.status, state.pending)
  return (
    <button type="button" class={`sync-pill sync-pill--${tone}`} onClick={() => void sync.sync()} title="Синхронизировать сейчас">
      <span class="sync-pill__dot" aria-hidden="true" />
      <span class="sync-pill__text">{text}</span>
    </button>
  )
}

export function syncLabel(status: string, pending: number): { tone: 'ok' | 'busy' | 'warn' | 'error'; text: string } {
  switch (status) {
    case 'syncing':
      return { tone: 'busy', text: 'Синхронизация…' }
    case 'offline':
      return { tone: 'warn', text: pending ? `Нет сети · ${pending}` : 'Нет сети' }
    case 'error':
      return { tone: 'error', text: 'Ошибка синхр.' }
    default:
      return pending ? { tone: 'busy', text: 'Сохраняю…' } : { tone: 'ok', text: 'Синхронизировано' }
  }
}

/** Выключатель (как в настройках iPhone). */
export function Switch(props: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      class={`switch${props.checked ? ' switch--on' : ''}`}
      onClick={() => props.onChange(!props.checked)}
    >
      <span class="switch__thumb" />
    </button>
  )
}

/** ‹ Период › и «Сегодня», если ушли от текущего. */
export function PeriodNav(props: { title: string; onShift: (direction: -1 | 1) => void; onToday?: () => void; isCurrent: boolean }) {
  return (
    <div class="period-nav">
      <button class="icon-btn" onClick={() => props.onShift(-1)} aria-label="Назад">
        <IconChevronLeft size={20} />
      </button>
      <span class="period-nav__title">{props.title}</span>
      <button class="icon-btn" onClick={() => props.onShift(1)} aria-label="Вперёд">
        <IconChevronRight size={20} />
      </button>
      {!props.isCurrent && props.onToday && (
        <button class="btn btn--ghost btn--small" onClick={props.onToday}>
          Сегодня
        </button>
      )}
    </div>
  )
}

/** Круглая галочка «сделано» для задач и платежей. */
export function CheckButton(props: { done: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" class={`check-btn${props.done ? ' check-btn--done' : ''}`} aria-pressed={props.done} aria-label={props.label} onClick={props.onClick}>
      <IconCheck size={15} />
    </button>
  )
}

export function EmptyState(props: { title: string; text?: string; children?: ComponentChildren }) {
  return (
    <section class="card empty">
      <h2>{props.title}</h2>
      {props.text && <p class="muted">{props.text}</p>}
      {props.children}
    </section>
  )
}
