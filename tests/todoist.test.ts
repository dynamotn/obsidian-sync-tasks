import { describe, expect, test } from "bun:test"
import { todoist } from "../src/providers/todoist"
import { fakeContext } from "./fake-http"

function item(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    content: `Task ${id}`,
    description: "",
    project_id: "p1",
    section_id: null,
    labels: ["home"],
    priority: 4,
    due: { date: "2026-10-20" },
    added_at: "2026-10-01T10:00:00Z",
    checked: false,
    ...extra,
  }
}

const projects = { results: [{ id: "p1", name: "Work" }, { id: "p2", name: "Home" }], next_cursor: null }

describe("todoist", () => {
  test("a project: columns per section, cursor pagination", async () => {
    const { ctx, requests } = fakeContext([
      [/\/tasks\?project_id=p1&limit=200$/, { results: [item("1")], next_cursor: "n1" }],
      [/\/tasks\?project_id=p1&limit=200&cursor=n1$/, { results: [item("2", { section_id: "s2" })], next_cursor: null }],
      [/\/projects/, projects],
      [/\/sections\?project_id=p1/, { results: [{ id: "s2", name: "Doing", section_order: 2 }, { id: "s1", name: "Next", section_order: 1 }] }],
    ])

    const [group] = await todoist.fetch({ ...todoist.defaults, token: "td", projectId: "p1" }, ctx)

    expect(requests[0]!.headers).toEqual({ Authorization: "Bearer secret:td" })
    expect(group!.board).toEqual({ name: "Work", columns: ["No section", "Next", "Doing"] })
    expect(group!.tasks.map((t) => [t.id, t.state])).toEqual([
      ["1", "No section"],
      ["2", "Doing"],
    ])
    expect(group!.tasks[0]).toMatchObject({
      title: "Task 1",
      url: "https://app.todoist.com/app/task/1",
      due: "2026-10-20",
      created: "2026-10-01",
      tags: ["home"],
      fields: { priority: "p1", project: "Work" },
    })
  })

  test("a filter: columns per project", async () => {
    const { ctx, requests } = fakeContext([
      [/\/tasks\/filter\?query=today%20%7C%20overdue&limit=200$/, { results: [item("1"), item("2", { project_id: "p2", priority: 1 })] }],
      [/\/projects/, projects],
    ])

    const [group] = await todoist.fetch({ ...todoist.defaults, token: "td", filter: "today | overdue" }, ctx)

    expect(requests).toHaveLength(2)
    expect(group!.board).toEqual({ name: "todoist", columns: ["Work", "Home"] })
    expect(group!.tasks[1]).toMatchObject({ state: "Home", fields: { priority: "p4" } })
  })
})
