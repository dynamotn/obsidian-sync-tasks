import type { Task } from "./types"
import { safeFileName } from "./util"

export const DEFAULT_NOTE_NAME = "{{TASK_TYPE}} - {{TASK_ID}}"

export const DEFAULT_NOTE_TEMPLATE = [
  "# {{TASK_TITLE}}",
  "#{{TASK_TYPE}}",
  "",
  "id: {{TASK_ID}}",
  "state: {{TASK_STATE}}",
  "AssignedTo: {{TASK_ASSIGNEDTO}}",
  "",
  "Link: {{TASK_LINK}}",
  "",
  "{{TASK_DESCRIPTION}}",
  "",
  "#todo:",
  "- [ ] Create todo list",
  "- [ ] ",
  "",
  "## Notes:",
  "",
].join("\n")

/** The variables every template can use, for the settings help text. */
export const TEMPLATE_VARIABLES = [
  "TASK_ID",
  "TASK_TITLE",
  "TASK_NAME",
  "TASK_TYPE",
  "TASK_STATE",
  "TASK_ASSIGNEDTO",
  "TASK_LINK",
  "TASK_DESCRIPTION",
  "TASK_DUEDATE",
  "TASK_CREATED",
  "TASK_TAGS",
  "SOURCE_NAME",
  "SOURCE_TYPE",
]

export interface TemplateSource {
  name: string
  provider: string
}

/** Template variables of a task, keyed without the braces. */
export function variables(task: Task, source: TemplateSource): Record<string, string> {
  const vars: Record<string, string> = {
    TASK_ID: task.id,
    TASK_TITLE: task.title,
    TASK_NAME: safeFileName(task.title),
    TASK_TYPE: task.type.replace(/\s+/g, ""),
    TASK_STATE: task.state,
    TASK_ASSIGNEDTO: task.assignee,
    TASK_LINK: task.url,
    TASK_DESCRIPTION: task.description,
    TASK_DUEDATE: task.due,
    TASK_CREATED: task.created,
    TASK_TAGS: task.tags.map((tag) => tag.trim().replace(/\s+/g, "-")).join(" "),
    SOURCE_NAME: source.name,
    SOURCE_TYPE: source.provider,
  }
  for (const [key, value] of Object.entries(task.fields ?? {})) {
    vars[`TASK_${key.toUpperCase()}`] = value
  }
  return vars
}

/** Fills `{{VAR}}` placeholders; unknown variables become empty. */
export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/{{\s*([A-Z0-9_]+)\s*}}/g, (_match, key: string) => vars[key] ?? "")
}

/** The file name (without extension) of a task note. */
export function noteName(template: string, task: Task, source: TemplateSource): string {
  const name = safeFileName(render(template || DEFAULT_NOTE_NAME, variables(task, source)))
  return name || safeFileName(task.id)
}

/** The initial content of a new task note. */
export function noteContent(template: string, task: Task, source: TemplateSource): string {
  return render(template || DEFAULT_NOTE_TEMPLATE, variables(task, source))
}
