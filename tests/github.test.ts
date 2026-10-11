import { describe, expect, test } from "bun:test"
import { github } from "../src/providers/github"
import { fakeContext } from "./fake-http"

function item(number: number, extra: Record<string, unknown> = {}) {
  return {
    number,
    title: `Issue ${number}`,
    state: "open",
    labels: [],
    assignee: { login: "ann" },
    html_url: `https://github.com/acme/web/issues/${number}`,
    repository_url: "https://api.github.com/repos/acme/web",
    body: "Body",
    created_at: "2026-10-01T10:00:00Z",
    ...extra,
  }
}

describe("github", () => {
  test("pages through the search and maps issues and pull requests", async () => {
    const first = Array.from({ length: 100 }, (_, i) => item(i + 1))
    const { ctx, requests } = fakeContext([
      [/page=1$/, { total_count: 102, items: first }],
      [
        /page=2$/,
        {
          total_count: 102,
          items: [
            item(101, { labels: [{ name: "In Progress" }], milestone: { title: "v2", due_on: "2026-11-01T07:00:00Z" } }),
            item(102, { state: "closed", pull_request: {}, assignee: null, assignees: [] }),
          ],
        },
      ],
    ])

    const [group] = await github.fetch(
      { ...github.defaults, token: "gh", columns: "Open,In Progress,Closed", groupByRepo: true },
      ctx,
    )

    expect(requests).toHaveLength(2)
    expect(requests[0]!.url).toBe(
      "https://api.github.com/search/issues?q=is%3Aissue%20is%3Aopen%20assignee%3A%40me&per_page=100&page=1",
    )
    expect(requests[0]!.headers!.Authorization).toBe("Bearer secret:gh")
    expect(group).toMatchObject({ folder: "", splitCompleted: true, board: { name: "github", columns: ["Open", "In Progress", "Closed"] } })
    expect(group!.tasks.slice(100)).toMatchObject([
      { id: "web-101", state: "In Progress", type: "Issue", due: "2026-11-01", folder: "acme/web", fields: { milestone: "v2" } },
      { id: "web-102", state: "Closed", type: "Pull Request", assignee: "Unassigned", done: true },
    ])
  })

  test("stops at the search limit", async () => {
    const full = Array.from({ length: 100 }, (_, i) => item(i))
    const { ctx, requests } = fakeContext([[/search/, { total_count: 5000, items: full }]])
    await github.fetch({ ...github.defaults, token: "gh", apiUrl: "ghe.acme.io/api/v3/" }, ctx)
    expect(requests).toHaveLength(10)
    expect(requests[0]!.url).toStartWith("https://ghe.acme.io/api/v3/search/issues?")
  })
})
