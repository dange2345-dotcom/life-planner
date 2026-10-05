import type { DateKey } from '../domain/dates'

/** 0/1 вместо boolean: IndexedDB не умеет индексировать boolean. */
export type Flag = 0 | 1

/** Служебные поля каждой синхронизируемой записи. */
export interface SyncMeta {
  id: string
  /** Время последнего изменения на устройстве, мс. При конфликте побеждает большее. */
  updatedAt: number
  /** Удаление = пометка, чтобы оно доехало до других устройств. */
  deleted: Flag
  /** 1 — изменение ещё не отправлено в облако. */
  dirty: Flag
}

export type HabitSchedule =
  | { type: 'daily' }
  /** Конкретные дни недели, ISO: 1 = пн … 7 = вс. */
  | { type: 'weekdays'; days: number[] }
  /** N раз в неделю, в любые дни. */
  | { type: 'weekly'; times: number }
  /** N раз в месяц, в любые дни. */
  | { type: 'monthly'; times: number }

export interface Habit extends SyncMeta {
  title: string
  emoji: string
  schedule: HabitSchedule
  /** С этого дня привычка планируется. */
  startDate: DateKey
  /** Последний день, когда привычка планировалась (архив). null — активна. */
  archivedAt: DateKey | null
  order: number
  /** Цель на год, к которой привязана привычка (этап 5). */
  goalId: string | null
  /** Время напоминаний «HH:MM», если в этот день привычка ещё не отмечена. У старых записей поля нет. */
  remindAt?: string[]
}

/** Отметка «сделано» за день. id = `${habitId}:${date}` — одинаковый на всех устройствах, поэтому без дублей. */
export interface HabitLog extends SyncMeta {
  habitId: string
  date: DateKey
}

/* ===================== Задачи ===================== */

/** 0 — без приоритета, 1 — низкий, 2 — средний, 3 — высокий. */
export type Priority = 0 | 1 | 2 | 3

export interface Project extends SyncMeta {
  title: string
  emoji: string
  note: string
  deadline: DateKey | null
  goalId: string | null
  /** День, когда проект завершён; null — в работе. */
  doneAt: DateKey | null
  order: number
}

export interface Task extends SyncMeta {
  title: string
  note: string
  projectId: string | null
  /** День, на который запланирована задача (он же срок). null — без даты. */
  date: DateKey | null
  /** «HH:MM» — в это время придёт напоминание; null — без времени. */
  time: string | null
  priority: Priority
  /** День выполнения; null — не выполнена. */
  doneAt: DateKey | null
  order: number
}

/* ===================== Финансы ===================== */

export type MoneyType = 'expense' | 'income'

/** Операция. Суммы — в рублях, всегда положительные; знак задаёт type. */
export interface Transaction extends SyncMeta {
  type: MoneyType
  amount: number
  /** Ключ встроенной категории (см. domain/money.ts) или id своей категории. */
  category: string
  date: DateKey
  note: string
  /** Оплата регулярного платежа: id = `pay:${paymentId}:${dueDate}`, чтобы два устройства не создали дубль. */
  paymentId: string | null
  dueDate: DateKey | null
}

/** Своя категория (встроенные живут в коде). */
export interface Category extends SyncMeta {
  type: MoneyType
  title: string
  emoji: string
  order: number
}

export type PaymentSchedule =
  /** Каждый месяц в этот день; если в месяце дней меньше — в последний день. */
  | { type: 'monthly'; day: number }
  | { type: 'yearly'; month: number; day: number }
  /** День недели ISO: 1 = пн … 7 = вс. */
  | { type: 'weekly'; weekday: number }

export type PaymentKind = 'subscription' | 'credit' | 'bill' | 'other'

/** Регулярный платёж: подписка, кредит, коммуналка. */
export interface Payment extends SyncMeta {
  title: string
  emoji: string
  kind: PaymentKind
  amount: number
  category: string
  schedule: PaymentSchedule
  /** Первый платёж — не раньше этой даты. */
  startDate: DateKey
  /** Последний платёж (кредит, подписка до даты); null — бессрочно. */
  endDate: DateKey | null
  note: string
  order: number
}

/** Цель накоплений. Сколько накоплено — сумма её пополнений (SavingEntry). */
export interface Saving extends SyncMeta {
  title: string
  emoji: string
  target: number
  deadline: DateKey | null
  goalId: string | null
  order: number
}

