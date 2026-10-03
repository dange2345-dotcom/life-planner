import type { SupabaseClient } from '@supabase/supabase-js'

/** Строка облачной таблицы records (см. supabase/schema.sql). */
export interface RemoteRow {
  id: string
  kind: string
  data: Record<string, unknown>
  updated_at: number
  deleted: boolean
  server_updated_at: string
}

export type OutgoingRow = Omit<RemoteRow, 'server_updated_at'>

/** Всё, что движку синхронизации нужно от облака. В тестах подменяется фейком. */
export interface Remote {
  upsert(rows: OutgoingRow[]): Promise<void>
  /** Записи с server_updated_at > since (или все, если since = null), по возрастанию server_updated_at. */
  pullSince(since: string | null, limit: number): Promise<RemoteRow[]>
}

export function supabaseRemote(client: SupabaseClient): Remote {
  return {
    async upsert(rows) {
      const { error } = await client.from('records').upsert(rows, { onConflict: 'id' })
      if (error) throw error
    },

    async pullSince(since, limit) {
      let query = client
        .from('records')
        .select('id, kind, data, updated_at, deleted, server_updated_at')
        .order('server_updated_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit)
      if (since) query = query.gt('server_updated_at', since)
      const { data, error } = await query
      if (error) throw error
      return data as RemoteRow[]
    },
  }
}
