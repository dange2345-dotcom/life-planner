import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { deviceLabel } from '../lib/device'
import { humanizeError } from '../lib/errors'
import { useOnline } from '../lib/use-online'
import { formatBuildTime } from './not-configured'

// Этап 0: проверка цепочки «iPhone ⇄ Supabase ⇄ Windows» на тестовых записях kind = 'ping'.
// На этапе 1 этот экран заменяется настоящим приложением со слоем синхронизации.

type Ping = {
  id: string
  data: { device?: string; text?: string }
  server_updated_at: string
}

const REFRESH_MS = 10_000

export function SyncCheckScreen({ client, session }: { client: SupabaseClient; session: Session }) {
  const device = useMemo(() => deviceLabel(navigator.userAgent), [])
  const online = useOnline()
  const [pings, setPings] = useState<Ping[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncedAt, setSyncedAt] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await client
        .from('records')
        .select('id, data, server_updated_at')
        .eq('kind', 'ping')
        .eq('deleted', false)
        .order('server_updated_at', { ascending: false })
        .limit(20)
      if (error) throw error
      setPings(data as Ping[])
      setSyncedAt(new Date())
      setError(null)
    } catch (err) {
      setError(humanizeError(err))
    } finally {
      setLoading(false)
    }
  }, [client])

  useEffect(() => {
    load()
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    const timer = setInterval(onVisible, REFRESH_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', load)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', load)
    }
  }, [load])

  async function sendPing() {
    setSending(true)
    try {
      const { error } = await client.from('records').insert({
        id: crypto.randomUUID(),
        kind: 'ping',
        data: { device, text: `Отметка с ${device}` },
        updated_at: Date.now(),
      })
      if (error) throw error
      await load()
    } catch (err) {
      setError(humanizeError(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <main class="screen">
      <header class="top">
        <h1>Проверка синхронизации</h1>
        <p class="muted">
          Это устройство: <b>{device}</b> · {session.user.email}
        </p>
      </header>

      <section class="card stack">
        <SyncStatus online={online} loading={loading} error={error} syncedAt={syncedAt} />
        <button class="btn btn--primary" onClick={sendPing} disabled={sending || !online}>
          {sending ? 'Отправляю…' : `Отметиться с ${device}`}
        </button>
        <p class="hint">
          Нажмите здесь, а затем откройте приложение на другом устройстве: отметка должна появиться в списке
          в течение ~10 секунд.
        </p>
      </section>

      <section class="card">
        <h2>Последние отметки</h2>
        {pings.length === 0 ? (
          <p class="muted">Пока пусто</p>
        ) : (
          <ul class="list">
            {pings.map((ping) => (
              <li key={ping.id} class="list__row">
                <span>{ping.data.text ?? '—'}</span>
                <span class="muted tabular">{formatTime(ping.server_updated_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer class="foot">
        <span class="hint">Сборка: {formatBuildTime()}</span>
        <button class="btn btn--ghost" onClick={() => client.auth.signOut()}>
          Выйти
        </button>
      </footer>
    </main>
  )
}

function SyncStatus(props: { online: boolean; loading: boolean; error: string | null; syncedAt: Date | null }) {
  if (!props.online) return <p class="status status--warn">Нет сети</p>
  if (props.error) return <p class="status status--error">{props.error}</p>
  if (props.loading && !props.syncedAt) return <p class="status">Синхронизация…</p>
  if (props.syncedAt) {
    return <p class="status status--ok">Синхронизировано · {formatTime(props.syncedAt.toISOString())}</p>
  }
  return <p class="status">—</p>
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
