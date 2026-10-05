// Функция Supabase «notify» — отправляет пуш-уведомления Планера.
//
// 1) Раз в минуту её вызывает расписание (pg_cron → pg_net, см. supabase/notify.sql) с заголовком x-cron-secret:
//    функция смотрит настройки и данные владельца и шлёт напоминания, время которых наступило.
// 2) Приложение вызывает её с токеном вошедшего пользователя ({ action: 'test' }) — проверочный пуш на его устройства.
//
// Секреты функции (выставляет scripts/supabase-admin.ts): PLANNER_SECRET_KEY, NOTIFY_CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.
// Выкладка: npm run supabase -- deploy

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  addDays,
  anythingDue,
  DEFAULT_SETTINGS,
  dueMessages,
  localNow,
  readSettings,
  studyDue,
  weekday,
  type HabitRec,
  type LocalNow,
  type NotifySettings,
  type PaymentRec,
  type StudyData,
  type TaskRec,
} from './reminders.ts'
import { sendPush, type PushMessage, type PushTarget, type Vapid } from './webpush.ts'

const env = (name: string) => {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Не задан секрет ${name}`)
  return value
}

const db = createClient(env('SUPABASE_URL'), env('PLANNER_SECRET_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
})
const CRON_SECRET = env('NOTIFY_CRON_SECRET')
const vapid: Vapid = {
  publicKey: env('VAPID_PUBLIC_KEY'),
  privateKey: env('VAPID_PRIVATE_KEY'),
  subject: 'https://dange2345-dotcom.github.io/life-planner/',
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

interface Row<T> {
  id: string
  user_id: string
  data: T
  updated_at: number
}

interface SubData {
  endpoint: string
  keys: PushTarget['keys']
  device: string
}

/** Записи вида kind (без удалённых), постранично — сервер отдаёт не больше 1000 строк за запрос. */
async function rows<T>(kind: string, build?: (q: any) => any): Promise<Row<T>[]> {
  const all: Row<T>[] = []
  for (let from = 0; ; from += 1000) {
    let query = db.from('records').select('id, user_id, data, updated_at').eq('kind', kind).eq('deleted', false)
    if (build) query = build(query)
    const { data, error } = await query.order('id').range(from, from + 999)
    if (error) throw new Error(`records(${kind}): ${error.message}`)
    all.push(...(data as Row<T>[]))
    if (data.length < 1000) return all
  }
}

/** Отправить сообщения на все устройства пользователя; недействующие подписки помечаются удалёнными. */
async function deliver(subs: Row<SubData>[], messages: PushMessage[]) {
  const results: { device: string; status: number; error?: string }[] = []
  await Promise.all(
    subs.map(async (sub) => {
      for (const message of messages) {
        const result = await sendPush({ endpoint: sub.data.endpoint, keys: sub.data.keys }, message, vapid).catch((error) => ({
          ok: false,
          status: 0,
          gone: false,
          error: String(error),
        }))
        results.push({ device: sub.data.device, status: result.status, error: result.error })
        if (result.gone) {
          // Время изменения строго больше прошлого — иначе триггер отбросит правку как устаревшую.
          await db
            .from('records')
            .update({ deleted: true, updated_at: Math.max(Date.now(), sub.updated_at + 1) })
            .eq('id', sub.id)
          break
        }
      }
    }),
  )
  return results
}

// Учёба — те же id, что в приложении (src/domain/route.ts, src/domain/study.ts).
const ROUTE_ID = 'main'
const ROUTE_SETTINGS_ID = `route:${ROUTE_ID}`
const STUDY_TIMER_ID = 'study-timer'
const DEFAULT_WEEKLY_HOURS = 18

/** Часы учёбы за текущую неделю; null — маршрута у пользователя нет. */
async function studyData(userId: string, now: LocalNow): Promise<StudyData | null> {
  const { data: route, error } = await db
    .from('records')
    .select('id')
    .eq('kind', 'route')
    .eq('id', ROUTE_ID)
    .eq('user_id', userId)
    .eq('deleted', false)
    .maybeSingle()
  if (error) throw new Error(`records(route): ${error.message}`)
  if (!route) return null

  const monday = addDays(now.date, 1 - weekday(now.date))
  const sunday = addDays(monday, 6)
  const sessions = (
    await rows<{ routeId: string; date: string; minutes: number }>('studySession', (q) => q.eq('user_id', userId).gte('data->>date', monday))
  ).filter((s) => s.data.routeId === ROUTE_ID && s.data.date <= sunday)
  const settings = await rows<{ value: { weeklyHours?: number; startedAt?: number } }>('setting', (q) =>
    q.eq('user_id', userId).in('id', [ROUTE_SETTINGS_ID, STUDY_TIMER_ID]),
  )
  const weeklyHours = Number(settings.find((s) => s.id === ROUTE_SETTINGS_ID)?.data.value?.weeklyHours)
  return {
    weekMinutes: sessions.reduce((sum, s) => sum + (Number(s.data.minutes) || 0), 0),
    todayMinutes: sessions.filter((s) => s.data.date === now.date).reduce((sum, s) => sum + (Number(s.data.minutes) || 0), 0),
    targetHours: weeklyHours > 0 ? weeklyHours : DEFAULT_WEEKLY_HOURS,
    timerRunning: settings.some((s) => s.id === STUDY_TIMER_ID),
  }
}

async function runScheduled(at: Date) {
  const subs = await rows<SubData>('pushSub')
  const byUser = new Map<string, Row<SubData>[]>()
  for (const sub of subs) byUser.set(sub.user_id, [...(byUser.get(sub.user_id) ?? []), sub])
  const report: unknown[] = []

  for (const [userId, userSubs] of byUser) {
    const forUser = (q: any) => q.eq('user_id', userId)
    const settingsRow = (await rows<{ value: Partial<NotifySettings> }>('setting', (q) => forUser(q).eq('id', 'notify')))[0]
    const settings: NotifySettings = readSettings(settingsRow?.data.value)
    const now = localNow(at, settings.timezone || DEFAULT_SETTINGS.timezone)

    const habits = (await rows<HabitRec>('habit', forUser)).map((r) => ({ ...r.data, id: r.id }))
    const tasks = (await rows<TaskRec>('task', (q) => forUser(q).is('data->>doneAt', null))).map((r) => ({ ...r.data, id: r.id }))
    if (!anythingDue(settings, habits, tasks, now)) continue

    // Отметки — с начала месяца (для «N раз в месяц»), оплаты — за вчера и сегодня.
    const since = addDays(now.date, -32)
    const logs = await rows<{ habitId: string; date: string }>('habitLog', (q) => forUser(q).gte('data->>date', since))
    const payments = (await rows<PaymentRec>('payment', forUser)).map((r) => ({ ...r.data, id: r.id }))
    const paid = await rows<unknown>('transaction', (q) => forUser(q).like('id', 'pay:%').gte('data->>dueDate', since))

    const messages = dueMessages(
      {
        settings,
        habits,
        tasks,
        payments,
        logs: new Set(logs.map((r) => `${r.data.habitId}:${r.data.date}`)),
        paid: new Set(paid.map((r) => r.id)),
        study: studyDue(settings, now) ? await studyData(userId, now) : null,
      },
      now,
    )
    if (messages.length === 0) continue
    const results = await deliver(userSubs, messages)
    report.push({ now, messages: messages.map((m) => m.title), results })
  }

  if (report.length) console.log(JSON.stringify(report))
  return { ok: true, sent: report }
}

async function runTest(token: string, endpoint: string | undefined) {
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) return json({ error: 'Нужно войти в приложение' }, 401)
  const subs = (await rows<SubData>('pushSub', (q) => q.eq('user_id', data.user.id))).filter(
    (sub) => !endpoint || sub.data.endpoint === endpoint,
  )
  if (subs.length === 0) return json({ error: 'Подписка этого устройства ещё не дошла до облака — попробуйте через минуту' }, 404)
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })
  const results = await deliver(subs, [{ title: 'Планер', body: `Уведомления работают ✅ (${time})`, tag: 'test', url: '#/settings' }])
  console.log(JSON.stringify({ test: results }))
  return json({ ok: results.every((r) => r.status >= 200 && r.status < 300), results })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    const body = await req.json().catch(() => ({}))
    if (req.headers.get('x-cron-secret') === CRON_SECRET) {
      return json(await runScheduled(body.at ? new Date(body.at) : new Date()))
    }
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!token || body.action !== 'test') return json({ error: 'unauthorized' }, 401)
    return await runTest(token, body.endpoint)
  } catch (error) {
    console.error(error)
    return json({ error: String(error instanceof Error ? error.message : error) }, 500)
  }
})
