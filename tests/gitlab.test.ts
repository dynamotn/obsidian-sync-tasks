import { describe, expect, test } from "bun:test"
import { gitlab, issueToTask } from "../src/providers/gitlab"
import { fakeContext } from "./fake-http"

const options = { ...gitlab.defaults, token: "gl", projectId: "acme/web" }

function issue(iid: number, extra: Record<string, unknown> = {}) {
  return {
    id: 1000 + iid,
    iid,
    title: `Issue ${iid}`,
    state: "opened",
    issue_type: "issue",
    labels: [],
    assignees: [{ name: "Ann" }],
    web_url: `https://gitlab.com/acme/web/-/issues/${iid}`,
    description: "Body",
    created_at: "2026-10-01T10:00:00Z",
    due_date: "2026-10-20",
    ...extra,
  }
}

describe("gitlab", () => {
  test("milestones mode: issues of the active milestone, columns from the board", async () => {
    const page = Array.from({ length: 100 }, (_, i) => issue(i + 1))
    const { ctx, requests } = fakeContext([
      [/\/boards\/9\/lists$/, [
        { position: 1, label: { name: "Review" } },
        { position: 0, label: { name: "Doing" } },
      ]],
      [/\/milestones\?state=active$/, [{ id: 77, title: "Release 1.2!" }]],
      [/\/issues\?milestone=Release%201\.2!&scope=assigned_to_me&per_page=100&page=1$/, page],
      [/&page=2$/, [issue(101, { labels: ["Review", "Doing"] }), issue(102, { state: "closed" })]],
    ])

    const [group] = await gitlab.fetch({ ...options, boardId: "9" }, ctx)

    expect(requests[0]!.url).toBe("https://gitlab.com/api/v4/projects/acme%2Fweb/boards/9/lists")
    expect(requests[0]!.headers).toEqual({ "PRIVATE-TOKEN": "secret:gl" })
    expect(group!.folder).toBe("milestone-Release-12")
    expect(group!.board).toEqual({ name: "Release-12", columns: ["Open", "Doing", "Review", "Closed"] })
    expect(group!.tasks).toHaveLength(102)
    expect(group!.tasks.slice(100).map((t) => [t.id, t.state, t.done])).toEqual([
      ["101", "Doing", false],
      ["102", "Closed", true],
    ])
  })

  test("board mode: every issue per assignee, deduplicated, completed split", async () => {
    const { ctx, requests } = fakeContext([
      [/assignee_username=ann/, [issue(1), issue(2)]],
      [/assignee_username=bob/, [issue(2), issue(3, { state: "closed" })]],
    ])

    const [group] = await gitlab.fetch({ ...options, mode: "board", usernames: "ann, bob", columns: "Open,Doing,Closed" }, ctx)

    expect(requests.map((r) => r.url)).toEqual([
      "https://gitlab.com/api/v4/projects/acme%2Fweb/issues?state=all&assignee_username=ann&per_page=100&page=1",
      "https://gitlab.com/api/v4/projects/acme%2Fweb/issues?state=all&assignee_username=bob&per_page=100&page=1",
    ])
    expect(group).toMatchObject({ folder: "", splitCompleted: true, board: { name: "board", columns: ["Open", "Doing", "Closed"] } })
    expect(group!.tasks.map((t) => t.id)).toEqual(["1", "2", "3"])
  })

  test("team mode pulls everyone", async () => {
    const { ctx, requests } = fakeContext([[/issues/, []]], true)
    await gitlab.fetch({ ...options, mode: "board", usernames: "ann" }, ctx)
    expect(requests[0]!.url).toEndWith("/issues?state=all&per_page=100&page=1")
  })

  test("issueToTask maps the fields", () => {
    const task = issueToTask(issue(5, { issue_type: "incident", labels: ["x y"], milestone: { title: "M1" } }), {
      names: [],
      labels: [],
    })
    expect(task).toMatchObject({
      id: "5",
      title: "Issue 5",
      state: "Open",
      type: "Incident",
      assignee: "Ann",
      created: "2026-10-01",
      due: "2026-10-20",
      tags: ["x y"],
      fields: { milestone: "M1" },
    })
  })
})

describe("gitlab user mode", () => {
  test("assigned issues of every project, in date folders, ids prefixed by project", async () => {
    const { ctx, requests } = fakeContext([
      [
        /\/api\/v4\/issues\?/,
        [
          issue(3, { references: { full: "acme/web#3" }, created_at: "2026-02-03T00:00:00Z", labels: ["Doing"] }),
          issue(3, { id: 2003, references: { full: "acme/api#3" }, created_at: "2025-12-31T00:00:00Z" }),
        ],
      ],
    ])

    const [group] = await gitlab.fetch(
      { ...options, mode: "user", projectId: "", boardId: "9", excludeClosed: true, columns: "Open,Doing,Closed" },
      ctx,
    )

    expect(requests.map((r) => r.url)).toEqual([
      "https://gitlab.com/api/v4/issues?state=opened&scope=assigned_to_me&per_page=100&page=1",
    ])
    expect(group!.board).toEqual({ name: "all-issues", columns: ["Open", "Doing", "Closed"] })
    expect(group!.tasks.map((t) => [t.id, t.folder, t.state])).toEqual([
      ["web-3", "2026/Q1/February", "Doing"],
      ["api-3", "2025/Q4/December", "Open"],
    ])
  })

  test("listed assignees search every project", async () => {
    const { ctx, requests } = fakeContext([[/issues/, []]])
    await gitlab.fetch({ ...options, mode: "user", usernames: "ann" }, ctx)
    expect(requests[0]!.url).toBe("https://gitlab.com/api/v4/issues?state=all&scope=all&assignee_username=ann&per_page=100&page=1")
  })
})
