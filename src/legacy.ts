import { azureDevops } from "./providers/azure-devops"
import { gitlab } from "./providers/gitlab"
import { jira } from "./providers/jira"
import type { Options } from "./providers/provider"
import { newSource, type SourceConfig } from "./settings"

/** Where Agile Task Notes keeps its settings, relative to the config folder. */
export const LEGACY_DATA = "plugins/obsidian-agile-task-notes/data.json"

export interface LegacyImport {
  sources: SourceConfig[]
  /** Credentials to move into Obsidian's keychain under these names. */
  secrets: { name: string; value: string }[]
}

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/**
 * Sources equivalent to an Agile Task Notes configuration: the selected
 * backend, plus any other backend that was filled in. Its tokens become
 * keychain secrets, so they no longer sit in plain text in the new settings.
 */
export function fromAgileTaskNotes(data: any, makeId: () => string): LegacyImport {
  const result: LegacyImport = { sources: [], secrets: [] }
  if (!data || typeof data !== "object") return result
  const selected = text(data.selectedTfsClient)

  const add = (provider: string, name: string, defaults: Options, options: Options, token: string) => {
    const id = makeId()
    const source = newSource(id, provider, name, defaults)
    Object.assign(source.options, options)
    source.folder = text(data.targetFolder)
    source.teamMode = data.teamLeaderMode === true
    source.createBoard = data.createKanban !== false
    source.intervalMinutes = Number(data.intervalMinutes) > 0 ? Number(data.intervalMinutes) : null
    source.noteName = text(data.noteName)
    source.noteTemplate = text(data.noteTemplate)
    if (token) {
      const secret = `sync-tasks-${provider}-${id}`.toLowerCase().replace(/[^a-z0-9-]/g, "-")
      result.secrets.push({ name: secret, value: token })
      source.options.token = secret
    }
    result.sources.push(source)
  }

  const j = data.jiraSettings ?? {}
  if (selected === "Jira" || text(j.boardId)) {
    add(
      "jira",
      "Jira",
      jira.defaults,
      {
        url: text(j.baseUrl).replace("{yourserver}.atlassian.net", ""),
        authMode: j.authmode === "bearer" ? "bearer" : "basic",
        email: text(j.email),
        boardId: text(j.boardId),
        mode: j.mode === "kanban" ? "kanban" : "sprints",
        useSprintName: j.useSprintName !== false,
        excludeBacklog: j.excludeBacklog === true,
        usernames: text(j.usernames),
      },
      text(j.apiToken),
    )
  }

  const a = data.azureDevopsSettings ?? {}
  if (selected === "AzureDevops" || text(a.project)) {
    add(
      "azure-devops",
      "Azure DevOps",
      azureDevops.defaults,
      {
        instance: text(a.instance),
        collection: text(a.collection),
        project: text(a.project),
        team: text(a.team),
        usernames: text(a.usernames),
        ...(text(a.columns) ? { columns: text(a.columns) } : {}),
      },
      text(a.accessToken),
    )
  }

  const g = data.gitlabSettings ?? {}
  if (selected === "Gitlab" || text(g.projectId)) {
    add(
      "gitlab",
      "GitLab",
      gitlab.defaults,
      {
        url: text(g.baseUrl) || "gitlab.com",
        projectId: decodeURIComponent(text(g.projectId)),
        usernames: text(g.usernames),
        boardId: text(g.boardId),
        mode: ["milestones", "board", "user"].includes(g.mode) ? g.mode : "milestones",
        useMilestoneName: g.useMilestoneName !== false,
        ...(text(g.columns) ? { columns: text(g.columns) } : {}),
        excludeClosed: g.excludeClosed === true,
      },
      text(g.accessToken),
    )
  }

  return result
}
