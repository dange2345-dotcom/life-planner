import { useMemo } from 'preact/hooks'
import { useApp } from '../app-context'
import type { Habit } from '../db/types'
import { buildLogIndex, type LogIndex } from '../domain/habit-stats'
import { useLive } from '../lib/hooks'

/** Привычки (без удалённых, по порядку) и индекс отметок — живые, обновляются при любой правке и синхронизации. */
export function useHabitsData(): { habits: Habit[]; index: LogIndex; loaded: boolean } {
  const { db } = useApp()
  const habits = useLive(async () => {
    const all = await db.habits.toArray()
    return all.filter((habit) => !habit.deleted).sort((a, b) => a.order - b.order)
  }, [db])
  const logs = useLive(() => db.habitLogs.toArray(), [db])
  const index = useMemo(() => buildLogIndex(logs ?? []), [logs])
  return { habits: habits ?? [], index, loaded: habits !== undefined && logs !== undefined }
}
