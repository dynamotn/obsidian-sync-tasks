import type { Task } from "../types"
import { isoDate, splitList } from "../util"
import { baseUrl, bool, str, type Provider } from "./provider"

const PAGE = 100
/** GitHub's search never returns more than this many results. */
const SEARCH_LIMIT = 1000

/** "https://api.github.com/repos/acme/web" → "acme/web". */
function repoOf(item: any): string {
  return String(item.repository_url ?? "").replace(/^.*\/repos\//, "")
}

export const github: Provider = {
  id: "github",
  name: "GitHub",
  defaults: {
    apiUrl: "api.github.com",
    token: "",
    query: "is:issue is:open assignee:@me",
    columns: "Open,Closed",
    groupByRepo: false,
  },
  fields: [
    {
      key: "apiUrl",
      name: "API URL",
      desc: "api.github.com, or github.example.com/api/v3 for GitHub Enterprise Server.",
      type: "text",
    },
    {
      key: "token",
      name: "Token",
      desc: "Secret in Obsidian's keychain holding a token that can read issues.",
      type: "secret",
    },
    {
      key: "query",
      name: "Search query",
      desc: "GitHub search syntax, e.g. is:open assignee:@me repo:acme/web. Add is:pr for pull requests. Team mode does not change it.",
      type: "text",
    },
    {
      key: "columns",
      name: "Board columns",
      desc: 'Include "Open" and "Closed"; the others are labels, as on a label-driven board.',
      type: "text",
    },
    { key: "groupByRepo", name: "Folder per repository", type: "toggle" },
  ],

  async fetch(options, ctx) {
    const api = baseUrl(str(options, "apiUrl"), "api.github.com")
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${ctx.secret(str(options, "token"))}`,
      "X-GitHub-Api-Version": "2022-11-28",
    }
    const query = str(options, "query") || "is:open assignee:@me"

    const items: any[] = []
    for (let page = 1; ; page++) {
      const res = await ctx.request<any>({
        url: `${api}/search/issues?q=${encodeURIComponent(query)}&per_page=${PAGE}&page=${page}`,
        headers,
      })
      const batch: any[] = res?.items ?? []
      items.push(...batch)
      if (batch.length < PAGE || page * PAGE >= Math.min(res?.total_count ?? 0, SEARCH_LIMIT)) break
    }

    const columns = splitList(str(options, "columns"))
    const labelColumns = columns.filter((c) => c !== "Open" && c !== "Closed")
    const tasks = items.map((item): Task => {
      const repo = repoOf(item)
      const labels: string[] = (item.labels ?? []).map((label: any) => label.name).filter(Boolean)
      const closed = item.state === "closed"
      return {
        id: `${repo.split("/").pop()}-${item.number}`,
        title: item.title ?? "",
        state: closed ? "Closed" : (labelColumns.find((c) => labels.includes(c)) ?? "Open"),
        type: item.pull_request ? "Pull Request" : (item.type?.name ?? "Issue"),
        assignee: item.assignee?.login ?? item.assignees?.[0]?.login ?? "Unassigned",
        url: item.html_url ?? "",
        description: item.body ?? "",
        created: isoDate(item.created_at),
        due: isoDate(item.milestone?.due_on),
        tags: labels,
        done: closed,
        folder: bool(options, "groupByRepo") ? repo : undefined,
        fields: { repo, milestone: item.milestone?.title ?? "" },
      }
    })

    return [{ folder: "", splitCompleted: true, board: { name: "github", columns }, tasks }]
  },
}
