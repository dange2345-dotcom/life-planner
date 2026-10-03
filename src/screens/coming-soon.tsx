import { ScreenHeader } from '../ui/components'

const SECTIONS = {
  tasks: {
    title: 'Задачи',
    stage: 3,
    items: ['Проекты с подзадачами и процентом выполнения', 'Задачи на день с переносом несделанных', 'Приоритеты', 'Календарь месяца со сроками'],
  },
  finance: {
    title: 'Финансы',
    stage: 4,
    items: ['Расходы и доходы по категориям', 'Цели накоплений с процентом', 'Подписки, кредиты и регулярные платежи'],
  },
  goals: {
    title: 'Цели',
    stage: 5,
    items: ['Цели на год по сферам жизни', 'Привязка привычек, проектов и накоплений', 'Общий процент по каждой цели'],
  },
} as const

export function ComingSoonScreen({ section }: { section: keyof typeof SECTIONS }) {
  const info = SECTIONS[section]
  return (
    <>
      <ScreenHeader title={info.title} />
      <section class="card stack">
        <h2>Скоро — этап {info.stage}</h2>
        <ul class="plain-list">
          {info.items.map((item) => (
            <li>{item}</li>
          ))}
        </ul>
      </section>
    </>
  )
}
