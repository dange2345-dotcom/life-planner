import { SYNCED_TABLES, syncedTable, type PlannerDB } from '../db/db'
import { onLocalChange } from '../db/changes'
import type { SyncMeta } from '../db/types'
import { humanizeError, isNetworkError } from '../lib/errors'
import { fromRemote, serverTime, shouldApplyRemote, toRemote } from './convert'
import type { Remote, RemoteRow } from './remote'

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error'

export interface SyncState {
  status: SyncStatus
  lastSyncedAt: number | null
  error: string | null
  /** Сколько изменений ещё не отправлено в облако. */
  pending: number
}

export interface SyncEngine {
  getState(): SyncState
  subscribe(listener: (state: SyncState) => void): () => void
  /** Синхронизировать сейчас: отправить локальные изменения, затем забрать чужие. */
  sync(): Promise<void>
  /** Синхронизировать чуть позже (отложенно), чтобы пачка быстрых правок ушла одним запросом. */
  schedule(): void
  /** Подписаться на события браузера (сеть, возврат в окно, таймер). Возвращает функцию отписки. */
  start(): () => void
}

const PUSH_BATCH = 500
const PULL_PAGE = 1000
/** Перекрытие при скачивании: транзакция с более ранним временем могла закоммититься позже — перечитываем последнюю минуту. */
const PULL_OVERLAP_MICROS = 60_000_000
const DEBOUNCE_MS = 2_000
const INTERVAL_MS = 60_000
const CURSOR_KEY = 'pullCursor'
const KINDS_KEY = 'pullKinds'

const tableByKind = new Map<string, (typeof SYNCED_TABLES)[number]['table']>(
  SYNCED_TABLES.map(({ table, kind }) => [kind, table]),
)

export function createSyncEngine(db: PlannerDB, remote: Remote): SyncEngine {
  let state: SyncState = { status: 'idle', lastSyncedAt: null, error: null, pending: 0 }
  const listeners = new Set<(state: SyncState) => void>()
  let running: Promise<void> | null = null
  let rerun = false
  let debounce: ReturnType<typeof setTimeout> | undefined

  function setState(patch: Partial<SyncState>) {
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener(state))
  }

  async function countPending(): Promise<number> {
    const counts = await Promise.all(
      SYNCED_TABLES.map(({ table }) => syncedTable(db, table).where('dirty').equals(1).count()),
    )
    return counts.reduce((sum, n) => sum + n, 0)
  }

  async function push() {
    for (const { table, kind } of SYNCED_TABLES) {
      const store = syncedTable(db, table)
      const dirty = await store.where('dirty').equals(1).toArray()
      for (let i = 0; i < dirty.length; i += PUSH_BATCH) {
        const batch = dirty.slice(i, i + PUSH_BATCH)
        await remote.upsert(batch.map((entity) => toRemote(kind, entity)))
        // Снимаем флаг только если запись не успели снова изменить, пока шла отправка.
        await db.transaction('rw', store, async () => {
          for (const sent of batch) {
            const current = await store.get(sent.id)
            if (current && current.updatedAt === sent.updatedAt) await store.update(sent.id, { dirty: 0 })
          }
        })
      }
    }
  }

  async function applyRemote(rows: RemoteRow[]) {
    const tables = SYNCED_TABLES.map(({ table }) => syncedTable(db, table))
    await db.transaction('rw', tables, async () => {
      for (const row of rows) {
        const tableName = tableByKind.get(row.kind)
        if (!tableName) continue // чужой/служебный kind (например, тестовый 'ping') — пропускаем
        const store = syncedTable(db, tableName)
        const local = await store.get(row.id)
        if (shouldApplyRemote(local, row)) await store.put(fromRemote(row) as SyncMeta)
      }
    })
  }

  async function pull() {
    // Если в этой версии приложения появились новые виды записей (новый раздел), скачиваем облако заново целиком:
    // записи этих видов могли прийти раньше, когда старая версия их пропускала, а курсор уже ушёл вперёд.
    const kinds = SYNCED_TABLES.map(({ kind }) => kind).join(',')
    const sameKinds = (await db.meta.get(KINDS_KEY))?.value === kinds
    const cursor = sameKinds ? (((await db.meta.get(CURSOR_KEY))?.value as string | undefined) ?? null) : null
    let since = cursor ? overlapSince(cursor) : null
    let newest = cursor

    for (;;) {
      const rows = await remote.pullSince(since, PULL_PAGE)
      await applyRemote(rows)
      for (const row of rows) {
        if (!newest || serverTime(row.server_updated_at) > serverTime(newest)) newest = row.server_updated_at
      }
      if (rows.length < PULL_PAGE) break
      since = rows[rows.length - 1].server_updated_at
    }

    if (newest && newest !== cursor) await db.meta.put({ key: CURSOR_KEY, value: newest })
    if (!sameKinds) await db.meta.put({ key: KINDS_KEY, value: kinds })
  }

  async function runOnce() {
    setState({ status: 'syncing' })
    try {
      await push()
      await pull()
      setState({ status: 'idle', lastSyncedAt: Date.now(), error: null, pending: await countPending() })
    } catch (error) {
      const offline = isNetworkError(error) || (typeof navigator !== 'undefined' && navigator.onLine === false)
      setState({
        status: offline ? 'offline' : 'error',
        error: offline ? null : humanizeError(error),
        pending: await countPending(),
      })
      throw error
    }
  }

  function sync(): Promise<void> {
    if (running) {
      rerun = true
      return running
    }
    running = (async () => {
      try {
        do {
          rerun = false
          await runOnce()
        } while (rerun)
      } catch {
        // состояние уже выставлено в runOnce; повторим по таймеру, при появлении сети или при следующей правке
      } finally {
        running = null
      }
    })()
    return running
  }

  function schedule() {
    clearTimeout(debounce)
    debounce = setTimeout(() => void sync(), DEBOUNCE_MS)
    void countPending().then((pending) => setState({ pending }))
  }

  function start() {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sync()
    }
    const onOnline = () => void sync()
    const offChange = onLocalChange(schedule)
    const timer = setInterval(onVisible, INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    void sync()

    return () => {
      offChange()
      clearInterval(timer)
      clearTimeout(debounce)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    sync,
    schedule,
    start,
  }
}

function overlapSince(cursor: string): string {
  const micros = serverTime(cursor) - PULL_OVERLAP_MICROS
  return new Date(Math.floor(micros / 1000)).toISOString()
}
