import type { SyncResult } from "./sync"

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ") || " "
}

/**
 * One note listing the open tasks of every source, soonest due first, with a
 * section per source in settings order.
 */
export function overviewMarkdown(results: SyncResult[]): string {
  const lines = ["# Open tasks", ""]
  for (const result of results) {
    lines.push(`## ${result.source.name}`, "")
    if (result.error) {
      lines.push(`> [!warning] Last sync failed: ${result.error}`, "")
      continue
    }
    const open = result.cards
      .filter(({ task }) => !task.done)
      .sort((a, b) => (a.task.due || "9999").localeCompare(b.task.due || "9999") || a.task.id.localeCompare(b.task.id))
    if (open.length === 0) {
      lines.push("Nothing open.", "")
      continue
    }
    lines.push("| Task | State | Assignee | Due |", "| --- | --- | --- | --- |")
    for (const { task, link } of open) {
      const [path, label] = link.split("|")
      lines.push(`| [[${path}\\|${cell(label ?? path ?? "")}]] ${cell(task.title)} | ${cell(task.state)} | ${cell(task.assignee)} | ${cell(task.due)} |`)
    }
    lines.push("")
  }
  return lines.join("\n")
}
