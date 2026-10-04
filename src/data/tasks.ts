import type { PlannerDB } from '../db/db'
import type { Project, Task } from '../db/types'
import type { DateKey } from '../domain/dates'
import { insert, nextOrder, remove, update, updateMany, type Fields } from './entities'

export type TaskInput = Pick<Task, 'title'> & Partial<Omit<Fields<Task>, 'title' | 'order'>>

export async function createTask(db: PlannerDB, input: TaskInput): Promise<string> {
  return insert(db, 'tasks', {
    note: '',
    projectId: null,
    date: null,
    time: null,
    priority: 0,
    doneAt: null,
    ...input,
    title: input.title.trim(),
    order: await nextOrder(db, 'tasks'),
  })
}

export function updateTask(db: PlannerDB, id: string, changes: Partial<Fields<Task>>) {
  return update(db, 'tasks', id, changes)
}

/** Отметить сделанной сегодня / вернуть в работу. */
export function toggleTask(db: PlannerDB, task: Task, today: DateKey) {
  return update(db, 'tasks', task.id, { doneAt: task.doneAt ? null : today })
}

/** Перенести задачи на день (например, все просроченные — на сегодня). */
export function moveTasks(db: PlannerDB, ids: string[], date: DateKey | null) {
  return updateMany(db, 'tasks', ids, () => ({ date }))
}

export function deleteTask(db: PlannerDB, id: string) {
  return remove(db, 'tasks', id)
}

export type ProjectInput = Pick<Project, 'title' | 'emoji'> & Partial<Omit<Fields<Project>, 'title' | 'emoji' | 'order'>>

export async function createProject(db: PlannerDB, input: ProjectInput): Promise<string> {
  return insert(db, 'projects', {
    note: '',
    deadline: null,
    goalId: null,
    doneAt: null,
    ...input,
    title: input.title.trim(),
    order: await nextOrder(db, 'projects'),
  })
}

export function updateProject(db: PlannerDB, id: string, changes: Partial<Fields<Project>>) {
  return update(db, 'projects', id, changes)
}

/** Удалить проект; его задачи — тоже или оставить без проекта. */
export async function deleteProject(db: PlannerDB, id: string, withTasks: boolean) {
  const tasks = (await db.tasks.where('projectId').equals(id).toArray()).filter((t) => !t.deleted).map((t) => t.id)
  if (withTasks) await remove(db, 'tasks', tasks)
  else await updateMany(db, 'tasks', tasks, () => ({ projectId: null }))
  await remove(db, 'projects', id)
}
