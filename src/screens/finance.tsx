import { useState } from 'preact/hooks'
import { useApp } from '../app-context'
import { togglePaid } from '../data/money'
import { useRows } from '../data/use-data'
import type { Category, MoneyType, Payment, Saving, SavingEntry, Transaction } from '../db/types'
import { addDaysKey, addMonthsKey, formatDate, formatMonth, formatRelative, monthOf, type DateKey, type MonthKey } from '../domain/dates'
import {
  buildPaidIndex,
  categoryInfo,
  formatMoney,
  monthlyCost,
  monthMoney,
  nextDueDate,
  occurrences,
  remainingPayments,
  savingStats,
  totalsByCategory,
} from '../domain/money'
import { plural } from '../lib/plural'
import { useLocalSetting, useToday } from '../lib/hooks'
import { CheckButton, EmptyState, PeriodNav, ProgressBar, ScreenHeader, Segmented } from '../ui/components'
import { IconPlus } from '../ui/icons'
import { PaymentForm, SavingEntryForm, SavingForm, TransactionForm } from './finance-parts'

type Mode = 'ops' | 'savings' | 'payments'

export function FinanceScreen() {
  const today = useToday()
  const [mode, setMode] = useLocalSetting<Mode>('finance.mode', 'ops')
  const [month, setMonth] = useState(() => monthOf(today))
  const transactions = useRows('transactions') ?? []
  const categories = useRows('categories') ?? []
  const payments = useRows('payments') ?? []
  const savings = useRows('savings') ?? []
  const entries = useRows('savingEntries') ?? []
  const goals = useRows('goals') ?? []

  const [txnForm, setTxnForm] = useState<{ txn?: Transaction; type?: MoneyType } | null>(null)
  const [paymentForm, setPaymentForm] = useState<{ payment?: Payment } | null>(null)
  const [savingForm, setSavingForm] = useState<{ saving?: Saving } | null>(null)
  const [entryForm, setEntryForm] = useState<{ saving: Saving; direction: 1 | -1 } | null>(null)

  function onAdd() {
    if (mode === 'savings') setSavingForm({})
    else if (mode === 'payments') setPaymentForm({})
    else setTxnForm({})
  }

  return (
    <>
      <ScreenHeader
        title="Финансы"
        action={
          <button class="btn btn--small btn--primary" onClick={onAdd}>
            <IconPlus size={18} />
            <span class="desktop-only">{mode === 'savings' ? 'Цель' : mode === 'payments' ? 'Платёж' : 'Операция'}</span>
          </button>
        }
      />

      <div class="toolbar">
        <Segmented
          label="Раздел"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'ops', label: 'Операции' },
            { value: 'savings', label: 'Накопления' },
            { value: 'payments', label: 'Платежи' },
          ]}
        />
        {mode === 'ops' && (
          <PeriodNav
            title={formatMonth(month)}
            onShift={(d) => setMonth(addMonthsKey(month, d))}
            onToday={() => setMonth(monthOf(today))}
            isCurrent={month === monthOf(today)}
          />
        )}
      </div>

      {mode === 'ops' && (
        <Operations
          month={month}
          today={today}
          transactions={transactions}
          entries={entries}
          categories={categories}
          onAdd={(type) => setTxnForm({ type })}
          onOpen={(txn) => setTxnForm({ txn })}
        />
      )}
      {mode === 'savings' && (
        <Savings
          savings={savings}
          entries={entries}
          today={today}
          onCreate={() => setSavingForm({})}
          onOpen={(saving) => setSavingForm({ saving })}
          onEntry={(saving, direction) => setEntryForm({ saving, direction })}
        />
      )}
      {mode === 'payments' && (
        <Payments payments={payments} transactions={transactions} today={today} onCreate={() => setPaymentForm({})} onOpen={(payment) => setPaymentForm({ payment })} />
      )}

      {txnForm && <TransactionForm txn={txnForm.txn} defaultType={txnForm.type} categories={categories} today={today} onClose={() => setTxnForm(null)} />}
      {paymentForm && <PaymentForm payment={paymentForm.payment} categories={categories} today={today} onClose={() => setPaymentForm(null)} />}
      {savingForm && <SavingForm saving={savingForm.saving} entries={entries} goals={goals} today={today} onClose={() => setSavingForm(null)} />}
      {entryForm && (
        <SavingEntryForm saving={entryForm.saving} entries={entries} direction={entryForm.direction} today={today} onClose={() => setEntryForm(null)} />
      )}
    </>
  )
}

/* ===================== Операции ===================== */

