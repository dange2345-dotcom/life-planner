import { useApp } from '../app-context'
import type { SyncedTables } from '../db/db'
import type { SyncMeta } from '../db/types'
import { useLive } from '../lib/hooks'
import type { TableName } from './entities'

/** Записи таблицы без удалённых — живые, обновляются при любой правке и синхронизации. undefined — ещё грузятся. */
export function useRows<N extends TableName>(name: N): SyncedTables[N][] | undefined {
  const { db } = useApp()
  return useLive(async () => {
    const rows = (await db.table(name).toArray()) as (SyncedTables[N] & SyncMeta)[]
    return rows.filter((row) => !row.deleted)
  }, [db, name])
}

/** Одна запись по id (например, настройка) или null, если её нет. */
export function useRow<N extends TableName>(name: N, id: string): SyncedTables[N] | null | undefined {
  const { db } = useApp()
  return useLive(async () => {
    const row = (await db.table(name).get(id)) as (SyncedTables[N] & SyncMeta) | undefined
    return row && !row.deleted ? row : null
  }, [db, name, id])
}
