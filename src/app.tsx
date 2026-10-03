import { useEffect, useState } from 'preact/hooks'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { LoginScreen } from './screens/login'
import { NotConfiguredScreen } from './screens/not-configured'
import { SyncCheckScreen } from './screens/sync-check'

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
  return session ? <SyncCheckScreen client={client} session={session} /> : <LoginScreen client={client} />
}
