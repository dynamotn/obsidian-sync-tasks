import type { Task, TaskGroup } from "../types"
import { isoDate } from "../util"
import { bool, str, type Options, type Provider } from "./provider"

const API = "https://api.linear.app/graphql"

const QUERY = `query Issues($filter: IssueFilter, $after: String) {
  issues(filter: $filter, first: 100, after: $after) {
    nodes {
      identifier title description url createdAt dueDate priorityLabel
      state { name type position }
      assignee { name }
      labels { nodes { name } }
      team { key }
      cycle { number }
      project { name }
    }
    pageInfo { hasNextPage endCursor }
  }
}`

/** Linear's workflow state types, in board order. */
const STATE_ORDER = ["triage", "backlog", "unstarted", "started", "completed", "canceled"]

/** The IssueFilter for the source's options. */
export function issueFilter(options: Options, teamMode: boolean): Record<string, unknown> {
  const filter: Record<string, unknown> = {}
  if (!teamMode) filter.assignee = { isMe: { eq: true } }
  const team = str(options, "teamKey")
  if (team) filter.team = { key: { eq: team } }
  if (bool(options, "currentCycle")) filter.cycle = { isActive: { eq: true } }
  if (bool(options, "excludeCompleted")) filter.state = { type: { nin: ["completed", "canceled"] } }
  return filter
}

/** Board columns: the states the issues are in, ordered as Linear orders them. */
function columnsOf(issues: any[]): string[] {
  const states = new Map<string, { type: string; position: number }>()
  for (const issue of issues) if (issue.state) states.set(issue.state.name, issue.state)
  return [...states.entries()]
    .sort(([, a], [, b]) => STATE_ORDER.indexOf(a.type) - STATE_ORDER.indexOf(b.type) || a.position - b.position)
    .map(([name]) => name)
}

export const linear: Provider = {
  id: "linear",
  name: "Linear",
  defaults: { apiKey: "", teamKey: "", currentCycle: false, excludeCompleted: false },
  fields: [
    { key: "apiKey", name: "API key", desc: "Secret in Obsidian's keychain holding a personal API key.", type: "secret" },
    { key: "teamKey", name: "Team key", desc: "Optional, e.g. ENG. Empty takes every team.", type: "text" },
    {
      key: "currentCycle",
      name: "Current cycle only",
      desc: "Only issues in an active cycle, in a folder per cycle.",
      type: "toggle",
    },
    { key: "excludeCompleted", name: "Exclude completed and canceled", type: "toggle" },
  ],

  async fetch(options, ctx) {
    const headers = { Authorization: ctx.secret(str(options, "apiKey")), "Content-Type": "application/json" }
    const filter = issueFilter(options, ctx.teamMode)

    const issues: any[] = []
    let after: string | null = null
    do {
      const res: any = await ctx.request({
        url: API,
        method: "POST",
        headers,
        body: JSON.stringify({ query: QUERY, variables: { filter, after } }),
      })
      if (res?.errors?.length) throw new Error(res.errors[0].message)
      const page = res?.data?.issues
      issues.push(...(page?.nodes ?? []))
      after = page?.pageInfo?.hasNextPage ? page.pageInfo.endCursor : null
    } while (after)

    const toTask = (issue: any): Task => ({
      id: issue.identifier,
      title: issue.title ?? "",
      state: issue.state?.name ?? "",
      type: "Issue",
      assignee: issue.assignee?.name ?? "Unassigned",
      url: issue.url ?? "",
      description: issue.description ?? "",
      created: isoDate(issue.createdAt),
      due: isoDate(issue.dueDate),
      tags: (issue.labels?.nodes ?? []).map((label: any) => label.name),
      done: issue.state?.type === "completed" || issue.state?.type === "canceled",
      fields: { priority: issue.priorityLabel ?? "", project: issue.project?.name ?? "", team: issue.team?.key ?? "" },
    })

    if (!bool(options, "currentCycle")) {
      const name = str(options, "teamKey") || "linear"
      return [{ folder: "", splitCompleted: true, board: { name, columns: columnsOf(issues) }, tasks: issues.map(toTask) }]
    }

    const cycles = new Map<string, any[]>()
    for (const issue of issues) {
      const key = `${issue.team?.key ?? "team"}-cycle-${issue.cycle?.number ?? "none"}`
      cycles.set(key, [...(cycles.get(key) ?? []), issue])
    }
    return [...cycles.entries()].map(
      ([key, list]): TaskGroup => ({ folder: key, board: { name: key, columns: columnsOf(list) }, tasks: list.map(toTask) }),
    )
  },
}
