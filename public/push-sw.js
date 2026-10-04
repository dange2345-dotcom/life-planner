// Пуш-уведомления Планера: подключается в service worker через workbox.importScripts (vite.config.ts).
// Сообщение от функции Supabase notify: { title, body, tag?, url? } (url — относительно приложения, например «#/today»).

self.addEventListener('push', (event) => {
  let message = {}
  try {
    message = event.data ? event.data.json() : {}
  } catch {
    message = { body: event.data ? event.data.text() : '' }
  }
  // iOS отзывает подписку, если пуш пришёл, а уведомление не показано, — поэтому показываем всегда.
  event.waitUntil(
    self.registration.showNotification(message.title || 'Планер', {
      body: message.body || '',
      tag: message.tag,
      icon: 'pwa-192x192.png',
      badge: 'pwa-64x64.png',
      data: { url: message.url || '#/today' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '#/today', self.registration.scope).href
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const client = windows[0]
      if (client) {
        await client.focus()
        client.postMessage({ type: 'open', url })
        return
      }
      await self.clients.openWindow(url)
    })(),
  )
})
