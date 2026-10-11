import { describe, expect, test } from "bun:test"
import { adfToText, assigneeJql, jira } from "../src/providers/jira"
import { fakeContext } from "./fake-http"

const options = { ...jira.defaults, url: "acme.atlassian.net/", email: "me@acme.io", token: "jira", boardId: "7" }

const configuration = {
  columnConfig: {
    columns: [
      { name: "Backlog", statuses: [{ id: "1" }] },
      { name: "To Do", statuses: [{ id: "2" }] },
      { name: "Done", statuses: [{ id: "3" }, { id: "4" }] },
    ],
  },
}

function issue(key: string, statusId: string, statusName: string, extra: Record<string, unknown> = {}) {
  return {
    key,
    fields: {
      summary: `Summary ${key}`,
      status: { id: statusId, name: statusName, statusCategory: { key: statusId === "1" || statusId === "2" ? "new" : "done" } },
      issuetype: { name: "Story" },
      assignee: { displayName: "Ann" },
      description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] },
      created: "2026-10-01T10:00:00.000+0000",
      duedate: "2026-10-20",
      labels: ["web"],
      resolution: null,
      priority: { name: "High" },
      ...extra,
    },
  }
}

describe("jira", () => {
  test("sprints mode: the active sprint into its own folder, paging through issues", async () => {
    const { ctx, requests } = fakeContext([
      [/\/configuration$/, configuration],
      [/\/sprint\?state=active$/, { values: [{ id: 42, name: "Board Sprint 12 (Q4)" }] }],
      [/\/sprint\/42\/issue\?startAt=0&/, { total: 2, issues: [issue("A-1", "2", "Open")] }],
      [/\/sprint\/42\/issue\?startAt=100&/, { total: 2, issues: [issue("A-2", "4", "Closed")] }],
    ])

    const [group] = await jira.fetch(options, ctx)

    expect(group!.folder).toBe("sprint-12-Q4")
    expect(group!.board).toEqual({ name: "12-Q4", columns: ["Backlog", "To Do", "Done"] })
    expect(group!.tasks.map((t) => [t.id, t.column, t.done])).toEqual([
      ["A-1", "To Do", false],
      ["A-2", "Done", true],
    ])
    expect(group!.tasks[0]).toMatchObject({
      title: "Summary A-1",
      type: "Story",
      url: "https://acme.atlassian.net/browse/A-1",
      description: "Hello",
      created: "2026-10-01",
      due: "2026-10-20",
      tags: ["web"],
      fields: { priority: "High" },
    })
    expect(requests[0]!.headers!.Authorization).toBe(`Basic ${btoa("me@acme.io:secret:jira")}`)
    expect(decodeURIComponent(requests[2]!.url)).toContain("jql=assignee = currentUser()")
  })

  test("sprints mode can name the folder by sprint id", async () => {
    const { ctx } = fakeContext([
      [/\/configuration$/, configuration],
      [/\/sprint\?state=active$/, { values: [{ id: 42, name: "Sprint 12" }] }],
      [/\/issue\?/, { total: 0, issues: [] }],
    ])
    const [group] = await jira.fetch({ ...options, useSprintName: false }, ctx)
    expect(group!.folder).toBe("sprint-42")
  })

  test("fails clearly without an active sprint", async () => {
    const { ctx } = fakeContext([
      [/\/configuration$/, configuration],
      [/\/sprint\?state=active$/, { values: [] }],
    ])
    await expect(jira.fetch(options, ctx)).rejects.toThrow("board 7 has no active sprint")
  })

  test("kanban mode: whole board, completed split, backlog excluded", async () => {
    const { ctx, requests } = fakeContext(
      [
        [/\/configuration$/, configuration],
        [
          /\/board\/7\/issue\?/,
          {
            total: 2,
            issues: [issue("A-1", "1", "Backlog"), issue("A-2", "3", "Done", { resolution: { name: "Fixed" } })],
          },
        ],
      ],
      true,
    )

    const [group] = await jira.fetch(
      { ...options, mode: "kanban", excludeBacklog: true, authMode: "bearer", jql: "project = WEB" },
      ctx,
    )

    expect(group).toMatchObject({ folder: "", splitCompleted: true, board: { name: "7", columns: ["To Do", "Done"] } })
    expect(group!.tasks.map((t) => [t.id, t.done])).toEqual([["A-2", true]])
    expect(requests[0]!.headers!.Authorization).toBe("Bearer secret:jira")
    expect(decodeURIComponent(requests[1]!.url)).toContain("jql=(project = WEB)")
  })

  test("assigneeJql quotes the listed users", () => {
    expect(assigneeJql({ usernames: 'ann, bo"b' }, false)).toBe('assignee in ("ann", "bo\\"b")')
    expect(assigneeJql({ usernames: "ann" }, true)).toBe("")
  })

  test("adfToText flattens rich text", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "b" }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }] },
      ],
    }
    expect(adfToText(doc)).toBe("a\nb\n\n- x")
    expect(adfToText("plain")).toBe("plain")
    expect(adfToText(null)).toBe("")
  })
})
