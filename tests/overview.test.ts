import { describe, expect, test } from "bun:test"
import { overviewMarkdown } from "../src/overview"
import { newSource } from "../src/settings"
import type { SyncResult } from "../src/sync"
import { task } from "./helpers"

function result(name: string, extra: Partial<SyncResult> = {}): SyncResult {
  return { source: newSource(name, "jira", name, {}), tasks: 0, created: 0, moved: 0, boards: 0, cards: [], ...extra }
}

describe("overviewMarkdown", () => {
  test("lists open tasks per source, soonest due first", () => {
    const md = overviewMarkdown([
      result("Work", {
        cards: [
          { task: task({ id: "A-2", title: "No due" }), link: "W/A-2|A-2" },
          { task: task({ id: "A-1", title: "Pipe | here", due: "2026-10-20" }), link: "W/A-1|A-1" },
          { task: task({ id: "A-3", done: true }), link: "W/A-3|A-3" },
        ],
      }),
      result("Home"),
      result("Broken", { error: "HTTP 401" }),
    ])
    expect(md).toBe(
      [
        "# Open tasks",
        "",
        "## Work",
        "",
        "| Task | State | Assignee | Due |",
        "| --- | --- | --- | --- |",
        "| [[W/A-1\\|A-1]] Pipe \\| here | To Do | Ann | 2026-10-20 |",
        "| [[W/A-2\\|A-2]] No due | To Do | Ann |   |",
        "",
        "## Home",
        "",
        "Nothing open.",
        "",
        "## Broken",
        "",
        "> [!warning] Last sync failed: HTTP 401",
        "",
      ].join("\n"),
    )
  })
})
