import type { Task } from "../types"
import { isoDate } from "../util"
import { str, type FetchContext, type Provider } from "./provider"

const API = "https://api.todoist.com/api/v1"
const NO_SECTION = "No section"

/** Every page of a cursor-paginated Todoist list. */
async function all(ctx: FetchContext, url: string, headers: Record<string, string>): Promise<any[]> {
  const items: any[] = []
  let cursor: string | null = null
  do {
    const sep = url.includes("?") ? "&" : "?"
    const page: any = await ctx.request({
      url: `${url}${sep}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      headers,
    })
    // Lists come back as { results, next_cursor }; accept a bare array too.
    items.push(...(Array.isArray(page) ? page : (page?.results ?? page?.tasks ?? [])))
    cursor = Array.isArray(page) ? null : (page?.next_cursor ?? null)
  } while (cursor)
  return items
}

export const todoist: Provider = {
  id: "todoist",
  name: "Todoist",
  defaults: { token: "", projectId: "", filter: "" },
  fields: [
    { key: "token", name: "API token", desc: "Secret in Obsidian's keychain holding the token from Settings → Integrations.", type: "secret" },
    {
      key: "projectId",
      name: "Project ID",
      desc: "Optional. With a project the board has a column per section; without, a column per project.",
      type: "text",
    },
    {
      key: "filter",
      name: "Filter",
      desc: "Optional Todoist filter, e.g. today | overdue or #Work & @next. Only active tasks are synced.",
      type: "text",
    },
  ],

  async fetch(options, ctx) {
    const headers = { Authorization: `Bearer ${ctx.secret(str(options, "token"))}` }
    const projectId = str(options, "projectId")
    const filter = str(options, "filter")

    const tasksUrl = filter
      ? `${API}/tasks/filter?query=${encodeURIComponent(filter)}`
      : `${API}/tasks${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`
    const [items, projects, sections] = await Promise.all([
      all(ctx, tasksUrl, headers),
      all(ctx, `${API}/projects`, headers),
      projectId ? all(ctx, `${API}/sections?project_id=${encodeURIComponent(projectId)}`, headers) : [],
    ])

    const projectName = new Map(projects.map((p) => [String(p.id), String(p.name)]))
    const sectionName = new Map(sections.map((s) => [String(s.id), String(s.name)]))
    const inProject = projectId ? items.filter((item) => String(item.project_id) === projectId) : items

    const tasks = inProject.map((item): Task => {
      const project = projectName.get(String(item.project_id)) ?? ""
      return {
        id: String(item.id),
        title: item.content ?? "",
        state: projectId ? (sectionName.get(String(item.section_id)) ?? NO_SECTION) : project,
        type: "Task",
        assignee: item.responsible_uid ? String(item.responsible_uid) : "Unassigned",
        url: `https://app.todoist.com/app/task/${item.id}`,
        description: item.description ?? "",
        created: isoDate(item.added_at),
        due: isoDate(item.due?.date),
        tags: item.labels ?? [],
        done: item.checked === true,
        fields: {
          // The API counts 4 as most urgent; the app calls that p1.
          priority: item.priority ? `p${5 - Number(item.priority)}` : "",
          project,
          deadline: isoDate(item.deadline?.date),
        },
      }
    })

    const columns = projectId
      ? [NO_SECTION, ...[...sections].sort((a, b) => (a.section_order ?? 0) - (b.section_order ?? 0)).map((s) => String(s.name))]
      : [...new Set(tasks.map((task) => task.state))]
    const name = (projectId && projectName.get(projectId)) || "todoist"
    return [{ folder: "", splitCompleted: true, board: { name, columns }, tasks }]
  },
}
