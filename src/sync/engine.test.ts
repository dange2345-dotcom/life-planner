import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDb, type PlannerDB } from '../db/db'
import { createHabit, habitLogId, toggleHabitLog, updateHabit } from '../data/habits'
import { serverTime } from './convert'
import { createSyncEngine } from './engine'
import type { OutgoingRow, Remote, RemoteRow } from './remote'

/** Облако в памяти: ведёт себя как таблица records с триггером из supabase/schema.sql. */
class FakeRemote implements Remote {
  rows = new Map<string, RemoteRow>()
  offline = false
  onUpsert: (() => Promise<void>) | null = null
  private tick = 0

  async upsert(rows: OutgoingRow[]) {
    if (this.offline) throw new TypeError('Failed to fetch')
    await this.onUpsert?.()
    for (const row of rows) {
      const old = this.rows.get(row.id)
      if (old && row.updated_at < old.updated_at) continue // триггер: устаревшая правка не проходит
      this.rows.set(row.id, { ...row, server_updated_at: this.nextServerTime() })
    }
  }

  async pullSince(since: string | null, limit: number) {
    if (this.offline) throw new TypeError('Failed to fetch')
    return [...this.rows.values()]
      .filter((row) => !since || serverTime(row.server_updated_at) > serverTime(since))
      .sort((a, b) => serverTime(a.server_updated_at) - serverTime(b.server_updated_at))
      .slice(0, limit)
  }

  private nextServerTime() {
    // формат как у Postgres: микросекунды и смещение
    const micros = ++this.tick * 1500
    const base = new Date(Date.UTC(2026, 9, 4) + Math.floor(micros / 1000)).toISOString().slice(0, 19)
    return `${base}.${String(micros % 1_000_000).padStart(6, '0')}+00:00`
  }
}

let n = 0
let remote: FakeRemote
let phone: PlannerDB
let laptop: PlannerDB

beforeEach(() => {
  n++
  remote = new FakeRemote()
  phone = createDb(`phone-${n}`)
  laptop = createDb(`laptop-${n}`)
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-04T10:00:00Z') })
})

afterEach(async () => {
  vi.useRealTimers()
  await phone.delete()
  await laptop.delete()
})

const later = (ms: number) => vi.setSystemTime(Date.now() + ms)

async function newHabit(db: PlannerDB, title = 'Зарядка') {
  return createHabit(db, { title, emoji: '🏃', schedule: { type: 'daily' }, startDate: '2026-10-01' })
}

