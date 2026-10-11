import type { Task } from "../types"
import { isoDate, splitList } from "../util"
import { bool, str, type FetchContext, type Provider } from "./provider"

const API = "https://api.clickup.com/api/v2"

/** ClickUp's status types, in board order. */
const STATUS_ORDER = ["open", "custom", "unstarted", "active", "done", "closed"]

/** ClickUp dates are milliseconds since the epoch, as strings. */
export function msDate(value: unknown): string {
  const ms = Number(value)
  return value && Number.isFinite(ms) ? isoDate(new Date(ms).toISOString()) : ""
}

/** Board columns: statuses ordered by type, then by their position. */
function columnsOf(statuses: { status: string; type?: string; orderindex?: number }[]): string[] {
  const unique = new Map(statuses.map((s) => [s.status, s]))
  return [...unique.values()]
    .sort(
      (a, b) =>
        STATUS_ORDER.indexOf(a.type ?? "custom") - STATUS_ORDER.indexOf(b.type ?? "custom") ||
        (a.orderindex ?? 0) - (b.orderindex ?? 0),
    )
    .map((s) => s.status)
}

/** User ids for the assignee filter: the listed usernames or emails, else the token owner; none in team mode. */
async function assigneeIds(
  ctx: FetchContext,
  headers: Record<string, string>,
  usernames: string[],
): Promise<string[]> {
  if (ctx.teamMode) return []
  if (usernames.length === 0) {
    const me = await ctx.request<any>({ url: `${API}/user`, headers })
    return [String(me?.user?.id)]
  }
  const teams = await ctx.request<any>({ url: `${API}/team`, headers })
  const wanted = new Set(usernames.map((u) => u.toLowerCase()))
  const ids = new Set<string>()
  for (const team of teams?.teams ?? []) {
    for (const { user } of team.members ?? []) {
      if (wanted.has(String(user?.username).toLowerCase()) || wanted.has(String(user?.email).toLowerCase())) {
        ids.add(String(user.id))
      }
    }
  }
  if (ids.size === 0) throw new Error(`no workspace member matches ${usernames.join(", ")}`)
  return [...ids]
}

export const clickup: Provider = {
  id: "clickup",
  name: "ClickUp",
  defaults: { token: "", mode: "list", listId: "", teamId: "", usernames: "", excludeClosed: false, subtasks: true },
  fields: [
    { key: "token", name: "API token", desc: "Secret in Obsidian's keychain holding a personal token (pk_…).", type: "secret" },
    {
      key: "mode",
      name: "Mode",
      type: "dropdown",
      choices: { list: "List: one list or sprint, with its statuses", workspace: "Workspace: tasks across a workspace" },
    },
    {
      key: "listId",
      name: "List ID",
      desc: "The number after /li/ in the list URL.",
      type: "text",
      when: (o) => o.mode !== "workspace",
    },
    {
      key: "teamId",
      name: "Workspace ID",
      desc: "The first number in any ClickUp URL of the workspace.",
      type: "text",
      when: (o) => o.mode === "workspace",
    },
    {
      key: "usernames",
      name: "Assignees",
      desc: "Comma-separated usernames or emails. Empty means you. Ignored in team mode.",
      type: "text",
    },
    { key: "excludeClosed", name: "Exclude closed tasks", type: "toggle" },
    { key: "subtasks", name: "Include subtasks", type: "toggle" },
  ],

  async fetch(options, ctx) {
    const headers = { Authorization: ctx.secret(str(options, "token")) }
    const workspace = options.mode === "workspace"
    const containerId = str(options, workspace ? "teamId" : "listId")
    if (!containerId) throw new Error(workspace ? "no workspace ID is set" : "no list ID is set")
    const tasksUrl = `${API}/${workspace ? "team" : "list"}/${encodeURIComponent(containerId)}/task`

    const [list, ids] = await Promise.all([
      workspace ? null : ctx.request<any>({ url: `${API}/list/${encodeURIComponent(containerId)}`, headers }),
      assigneeIds(ctx, headers, splitList(str(options, "usernames"))),
    ])

    const params = [
      `include_closed=${!bool(options, "excludeClosed")}`,
      `subtasks=${options.subtasks !== false}`,
      "include_markdown_description=true",
      ...ids.map((id) => `assignees[]=${encodeURIComponent(id)}`),
    ].join("&")
    const items: any[] = []
    for (let page = 0; ; page++) {
      const res = await ctx.request<any>({ url: `${tasksUrl}?page=${page}&${params}`, headers })
      const batch: any[] = res?.tasks ?? []
      items.push(...batch)
      // last_page is the documented signal; an empty page also ends it, should it be missing.
      if (res?.last_page !== false || batch.length === 0) break
    }

    const tasks = items.map((item): Task => {
      const type = item.status?.type
      return {
        id: String(item.custom_id || item.id),
        title: item.name ?? "",
        state: item.status?.status ?? "",
        type: item.parent ? "Subtask" : "Task",
        assignee: item.assignees?.[0]?.username ?? "Unassigned",
        url: item.url ?? "",
        description: item.markdown_description || item.text_content || item.description || "",
        created: msDate(item.date_created),
        due: msDate(item.due_date),
        tags: (item.tags ?? []).map((tag: any) => tag.name),
        done: type === "closed" || type === "done",
        fields: { priority: item.priority?.priority ?? "", list: item.list?.name ?? "" },
      }
    })

    const statuses = list?.statuses ?? items.map((item) => item.status).filter(Boolean)
    const name = workspace ? "clickup" : String(list?.name || containerId)
    return [{ folder: "", splitCompleted: true, board: { name, columns: columnsOf(statuses) }, tasks }]
  },
}
