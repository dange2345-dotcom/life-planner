export function NotConfiguredScreen() {
  return (
    <main class="screen screen--center">
      <section class="card stack">
        <img class="app-icon" src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
        <h1>Планер</h1>
        <p class="muted">
          Приложение установлено и работает, но облако для синхронизации ещё не подключено.
        </p>
        <p class="hint">Сборка: {formatBuildTime()}</p>
      </section>
    </main>
  )
}

export function formatBuildTime(): string {
  return new Date(__BUILD_TIME__).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
