import { render } from 'preact'
import { App } from './app'
import './styles.css'

// Просим браузер не вычищать локальную базу при нехватке места.
navigator.storage?.persist?.().catch(() => {})

// Нажали на уведомление, когда приложение уже было открыто, — переходим в нужный раздел.
navigator.serviceWorker?.addEventListener('message', (event) => {
  const data = event.data as { type?: string; url?: string } | null
  if (data?.type === 'open' && data.url) location.hash = new URL(data.url).hash || '#/today'
})

const root = document.getElementById('app')!

if (import.meta.env.VITE_DEMO === '1') {
  import('./demo').then(({ DemoApp }) => render(<DemoApp />, root))
} else {
  render(<App />, root)
}
