// Сигнал «на устройстве что-то изменилось» — по нему движок синхронизации планирует отправку.
const listeners = new Set<() => void>()

export function onLocalChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function emitLocalChange(): void {
  listeners.forEach((listener) => listener())
}

/** Время изменения: строго больше предыдущего, даже если часы устройства отстали. */
export function nextStamp(prev?: { updatedAt: number }, now = Date.now()): number {
  return prev && prev.updatedAt >= now ? prev.updatedAt + 1 : now
}