function Operations(props: {
  month: MonthKey
  today: DateKey
  transactions: Transaction[]
  entries: SavingEntry[]
  categories: Category[]
  onAdd: (type: MoneyType) => void
  onOpen: (txn: Transaction) => void
}) {
  const { month, today, categories } = props
  const summary = monthMoney(props.transactions, props.entries, month)
  const byCategory = totalsByCategory(props.transactions, month, 'expense')
  const list = props.transactions
    .filter((t) => monthOf(t.date) === month)
    .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : b.updatedAt - a.updatedAt))
  const days = new Map<DateKey, Transaction[]>()
  for (const t of list) days.set(t.date, [...(days.get(t.date) ?? []), t])

  return (
    <>
      <section class="card money-summary">
        <div class="money-stats">
          <Stat label="Доходы" value={summary.income} tone="income" />
          <Stat label="Расходы" value={summary.expense} tone="expense" />
          <Stat label="Отложено" value={summary.saved} tone="saved" />
          <Stat label="Остаток" value={summary.balance} tone={summary.balance < 0 ? 'expense' : 'plain'} />
        </div>
        <div class="money-actions">
          <button class="btn btn--secondary btn--small" onClick={() => props.onAdd('expense')}>
            − Расход
          </button>
          <button class="btn btn--secondary btn--small" onClick={() => props.onAdd('income')}>
            + Доход
          </button>
        </div>
      </section>

      {byCategory.length > 0 && (
        <section class="card">
          <h2>Расходы по категориям</h2>
          <ul class="rank-list">
            {byCategory.map((row) => {
              const info = categoryInfo(row.category, categories)
              return (
                <li key={row.category} class="rank-row">
                  <span class="rank-row__name">
                    <span aria-hidden="true">{info.emoji}</span> {info.title}
                    <span class="muted"> · {row.share}%</span>
                  </span>
                  <span class="rank-row__pct tabular">{formatMoney(row.amount)}</span>
                  <ProgressBar value={row.share} tone="pink" />
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {list.length === 0 ? (
        <EmptyState title="Операций за месяц нет" text="Записывайте расходы и доходы — здесь появятся итоги месяца и расходы по категориям." />
      ) : (
        <section class="card">
          <h2>Операции</h2>
          {[...days.entries()].map(([day, items]) => {
            const net = items.reduce((sum, t) => sum + (t.type === 'income' ? t.amount : -t.amount), 0)
            return (
              <div key={day} class="day-group">
                <h3 class="section-title section-title--split">
                  <span>{formatRelative(day, today)}</span>
                  <span class="tabular">{formatMoney(net, { sign: true })}</span>
                </h3>
                <ul class="txn-list">
                  {items.map((t) => {
                    const info = categoryInfo(t.category, categories)
                    return (
                      <li key={t.id}>
                        <button class="txn-row" onClick={() => props.onOpen(t)}>
                          <span class="txn-row__emoji" aria-hidden="true">
                            {info.emoji}
                          </span>
                          <span class="txn-row__text">
                            <span class="txn-row__title">{t.note || info.title}</span>
                            {t.note && <span class="txn-row__meta">{info.title}</span>}
                          </span>
                          <span class={`txn-row__amount tabular${t.type === 'income' ? ' text-income' : ''}`}>
                            {formatMoney(t.type === 'income' ? t.amount : -t.amount, { sign: t.type === 'income' })}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </section>
      )}
    </>
  )
}

function Stat(props: { label: string; value: number; tone: 'income' | 'expense' | 'saved' | 'plain' }) {
  return (
    <div class={`stat stat--${props.tone}`}>
      <span class="stat__label">{props.label}</span>
      <span class="stat__value tabular">{formatMoney(props.value)}</span>
    </div>
  )
}

/* ===================== Накопления ===================== */

function Savings(props: {
  savings: Saving[]
  entries: SavingEntry[]
  today: DateKey
  onCreate: () => void
  onOpen: (saving: Saving) => void
  onEntry: (saving: Saving, direction: 1 | -1) => void
}) {
  const { today } = props
  if (props.savings.length === 0) {
    return (
      <EmptyState title="Целей накоплений пока нет" text="Укажите сумму и срок — Планер посчитает, сколько откладывать в месяц.">
        <button class="btn btn--primary" onClick={props.onCreate}>
          Создать цель
        </button>
      </EmptyState>
    )
  }
  const sorted = [...props.savings].sort((a, b) => a.order - b.order)
  const total = sorted.reduce((sum, s) => sum + savingStats(s, props.entries, today).current, 0)

  return (
    <>
      <p class="muted">
        Всего накоплено: <b class="text-strong tabular">{formatMoney(total)}</b>
      </p>
      <div class="saving-grid">
        {sorted.map((saving) => {
          const stats = savingStats(saving, props.entries, today)
          return (
            <section key={saving.id} class="card saving-card">
              <button class="saving-card__head" onClick={() => props.onOpen(saving)}>
                <span class="saving-card__emoji" aria-hidden="true">
                  {saving.emoji}
                </span>
                <span class="saving-card__title">{saving.title}</span>
                <span class="saving-card__pct tabular">{stats.pct}%</span>
              </button>
              <p class="saving-card__amount tabular">
                <b>{formatMoney(stats.current)}</b> <span class="muted">из {formatMoney(saving.target)}</span>
              </p>
              <ProgressBar value={stats.pct} />
              <p class="muted small">
                {stats.reached
                  ? 'Цель достигнута 🎉'
                  : stats.perMonth !== null
                    ? `≈ ${formatMoney(stats.perMonth)} в месяц до ${formatDate(saving.deadline!, today)} (${stats.monthsLeft} ${plural(stats.monthsLeft!, 'месяц', 'месяца', 'месяцев')})`
                    : `Осталось ${formatMoney(stats.left)}`}
              </p>
              <div class="saving-card__actions">
                <button class="btn btn--primary btn--small" onClick={() => props.onEntry(saving, 1)}>
                  Пополнить
                </button>
                <button class="btn btn--ghost btn--small" onClick={() => props.onEntry(saving, -1)} disabled={stats.current <= 0}>
                  Снять
                </button>
              </div>
            </section>
          )
        })}
      </div>
    </>
  )
}

/* ===================== Платежи ===================== */

function Payments(props: { payments: Payment[]; transactions: Transaction[]; today: DateKey; onCreate: () => void; onOpen: (p: Payment) => void }) {
  const { db } = useApp()
  const { today } = props
  if (props.payments.length === 0) {
    return (
      <EmptyState title="Регулярных платежей нет" text="Подписки, кредиты, коммуналка — Планер напомнит накануне и запишет расход в одно касание.">
        <button class="btn btn--primary" onClick={props.onCreate}>
          Добавить платёж
        </button>
      </EmptyState>
    )
  }

  const paid = buildPaidIndex(props.transactions)
  // Неоплаченные за последние 2 месяца + всё на ближайшие 30 дней.
  const upcoming = occurrences(props.payments, paid, addDaysKey(today, -60), addDaysKey(today, 30)).filter(
    (o) => o.dueDate >= today || !o.paid,
  )
  const dueSum = upcoming.filter((o) => !o.paid).reduce((sum, o) => sum + o.payment.amount, 0)
  const perMonth = props.payments.reduce((sum, p) => sum + (p.endDate && p.endDate < today ? 0 : monthlyCost(p)), 0)
  const sorted = [...props.payments].sort((a, b) => a.order - b.order)

  return (
    <>
      <section class="card">
        <div class="card__head">
          <h2>Ближайшие 30 дней</h2>
          <span class="muted tabular">{formatMoney(dueSum)}</span>
        </div>
        {upcoming.length === 0 ? (
          <p class="muted">Платежей в ближайший месяц нет.</p>
        ) : (
          <ul class="task-list">
            {upcoming.map((o) => {
              const overdue = !o.paid && o.dueDate < today
              return (
                <li key={`${o.payment.id}:${o.dueDate}`}>
                  <div class={`task-row${o.paid ? ' task-row--done' : ''}`}>
                    <CheckButton done={o.paid !== null} onClick={() => void togglePaid(db, o.payment, o.dueDate, today)} label={o.paid ? 'Снять оплату' : 'Оплачено'} />
                    <button class="task-row__body" onClick={() => props.onOpen(o.payment)}>
                      <span class="task-row__title">
                        {o.payment.emoji} {o.payment.title}
                      </span>
                      <span class="task-row__meta">
                        <span class={overdue ? 'meta-overdue' : ''}>
                          {overdue ? 'просрочен с ' : ''}
                          {formatRelative(o.dueDate, today).toLowerCase()}
                        </span>
                        {o.paid && <span>оплачено</span>}
                      </span>
                    </button>
                    <span class="task-row__amount tabular">{formatMoney(o.payment.amount)}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section class="card">
        <div class="card__head">
          <h2>Все регулярные</h2>
          <span class="muted tabular">≈ {formatMoney(Math.round(perMonth))} в мес</span>
        </div>
        <ul class="txn-list">
          {sorted.map((p) => {
            const next = nextDueDate(p, today)
            const left = remainingPayments(p, paid)
            const period = p.schedule.type === 'yearly' ? 'в год' : p.schedule.type === 'weekly' ? 'в неделю' : 'в месяц'
            return (
              <li key={p.id}>
                <button class="txn-row" onClick={() => props.onOpen(p)}>
                  <span class="txn-row__emoji" aria-hidden="true">
                    {p.emoji}
                  </span>
                  <span class="txn-row__text">
                    <span class="txn-row__title">{p.title}</span>
                    <span class="txn-row__meta">
                      {next ? `следующий ${formatRelative(next, today).toLowerCase()}` : 'выплачен'}
                      {left && left.count > 0 && ` · осталось ${left.count} ${plural(left.count, 'платёж', 'платежа', 'платежей')} на ${formatMoney(left.total)}`}
                    </span>
                  </span>
                  <span class="txn-row__amount tabular">
                    {formatMoney(p.amount)} <span class="muted small">{period}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    </>
  )
}
