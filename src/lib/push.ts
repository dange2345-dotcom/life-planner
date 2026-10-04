import { VAPID_PUBLIC_KEY } from '../config'

// Подписка этого устройства на пуш-уведомления (Web Push). На iPhone работает только в приложении,
// установленном на экран «Домой» (iOS 16.4+), и разрешение можно спросить только по нажатию кнопки.

export type PushSupport = 'ok' | 'ios-browser' | 'unsupported'

export function pushSupport(): PushSupport {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  if (ios && !standalone) return 'ios-browser'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  return 'ok'
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  // Без service worker (режим разработки) ready не наступает никогда.
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000))])
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null
  const reg = await registration()
  return reg ? reg.pushManager.getSubscription() : null
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4)
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.length) return false
  const view = new Uint8Array(a)
  return view.every((byte, i) => byte === b[i])
}

/** Спросить разрешение и подписаться. Вызывать прямо из обработчика нажатия. */
export async function subscribePush(): Promise<PushSubscription> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(permission === 'denied' ? 'Уведомления запрещены — включите их в настройках системы для Планера' : 'Разрешение не дано')
  }
  const reg = await registration()
  if (!reg) throw new Error('Приложение ещё не готово к уведомлениям — закройте и откройте его снова')
  const key = keyBytes(VAPID_PUBLIC_KEY)
  const existing = await reg.pushManager.getSubscription()
  if (existing) {
    if (sameKey(existing.options.applicationServerKey, key)) return existing
    await existing.unsubscribe() // подписка со старым ключом сервера — пересоздаём
  }
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return 'Notification' in window ? Notification.permission : 'unsupported'
}
