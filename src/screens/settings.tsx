import { useEffect, useState } from 'preact/hooks'
import { useApp } from '../app-context'
import { NOTIFY_ID, readNotify, registerDevice, saveNotify, unregisterDevice } from '../data/notify'
import { useRow, useRows } from '../data/use-data'
import type { NotifySettings } from '../db/types'
import { humanizeError } from '../lib/errors'
import { useSyncState } from '../lib/hooks'
import { currentSubscription, notificationPermission, pushSupport, subscribePush } from '../lib/push'
import { supabase } from '../supabase'
import { ScreenHeader, Switch, syncLabel } from '../ui/components'
import { formatBuildTime } from './not-configured'

export function SettingsScreen() {
  const { sync, email, signOut } = useApp()
  const state = useSyncState(sync)
  const label = syncLabel(state.status, state.pending)

  async function onSignOut() {
    if (!confirm('Выйти из аккаунта?\nДанные на этом устройстве будут удалены, в облаке всё сохранится — после входа они вернутся.')) return
    await signOut()
  }

  return (
    <>
      <ScreenHeader title="Настройки" />

      <NotificationsCard />

      <section class="card stack">
        <h2>Синхронизация</h2>
        <dl class="kv">
          <dt>Статус</dt>
          <dd class={`sync-text sync-text--${label.tone}`}>{label.text}</dd>
          <dt>Последняя</dt>
          <dd>
            {state.lastSyncedAt
              ? new Date(state.lastSyncedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })
              : '—'}
          </dd>
          <dt>Не отправлено</dt>
          <dd>{state.pending}</dd>
        </dl>
        {state.error && (
          <p class="error" role="alert">
            {state.error}
          </p>
        )}
        <p class="hint">
          Все изменения сначала сохраняются на устройстве и работают без интернета, а в облако уходят автоматически, как только есть связь.
        </p>
        <button class="btn btn--primary" onClick={() => void sync.sync()} disabled={state.status === 'syncing'}>
          Синхронизировать сейчас
        </button>
      </section>

      <section class="card stack">
        <h2>Аккаунт</h2>
        <p>{email ?? '—'}</p>
        <button class="btn btn--secondary" onClick={onSignOut}>
          Выйти
        </button>
      </section>

      <p class="hint center">Сборка: {formatBuildTime()}</p>
    </>
  )
}

/* ===================== Уведомления ===================== */

