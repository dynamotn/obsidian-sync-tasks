import { htmlToMarkdown, requestUrl, type App } from "obsidian"
import type { FetchContext, HttpRequest } from "./providers/provider"
import type { SourceConfig } from "./settings"

/** A URL without its query string, which may carry keys (Trello does). */
export function redact(url: string): string {
  return url.replace(/[?#].*$/, "")
}

/** The most useful line of an error body from any of the trackers. */
export function errorDetail(body: unknown): string {
  if (!body || typeof body !== "object") return ""
  const b = body as Record<string, any>
  const messages: unknown[] = [
    b.errorMessages?.[0],
    b.message,
    b.error_description,
    b.error,
    b.errors?.[0]?.message,
    b.errors && !Array.isArray(b.errors) ? Object.values(b.errors)[0] : undefined,
  ]
  const message = messages.find((m) => typeof m === "string" && m.trim())
  return typeof message === "string" ? message.trim().slice(0, 200) : ""
}

/** The fetch context of a source, backed by Obsidian's requestUrl and keychain. */
export function fetchContext(app: App, source: SourceConfig): FetchContext {
  return {
    teamMode: source.teamMode,
    htmlToMarkdown: (html) => htmlToMarkdown(html),
    secret(name) {
      if (!name) throw new Error("no secret is selected for a required credential")
      const value = app.secretStorage.getSecret(name)
      if (!value) throw new Error(`secret "${name}" is not in Obsidian's keychain`)
      return value
    },
    async request<T>(req: HttpRequest): Promise<T> {
      const method = req.method ?? "GET"
      const res = await requestUrl({
        url: req.url,
        method,
        headers: req.headers,
        body: req.body,
        contentType: req.body ? "application/json" : undefined,
        throw: false,
      })
      let json: unknown = null
      try {
        json = res.text ? JSON.parse(res.text) : null
      } catch {
        if (res.status < 400) throw new Error(`${method} ${redact(req.url)} did not return JSON`)
      }
      if (res.status >= 400) {
        const detail = errorDetail(json)
        throw new Error(`HTTP ${res.status} from ${method} ${redact(req.url)}${detail ? `: ${detail}` : ""}`)
      }
      return json as T
    },
  }
}
