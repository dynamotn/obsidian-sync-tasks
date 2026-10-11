import type { Task, TaskGroup } from "../types"
import { base64, isoDate, slug, splitList } from "../util"
import { baseUrl, bool, str, type Options, type Provider } from "./provider"

const FIELDS = "summary,status,issuetype,assignee,description,created,duedate,labels,resolution,priority"
const PAGE = 100

/** Plain text of an Atlassian Document Format node, as Jira Cloud sends rich text. */
export function adfToText(node: any): string {
  if (!node || typeof node !== "object") return typeof node === "string" ? node : ""
  if (node.type === "text") return node.text ?? ""
  if (node.type === "hardBreak") return "\n"
  const children: string[] = (node.content ?? []).map(adfToText)
  switch (node.type) {
    case "doc":
      return children.join("\n\n")
    case "bulletList":
      return children.map((c) => `- ${c}`).join("\n")
    case "orderedList":
      return children.map((c, i) => `${i + 1}. ${c}`).join("\n")
    case "codeBlock":
      return `\`\`\`\n${children.join("")}\n\`\`\``
    case "listItem":
      return children.join("\n")
    default:
      return children.join("")
  }
}

/** Quotes a value for JQL. */
function jqlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

/** The JQL that limits a board query to the wanted assignees and the user's own filter. */
export function assigneeJql(options: Options, teamMode: boolean): string {
  const clauses: string[] = []
  if (!teamMode) {
    const users = splitList(str(options, "usernames"))
    clauses.push(users.length ? `assignee in (${users.map(jqlString).join(", ")})` : "assignee = currentUser()")
  }
  const extra = str(options, "jql")
  if (extra) clauses.push(`(${extra})`)
  return clauses.join(" AND ")
}

export const jira: Provider = {
  id: "jira",
  name: "Jira",
  defaults: {
    url: "",
    authMode: "basic",
    email: "",
    token: "",
    boardId: "",
    mode: "sprints",
    useSprintName: true,
    excludeBacklog: false,
    usernames: "",
    jql: "",
  },
  fields: [
    { key: "url", name: "URL", type: "text", placeholder: "yourserver.atlassian.net", desc: "Base URL of the Jira site or server." },
    {
      key: "authMode",
      name: "Authorization",
      type: "dropdown",
      choices: { basic: "Email and API token (Cloud)", bearer: "Personal access token (Server, Data Center)" },
    },
    { key: "email", name: "Email", type: "text", when: (o) => o.authMode !== "bearer" },
    { key: "token", name: "Token", type: "secret", desc: "Secret in Obsidian's keychain holding the API token or PAT." },
    { key: "boardId", name: "Board ID", type: "text", desc: "The number in the board URL." },
    {
      key: "mode",
      name: "Mode",
      type: "dropdown",
      choices: { sprints: "Sprints: the active sprint", kanban: "Kanban: the whole board" },
    },
    {
      key: "useSprintName",
      name: "Use sprint name",
      desc: "Name the sprint folder after the sprint rather than its id.",
      type: "toggle",
      when: (o) => o.mode !== "kanban",
    },
    {
      key: "excludeBacklog",
      name: "Exclude backlog",
      desc: "Skip issues in the Backlog status.",
      type: "toggle",
      when: (o) => o.mode === "kanban",
    },
    {
      key: "usernames",
      name: "Assignees",
      desc: "Comma-separated usernames or account ids. Empty means you. Ignored in team mode.",
      type: "text",
    },
    { key: "jql", name: "Extra JQL", desc: "Optional filter added to the query, e.g. project = WEB.", type: "text" },
  ],

  async fetch(options, ctx) {
    const site = baseUrl(str(options, "url"))
    const boardId = encodeURIComponent(str(options, "boardId"))
    if (!boardId) throw new Error("no board ID is set")
    const token = ctx.secret(str(options, "token"))
    const headers = {
      Accept: "application/json",
      Authorization:
        options.authMode === "bearer" ? `Bearer ${token}` : `Basic ${base64(`${str(options, "email")}:${token}`)}`,
    }
    const api = `${site}/rest/agile/1.0/board/${boardId}`
    const get = <T>(url: string) => ctx.request<T>({ url, headers })

    const config = await get<any>(`${api}/configuration`)
    const columns: { name: string; statuses?: { id: string }[] }[] = config?.columnConfig?.columns ?? []
    const statusColumn = new Map<string, string>()
    for (const column of columns) for (const status of column.statuses ?? []) statusColumn.set(String(status.id), column.name)

    const toTask = (issue: any): Task => {
      const f = issue.fields ?? {}
      return {
        id: issue.key,
        title: f.summary ?? "",
        state: f.status?.name ?? "",
        column: statusColumn.get(String(f.status?.id)),
        type: f.issuetype?.name ?? "Issue",
        assignee: f.assignee?.displayName ?? "Unassigned",
        url: `${site}/browse/${issue.key}`,
        description: typeof f.description === "string" ? f.description : adfToText(f.description),
        created: isoDate(f.created),
        due: isoDate(f.duedate),
        tags: f.labels ?? [],
        done: options.mode === "kanban" ? f.resolution != null : f.status?.statusCategory?.key === "done",
        fields: { priority: f.priority?.name ?? "" },
      }
    }

    const jql = assigneeJql(options, ctx.teamMode)
    const issues = async (url: string) => {
      const all: any[] = []
      for (let startAt = 0; ; startAt += PAGE) {
        const query = `startAt=${startAt}&maxResults=${PAGE}&fields=${FIELDS}${jql ? `&jql=${encodeURIComponent(jql)}` : ""}`
        const page = await get<any>(`${url}?${query}`)
        const batch: any[] = page?.issues ?? []
        all.push(...batch)
        if (batch.length === 0 || startAt + batch.length >= (page?.total ?? 0)) break
      }
      return all
    }

    if (options.mode === "kanban") {
      const exclude = bool(options, "excludeBacklog")
      const tasks = (await issues(`${api}/issue`))
        .filter((issue) => !exclude || issue.fields?.status?.name !== "Backlog")
        .map(toTask)
      const names = columns.map((c) => c.name).filter((name) => !exclude || name !== "Backlog")
      return [{ folder: "", splitCompleted: true, board: { name: str(options, "boardId"), columns: names }, tasks }]
    }

    const sprints = await get<any>(`${api}/sprint?state=active`)
    const sprint = sprints?.values?.[0]
    if (!sprint) throw new Error(`board ${str(options, "boardId")} has no active sprint`)
    const name = slug(String(sprint.name).replace(/Sprint/, "").replace(/Board/, ""))
    const id = options.useSprintName === false || !name ? String(sprint.id) : name
    const tasks = (await issues(`${api}/sprint/${sprint.id}/issue`)).map(toTask)
    const group: TaskGroup = { folder: `sprint-${id}`, board: { name: id, columns: columns.map((c) => c.name) }, tasks }
    return [group]
  },
}
