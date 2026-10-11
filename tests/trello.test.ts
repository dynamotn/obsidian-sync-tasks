import { describe, expect, test } from "bun:test"
import { createdFromId, trello } from "../src/providers/trello"
import { fakeContext } from "./fake-http"

const options = { ...trello.defaults, apiKey: "k", token: "t", boardId: "AbCd1234" }

function card(idShort: number, idList: string, members: string[], extra: Record<string, unknown> = {}) {
  return {
    id: "6702b6800000000000000000",
    idShort,
    name: `Card ${idShort}`,
    desc: "Body",
    due: "2026-10-20T12:00:00.000Z",
    dueComplete: false,
    idList,
    labels: [{ name: "", color: "red" }, { name: "UI", color: "blue" }],
    shortUrl: `https://trello.com/c/x${idShort}`,
    members: members.map((username) => ({ username, fullName: username.toUpperCase() })),
    ...extra,
  }
}

const routes = (cards: unknown[]): [RegExp, unknown][] => [
  [/\/boards\/AbCd1234\?fields=name&/, { name: "Roadmap" }],
  [/\/lists\?/, [{ id: "l2", name: "Done", pos: 2 }, { id: "l1", name: "Doing", pos: 1 }]],
  [/\/cards\/open\?/, cards],
  [/\/members\/me\?/, { username: "Ann" }],
]

describe("trello", () => {
  test("takes the cards of the token owner by default", async () => {
    const { ctx, requests } = fakeContext(routes([card(1, "l1", ["ann"]), card(2, "l2", ["bob", "ann"]), card(3, "l1", ["bob"])]))

    const [group] = await trello.fetch(options, ctx)

    expect(requests[0]!.url).toEndWith("?fields=name&key=secret%3Ak&token=secret%3At")
    expect(group!.board).toEqual({ name: "Roadmap", columns: ["Doing", "Done"] })
    expect(group!.tasks.map((t) => [t.id, t.state, t.done])).toEqual([
      ["1", "Doing", false],
      ["2", "Done", true],
    ])
    expect(group!.tasks[0]).toMatchObject({ assignee: "ANN", due: "2026-10-20", tags: ["red", "UI"], created: "2024-10-06" })
  })

  test("listed members, or everyone in team mode", async () => {
    const cards = [card(1, "l1", ["ann"]), card(3, "l1", ["bob"]), card(4, "l1", [])]
    const listed = await trello.fetch({ ...options, usernames: "Bob" }, fakeContext(routes(cards)).ctx)
    expect(listed[0]!.tasks.map((t) => t.id)).toEqual(["3"])
    const team = await trello.fetch(options, fakeContext(routes(cards), true).ctx)
    expect(team[0]!.tasks.map((t) => t.id)).toEqual(["1", "3", "4"])
  })

  test("createdFromId", () => {
    expect(createdFromId("6702b6800000000000000000")).toBe("2024-10-06")
    expect(createdFromId("zz")).toBe("")
  })
})
