import { useApp } from '../app-context'
import { useSyncState } from '../lib/hooks'
import { ScreenHeader, syncLabel } from '../ui/components'
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
