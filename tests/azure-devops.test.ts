import { describe, expect, test } from "bun:test"
import { azureDevops, wiql } from "../src/providers/azure-devops"
import { fakeContext } from "./fake-http"

const options = { ...azureDevops.defaults, instance: "dev.azure.com/Acme", project: "Web App", team: "Core", token: "ado" }

function item(id: number, state: string) {
  return {
    id,
    fields: {
      "System.Title": `Item ${id}`,
      "System.State": state,
      "System.WorkItemType": "User Story",
      "System.AssignedTo": { displayName: "Ann" },
      "System.Description": "<p>Hello</p>",
      "System.CreatedDate": "2026-10-01T10:00:00Z",
      "System.Tags": "needs review; ui",
      "Microsoft.VSTS.Common.AcceptanceCriteria": "<b>works</b>",
      "Microsoft.VSTS.Common.Priority": 2,
    },
  }
}

describe("azure devops", () => {
  test("pulls the current iteration in batches", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => ({ id: i + 1 }))
    const { ctx, requests } = fakeContext([
      [/iterations\?\$timeframe=current/, { value: [{ name: "Sprint 5", path: "Web App\\Sprint 5" }] }],
      [/^POST .*\/Core\/_apis\/wit\/wiql/, { workItems: ids }],
      [/workitems\?ids=1,/, { value: [item(1, "Active")] }],
      [/workitems\?ids=201&/, { value: [item(201, "Closed")] }],
    ])

    const [group] = await azureDevops.fetch(options, ctx)

    expect(requests[0]!.url).toStartWith("https://dev.azure.com/Acme/Web%20App/Core/_apis/work/teamsettings/iterations")
    expect(requests[0]!.headers!.Authorization).toBe(`Basic ${btoa(":secret:ado")}`)
    expect(JSON.parse(requests[1]!.body!).query).toBe(
      "SELECT [System.Id] FROM WorkItems WHERE [System.IterationPath] UNDER 'Web App\\Sprint 5' AND [System.AssignedTo] = @Me",
    )
    expect(requests).toHaveLength(4)
    expect(group!.folder).toBe("Web App/Sprint 5")
    expect(group!.board).toEqual({
      name: "Sprint 5",
      columns: ["Pending", "In Progress", "In Merge", "In Verification", "Closed"],
    })
    expect(group!.tasks.map((t) => [t.id, t.done])).toEqual([
      ["1", false],
      ["201", true],
    ])
    expect(group!.tasks[0]).toMatchObject({
      title: "Item 1",
      type: "User Story",
      url: "https://dev.azure.com/Acme/Web%20App/_workitems/edit/1",
      description: "Hello",
      created: "2026-10-01",
      tags: ["needs review", "ui"],
      fields: { criteria: "works", tests: "", priority: "2" },
    })
  })

  test("puts the collection in the URL only when set", async () => {
    const { ctx, requests } = fakeContext([
      [/iterations/, { value: [{ name: "S", path: "P\\S" }] }],
      [/wiql/, { workItems: [] }],
    ])
    await azureDevops.fetch({ ...options, instance: "tfs.acme.local/", collection: "Main" }, ctx)
    expect(requests[0]!.url).toStartWith("https://tfs.acme.local/Main/Web%20App/Core/")
  })

  test("wiql filters by the listed users, or not at all in team mode", () => {
    expect(wiql("P\\S", { usernames: "Ann, O'Neil" }, false)).toEndWith(
      " AND ([System.AssignedTo] = 'Ann' OR [System.AssignedTo] = 'O''Neil')",
    )
    expect(wiql("P\\S", { usernames: "Ann" }, true)).toEndWith("UNDER 'P\\S'")
  })
})
