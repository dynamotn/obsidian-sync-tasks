import type { Task } from "./types"

export interface BoardCard {
  task: Task
  /** Wikilink target of the task note. */
  link: string
}

/**
 * Markdown for the Kanban community plugin: one heading per column, one card
 * per task note. Tasks whose column is not listed get a column of their own
 * after the configured ones, so no task silently drops off the board.
 */
export function boardMarkdown(columns: string[], cards: BoardCard[], showAssignee: boolean): string {
  const all = [...columns]
  for (const { task } of cards) {
    const column = task.column ?? task.state
    if (!all.includes(column)) all.push(column)
  }

  const lines = ["---", "", "kanban-plugin: board", "", "---", ""]
  for (const column of all) {
    lines.push(`## ${column}`, "")
    for (const { task, link } of cards) {
      if ((task.column ?? task.state) !== column) continue
      const card = [`- [${task.done ? "x" : " "}] [[${link}]]`]
      if (showAssignee) card.push(` ${task.assignee}`)
      card.push(` ${task.title}`)
      lines.push(card.join(" \n"))
    }
    lines.push("", "")
  }
  lines.push("%% kanban:settings", "```", '{"kanban-plugin":"board"}', "```", "%%", "")
  return lines.join("\n")
}
