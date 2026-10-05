import type { ComponentType } from 'preact'
import { useHashRoute } from '../lib/hooks'
import { IconFinance, IconGoals, IconHabits, IconSettings, IconStudy, IconTasks, IconToday } from '../ui/icons'
import { FinanceScreen } from './finance'
import { GoalsScreen } from './goals'
import { HabitsScreen } from './habits'
import { SettingsScreen } from './settings'
import { StudyScreen } from './study'
import { TasksScreen } from './tasks'
import { TodayScreen } from './today'

const TABS: { route: string; label: string; Icon: ComponentType<{ size?: number }> }[] = [
  { route: 'today', label: 'Сегодня', Icon: IconToday },
  { route: 'habits', label: 'Привычки', Icon: IconHabits },
  { route: 'tasks', label: 'Задачи', Icon: IconTasks },
  { route: 'finance', label: 'Финансы', Icon: IconFinance },
  { route: 'goals', label: 'Цели', Icon: IconGoals },
  { route: 'study', label: 'Учёба', Icon: IconStudy },
]

export function Shell() {
  const raw = useHashRoute()
  const route = raw === 'settings' || TABS.some((tab) => tab.route === raw) ? raw : 'today'

  return (
    <div class="shell">
      <nav class="tabbar" aria-label="Разделы">
        <div class="tabbar__brand desktop-only">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={28} height={28} />
          <span>Планер</span>
        </div>
        {TABS.map(({ route: tab, label, Icon }) => (
          <a href={`#/${tab}`} class={`tab${route === tab ? ' tab--active' : ''}`} aria-current={route === tab ? 'page' : undefined}>
            <Icon size={24} />
            <span>{label}</span>
          </a>
        ))}
        <a
          href="#/settings"
          class={`tab tab--settings desktop-only${route === 'settings' ? ' tab--active' : ''}`}
          aria-current={route === 'settings' ? 'page' : undefined}
        >
          <IconSettings size={24} />
          <span>Настройки</span>
        </a>
      </nav>

      <main class="main" key={route}>
        {route === 'today' && <TodayScreen />}
        {route === 'habits' && <HabitsScreen />}
        {route === 'tasks' && <TasksScreen />}
        {route === 'finance' && <FinanceScreen />}
        {route === 'goals' && <GoalsScreen />}
        {route === 'study' && <StudyScreen />}
        {route === 'settings' && <SettingsScreen />}
      </main>
    </div>
  )
}
