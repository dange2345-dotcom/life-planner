import { useState } from 'preact/hooks'
import type { SupabaseClient } from '@supabase/supabase-js'
import { humanizeError } from '../lib/errors'

export function LoginScreen({ client }: { client: SupabaseClient }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: Event) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { error } = await client.auth.signInWithPassword({ email: email.trim(), password })
      if (error) setError(humanizeError(error))
    } catch (err) {
      setError(humanizeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main class="screen screen--center">
      <form class="card stack" onSubmit={onSubmit}>
        <img class="app-icon" src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
        <h1>Планер</h1>
        <p class="muted">Войдите, чтобы данные синхронизировались между телефоном и компьютером.</p>

        <label class="field">
          <span>Почта</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellcheck={false}
            required
            value={email}
            onInput={(e) => setEmail(e.currentTarget.value)}
          />
        </label>

        <label class="field">
          <span>Пароль</span>
          <input
            type="password"
            autoComplete="current-password"
            enterKeyHint="go"
            required
            value={password}
            onInput={(e) => setPassword(e.currentTarget.value)}
          />
        </label>

        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}

        <button class="btn btn--primary" type="submit" disabled={busy}>
          {busy ? 'Входим…' : 'Войти'}
        </button>
      </form>
    </main>
  )
}
