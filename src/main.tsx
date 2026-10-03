import { render } from 'preact'
import { App } from './app'
import './styles.css'

// Просим браузер не вычищать локальную базу при нехватке места.
navigator.storage?.persist?.().catch(() => {})

const root = document.getElementById('app')!

if (import.meta.env.VITE_DEMO === '1') {
  import('./demo').then(({ DemoApp }) => render(<DemoApp />, root))
} else {
  render(<App />, root)
}
