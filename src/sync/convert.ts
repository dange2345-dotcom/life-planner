import type { SyncMeta } from '../db/types'
import type { OutgoingRow, RemoteRow } from './remote'

export function toRemote(kind: string, entity: SyncMeta): OutgoingRow {
  const { id, updatedAt, deleted, dirty: _dirty, ...data } = entity
  return { id, kind, data, updated_at: updatedAt, deleted: deleted === 1 }
}

export function fromRemote(row: RemoteRow): SyncMeta {
  return {
    ...row.data,
    id: row.id,
    updatedAt: Number(row.updated_at),
    deleted: row.deleted ? 1 : 0,
    dirty: 0,
  }
}

/**
 * Принять ли облачную версию записи вместо локальной.
 * Побеждает более позднее изменение; при равенстве локальная версия уже такая же (или новее и ждёт отправки).
 */
export function shouldApplyRemote(local: SyncMeta | undefined, remote: Pick<RemoteRow, 'updated_at'>): boolean {
  return !local || Number(remote.updated_at) > local.updatedAt
}

/**
 * Время сервера («2026-10-04T00:42:45.123456+00:00») → число микросекунд, чтобы сравнивать без потери точности.
 * Date.parse отбрасывает микросекунды, поэтому дробную часть разбираем сами.
 */
export function serverTime(iso: string): number {
  const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(.*)$/.exec(iso)
  if (!match) return Date.parse(iso) * 1000
  const [, base, fraction = '', zone] = match
  const micros = Number((fraction + '000000').slice(0, 6))
  return Date.parse(base + (zone || 'Z')) * 1000 + micros
}
