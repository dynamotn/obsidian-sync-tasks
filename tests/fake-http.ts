import type { FetchContext, HttpRequest } from "../src/providers/provider"

type Reply = unknown | ((req: HttpRequest) => unknown)

/**
 * A fetch context answering from a route table: the first route whose
 * pattern matches the URL (and method, as "POST url") wins. Every request is
 * recorded for assertions.
 */
export function fakeContext(routes: [RegExp, Reply][], teamMode = false) {
  const requests: HttpRequest[] = []
  const ctx: FetchContext = {
    teamMode,
    htmlToMarkdown: (html) => html.replace(/<[^>]+>/g, ""),
    secret: (name) => {
      if (!name) throw new Error("no secret is selected for a required credential")
      return `secret:${name}`
    },
    async request<T>(req: HttpRequest): Promise<T> {
      requests.push(req)
      const key = `${req.method ?? "GET"} ${req.url}`
      const route = routes.find(([pattern]) => pattern.test(key))
      if (!route) throw new Error(`unexpected request ${key}`)
      const reply = route[1]
      return (typeof reply === "function" ? reply(req) : reply) as T
    },
  }
  return { ctx, requests }
}
