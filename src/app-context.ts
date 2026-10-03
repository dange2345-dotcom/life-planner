import { createContext } from 'preact'
import { useContext } from 'preact/hooks'
import type { PlannerDB } from './db/db'
import type { SyncEngine } from './sync/engine'

export interface AppContextValue {
  db: PlannerDB
  sync: SyncEngine
  email: string | null
  signOut: () => Promise<void>
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('AppContext не задан')
  return value
}
