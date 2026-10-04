import { useState } from 'preact/hooks'
import { useApp } from '../app-context'
import {
  addSavingEntry,
  createCategory,
  createPayment,
  createSaving,
  createTransaction,
  deletePayment,
  deleteSaving,
  deleteSavingEntry,
  deleteTransaction,
  updatePayment,
  updateSaving,
  updateTransaction,
} from '../data/money'
import type { Category, Goal, MoneyType, Payment, PaymentKind, Saving, SavingEntry, Transaction } from '../db/types'
import { formatDate, type DateKey } from '../domain/dates'
import {
  categoriesOf,
  categoryInfo,
  formatMoney,
  nextDueDate,
  parseAmount,
  PAYMENT_KINDS,
  savingStats,
  scheduleFromDate,
} from '../domain/money'
import { Segmented, Sheet } from '../ui/components'
import { EmojiPicker } from './task-parts'

/* ===================== Сумма ===================== */

function AmountField(props: { value: string; onChange: (value: string) => void; label?: string; autoFocus?: boolean }) {
  return (
    <label class="field">
      <span>{props.label ?? 'Сумма, ₽'}</span>
      <input
        class="amount-input tabular"
        inputMode="decimal"
        value={props.value}
        onInput={(e) => props.onChange(e.currentTarget.value)}
        placeholder="0"
        autoFocus={props.autoFocus}
        enterKeyHint="done"
        autoComplete="off"
      />
    </label>
  )
}

const amountText = (amount: number | undefined) => (amount === undefined ? '' : String(amount).replace('.', ','))

/* ===================== Операция ===================== */

const CATEGORY_EMOJIS = ['🐈', '👶', '🚬', '🍺', '☕', '🎮', '🧸', '🪴', '🔧', '⛽', '🎟️', '💻', '🐶', '🧾', '🎵', '🛍️']

export function TransactionForm(props: { txn?: Transaction; defaultType?: MoneyType; categories: Category[]; today: DateKey; onClose: () => void }) {
  const { db } = useApp()
  const editing = props.txn
  const [type, setType] = useState<MoneyType>(editing?.type ?? props.defaultType ?? 'expense')
  const [amount, setAmount] = useState(amountText(editing?.amount))
  const [category, setCategory] = useState(editing?.category ?? '')
  const [date, setDate] = useState(editing?.date ?? props.today)
  const [note, setNote] = useState(editing?.note ?? '')
  const [newCategory, setNewCategory] = useState<{ title: string; emoji: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const list = categoriesOf(type, props.categories)

  function switchType(next: MoneyType) {
    setType(next)
    if (category && categoryInfo(category, props.categories).type !== next) setCategory('')
  }

  async function onSubmit(event: Event) {
    event.preventDefault()
    const value = parseAmount(amount)
    if (value === null) return setError('Введите сумму, например 1250 или 350+120')
    if (!category) return setError('Выберите категорию')
    if (!date) return setError('Укажите дату')
    if (editing) await updateTransaction(db, editing.id, { type, amount: value, category, date, note: note.trim() })
    else await createTransaction(db, { type, amount: value, category, date, note })
    props.onClose()
  }

  async function addCategory() {
    if (!newCategory?.title.trim()) return
    const id = await createCategory(db, { type, title: newCategory.title, emoji: newCategory.emoji })
    setCategory(id)
    setNewCategory(null)
  }

  async function onDelete() {
    if (!editing || !confirm('Удалить операцию?')) return
    await deleteTransaction(db, editing.id)
    props.onClose()
  }

  return (
    <Sheet title={editing ? 'Операция' : type === 'expense' ? 'Новый расход' : 'Новый доход'} onClose={props.onClose}>
      <form class="form" onSubmit={onSubmit}>
        <Segmented
          label="Тип"
          value={type}
          onChange={switchType}
          options={[
            { value: 'expense', label: 'Расход' },
            { value: 'income', label: 'Доход' },
          ]}
        />
        <AmountField value={amount} onChange={setAmount} autoFocus={!editing} />

        <div class="field">
          <span>Категория</span>
          <div class="cat-grid" role="radiogroup" aria-label="Категория">
            {list.map((c) => (
              <button type="button" role="radio" aria-checked={c.id === category} class={`cat-btn${c.id === category ? ' cat-btn--active' : ''}`} onClick={() => setCategory(c.id)}>
                <span aria-hidden="true">{c.emoji}</span>
                <span class="cat-btn__title">{c.title}</span>
              </button>
            ))}
            {!newCategory && (
              <button type="button" class="cat-btn cat-btn--add" onClick={() => setNewCategory({ title: '', emoji: CATEGORY_EMOJIS[0] })}>
                <span aria-hidden="true">＋</span>
                <span class="cat-btn__title">Своя</span>
              </button>
            )}
          </div>
        </div>

        {newCategory && (
          <div class="inline-panel stack-sm">
            <EmojiPicker list={CATEGORY_EMOJIS} value={newCategory.emoji} onChange={(emoji) => setNewCategory({ ...newCategory, emoji })} />
            <div class="field-row">
              <input
                value={newCategory.title}
                onInput={(e) => setNewCategory({ ...newCategory, title: e.currentTarget.value })}
                placeholder="Название категории"
                aria-label="Название категории"
                maxLength={40}
              />
              <button type="button" class="btn btn--secondary" onClick={addCategory} disabled={!newCategory.title.trim()}>
                Добавить
              </button>
            </div>
            <button type="button" class="btn btn--ghost btn--small" onClick={() => setNewCategory(null)}>
              Отмена
            </button>
          </div>
        )}

        <div class="field-row">
          <label class="field">
            <span>Дата</span>
            <input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} />
          </label>
          <label class="field field--grow">
            <span>Комментарий</span>
            <input value={note} onInput={(e) => setNote(e.currentTarget.value)} placeholder="необязательно" maxLength={120} />
          </label>
        </div>

        {editing?.paymentId && editing.dueDate && <p class="hint">Оплата регулярного платежа за {formatDate(editing.dueDate, props.today)}.</p>}
        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
        <button class="btn btn--primary" type="submit">
          {editing ? 'Сохранить' : 'Добавить'}
        </button>
        {editing && (
          <div class="form__secondary">
            <button type="button" class="btn btn--ghost btn--danger" onClick={onDelete}>
              Удалить операцию
            </button>
          </div>
        )}
      </form>
    </Sheet>
  )
}

