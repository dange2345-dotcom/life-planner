import type { PlannerDB } from '../db/db'
import type { Category, Payment, Saving, SavingEntry, Transaction } from '../db/types'
import type { DateKey } from '../domain/dates'
import { paymentTxnId } from '../domain/money'
import { insert, nextOrder, remove, update, type Fields } from './entities'

export function createTransaction(db: PlannerDB, input: Omit<Fields<Transaction>, 'paymentId' | 'dueDate'>) {
  return insert(db, 'transactions', { ...input, note: input.note.trim(), paymentId: null, dueDate: null })
}

export function updateTransaction(db: PlannerDB, id: string, changes: Partial<Fields<Transaction>>) {
  return update(db, 'transactions', id, changes)
}

export function deleteTransaction(db: PlannerDB, id: string) {
  return remove(db, 'transactions', id)
}

export async function createCategory(db: PlannerDB, input: Pick<Category, 'type' | 'title' | 'emoji'>) {
  return insert(db, 'categories', { ...input, title: input.title.trim(), order: await nextOrder(db, 'categories') })
}

/* ---------- регулярные платежи ---------- */

export async function createPayment(db: PlannerDB, input: Omit<Fields<Payment>, 'order'>) {
  return insert(db, 'payments', { ...input, title: input.title.trim(), order: await nextOrder(db, 'payments') })
}

export function updatePayment(db: PlannerDB, id: string, changes: Partial<Fields<Payment>>) {
  return update(db, 'payments', id, changes)
}

export function deletePayment(db: PlannerDB, id: string) {
  return remove(db, 'payments', id)
}

/**
 * Оплатить платёж за дату dueDate: появляется расход с детерминированным id (без дублей между устройствами).
 * Повторный вызов снимает оплату.
 */
export async function togglePaid(db: PlannerDB, payment: Payment, dueDate: DateKey, today: DateKey): Promise<boolean> {
  const id = paymentTxnId(payment.id, dueDate)
  const existing = await db.transactions.get(id)
  if (existing && !existing.deleted) {
    await remove(db, 'transactions', id)
    return false
  }
  await insert(
    db,
    'transactions',
    {
      type: 'expense',
      amount: payment.amount,
      category: payment.category,
      date: today,
      note: payment.title,
      paymentId: payment.id,
      dueDate,
    },
    id,
  )
  return true
}

/* ---------- накопления ---------- */

export async function createSaving(db: PlannerDB, input: Omit<Fields<Saving>, 'order'>, initial: number, today: DateKey) {
  const id = await insert(db, 'savings', { ...input, title: input.title.trim(), order: await nextOrder(db, 'savings') })
  if (initial > 0) await addSavingEntry(db, { savingId: id, amount: initial, date: today, note: 'Уже было' })
  return id
}

export function updateSaving(db: PlannerDB, id: string, changes: Partial<Fields<Saving>>) {
  return update(db, 'savings', id, changes)
}

export async function deleteSaving(db: PlannerDB, id: string) {
  const entries = (await db.savingEntries.where('savingId').equals(id).toArray()).filter((e) => !e.deleted)
  await remove(
    db,
    'savingEntries',
    entries.map((e) => e.id),
  )
  await remove(db, 'savings', id)
}

export function addSavingEntry(db: PlannerDB, input: Fields<SavingEntry>) {
  return insert(db, 'savingEntries', { ...input, note: input.note.trim() })
}

export function deleteSavingEntry(db: PlannerDB, id: string) {
  return remove(db, 'savingEntries', id)
}
