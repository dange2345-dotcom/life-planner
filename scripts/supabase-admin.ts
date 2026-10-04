// Настройка облака Supabase через Management API — для Claude, с токеном владельца.
//
//   npm run supabase -- keys       ключи VAPID и секрет расписания (один раз) → private/notify-keys.env
//   npm run supabase -- secrets    выставить секреты функции notify
//   npm run supabase -- deploy     выложить функцию notify (supabase/functions/notify)
//   npm run supabase -- cron       секрет в Vault + расписание раз в минуту (supabase/notify.sql)
//   npm run supabase -- run        вызвать функцию как расписание прямо сейчас (проверка)
//   npm run supabase -- sql "select …"   выполнить SQL
//   npm run supabase -- logs [минут]     журнал функции notify
//
// Токен: SUPABASE_ACCESS_TOKEN=sbp_… в life-planner/.env (Supabase → Account → Access Tokens).
// Ни токен, ни ключи не выводить в консоль и не коммитить.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { SUPABASE_URL } from '../src/config'

const root = new URL('../', import.meta.url)
const KEYS_FILE = new URL('private/notify-keys.env', root)
const PROJECT = new URL(SUPABASE_URL).hostname.split('.')[0]
const API = `https://api.supabase.com/v1/projects/${PROJECT}`
const FUNCTION_FILES = ['index.ts', 'reminders.ts', 'webpush.ts']

function fail(message: string): never {
  console.error(`✖ ${message}`)
  process.exit(1)
}

for (const file of [new URL('.env', root), KEYS_FILE]) {
  if (existsSync(file)) process.loadEnvFile(file)
}

function need(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) fail(`Нет ${name} (life-planner/.env или private/notify-keys.env)`)
  return value
}

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const token = need('SUPABASE_ACCESS_TOKEN')
  if (!token.startsWith('sbp_')) fail('SUPABASE_ACCESS_TOKEN должен начинаться с sbp_')
  const isForm = body instanceof FormData
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) fail(`${method} ${path}: ${response.status} ${text.slice(0, 500)}`)
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return text
  }
}

const sql = (query: string) => api('POST', '/database/query', { query })

const [command, arg] = process.argv.slice(2)

switch (command) {
  case 'keys': {
    if (existsSync(KEYS_FILE)) {
      console.log('Ключи уже есть: private/notify-keys.env (новые не создаю — иначе устройства придётся подписывать заново)')
      break
    }
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const publicKey = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url')
    const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey)
    mkdirSync(new URL('private/', root), { recursive: true })
    writeFileSync(
      KEYS_FILE,
      [
        '# Ключи пуш-уведомлений (создал scripts/supabase-admin.ts). Не коммитить, не выводить.',
        '# Открытый ключ VAPID также прописан в src/config.ts.',
        `VAPID_PUBLIC_KEY=${publicKey}`,
        `VAPID_PRIVATE_KEY=${d}`,
        `NOTIFY_CRON_SECRET=${randomBytes(24).toString('hex')}`,
        '',
      ].join('\n'),
    )
    console.log(`✔ Ключи сохранены в private/notify-keys.env\nОткрытый ключ VAPID (для src/config.ts): ${publicKey}`)
    break
  }

  case 'secrets': {
    await api('POST', '/secrets', [
      { name: 'PLANNER_SECRET_KEY', value: need('SUPABASE_SECRET_KEY') },
      { name: 'NOTIFY_CRON_SECRET', value: need('NOTIFY_CRON_SECRET') },
      { name: 'VAPID_PUBLIC_KEY', value: need('VAPID_PUBLIC_KEY') },
      { name: 'VAPID_PRIVATE_KEY', value: need('VAPID_PRIVATE_KEY') },
    ])
    console.log('✔ Секреты функции выставлены')
    break
  }

  case 'deploy': {
    const form = new FormData()
    form.append('metadata', JSON.stringify({ name: 'notify', entrypoint_path: 'index.ts', verify_jwt: false }))
    for (const name of FUNCTION_FILES) {
      const content = readFileSync(new URL(`supabase/functions/notify/${name}`, root))
      form.append('file', new Blob([content], { type: 'application/typescript' }), name)
    }
    const result = await api('POST', '/functions/deploy?slug=notify', form)
    console.log(`✔ Функция выложена: notify, версия ${result?.version ?? '?'}, статус ${result?.status ?? '?'}`)
    break
  }

  case 'cron': {
    const secret = need('NOTIFY_CRON_SECRET')
    if (!/^[0-9a-f]+$/.test(secret)) fail('NOTIFY_CRON_SECRET — только hex')
    await sql(`
      do $$
      begin
        if exists (select 1 from vault.secrets where name = 'notify_cron_secret') then
          perform vault.update_secret((select id from vault.secrets where name = 'notify_cron_secret'), '${secret}');
        else
          perform vault.create_secret('${secret}', 'notify_cron_secret');
        end if;
      end $$;`)
    await sql(readFileSync(new URL('supabase/notify.sql', root), 'utf8'))
    const jobs = await sql(`select jobname, schedule, active from cron.job where jobname like 'planner-%' order by jobname`)
    console.log('✔ Расписание:', JSON.stringify(jobs))
    break
  }

  case 'run': {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': need('NOTIFY_CRON_SECRET') },
      body: JSON.stringify({ at: arg ?? new Date().toISOString() }),
    })
    console.log(response.status, await response.text())
    break
  }

  case 'sql': {
    if (!arg) fail('Нужен текст запроса')
    console.log(JSON.stringify(await sql(arg), null, 1))
    break
  }

  case 'logs': {
    const minutes = Number(arg ?? 30)
    const end = new Date()
    const start = new Date(end.getTime() - minutes * 60_000)
    const query = `select timestamp, event_message, metadata.level from function_logs
      cross join unnest(metadata) as metadata
      order by timestamp desc limit 100`
    const params = new URLSearchParams({ sql: query, iso_timestamp_start: start.toISOString(), iso_timestamp_end: end.toISOString() })
    const result = await api('GET', `/analytics/endpoints/logs.all?${params}`)
    const rows = (result?.result ?? []) as { timestamp: number; event_message: string; level?: string }[]
    if (result?.error) console.log(JSON.stringify(result.error))
    for (const row of rows.reverse()) {
      console.log(new Date(row.timestamp / 1000).toLocaleTimeString('ru-RU'), row.level ?? '', row.event_message.trim().slice(0, 600))
    }
    if (!rows.length) console.log(`Записей за ${minutes} мин нет`)
    break
  }

  default:
    fail('Команды: keys, secrets, deploy, cron, run, sql, logs')
}
