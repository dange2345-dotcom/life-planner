// Разбор страницы учебного маршрута (HTML-исходник плана) в содержание маршрута «Планера».
// Файл лежит вне репозитория: само содержание в публичный код не попадает.
//
// Что берётся со страницы: данные этапов (STAGES, BRANCHES и stageGroups — исполняется кусок её скрипта между
// «Данные» и «Состояние»), правила, факты, развилка (forkHtml). stageGroups(этап) отдаёт блоки тем уже с ключами:
// той же функцией страница рисует себя, поэтому ключи на странице и в «Планере» совпадают.

import type { Route, RouteGroup, RouteStage, SyncMeta } from '../src/db/types'

export type RouteContent = Omit<Route, keyof SyncMeta>

interface PageStage {
  id: string
  no?: string
  title?: string
  weeks?: string
  what?: string
  why?: string
  example?: string
  result?: string
  learn?: string
  nar?: string
  branch?: string
  optional?: boolean
  fork?: boolean
  milestones?: string[]
}

/** Блок тем в том виде, как его отдаёт stageGroups на странице (пустые поля — пустые строки). */
interface PageGroup {
  title: string
  note: string
  learn: string
  practice: string
  items: { k: string; t: string; d: string }[]
}

export function parseRouteHtml(html: string): RouteContent {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  const script = scripts.find((s) => s.includes('var STAGES')) ?? fail('на странице нет скрипта с STAGES')

  const from = script.indexOf('/* ── Данные ── */')
  const to = script.indexOf('/* ── Состояние ── */')
  if (from < 0 || to < from) fail('не найден блок данных (от «Данные» до «Состояние»)')
  const data = new Function(`${script.slice(from, to)}\nreturn { STAGES, BRANCHES, stageGroups }`)() as {
    STAGES: PageStage[]
    BRANCHES: Record<string, { label: string; name: string; hint: string }>
    stageGroups: (stage: PageStage) => PageGroup[]
  }

  const stages: RouteStage[] = []
  let forkAfter: string | null = null
  for (const s of data.STAGES) {
    if (s.fork) {
      forkAfter = stages.at(-1)?.id ?? fail('развилка стоит раньше первого этапа')
      continue
    }
    const groups: RouteGroup[] = data.stageGroups(s).map((g) => ({
      title: g.title,
      ...(g.note ? { note: g.note } : {}),
      ...(g.learn ? { learn: g.learn } : {}),
      ...(g.practice ? { practice: g.practice } : {}),
      items: g.items.map(({ k, t, d }) => ({ k, t, ...(d ? { d } : {}) })),
    }))
    stages.push({
      id: s.id,
      no: s.no ?? '',
      title: s.title ?? '',
      weeks: s.weeks ?? '',
      what: s.what ?? '',
      why: s.why ?? '',
      example: s.example ?? '',
      result: text(s.result ?? ''),
      ...(s.learn ? { learn: s.learn } : {}),
      nar: s.nar ?? '',
      ...(s.branch ? { branch: s.branch } : {}),
      ...(s.optional ? { optional: true } : {}),
      milestones: (s.milestones ?? []).map((t, i) => ({ k: `m.${s.id}.${i}`, t })),
      groups,
    })
  }

  const branches = Object.entries(data.BRANCHES).map(([id, b]) => ({ id, label: b.label, name: b.name, hint: b.hint }))
  const defaultBranch = /branch:\s*'(\w+)'/.exec(script)?.[1] ?? branches[0]?.id ?? ''

  const content: RouteContent = {
    title: text(pick(html, /<h1>([\s\S]*?)<span/, 'заголовок')),
    subtitle: text(pick(html, /<p class="lede">([\s\S]*?)<\/p>/, 'подзаголовок')),
    ...trainer(script),
    facts: [...pick(html, /<ul class="facts">([\s\S]*?)<\/ul>/, 'факты').matchAll(/<li><b( id="[^"]*")?>([\s\S]*?)<\/b>([\s\S]*?)<\/li>/g)]
      .filter((m) => !m[1]) // факт с id считается на странице скриптом (число тем) — приложение считает его само
      .map((m) => ({ value: text(m[2]), label: text(m[3]) })),
    rules: [...html.matchAll(/<div class="rule"><b>([\s\S]*?)<\/b><p>([\s\S]*?)<\/p>/g)].map((m) => ({ title: text(m[1]), text: text(m[2]) })),
    stages,
    branches,
    defaultBranch,
    fork: forkAfter ? parseFork(script, forkAfter, branches.length) : null,
  }
  validate(content)
  return content
}

function parseFork(script: string, after: string, branchCount: number): RouteContent['fork'] {
  const from = script.indexOf('function forkHtml')
  const to = script.indexOf('var routeEl', from)
  if (from < 0 || to < 0) fail('не найдена функция forkHtml')
  const code = script.slice(from, to)
  const table = [...code.matchAll(/<tr><th>([^<]*)<\/th>((?:<td>[^<]*<\/td>)+)<\/tr>/g)].map((m) => ({
    label: text(m[1]),
    cells: [...m[2].matchAll(/<td>([^<]*)<\/td>/g)].map((c) => text(c[1])),
  }))
  if (table.some((row) => row.cells.length !== branchCount)) fail('в таблице развилки число колонок не совпадает с числом веток')
  return {
    after,
    weeks: text(pick(code, /<span class="weeks">([^<]*)<\/span>/, 'срок развилки')),
    title: text(pick(code, /<h3>([^<]*)<\/h3>/, 'заголовок развилки')),
    intro: text(pick(code, /<p class="fork-intro">([^<]*)<\/p>/, 'текст развилки')),
    table,
    how: [...pick(code, /<ol class="how">([\s\S]*?)<\/ol>/, 'как выбрать').matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => text(m[1])),
  }
}

/** Подпись поля «тренажёр» у этапов — как на странице. */
function trainer(script: string): { trainer?: string } {
  const label = /facet nar"><dt>([^<]*)<\/dt>/.exec(script)?.[1]
  return label ? { trainer: text(label) } : {}
}

function validate(route: RouteContent) {
  if (!route.stages.length) fail('нет ни одного этапа')
  const seen = new Set<string>()
  for (const stage of route.stages) {
    for (const item of [...stage.milestones, ...stage.groups.flatMap((g) => g.items)]) {
      if (seen.has(item.k)) fail(`ключ «${item.k}» встречается дважды`)
      seen.add(item.k)
    }
    if (stage.branch && !route.branches.some((b) => b.id === stage.branch)) fail(`этап ${stage.id}: неизвестная ветка ${stage.branch}`)
  }
  if (!route.branches.some((b) => b.id === route.defaultBranch)) fail(`ветка по умолчанию «${route.defaultBranch}» не найдена`)
}

/** Текст без тегов и HTML-сущностей. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function pick(source: string, pattern: RegExp, what: string): string {
  return pattern.exec(source)?.[1] ?? fail(`не найдено: ${what}`)
}

function fail(message: string): never {
  throw new Error(`Страница маршрута: ${message}`)
}
