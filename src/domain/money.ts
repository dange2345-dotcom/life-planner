import type { Category, MoneyType, Payment, PaymentKind, Saving, SavingEntry, Transaction } from '../db/types'
import { addDaysKey, addMonthsKey, isoWeekday, monthEnd, monthOf, type DateKey, type MonthKey } from './dates'

/* ===================== Категории ===================== */

export interface CategoryInfo {
  id: string
  type: MoneyType
  title: string
  emoji: string
}

const make = (type: MoneyType, list: [string, string, string][]): CategoryInfo[] =>
  list.map(([id, emoji, title]) => ({ id, type, emoji, title }))

/** Встроенные категории. id не менять — на них ссылаются операции. Флаги-эмодзи не использовать (Windows). */
export const EXPENSE_CATEGORIES = make('expense', [
  ['food', '🛒', 'Продукты'],
  ['cafe', '🍽️', 'Кафе и доставка'],
  ['transport', '🚕', 'Транспорт'],
  ['home', '🏠', 'Дом и ЖКХ'],
  ['connection', '📱', 'Связь и интернет'],
  ['health', '💊', 'Здоровье'],
  ['clothes', '👕', 'Одежда'],
  ['beauty', '🧴', 'Красота и уход'],
  ['fun', '🎬', 'Развлечения'],
  ['subscriptions', '🔁', 'Подписки'],
  ['education', '📚', 'Образование'],
  ['sport', '💪', 'Спорт'],
  ['gifts', '🎁', 'Подарки'],
  ['travel', '✈️', 'Путешествия'],
  ['credit', '🏦', 'Кредиты и долги'],
  ['other', '📦', 'Другое'],
])

export const INCOME_CATEGORIES = make('income', [
  ['in-salary', '💼', 'Зарплата'],
  ['in-side', '🧰', 'Подработка'],
  ['in-gifts', '🎁', 'Подарки'],
  ['in-cashback', '💳', 'Кэшбэк и проценты'],
  ['in-other', '💰', 'Другое'],
])

export function categoriesOf(type: MoneyType, custom: Category[]): CategoryInfo[] {
  const builtIn = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES
  const own = custom
    .filter((c) => c.type === type)
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ id: c.id, type: c.type, title: c.title, emoji: c.emoji }))
  // «Другое» — всегда последним.
  return [...builtIn.slice(0, -1), ...own, builtIn[builtIn.length - 1]]
}

export function categoryInfo(id: string, custom: Category[]): CategoryInfo {
  const found =
    EXPENSE_CATEGORIES.find((c) => c.id === id) ??
    INCOME_CATEGORIES.find((c) => c.id === id) ??
    custom.find((c) => c.id === id)
  if (found) return { id: found.id, type: found.type, title: found.title, emoji: found.emoji }
  return { id, type: 'expense', title: 'Без категории', emoji: '📦' }
}

/* ===================== Суммы ===================== */

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

const wholeFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const centsFormat = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** «1 299 ₽», «1 299,50 ₽»; sign — «+1 299 ₽» / «−350 ₽». */
export function formatMoney(amount: number, options: { sign?: boolean } = {}): string {
  const value = roundMoney(Math.abs(amount))
  const text = (Number.isInteger(value) ? wholeFormat : centsFormat).format(value)
  const sign = options.sign ? (amount < 0 ? '−' : amount > 0 ? '+' : '') : amount < 0 ? '−' : ''
  return `${sign}${text} ₽`
}

/** Сумма из поля ввода: «1 299,5» → 1299.5; можно сложить: «350+120» → 470. Ошибка или ≤ 0 → null. */
export function parseAmount(text: string): number | null {
  const clean = text.replace(/[\s  ₽]/g, '').replace(/,/g, '.')
  if (!/^\d+(\.\d{0,2})?(\+\d+(\.\d{0,2})?)*$/.test(clean)) return null
  const total = roundMoney(clean.split('+').reduce((sum, part) => sum + Number(part), 0))
  return total > 0 ? total : null
}

/* ===================== Месяц ===================== */

export interface MonthMoney {
  income: number
  expense: number
  /** Отложено в накопления за месяц (пополнения минус снятия). */
  saved: number
  /** Доходы − расходы − отложено. */
  balance: number
}

export function monthMoney(transactions: Transaction[], entries: SavingEntry[], month: MonthKey): MonthMoney {
  let income = 0
  let expense = 0
  for (const t of transactions) {
    if (monthOf(t.date) !== month) continue
    if (t.type === 'income') income += t.amount
    else expense += t.amount
  }
  const saved = entries.filter((e) => monthOf(e.date) === month).reduce((sum, e) => sum + e.amount, 0)
  return {
    income: roundMoney(income),
    expense: roundMoney(expense),
    saved: roundMoney(saved),
    balance: roundMoney(income - expense - saved),
  }
}

export interface CategoryTotal {
  category: string
  amount: number
  /** Доля от всех операций этого типа за месяц, 0–100. */
  share: number
  count: number
}