function NotificationsCard() {
  const { db, sync } = useApp()
  const support = pushSupport()
  const [subscription, setSubscription] = useState<PushSubscription | null | undefined>(undefined)
  const [permission, setPermission] = useState(notificationPermission())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const devices = useRows('pushSubs') ?? []
  const row = useRow('settings', NOTIFY_ID)
  const settings = readNotify(row?.value)

  useEffect(() => {
    currentSubscription()
      .then((sub) => setSubscription(sub))
      .catch(() => setSubscription(null))
  }, [])

  const enabledHere = Boolean(subscription && devices.some((d) => d.endpoint === subscription.endpoint))

  async function enable() {
    setBusy(true)
    setMessage(null)
    try {
      // Разрешение спрашивается первым делом — iOS разрешает это только сразу после нажатия.
      const sub = await subscribePush()
      await registerDevice(db, sub)
      setSubscription(sub)
      setPermission(notificationPermission())
      await sync.sync()
      setMessage({ tone: 'ok', text: 'Готово! Нажмите «Проверить» — должно прийти уведомление.' })
    } catch (error) {
      setPermission(notificationPermission())
      setMessage({ tone: 'error', text: humanizeError(error) })
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    if (!subscription) return
    setBusy(true)
    try {
      await unregisterDevice(db, subscription.endpoint)
      await subscription.unsubscribe().catch(() => {})
      setSubscription(null)
      setMessage(null)
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setBusy(true)
    setMessage(null)
    try {
      await sync.sync()
      if (!supabase) throw new Error('Облако не подключено')
      const { data, error } = await supabase.functions.invoke('notify', { body: { action: 'test', endpoint: subscription?.endpoint } })
      if (error) {
        const body = await (error as { context?: Response }).context?.json?.().catch(() => null)
        throw new Error(body?.error ?? error.message)
      }
      setMessage(
        data?.ok
          ? { tone: 'ok', text: 'Отправлено — уведомление придёт через пару секунд.' }
          : { tone: 'error', text: `Служба уведомлений ответила ошибкой: ${JSON.stringify(data?.results ?? data)}` },
      )
    } catch (error) {
      setMessage({ tone: 'error', text: humanizeError(error) })
    } finally {
      setBusy(false)
    }
  }

  const change = (patch: Partial<NotifySettings>) => void saveNotify(db, { ...settings, ...patch })

  return (
    <section class="card stack">
      <h2>Уведомления</h2>

      {support === 'ios-browser' && <p class="hint">На iPhone уведомления работают, только если открыть Планер с экрана «Домой», а не в Safari.</p>}
      {support === 'unsupported' && <p class="hint">Этот браузер не умеет показывать уведомления.</p>}
      {support === 'ok' && permission === 'denied' && (
        <p class="error">Уведомления для Планера запрещены. Разрешите их в настройках системы (iPhone: Настройки → Уведомления → Планер), затем вернитесь сюда.</p>
      )}

      {support === 'ok' && subscription !== undefined && (
        <div class="setting-row">
          <span>
            <b>На этом устройстве</b>
            <span class={`small ${enabledHere ? 'sync-text--ok' : 'muted'}`}>{enabledHere ? 'включены' : 'выключены'}</span>
          </span>
          {enabledHere ? (
            <span class="setting-row__actions">
              <button class="btn btn--secondary btn--small" onClick={test} disabled={busy}>
                Проверить
              </button>
              <button class="btn btn--ghost btn--small" onClick={disable} disabled={busy}>
                Выключить
              </button>
            </span>
          ) : (
            <button class="btn btn--primary btn--small" onClick={enable} disabled={busy || permission === 'denied'}>
              Включить
            </button>
          )}
        </div>
      )}

      {message && (
        <p class={message.tone === 'ok' ? 'sync-text--ok' : 'error'} role="status">
          {message.text}
        </p>
      )}

      {devices.length > 0 && <p class="hint">Получают уведомления: {devices.map((d) => d.device).join(', ')}.</p>}

      <div class="setting-list">
        <TimeSetting
          title="Утренний план"
          hint="Привычки и задачи на день, платежи сегодня и завтра"
          value={settings.morning}
          onChange={(morning) => change({ morning })}
        />
        <TimeSetting
          title="Вечерний итог"
          hint="Что ещё не отмечено — если всё сделано, не беспокоит"
          value={settings.evening}
          onChange={(evening) => change({ evening })}
        />
        <div class="setting-row">
          <span>
            <b>Напоминания привычек</b>
            <span class="muted small">Время задаётся в карточке привычки</span>
          </span>
          <Switch checked={settings.habits} onChange={(habits) => change({ habits })} label="Напоминания привычек" />
        </div>
        <div class="setting-row">
          <span>
            <b>Задачи со временем</b>
            <span class="muted small">В указанное у задачи время</span>
          </span>
          <Switch checked={settings.tasks} onChange={(tasks) => change({ tasks })} label="Напоминания задач" />
        </div>
        <div class="setting-row">
          <span>
            <b>Важные задачи — за час</b>
            <span class="muted small">Высокий приоритет: ещё одно напоминание за час до времени</span>
          </span>
          <Switch checked={settings.tasksEarly} onChange={(tasksEarly) => change({ tasksEarly })} label="Важные задачи за час" />
        </div>
        <TimeSetting
          title="Учёба"
          hint="Если сегодня ещё не занимались — с часами за неделю"
          value={settings.study}
          onChange={(study) => change({ study })}
        />
      </div>
      <p class="hint">Часовой пояс: {settings.timezone}. Настройки общие для всех устройств.</p>
    </section>
  )
}

function TimeSetting(props: { title: string; hint: string; value: { enabled: boolean; time: string }; onChange: (value: { enabled: boolean; time: string }) => void }) {
  return (
    <div class="setting-row">
      <span>
        <b>{props.title}</b>
        <span class="muted small">{props.hint}</span>
      </span>
      <span class="setting-row__actions">
        <input
          type="time"
          class="time-input"
          value={props.value.time}
          disabled={!props.value.enabled}
          aria-label={`${props.title}: время`}
          onChange={(e) => e.currentTarget.value && props.onChange({ ...props.value, time: e.currentTarget.value })}
        />
        <Switch checked={props.value.enabled} onChange={(enabled) => props.onChange({ ...props.value, enabled })} label={props.title} />
      </span>
    </div>
  )
}
