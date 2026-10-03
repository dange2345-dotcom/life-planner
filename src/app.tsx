import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { AppContext, type AppContextValue } from './app-context'
import { clearAll, createDb } from './db/db'
import { supabase } from './supabase'
import { createSyncEngine } from './sync/engine'
import { supabaseRemote } from './sync/remote'
import { LoginScreen } from './screens/login'
import { NotConfiguredScreen } from './screens/not-configured'
import { Shell } from './screens/shell'

const db = createDb('planner')

export function App() {
  return supabase ? <AuthGate client={supabase} /> : <NotConfiguredScreen />
}

function AuthGate({ client }: { client: SupabaseClient }) {
  // undefined — ещё не знаем (читаем сохранённую сессию), null — не вошли.
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    client.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = client.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [client])

  if (session === undefined) return null
  return session ? <Planner client={client} session={session} /> : <LoginScreen client={client} />
}

function Planner({ client, session }: { client: SupabaseClient; session: Session }) {
  const engine = useMemo(() => createSyncEngine(db, supabaseRemote(client)), [client])
  const stop = useRef<(() => void) | null>(null)
  const [ready, setReady] = useState(false)
  const userId = session.user.id

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // На устройство вошёл другой аккаунт — чужие локальные данные стираем.
      const owner = await db.meta.get('userId')
      if (owner && owner.value !== userId) await clearAll(db)
      await db.meta.put({ key: 'userId', value: userId })
      if (cancelled) return
      setReady(true)
      stop.current = engine.start()
    })()
    return () => {
      cancelled = true
      stop.current?.()
      stop.current = null
    }
  }, [engine, userId])

  const context = useMemo<AppContextValue>(
    () => ({
      db,
      sync: engine,
      email: session.user.email ?? null,
      async signOut() {
        await engine.sync()
        const pending = engine.getState().pending
        if (pending > 0 && !confirm(`${pending} изм. ещё не отправлено в облако (нет связи) и пропадёт. Всё равно выйти?`)) return
        stop.current?.()
        stop.current = null
        await clearAll(db)
        await client.auth.signOut()
      },
    }),
    [engine, client, session.user.email],
  )

  if (!ready) return null
  return (
    <AppContext.Provider value={context}>
      <Shell />
    </AppContext.Provider>
  )
}