/** Пополнение (amount > 0) или снятие (amount < 0) накоплений. */
export interface SavingEntry extends SyncMeta {
  savingId: string
  amount: number
  date: DateKey
  note: string
}

/* ===================== Цели на год ===================== */

/**
 * Как считать процент цели:
 * auto — среднее по привязанным привычкам, проектам, накоплениям и шагам;
 * count — счётчик «N из M» (например, уроки курса), можно считать отметки привычки;
 * manual — процент вручную.
 */
export type GoalMeasure = 'auto' | 'count' | 'manual'

export interface GoalStep {
  id: string
  title: string
  done: boolean
}

export interface Goal extends SyncMeta {
  title: string
  emoji: string
  /** Ключ сферы жизни (см. domain/goals.ts). */
  sphere: string
  year: number
  deadline: DateKey | null
  note: string
  measure: GoalMeasure
  countTarget: number
  /** Сколько уже было сделано до начала учёта (или вручную, без привычки). */
  countBase: number
  /** Считать отметки этой привычки. */
  countHabitId: string | null
  manualValue: number
  steps: GoalStep[]
  doneAt: DateKey | null
  order: number
}

/* ===================== Настройки и уведомления ===================== */

/** Синхронизируемая настройка: одна запись на ключ (id), значение — любое. */
export interface Setting extends SyncMeta {
  value: unknown
}

export interface NotifySettings {
  /** Утром: план на день (привычки, задачи, платежи сегодня и завтра). */
  morning: { enabled: boolean; time: string }
  /** Вечером: что ещё не отмечено. */
  evening: { enabled: boolean; time: string }
  /** Напоминания по времени у привычек и задач. */
  habits: boolean
  tasks: boolean
  /** Задачам с высоким приоритетом — ещё и за час до времени. */
  tasksEarly: boolean
  /** Часовой пояс IANA (с устройства) — сервер считает время напоминаний в нём. */
  timezone: string
}

/** Подписка устройства на пуш-уведомления. id — хэш адреса подписки. */
export interface PushSub extends SyncMeta {
  endpoint: string
  keys: { p256dh: string; auth: string }
  device: string
  createdAt: number
}

/* ===================== Учёба: маршрут ===================== */

/** Пункт маршрута, который можно отметить. key — стабильный ключ (по нему хранится отметка). */
export interface RouteItem {
  k: string
  t: string
}

/** Группа тем этапа (раскрывающийся список с отметками). */
export interface RouteGroup {
  title: string
  /** Пояснение под заголовком, например «не заучивать». */
  note?: string
  items: RouteItem[]
}

export interface RouteStage {
  id: string
  /** Номер для показа: «0», «1», … */
  no: string
  title: string
  /** «нед. 1–4 · ≈ 79 ч» */
  weeks: string
  what: string
  why: string
  example: string
  result: string
  /** Чем помогает тренажёр (сайт с задачами и вопросами). */
  nar: string
  /** Этап ветки после развилки; без ветки — общий. */
  branch?: string
  /** Необязательный этап: не входит в общий прогресс. */
  optional?: boolean
  milestones: RouteItem[]
  groups: RouteGroup[]
}

export interface RouteBranch {
  id: string
  label: string
  name: string
  hint: string
}

export interface RouteFork {
  /** id этапа, после которого стоит развилка. */
  after: string
  weeks: string
  title: string
  intro: string
  /** Сравнение направлений: первая колонка — название строки, дальше — по ветке. */
  table: { label: string; cells: string[] }[]
  how: string[]
}

/**
 * Учебный маршрут (сейчас один, id 'main'). Содержание пишет только Claude
 * (`npm run planner -- route-import`), приложение его лишь показывает. Хранится в облаке, а не в коде:
 * репозиторий публичный.
 */
export interface Route extends SyncMeta {
  title: string
  subtitle: string
  /** Название тренажёра — подпись к полю nar у этапов. */
  trainer?: string
  facts: { value: string; label: string }[]
  rules: { title: string; text: string }[]
  stages: RouteStage[]
  branches: RouteBranch[]
  defaultBranch: string
  fork: RouteFork | null
}

/** Отметка «пройдено». id = `${routeId}:${key}` — одинаковый на всех устройствах; снятие отметки = удаление. */
export interface RouteMark extends SyncMeta {
  routeId: string
  key: string
}

export interface MetaRow {
  key: string
  value: unknown
}