describe('синхронизация двух устройств', () => {
  it('привычка и отметка с телефона появляются на компьютере', async () => {
    const id = await newHabit(phone)
    await toggleHabitLog(phone, id, '2026-10-04')

    await createSyncEngine(phone, remote).sync()
    await createSyncEngine(laptop, remote).sync()

    expect((await laptop.habits.get(id))?.title).toBe('Зарядка')
    expect((await laptop.habitLogs.get(habitLogId(id, '2026-10-04')))?.deleted).toBe(0)
    expect(await phone.habits.where('dirty').equals(1).count()).toBe(0)
  })

  it('снятие отметки на компьютере доезжает до телефона', async () => {
    const id = await newHabit(phone)
    await toggleHabitLog(phone, id, '2026-10-04')
    const phoneSync = createSyncEngine(phone, remote)
    const laptopSync = createSyncEngine(laptop, remote)
    await phoneSync.sync()
    await laptopSync.sync()

    later(1000)
    expect(await toggleHabitLog(laptop, id, '2026-10-04')).toBe(false)
    await laptopSync.sync()
    await phoneSync.sync()

    expect((await phone.habitLogs.get(habitLogId(id, '2026-10-04')))?.deleted).toBe(1)
  })

  it('конфликт: побеждает более позднее изменение, на обоих устройствах одинаково', async () => {
    const id = await newHabit(phone)
    const phoneSync = createSyncEngine(phone, remote)
    const laptopSync = createSyncEngine(laptop, remote)
    await phoneSync.sync()
    await laptopSync.sync()

    later(1000)
    await updateHabit(phone, id, { title: 'С телефона' })
    later(1000)
    await updateHabit(laptop, id, { title: 'С компьютера (позже)' })

    await laptopSync.sync() // более поздняя правка уходит первой
    await phoneSync.sync() // более ранняя отвергается сервером, телефон забирает позднюю
    await laptopSync.sync()

    expect((await phone.habits.get(id))?.title).toBe('С компьютера (позже)')
    expect((await laptop.habits.get(id))?.title).toBe('С компьютера (позже)')
    expect(remote.rows.get(id)?.data.title).toBe('С компьютера (позже)')
  })

  it('без сети: изменения копятся и уходят, когда связь появилась', async () => {
    const engine = createSyncEngine(phone, remote)
    remote.offline = true
    const id = await newHabit(phone)
    await toggleHabitLog(phone, id, '2026-10-04')

    await engine.sync()
    expect(engine.getState()).toMatchObject({ status: 'offline', pending: 2 })
    expect(remote.rows.size).toBe(0)

    remote.offline = false
    await engine.sync()
    expect(engine.getState()).toMatchObject({ status: 'idle', pending: 0 })
    expect(remote.rows.size).toBe(2)
  })

  it('правка во время отправки не теряется — уйдёт следующей синхронизацией', async () => {
    const id = await newHabit(phone)
    const engine = createSyncEngine(phone, remote)
    remote.onUpsert = async () => {
      remote.onUpsert = null
      later(10)
      await updateHabit(phone, id, { title: 'Изменено во время отправки' })
    }

    await engine.sync()
    expect((await phone.habits.get(id))?.dirty).toBe(1)

    await engine.sync()
    expect(remote.rows.get(id)?.data.title).toBe('Изменено во время отправки')
    expect((await phone.habits.get(id))?.dirty).toBe(0)
  })

  it('незнакомые записи в облаке (например, тестовые ping) пропускаются', async () => {
    remote.rows.set('p1', {
      id: 'p1',
      kind: 'ping',
      data: { text: 'Отметка с iPhone' },
      updated_at: 1,
      deleted: false,
      server_updated_at: '2026-10-04T00:42:45.123456+00:00',
    })
    const engine = createSyncEngine(laptop, remote)
    await engine.sync()
    expect(engine.getState().status).toBe('idle')
    expect(await laptop.habits.count()).toBe(0)
  })

  it('новый раздел в обновлённом приложении: облако скачивается заново, старые записи нового вида не теряются', async () => {
    const id = await newHabit(phone)
    await toggleHabitLog(phone, id, '2026-10-04')
    await createSyncEngine(phone, remote).sync()

    // «Старая версия» на компьютере знала только привычки и уже прокрутила курсор на час вперёд всех записей
    // (минутное перекрытие их не захватит — проверяем именно сброс курсора).
    const staleState = [
      { key: 'pullCursor', value: '2026-10-04T01:00:00.000000+00:00' },
      { key: 'pullKinds', value: 'habit' },
    ]
    await laptop.meta.bulkPut(staleState)
    await createSyncEngine(laptop, remote).sync()
    expect(await laptop.habitLogs.count()).toBe(1)
    expect((await laptop.meta.get('pullKinds'))?.value).toBe('habit,habitLog')

    // Контрольная проверка: с тем же курсором, но «знакомыми» видами записей ничего не скачалось бы.
    const control = createDb(`control-${n}`)
    await control.meta.bulkPut([staleState[0], { key: 'pullKinds', value: 'habit,habitLog' }])
    await createSyncEngine(control, remote).sync()
    expect(await control.habitLogs.count()).toBe(0)
    await control.delete()
  })

  it('повторная синхронизация без изменений ничего не портит', async () => {
    const id = await newHabit(phone)
    const engine = createSyncEngine(phone, remote)
    await engine.sync()
    const before = await phone.habits.get(id)
    await engine.sync()
    await engine.sync()
    expect(await phone.habits.get(id)).toEqual(before)
  })
})

describe('serverTime', () => {
  it('сравнивает время сервера с точностью до микросекунд', () => {
    expect(serverTime('2026-10-04T00:42:45.123457+00:00')).toBeGreaterThan(serverTime('2026-10-04T00:42:45.123456+00:00'))
    expect(serverTime('2026-10-04T00:42:45.5+00:00')).toBeGreaterThan(serverTime('2026-10-04T00:42:45.12+00:00'))
    expect(serverTime('2026-10-04T00:42:46+00:00')).toBeGreaterThan(serverTime('2026-10-04T00:42:45.999999+00:00'))
    expect(serverTime('2026-10-04T03:42:45+03:00')).toBe(serverTime('2026-10-04T00:42:45+00:00'))
  })
})
