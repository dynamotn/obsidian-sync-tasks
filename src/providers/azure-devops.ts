import type { Task } from "../types"
import { base64, isoDate, joinPath, splitList } from "../util"
import { baseUrl, str, type Options, type Provider } from "./provider"

const API = "api-version=7.0"
const BATCH = 200

/** Quotes a value for WIQL. */
function wiqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** The WIQL query for the work items of an iteration and the wanted assignees. */
export function wiql(iterationPath: string, options: Options, teamMode: boolean): string {
  let query = `SELECT [System.Id] FROM WorkItems WHERE [System.IterationPath] UNDER ${wiqlString(iterationPath)}`
  if (!teamMode) {
    const users = splitList(str(options, "usernames"))
    query += users.length
      ? ` AND (${users.map((u) => `[System.AssignedTo] = ${wiqlString(u)}`).join(" OR ")})`
      : " AND [System.AssignedTo] = @Me"
  }
  return query
}

export const azureDevops: Provider = {
  id: "azure-devops",
  name: "Azure DevOps",
  defaults: {
    instance: "dev.azure.com/",
    collection: "",
    project: "",
    team: "",
    usernames: "",
    token: "",
    columns: "Pending,In Progress,In Merge,In Verification,Closed",
    doneStates: "Closed,Done,Removed",
  },
  fields: [
    { key: "instance", name: "Instance", type: "text", placeholder: "dev.azure.com/OrgName", desc: "Server and organization." },
    { key: "collection", name: "Collection", type: "text", desc: "Azure DevOps Server collection; empty when it does not apply." },
    { key: "project", name: "Project", type: "text" },
    { key: "team", name: "Team", type: "text" },
    { key: "token", name: "Personal access token", type: "secret", desc: "Secret in Obsidian's keychain holding a PAT with Work Items (Read)." },
    {
      key: "usernames",
      name: "Assignees",
      desc: "Comma-separated display names or emails. Empty means you. Ignored in team mode.",
      type: "text",
    },
    { key: "columns", name: "Board columns", desc: "Comma or line separated states, in board order.", type: "textarea" },
    { key: "doneStates", name: "Done states", desc: "States that count as finished.", type: "text" },
  ],

  async fetch(options, ctx) {
    const project = str(options, "project")
    const team = str(options, "team")
    if (!project || !team) throw new Error("project and team are required")
    const collection = str(options, "collection")
    const base = `${baseUrl(str(options, "instance"))}${collection ? `/${encodeURIComponent(collection)}` : ""}/${encodeURIComponent(project)}`
    const headers = { Accept: "application/json", Authorization: `Basic ${base64(`:${ctx.secret(str(options, "token"))}`)}` }

    const iterations = await ctx.request<any>({
      url: `${base}/${encodeURIComponent(team)}/_apis/work/teamsettings/iterations?$timeframe=current&${API}`,
      headers,
    })
    const sprint = iterations?.value?.[0]
    if (!sprint) throw new Error(`team ${team} has no current iteration`)

    const found = await ctx.request<any>({
      url: `${base}/${encodeURIComponent(team)}/_apis/wit/wiql?${API}`,
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ query: wiql(sprint.path, options, ctx.teamMode) }),
    })
    const ids: number[] = (found?.workItems ?? []).map((item: any) => item.id)

    const items: any[] = []
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH).join(",")
      const page = await ctx.request<any>({ url: `${base}/_apis/wit/workitems?ids=${batch}&${API}`, headers })
      items.push(...(page?.value ?? []))
    }

    const done = new Set(splitList(str(options, "doneStates")))
    const markdown = (html: unknown) => (typeof html === "string" && html ? ctx.htmlToMarkdown(html) : "")
    const tasks = items.map((item): Task => {
      const f = item.fields ?? {}
      return {
        id: String(item.id),
        title: f["System.Title"] ?? "",
        state: f["System.State"] ?? "",
        type: f["System.WorkItemType"] ?? "Work Item",
        assignee: f["System.AssignedTo"]?.displayName ?? "Unassigned",
        url: `${base}/_workitems/edit/${item.id}`,
        description: markdown(f["System.Description"]),
        created: isoDate(f["System.CreatedDate"]),
        due: isoDate(f["Microsoft.VSTS.Scheduling.DueDate"]),
        tags: String(f["System.Tags"] ?? "")
          .split(";")
          .map((tag) => tag.trim())
          .filter(Boolean),
        done: done.has(f["System.State"]),
        fields: {
          criteria: markdown(f["Microsoft.VSTS.Common.AcceptanceCriteria"]),
          tests: markdown(f["Custom.Testscenarios"]),
          priority: f["Microsoft.VSTS.Common.Priority"] === undefined ? "" : String(f["Microsoft.VSTS.Common.Priority"]),
        },
      }
    })

    return [
      {
        folder: joinPath(String(sprint.path)),
        board: { name: String(sprint.name), columns: splitList(str(options, "columns")) },
        tasks,
      },
    ]
  },
}
