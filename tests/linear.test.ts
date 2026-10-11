import { describe, expect, test } from "bun:test"
import { issueFilter, linear } from "../src/providers/linear"
import type { HttpRequest } from "../src/providers/provider"
import { fakeContext } from "./fake-http"

function issue(identifier: string, state: [string, string, number], extra: Record<string, unknown> = {}) {
  return {
    identifier,
    title: `Title ${identifier}`,
    description: "Body",
    url: `https://linear.app/acme/issue/${identifier}`,
    createdAt: "2026-10-01T10:00:00.000Z",
    dueDate: "2026-10-20",
    priorityLabel: "High",
    state: { name: state[0], type: state[1], position: state[2] },
    assignee: { name: "Ann" },
    labels: { nodes: [{ name: "Bug" }] },
    team: { key: "ENG" },
    cycle: { number: 7 },
    project: { name: "Web" },
    ...extra,
  }
}

describe("linear", () => {
  test("pages through issues; columns follow Linear's state order", async () => {
    const pages = [
      { nodes: [issue("ENG-2", ["Done", "completed", 0]), issue("ENG-1", ["In Review", "started", 2])], pageInfo: { hasNextPage: true, endCursor: "c1" } },
      { nodes: [issue("ENG-3", ["Todo", "unstarted", 0]), issue("ENG-4", ["In Progress", "started", 1])], pageInfo: { hasNextPage: false } },
    ]
    const { ctx, requests } = fakeContext([
      [/^POST https:\/\/api\.linear\.app\/graphql$/, (req: HttpRequest) => ({ data: { issues: JSON.parse(req.body!).variables.after ? pages[1] : pages[0] } })],
    ])

    const [group] = await linear.fetch({ ...linear.defaults, apiKey: "lin" }, ctx)

    expect(requests).toHaveLength(2)
    expect(requests[0]!.headers!.Authorization).toBe("secret:lin")
    expect(JSON.parse(requests[1]!.body!).variables).toEqual({ filter: { assignee: { isMe: { eq: true } } }, after: "c1" })
    expect(group!.board).toEqual({ name: "linear", columns: ["Todo", "In Progress", "In Review", "Done"] })
    expect(group!.splitCompleted).toBe(true)
    expect(group!.tasks[0]).toMatchObject({ id: "ENG-2", done: true, tags: ["Bug"], fields: { priority: "High", project: "Web", team: "ENG" } })
  })

  test("current cycle: a folder per team cycle", async () => {
    const { ctx } = fakeContext([
      [
        /graphql/,
        {
          data: {
            issues: {
              nodes: [issue("ENG-1", ["Todo", "unstarted", 0]), issue("OPS-1", ["Todo", "unstarted", 0], { team: { key: "OPS" }, cycle: { number: 3 } })],
              pageInfo: { hasNextPage: false },
            },
          },
        },
      ],
    ])
    const groups = await linear.fetch({ ...linear.defaults, apiKey: "lin", currentCycle: true }, ctx)
    expect(groups.map((g) => [g.folder, g.board?.name, g.tasks.length])).toEqual([
      ["ENG-cycle-7", "ENG-cycle-7", 1],
      ["OPS-cycle-3", "OPS-cycle-3", 1],
    ])
  })

  test("reports GraphQL errors", async () => {
    const { ctx } = fakeContext([[/graphql/, { errors: [{ message: "Authentication required" }] }]])
    await expect(linear.fetch({ ...linear.defaults, apiKey: "lin" }, ctx)).rejects.toThrow("Authentication required")
  })

  test("issueFilter", () => {
    expect(issueFilter({ teamKey: "ENG", currentCycle: true, excludeCompleted: true }, true)).toEqual({
      team: { key: { eq: "ENG" } },
      cycle: { isActive: { eq: true } },
      state: { type: { nin: ["completed", "canceled"] } },
    })
  })
})
