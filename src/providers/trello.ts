import type { Task } from "../types"
import { isoDate, splitList } from "../util"
import { str, type Provider } from "./provider"

const API = "https://api.trello.com/1"

/** A Trello id starts with the creation time in seconds, as hex. */
export function createdFromId(id: string): string {
  const seconds = Number.parseInt(String(id).slice(0, 8), 16)
  return Number.isNaN(seconds) ? "" : new Date(seconds * 1000).toISOString().slice(0, 10)
}

export const trello: Provider = {
  id: "trello",
  name: "Trello",
  defaults: { apiKey: "", token: "", boardId: "", usernames: "", doneLists: "Done" },
  fields: [
    { key: "apiKey", name: "API key", desc: "Secret in Obsidian's keychain holding your Power-Up API key.", type: "secret" },
    { key: "token", name: "Token", desc: "Secret in Obsidian's keychain holding a token for that key.", type: "secret" },
    { key: "boardId", name: "Board ID", desc: "The short id in the board URL, e.g. AbCd1234.", type: "text" },
    {
      key: "usernames",
      name: "Members",
      desc: "Comma-separated usernames whose cards to take. Empty means you. Ignored in team mode.",
      type: "text",
    },
    { key: "doneLists", name: "Done lists", desc: "Lists whose cards count as finished.", type: "text" },
  ],

  async fetch(options, ctx) {
    const auth = `key=${encodeURIComponent(ctx.secret(str(options, "apiKey")))}&token=${encodeURIComponent(ctx.secret(str(options, "token")))}`
    const boardId = str(options, "boardId")
    if (!boardId) throw new Error("no board ID is set")
    const board = `${API}/boards/${encodeURIComponent(boardId)}`
    const get = <T>(url: string) => ctx.request<T>({ url: `${url}${url.includes("?") ? "&" : "?"}${auth}` })

    const [info, lists, cards] = await Promise.all([
      get<any>(`${board}?fields=name`),
      get<any[]>(`${board}/lists?filter=open&fields=name,pos`),
      get<any[]>(
        `${board}/cards/open?members=true&member_fields=fullName,username&fields=idShort,name,desc,due,dueComplete,idList,labels,shortUrl`,
      ),
    ])

    let users = new Set<string>()
    if (!ctx.teamMode) {
      users = new Set(splitList(str(options, "usernames")).map((u) => u.toLowerCase()))
      if (users.size === 0) users.add(String((await get<any>(`${API}/members/me?fields=username`)).username).toLowerCase())
    }

    const ordered = [...(lists ?? [])].sort((a, b) => a.pos - b.pos)
    const listName = new Map(ordered.map((list) => [list.id, String(list.name)]))
    const doneLists = new Set(splitList(str(options, "doneLists")))

    const tasks = (cards ?? [])
      .filter((card) => ctx.teamMode || (card.members ?? []).some((m: any) => users.has(String(m.username).toLowerCase())))
      .map((card): Task => {
        const state = listName.get(card.idList) ?? ""
        return {
          id: String(card.idShort),
          title: card.name ?? "",
          state,
          type: "Card",
          assignee: card.members?.[0]?.fullName ?? "Unassigned",
          url: card.shortUrl ?? "",
          description: card.desc ?? "",
          created: createdFromId(card.id),
          due: isoDate(card.due),
          tags: (card.labels ?? []).map((label: any) => label.name || label.color).filter(Boolean),
          done: card.dueComplete === true || doneLists.has(state),
        }
      })

    return [{ folder: "", board: { name: String(info?.name ?? boardId), columns: ordered.map((l) => String(l.name)) }, tasks }]
  },
}
