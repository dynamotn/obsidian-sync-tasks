import { describe, expect, test } from "bun:test"
import { fromAgileTaskNotes } from "../src/legacy"

describe("fromAgileTaskNotes", () => {
  test("turns the selected backend and filled-in ones into sources, tokens into secrets", () => {
    let n = 0
    const { sources, secrets } = fromAgileTaskNotes(
      {
        selectedTfsClient: "Jira",
        targetFolder: "Work",
        noteTemplate: "# {{TASK_TITLE}}",
        noteName: "{{TASK_ID}} {{TASK_NAME}}",
        intervalMinutes: 15,
        createKanban: true,
        teamLeaderMode: true,
        jiraSettings: { baseUrl: "acme.atlassian.net", email: "me@acme.io", authmode: "basic", apiToken: "T1", boardId: "7", mode: "kanban", excludeBacklog: true, useSprintName: true, usernames: "ann" },
        azureDevopsSettings: { instance: "", project: "", columns: "" },
        gitlabSettings: { baseUrl: "gitlab.acme.io", projectId: "acme%2Fweb", accessToken: "T2", mode: "user", columns: "Open,Closed" },
      },
      () => `id${++n}`,
    )

    expect(sources.map((s) => s.provider)).toEqual(["jira", "gitlab"])
    expect(sources[0]).toMatchObject({
      id: "id1",
      folder: "Work",
      teamMode: true,
      createBoard: true,
      intervalMinutes: 15,
      noteName: "{{TASK_ID}} {{TASK_NAME}}",
      noteTemplate: "# {{TASK_TITLE}}",
      options: { url: "acme.atlassian.net", mode: "kanban", excludeBacklog: true, boardId: "7", token: "sync-tasks-jira-id1", usernames: "ann" },
    })
    expect(sources[1]!.options).toMatchObject({ url: "gitlab.acme.io", projectId: "acme/web", mode: "user", token: "sync-tasks-gitlab-id2" })
    expect(secrets).toEqual([
      { name: "sync-tasks-jira-id1", value: "T1" },
      { name: "sync-tasks-gitlab-id2", value: "T2" },
    ])
  })

  test("ignores missing or broken data", () => {
    expect(fromAgileTaskNotes(null, () => "x")).toEqual({ sources: [], secrets: [] })
    expect(fromAgileTaskNotes({ selectedTfsClient: "AzureDevops" }, () => "x").sources[0]!.provider).toBe("azure-devops")
  })
})
