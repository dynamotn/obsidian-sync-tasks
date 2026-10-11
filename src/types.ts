/** A task pulled from any tracker, in one shape for every provider. */
export interface Task {
  /** Unique within its source, and safe to show in a file name (e.g. "PROJ-12"). */
  id: string
  title: string
  /** The tracker's own state name, e.g. "In Progress". */
  state: string
  /** Kind of task, e.g. "Bug" or "Story". */
  type: string
  assignee: string
  url: string
  description: string
  /** ISO date (YYYY-MM-DD) or empty. */
  due: string
  /** ISO date (YYYY-MM-DD) or empty. */
  created: string
  tags: string[]
  /** Finished, resolved, closed or archived. */
  done: boolean
  /** Board column, when it differs from the state name. */
  column?: string
  /** Sub-folder of its group to keep the note in, e.g. "2026/Q4/October". */
  folder?: string
  /** Extra template variables, available as {{TASK_<KEY>}}. */
  fields?: Record<string, string>
}

/** A batch of tasks that share a folder and, optionally, a Kanban board. */
export interface TaskGroup {
  /** Folder relative to the source's folder; "" for the source folder itself. */
  folder: string
  tasks: Task[]
  /** Board to generate in that folder. */
  board?: { name: string; columns: string[] }
  /**
   * Keep finished tasks in a "Completed" sub-folder, and move notes in and out
   * of it as tasks are closed or reopened.
   */
  splitCompleted?: boolean
}
