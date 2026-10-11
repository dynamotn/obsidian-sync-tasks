import type { Task, TaskGroup } from "../types"
import { dateFolder, isoDate, slug, splitList, uniqueBy } from "../util"
import { baseUrl, bool, str, type FetchContext, type Options, type Provider } from "./provider"

const PAGE = 100

interface Columns {
  names: string[]
  /** Labels that put an open issue in a column, in board order. */
  labels: string[]
}

/** Every page of a GitLab list endpoint. */
async function all(ctx: FetchContext, url: string, headers: Record<string, string>): Promise<any[]> {
  const items: any[] = []
  for (let page = 1; ; page++) {
    const batch = await ctx.request<any[]>({ url: `${url}${url.includes("?") ? "&" : "?"}per_page=${PAGE}&page=${page}`, headers })
    items.push(...(batch ?? []))
    if (!batch || batch.length < PAGE) return items
  }
}

/** Issues from an endpoint, for each wanted assignee, or the token owner's, or everyone's in team mode. */
async function issuesFor(
  ctx: FetchContext,
  url: string,
  options: Options,
  headers: Record<string, string>,
): Promise<any[]> {
  if (ctx.teamMode) return all(ctx, url, headers)
  const users = splitList(str(options, "usernames"))
  if (users.length === 0) return all(ctx, `${url}&scope=assigned_to_me`, headers)
  const lists = await Promise.all(
    users.map((user) => all(ctx, `${url}&assignee_username=${encodeURIComponent(user)}`, headers)),
  )
  return uniqueBy(lists.flat(), (issue) => String(issue.id))
}