export function totalsByCategory(transactions: Transaction[], month: MonthKey, type: MoneyType): CategoryTotal[] {
  const map = new Map<string, { amount: number; count: number }>()
  let total = 0
  for (const t of transactions) {
    if (t.type !== type || monthOf(t.date) !== month) continue
    const row = map.get(t.category) ?? { amount: 0, count: 0 }
    row.amount += t.amount
    row.count++
    map.set(t.category, row)
    total += t.amount
  }
  return [...map.entries()]
    .map(([category, { amount, count }]) => ({
      category,
      amount: roundMoney(amount),
      count,
      share: total > 0 ? Math.round((amount / total) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
}

/* ===================== Регулярные платежи ===================== */

export const PAYMENT_KINDS: { value: PaymentKind; label: string; emoji: string }[] = [
  { value: 'subscription', label: 'Подписка', emoji: '🔁' },
  { value: 'credit', label: 'Кредит', emoji: '🏦' },
  { value: 'bill', label: 'Счёт', emoji: '🧾' },
  { value: 'other', label: 'Другое', emoji: '📌' },
]

const pad = (n: number) => String(n).padStart(2, '0')

function onDay(month: MonthKey, day: number): DateKey {
  const last = Number(monthEnd(month).slice(8))
  return `${month}-${pad(Math.min(day, last))}`
}

/** Даты платежей в диапазоне [from, to] (с учётом начала и окончания платежа). */
export function dueDates(payment: Payment, from: DateKey, to: DateKey): DateKey[] {
  const start = from > payment.startDate ? from : payment.startDate
  const end = payment.endDate && payment.endDate < to ? payment.endDate : to
  if (start > end) return []
  const s = payment.schedule
  const dates: DateKey[] = []

  if (s.type === 'monthly') {
    for (let month = monthOf(start); month <= monthOf(end); month = addMonthsKey(month, 1)) {
      const date = onDay(month, s.day)
      if (date >= start && date <= end) dates.push(date)
    }
  } else if (s.type === 'yearly') {
    for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year++) {
      const date = onDay(`${year}-${pad(s.month)}`, s.day)
      if (date >= start && date <= end) dates.push(date)
    }
  } else {
    const shift = (s.weekday - isoWeekday(start) + 7) % 7
    for (let date = addDaysKey(start, shift); date <= end; date = addDaysKey(date, 7)) dates.push(date)
  }
  return dates
}

export function nextDueDate(payment: Payment, from: DateKey): DateKey | null {
  return dueDates(payment, from, addDaysKey(from, 400))[0] ?? null
}

/** Расписание по дате ближайшего платежа: «каждый месяц 15-го», «каждый год 10 марта», «каждую неделю в пн». */
export function scheduleFromDate(date: DateKey, repeat: Payment['schedule']['type']): Payment['schedule'] {
  if (repeat === 'weekly') return { type: 'weekly', weekday: isoWeekday(date) }
  if (repeat === 'yearly') return { type: 'yearly', month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) }
  return { type: 'monthly', day: Number(date.slice(8, 10)) }
}

export function paymentTxnId(paymentId: string, dueDate: DateKey): string {
  return `pay:${paymentId}:${dueDate}`
}

/** Сколько платёж стоит в месяц (годовой — /12, недельный — ×52/12). */
export function monthlyCost(payment: Payment): number {
  if (payment.schedule.type === 'yearly') return roundMoney(payment.amount / 12)
  if (payment.schedule.type === 'weekly') return roundMoney((payment.amount * 52) / 12)
  return payment.amount
}

export interface Occurrence {
  payment: Payment
  dueDate: DateKey
  paid: Transaction | null
}

export type PaidIndex = Map<string, Transaction>

export function buildPaidIndex(transactions: Transaction[]): PaidIndex {
  return new Map(transactions.filter((t) => t.paymentId !== null).map((t) => [t.id, t]))
}

/** Все платежи в диапазоне, по дате. */
export function occurrences(payments: Payment[], paid: PaidIndex, from: DateKey, to: DateKey): Occurrence[] {
  const list: Occurrence[] = []
  for (const payment of payments) {
    for (const dueDate of dueDates(payment, from, to)) {
      list.push({ payment, dueDate, paid: paid.get(paymentTxnId(payment.id, dueDate)) ?? null })
    }
  }
  return list.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.payment.order - b.payment.order))
}

/** Сколько платежей осталось до конца (кредит, подписка до даты), не считая оплаченных. null — бессрочный. */
export function remainingPayments(payment: Payment, paid: PaidIndex): { count: number; total: number } | null {
  if (!payment.endDate) return null
  // Неоплаченные с первого до последнего (просроченные тоже ещё предстоит заплатить).
  const left = dueDates(payment, payment.startDate, payment.endDate).filter((date) => !paid.has(paymentTxnId(payment.id, date)))
  return { count: left.length, total: roundMoney(left.length * payment.amount) }
}

/* ===================== Накопления ===================== */

export interface SavingStats {
  current: number
  left: number
  /** 0–100, округление вниз — 100% только когда цель действительно достигнута. */
  pct: number
  reached: boolean
  /** Сколько месяцев осталось до срока, считая текущий; null — срока нет или цель достигнута. */
  monthsLeft: number | null
  /** Сколько откладывать в месяц, чтобы успеть к сроку. */
  perMonth: number | null
}

function monthsBetween(a: MonthKey, b: MonthKey): number {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7))
}

export function savingCurrent(savingId: string, entries: SavingEntry[]): number {
  return roundMoney(entries.filter((e) => e.savingId === savingId).reduce((sum, e) => sum + e.amount, 0))
}

export function savingStats(saving: Saving, entries: SavingEntry[], today: DateKey): SavingStats {
  const current = savingCurrent(saving.id, entries)
  const left = roundMoney(Math.max(0, saving.target - current))
  const reached = saving.target > 0 && left === 0
  const pct = saving.target > 0 ? Math.max(0, Math.min(100, Math.floor((current / saving.target) * 100))) : 0
  let monthsLeft: number | null = null
  let perMonth: number | null = null
  if (saving.deadline && !reached) {
    monthsLeft = Math.max(1, monthsBetween(monthOf(today), monthOf(saving.deadline)) + 1)
    perMonth = Math.ceil(left / monthsLeft)
  }
  return { current, left, pct, reached, monthsLeft, perMonth }
}
