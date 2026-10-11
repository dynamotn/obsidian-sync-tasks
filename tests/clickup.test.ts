import { describe, expect, test } from "bun:test"
import { clickup, msDate } from "../src/providers/clickup"
import { fakeContext } from "./fake-http"

const options = { ...clickup.defaults, token: "cu", listId: "901" }

function item(id: string, status: [string, string, number], extra: Record<string, unknown> = {}) {
  return {
    id,
    custom_id: null,
    name: `Task ${id}`,
    markdown_description: "**Body**",
    text_content: "Body",
    status: { status: status[0], type: status[1], orderindex: status[2] },
    assignees: [{ id: 7, username: "ann" }],
    tags: [{ name: "web" }],
    due_date: "1792152000000",
    date_created: "1791547200000",
    url: `https://app.clickup.com/t/${id}`,
    priority: { priority: "urgent" },
    list: { name: "Sprint 4" },
    ...extra,
  }
}

const list = {
  name: "Sprint 4",
  statuses: [
    { status: "complete", type: "closed", orderindex: 3 },
    { status: "in progress", type: "custom", orderindex: 1 },
    { status: "to do", type: "open", orderindex: 0 },
    { status: "review", type: "custom", orderindex: 2 },
  ],
}

describe("clickup", () => {
  test("list mode: the list's statuses as columns, pages until last_page", async () => {
    const { ctx, requests } = fakeContext([
      [/\/list\/901$/, list],
      [/\/user$/, { user: { id: 7, username: "ann" } }],
      [/\/list\/901\/task\?page=0&/, { tasks: [item("a1", ["to do", "open", 0])], last_page: false }],
      [/\/list\/901\/task\?page=1&/, { tasks: [item("a2", ["complete", "closed", 3], { custom_id: "WEB-2", parent: "a1" })], last_page: true }],
    ])

    const [group] = await clickup.fetch(options, ctx)

    expect(requests[0]!.headers).toEqual({ Authorization: "secret:cu" })
    expect(requests[2]!.url).toBe(
      "https://api.clickup.com/api/v2/list/901/task?page=0&include_closed=true&subtasks=true&include_markdown_description=true&assignees[]=7",
    )
    expect(group).toMatchObject({
      folder: "",
      splitCompleted: true,
      board: { name: "Sprint 4", columns: ["to do", "in progress", "review", "complete"] },
    })
    expect(group!.tasks.map((t) => [t.id, t.type, t.done])).toEqual([
      ["a1", "Task", false],
      ["WEB-2", "Subtask", true],
    ])
    expect(group!.tasks[0]).toMatchObject({
      title: "Task a1",
      state: "to do",
      assignee: "ann",
      description: "**Body**",
      created: "2026-10-09",
      due: "2026-10-16",
      tags: ["web"],
      fields: { priority: "urgent", list: "Sprint 4" },
    })
  })

  test("workspace mode resolves listed assignees to member ids", async () => {
    const { ctx, requests } = fakeContext([
      [
        /\/team$/,
        {
          teams: [
            { members: [{ user: { id: 7, username: "Ann", email: "ann@acme.io" } }, { user: { id: 8, username: "bob", email: "b@acme.io" } }] },
          ],
        },
      ],
      [/\/team\/55\/task\?/, { tasks: [item("a1", ["doing", "custom", 1]), item("a2", ["new", "open", 0])], last_page: true }],
    ])

    const [group] = await clickup.fetch(
      { ...options, mode: "workspace", teamId: "55", usernames: "ann, b@acme.io", excludeClosed: true, subtasks: false },
      ctx,
    )

    expect(requests[1]!.url).toBe(
      "https://api.clickup.com/api/v2/team/55/task?page=0&include_closed=false&subtasks=false&include_markdown_description=true&assignees[]=7&assignees[]=8",
    )
    expect(group!.board).toEqual({ name: "clickup", columns: ["new", "doing"] })
  })

  test("team mode filters no one; unknown assignees fail clearly", async () => {
    const team = fakeContext([[/\/team\/55\/task/, { tasks: [], last_page: true }]], true)
    await clickup.fetch({ ...options, mode: "workspace", teamId: "55", usernames: "ann" }, team.ctx)
    expect(team.requests[0]!.url).not.toContain("assignees")

    const unknown = fakeContext([[/\/team$/, { teams: [{ members: [] }] }], [/\/list\//, list]])
    await expect(clickup.fetch({ ...options, usernames: "zoe" }, unknown.ctx)).rejects.toThrow("no workspace member matches zoe")
  })

  test("msDate", () => {
    expect(msDate("1792152000000")).toBe("2026-10-16")
    expect(msDate(null)).toBe("")
    expect(msDate("soon")).toBe("")
  })
})