/** Board columns: the board's label lists between the implicit Open and Closed, or the configured ones. */
async function columnsFor(
  ctx: FetchContext,
  api: string,
  options: Options,
  headers: Record<string, string>,
): Promise<Columns> {
  const boardId = str(options, "boardId")
  if (boardId && options.mode !== "user") {
    const lists = await ctx.request<any[]>({ url: `${api}/boards/${encodeURIComponent(boardId)}/lists`, headers })
    const labels = [...(lists ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((list) => list.label?.name)
      .filter(Boolean)
    return { names: ["Open", ...labels, "Closed"], labels }
  }
  const names = splitList(str(options, "columns"))
  return { names, labels: names.filter((name) => name !== "Open" && name !== "Closed") }
}

/** A GitLab issue as a task; its column is the first board label it carries. */
export function issueToTask(issue: any, columns: Columns, id: string = String(issue.iid)): Task {
  const labels: string[] = issue.labels ?? []
  const state =
    issue.state === "closed" ? "Closed" : (columns.labels.find((label) => labels.includes(label)) ?? "Open")
  const type = String(issue.issue_type ?? "issue")
  return {
    id,
    title: issue.title ?? "",
    state,
    type: type.charAt(0).toUpperCase() + type.slice(1),
    assignee: issue.assignees?.[0]?.name ?? issue.assignee?.name ?? "Unassigned",
    url: issue.web_url ?? "",
    description: issue.description ?? "",
    created: isoDate(issue.created_at),
    due: isoDate(issue.due_date),
    tags: labels,
    done: issue.state === "closed",
    fields: { milestone: issue.milestone?.title ?? "" },
  }
}

/** Issue numbers repeat across projects, so user mode prefixes the project: "web-12". */
export function userModeId(issue: any): string {
  const project = String(issue.references?.full ?? "").split("#")[0]?.split("/").pop()
  return project ? `${project}-${issue.iid}` : String(issue.id)
}

export const gitlab: Provider = {
  id: "gitlab",
  name: "GitLab",
  defaults: {
    url: "gitlab.com",
    token: "",
    mode: "milestones",
    projectId: "",
    boardId: "",
    usernames: "",
    useMilestoneName: true,
    columns: "Open,Closed",
    excludeClosed: false,
  },
  fields: [
    { key: "url", name: "Instance", type: "text", placeholder: "gitlab.com" },
    { key: "token", name: "Personal access token", type: "secret", desc: "Secret in Obsidian's keychain holding a PAT with read_api." },
    {
      key: "mode",
      name: "Mode",
      type: "dropdown",
      choices: {
        milestones: "Milestones: the active milestone of a project",
        board: "Board: every issue of a project",
        user: "User: assigned issues of every project, in Year/Quarter/Month folders",
      },
    },
    {
      key: "projectId",
      name: "Project",
      desc: "Numeric project ID or full path, e.g. 12345 or group/project.",
      type: "text",
      when: (o) => o.mode !== "user",
    },
    {
      key: "boardId",
      name: "Board ID",
      desc: "Optional. When set, columns come from the board's label lists.",
      type: "text",
      when: (o) => o.mode !== "user",
    },
    {
      key: "columns",
      name: "Board columns",
      desc: 'Used without a board ID. Include "Open" and "Closed"; the others are labels.',
      type: "text",
      when: (o) => o.mode === "user" || !str(o, "boardId"),
    },
    {
      key: "excludeClosed",
      name: "Exclude closed issues",
      type: "toggle",
      when: (o) => o.mode === "user",
    },
    {
      key: "useMilestoneName",
      name: "Use milestone name",
      desc: "Name the milestone folder after the milestone rather than its id.",
      type: "toggle",
      when: (o) => o.mode === "milestones",
    },
    {
      key: "usernames",
      name: "Assignees",
      desc: "Comma-separated usernames. Empty means you. Ignored in team mode.",
      type: "text",
    },
  ],

  async fetch(options, ctx) {
    const headers = { "PRIVATE-TOKEN": ctx.secret(str(options, "token")) }
    const root = `${baseUrl(str(options, "url"), "gitlab.com")}/api/v4`

    if (options.mode === "user") {
      const state = bool(options, "excludeClosed") ? "opened" : "all"
      // The global endpoint defaults to issues created by the token owner; widen it unless asking for "assigned to me".
      const mine = !ctx.teamMode && splitList(str(options, "usernames")).length === 0
      const issues = await issuesFor(ctx, `${root}/issues?state=${state}${mine ? "" : "&scope=all"}`, options, headers)
      const columns = await columnsFor(ctx, root, options, headers)
      const tasks = issues.map((issue) => ({
        ...issueToTask(issue, columns, userModeId(issue)),
        folder: dateFolder(issue.created_at),
      }))
      return [{ folder: "", board: { name: "all-issues", columns: columns.names }, tasks }]
    }

    const projectId = str(options, "projectId")
    if (!projectId) throw new Error("no project is set")
    const api = `${root}/projects/${encodeURIComponent(projectId)}`
    const columns = await columnsFor(ctx, api, options, headers)

    if (options.mode === "board") {
      const issues = await issuesFor(ctx, `${api}/issues?state=all`, options, headers)
      const name = str(options, "boardId") || "board"
      return [
        {
          folder: "",
          splitCompleted: true,
          board: { name, columns: columns.names },
          tasks: issues.map((issue) => issueToTask(issue, columns)),
        },
      ]
    }

    const milestones = await ctx.request<any[]>({ url: `${api}/milestones?state=active`, headers })
    const milestone = milestones?.[0]
    if (!milestone) throw new Error(`project ${projectId} has no active milestone`)
    const id = options.useMilestoneName === false ? String(milestone.id) : slug(String(milestone.title)) || String(milestone.id)
    const issues = await issuesFor(
      ctx,
      `${api}/issues?milestone=${encodeURIComponent(milestone.title)}`,
      options,
      headers,
    )
    const group: TaskGroup = {
      folder: `milestone-${id}`,
      board: { name: id, columns: columns.names },
      tasks: issues.map((issue) => issueToTask(issue, columns)),
    }
    return [group]
  },
}