/* ===================== Регулярный платёж ===================== */

const PAYMENT_EMOJIS = ['🔁', '🏦', '🏠', '📱', '🌐', '🎬', '🎵', '☁️', '💡', '🚗', '🏋️', '📺', '💳', '🧾', '🛡️', '🎓']

export function PaymentForm(props: { payment?: Payment; categories: Category[]; today: DateKey; onClose: () => void }) {
  const { db } = useApp()
  const editing = props.payment
  const [title, setTitle] = useState(editing?.title ?? '')
  const [emoji, setEmoji] = useState(editing?.emoji ?? '🔁')
  const [kind, setKind] = useState<PaymentKind>(editing?.kind ?? 'subscription')
  const [amount, setAmount] = useState(amountText(editing?.amount))
  const [repeat, setRepeat] = useState<Payment['schedule']['type']>(editing?.schedule.type ?? 'monthly')
  const initialNext = editing ? (nextDueDate(editing, props.today) ?? editing.startDate) : props.today
  const [next, setNext] = useState(initialNext)
  const [endDate, setEndDate] = useState(editing?.endDate ?? '')
  const [category, setCategory] = useState(editing?.category ?? 'subscriptions')
  const [note, setNote] = useState(editing?.note ?? '')
  const [error, setError] = useState<string | null>(null)

  function changeKind(value: PaymentKind) {
    setKind(value)
    if (!editing) {
      setEmoji(PAYMENT_KINDS.find((k) => k.value === value)!.emoji)
      setCategory(value === 'credit' ? 'credit' : value === 'bill' ? 'home' : value === 'subscription' ? 'subscriptions' : 'other')
    }
  }

  async function onSubmit(event: Event) {
    event.preventDefault()
    const value = parseAmount(amount)
    if (!title.trim()) return setError('Как называется платёж?')
    if (value === null) return setError('Введите сумму')
    if (!next) return setError('Когда ближайший платёж?')
    if (endDate && endDate < next) return setError('Последний платёж раньше ближайшего')
    const schedule = scheduleFromDate(next, repeat)
    // Дату начала сдвигаем, только если расписание поменялось — иначе сохраняется история оплат.
    const unchanged = editing && next === initialNext && repeat === editing.schedule.type
    const fields = {
      title: title.trim(),
      emoji,
      kind,
      amount: value,
      category,
      schedule: unchanged ? editing.schedule : schedule,
      startDate: unchanged ? editing.startDate : next,
      endDate: endDate || null,
      note: note.trim(),
    }
    if (editing) await updatePayment(db, editing.id, fields)
    else await createPayment(db, fields)
    props.onClose()
  }

  async function onDelete() {
    if (!editing || !confirm(`Удалить платёж «${editing.title}»? Уже записанные оплаты останутся в операциях.`)) return
    await deletePayment(db, editing.id)
    props.onClose()
  }

  return (
    <Sheet title={editing ? 'Регулярный платёж' : 'Новый платёж'} onClose={props.onClose}>
      <form class="form" onSubmit={onSubmit}>
        <Segmented label="Вид" value={kind} onChange={changeKind} options={PAYMENT_KINDS.map((k) => ({ value: k.value, label: k.label }))} />
        <EmojiPicker list={PAYMENT_EMOJIS} value={emoji} onChange={setEmoji} />
        <label class="field">
          <span>Название</span>
          <input value={title} onInput={(e) => setTitle(e.currentTarget.value)} placeholder={kind === 'credit' ? 'Например, ипотека' : 'Например, Яндекс Плюс'} maxLength={80} />
        </label>
        <AmountField value={amount} onChange={setAmount} label="Сумма платежа, ₽" />
        <div class="field">
          <span>Повтор</span>
          <Segmented
            label="Повтор"
            value={repeat}
            onChange={setRepeat}
            options={[
              { value: 'monthly', label: 'Каждый месяц' },
              { value: 'yearly', label: 'Каждый год' },
              { value: 'weekly', label: 'Каждую неделю' },
            ]}
          />
        </div>
        <div class="field-row">
          <label class="field">
            <span>Ближайший платёж</span>
            <input type="date" value={next} onInput={(e) => setNext(e.currentTarget.value)} />
          </label>
          <label class="field">
            <span>Последний (необяз.)</span>
            <input type="date" value={endDate} min={next} onInput={(e) => setEndDate(e.currentTarget.value)} />
          </label>
        </div>
        <label class="field">
          <span>Категория расхода</span>
          <select value={category} onChange={(e) => setCategory(e.currentTarget.value)}>
            {categoriesOf('expense', props.categories).map((c) => (
              <option value={c.id}>
                {c.emoji} {c.title}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span>Заметка</span>
          <input value={note} onInput={(e) => setNote(e.currentTarget.value)} placeholder="необязательно" maxLength={200} />
        </label>
        <p class="hint">Утром накануне и в день платежа придёт напоминание. «Оплачено» сразу записывает расход.</p>
        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
        <button class="btn btn--primary" type="submit">
          {editing ? 'Сохранить' : 'Добавить платёж'}
        </button>
        {editing && (
          <div class="form__secondary">
            <button type="button" class="btn btn--ghost btn--danger" onClick={onDelete}>
              Удалить платёж
            </button>
          </div>
        )}
      </form>
    </Sheet>
  )
}

/* ===================== Накопления ===================== */

const SAVING_EMOJIS = ['💰', '🏠', '🚗', '✈️', '🛡️', '🎓', '💍', '📱', '💻', '🏖️', '👶', '🎁']

export function SavingForm(props: { saving?: Saving; entries: SavingEntry[]; goals: Goal[]; today: DateKey; onClose: () => void }) {
  const { db } = useApp()
  const editing = props.saving
  const [title, setTitle] = useState(editing?.title ?? '')
  const [emoji, setEmoji] = useState(editing?.emoji ?? '💰')
  const [target, setTarget] = useState(amountText(editing?.target))
  const [initial, setInitial] = useState('')
  const [deadline, setDeadline] = useState(editing?.deadline ?? '')
  const [goalId, setGoalId] = useState(editing?.goalId ?? '')
  const [error, setError] = useState<string | null>(null)
  const history = editing ? props.entries.filter((e) => e.savingId === editing.id).sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : b.updatedAt - a.updatedAt)) : []

  async function onSubmit(event: Event) {
    event.preventDefault()
    const value = parseAmount(target)
    if (!title.trim()) return setError('На что копим?')
    if (value === null) return setError('Сколько нужно накопить?')
    const start = initial.trim() ? parseAmount(initial) : 0
    if (start === null) return setError('Проверьте, сколько уже есть')
    const fields = { title: title.trim(), emoji, target: value, deadline: deadline || null, goalId: goalId || null }
    if (editing) await updateSaving(db, editing.id, fields)
    else await createSaving(db, fields, start, props.today)
    props.onClose()
  }

  async function onDelete() {
    if (!editing || !confirm(`Удалить цель накоплений «${editing.title}» вместе с историей пополнений?`)) return
    await deleteSaving(db, editing.id)
    props.onClose()
  }

  return (
    <Sheet title={editing ? 'Накопления' : 'Новая цель накоплений'} onClose={props.onClose}>
      <form class="form" onSubmit={onSubmit}>
        <EmojiPicker list={SAVING_EMOJIS} value={emoji} onChange={setEmoji} />
        <label class="field">
          <span>На что копим</span>
          <input value={title} onInput={(e) => setTitle(e.currentTarget.value)} placeholder="Например, подушка безопасности" maxLength={80} />
        </label>
        <div class="field-row">
          <AmountField value={target} onChange={setTarget} label="Цель, ₽" />
          {!editing && <AmountField value={initial} onChange={setInitial} label="Уже есть, ₽" />}
        </div>
        <label class="field">
          <span>К какому сроку (необязательно)</span>
          <input type="date" value={deadline} onInput={(e) => setDeadline(e.currentTarget.value)} />
        </label>
        {props.goals.length > 0 && (
          <label class="field">
            <span>Цель на год</span>
            <select value={goalId} onChange={(e) => setGoalId(e.currentTarget.value)}>
              <option value="">Не привязана</option>
              {props.goals.map((g) => (
                <option value={g.id}>
                  {g.emoji} {g.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
        <button class="btn btn--primary" type="submit">
          {editing ? 'Сохранить' : 'Создать'}
        </button>

        {history.length > 0 && (
          <div class="stack-sm">
            <h3 class="section-title">История</h3>
            <ul class="entry-list">
              {history.map((entry) => (
                <li key={entry.id}>
                  <span class="muted tabular">{formatDate(entry.date, props.today)}</span>
                  <span class="entry-list__note">{entry.note}</span>
                  <span class={`tabular ${entry.amount > 0 ? 'text-income' : 'text-expense'}`}>{formatMoney(entry.amount, { sign: true })}</span>
                  <button
                    type="button"
                    class="icon-btn icon-btn--small"
                    aria-label="Удалить запись"
                    onClick={() => confirm('Удалить запись?') && void deleteSavingEntry(db, entry.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {editing && (
          <div class="form__secondary">
            <button type="button" class="btn btn--ghost btn--danger" onClick={onDelete}>
              Удалить
            </button>
          </div>
        )}
      </form>
    </Sheet>
  )
}

/** Пополнить или снять с накоплений. */
export function SavingEntryForm(props: { saving: Saving; entries: SavingEntry[]; direction: 1 | -1; today: DateKey; onClose: () => void }) {
  const { db } = useApp()
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(props.today)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const stats = savingStats(props.saving, props.entries, props.today)

  async function onSubmit(event: Event) {
    event.preventDefault()
    const value = parseAmount(amount)
    if (value === null) return setError('Введите сумму')
    if (props.direction < 0 && value > stats.current) return setError(`Накоплено только ${formatMoney(stats.current)}`)
    await addSavingEntry(db, { savingId: props.saving.id, amount: value * props.direction, date, note })
    props.onClose()
  }

  return (
    <Sheet title={`${props.direction > 0 ? 'Пополнить' : 'Снять'}: ${props.saving.emoji} ${props.saving.title}`} onClose={props.onClose}>
      <form class="form" onSubmit={onSubmit}>
        <p class="muted">
          Сейчас {formatMoney(stats.current)} из {formatMoney(props.saving.target)}
          {stats.perMonth !== null && ` · нужно ≈ ${formatMoney(stats.perMonth)} в месяц`}
        </p>
        <AmountField value={amount} onChange={setAmount} autoFocus />
        <div class="field-row">
          <label class="field">
            <span>Дата</span>
            <input type="date" value={date} onInput={(e) => setDate(e.currentTarget.value)} />
          </label>
          <label class="field field--grow">
            <span>Комментарий</span>
            <input value={note} onInput={(e) => setNote(e.currentTarget.value)} placeholder="необязательно" maxLength={120} />
          </label>
        </div>
        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
        <button class="btn btn--primary" type="submit">
          {props.direction > 0 ? 'Пополнить' : 'Снять'}
        </button>
      </form>
    </Sheet>
  )
}
