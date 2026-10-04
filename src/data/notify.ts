import type { PlannerDB } from '../db/db'
import type { NotifySettings } from '../db/types'
import { deviceLabel } from '../lib/device'
import { insert, remove } from './entities'

/** id записи настроек уведомлений (одна на аккаунт). */
export const NOTIFY_ID = 'notify'

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow'
  } catch {
    return 'Europe/Moscow'
  }
}

export function defaultNotify(): NotifySettings {
  return {
    morning: { enabled: true, time: '08:00' },
    evening: { enabled: true, time: '21:30' },
    habits: true,
    tasks: true,
    timezone: deviceTimezone(),
  }
}

/** Настройки с подставленными значениями по умолчанию (в записи могут быть не все поля). */
export function readNotify(value: unknown): NotifySettings {
  const base = defaultNotify()
  const saved = (value ?? {}) as Partial<NotifySettings>
  return { ...base, ...saved, morning: { ...base.morning, ...saved.morning }, evening: { ...base.evening, ...saved.evening } }
}

/** Сохранить настройки; часовой пояс берётся с текущего устройства. */
export function saveNotify(db: PlannerDB, value: NotifySettings) {
  return insert(db, 'settings', { value: { ...value, timezone: deviceTimezone() } }, NOTIFY_ID)
}

export async function pushSubId(endpoint: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)))
  return `push-${[...hash.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** Запомнить подписку этого устройства — после синхронизации облако начнёт слать на него напоминания. */
export async function registerDevice(db: PlannerDB, subscription: PushSubscription) {
  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('Браузер вернул неполную подписку')
  const id = await pushSubId(json.endpoint)
  await insert(
    db,
    'pushSubs',
    {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      device: deviceLabel(navigator.userAgent),
      createdAt: Date.now(),
    },
    id,
  )
  // Первое включение — сохраняем настройки по умолчанию с часовым поясом устройства.
  const settings = await db.settings.get(NOTIFY_ID)
  if (!settings || settings.deleted) await saveNotify(db, defaultNotify())
  return id
}

export async function unregisterDevice(db: PlannerDB, endpoint: string) {
  await remove(db, 'pushSubs', await pushSubId(endpoint))
}
