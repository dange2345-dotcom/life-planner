import { render } from 'preact'
import { App } from './app'
import './styles.css'

// Просим браузер не вычищать локальную базу при нехватке места.
navigator.storage?.persist?.().catch(() => {})

render(<App />, document.getElementById('app')!)
