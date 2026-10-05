import { describe, expect, it } from 'vitest'
import type { RouteStage } from '../db/types'
import { findRouteItems, findStage, resolveBranch, routeMarkId, routeProgress, stageKeys, topicCount } from './route'

function stage(id: string, no: string, extra: Partial<RouteStage> = {}): RouteStage {
  return {
    id,
    no,
    title: `Этап ${no}`,
    weeks: '',
    what: '',
    why: '',
    example: '',
    result: '',
    nar: '',
    milestones: [{ k: `m.${id}.0`, t: `Веха ${id}` }],
    groups: [{ title: 'Темы', items: [{ k: `${id}.t1`, t: `Тема один ${id}` }, { k: `${id}.t2`, t: `Тема два ${id}` }] }],
    ...extra,
  }
}

const route = {
  branches: [
    { id: 'a', label: 'A', name: 'NLP', hint: '' },
    { id: 'b', label: 'B', name: 'DS', hint: '' },
  ],
  defaultBranch: 'a',
  stages: [
    stage('s0', '0'),
    stage('s1', '1'),
    stage('s6a', '6', { branch: 'a' }),
    stage('s6b', '6', { branch: 'b' }),
    stage('s10', '10', { optional: true }),
  ],
}

describe('маршрут', () => {
  it('ключи этапа — вехи и темы', () => {
    expect(stageKeys(route.stages[0])).toEqual(['m.s0.0', 's0.t1', 's0.t2'])
    expect(topicCount(route.stages[0])).toBe(2)
    expect(routeMarkId('ml', 'm.s0.0')).toBe('ml:m.s0.0')
  })

  it('прогресс считает только этапы выбранной ветки и без необязательных', () => {
    const done = new Set(['m.s0.0', 's0.t1', 's0.t2', 's1.t1', 's6b.t1', 's10.t1'])
    const p = routeProgress(route, 'a', done)
    // s0 (3) + s1 (3) + s6a (3) = 9 пунктов, отмечено 3 + 1 + 0
    expect(p.total).toBe(9)
    expect(p.done).toBe(4)
    expect(p.pct).toBe(44)
    expect(p.here?.id).toBe('s1')
    // по этапам считаются все, в том числе чужая ветка и необязательный
    expect(p.stages.get('s6b')).toEqual({ done: 1, total: 3, pct: 33 })
    expect(p.stages.get('s10')?.done).toBe(1)
  })

  it('100% и «маршрут пройден» — только когда отмечено всё на ветке', () => {
    const keys = ['s0', 's1', 's6b'].flatMap((id) => stageKeys(route.stages.find((s) => s.id === id)!))
    const p = routeProgress(route, 'b', new Set(keys))
    expect(p.pct).toBe(100)
    expect(p.here).toBeNull()
    const almost = routeProgress(route, 'b', new Set(keys.slice(1)))
    expect(almost.pct).toBe(88)
    expect(almost.here?.id).toBe('s0')
  })

  it('ветка: сохранённая, иначе по умолчанию', () => {
    expect(resolveBranch(route, { branch: 'b' })).toBe('b')
    expect(resolveBranch(route, { branch: 'zzz' })).toBe('a')
    expect(resolveBranch(route, undefined)).toBe('a')
  })

  it('поиск пункта: точный ключ, иначе текст на своей ветке', () => {
    expect(findRouteItems(route, 'a', 's6b.t1').map((h) => h.item.k)).toEqual(['s6b.t1'])
    expect(findRouteItems(route, 'a', 'ТЕМА ДВА S6').map((h) => h.item.k)).toEqual(['s6a.t2'])
    expect(findRouteItems(route, 'a', 'Веха s1')[0].milestone).toBe(true)
    expect(findRouteItems(route, 'a', 'нет такого')).toEqual([])
  })

  it('этап по номеру с учётом ветки или по id', () => {
    expect(findStage(route, 'b', '6')?.id).toBe('s6b')
    expect(findStage(route, 'a', 's6b')?.id).toBe('s6b')
    expect(findStage(route, 'a', '42')).toBeUndefined()
  })
})
