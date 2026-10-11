import type { TaskGroup } from "../types"

/** Provider options as saved in the settings: plain strings and flags. */
export type Options = Record<string, string | boolean>

/** One provider setting, rendered generically by the settings tab. */
export interface Field {
  key: string
  name: string
  desc?: string
  /** "secret" fields hold the name of a secret in Obsidian's keychain, not its value. */
  type: "text" | "secret" | "toggle" | "dropdown" | "textarea"
  placeholder?: string
  /** Value → label, for dropdowns. */
  choices?: Record<string, string>
  /** Show the field only when this holds. */
  when?: (options: Options) => boolean
}

export interface HttpRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

/** What a provider may use while fetching, so it never touches Obsidian directly. */
export interface FetchContext {
  /** Sends a request and returns the parsed JSON; throws on HTTP errors. */
  request<T = any>(req: HttpRequest): Promise<T>
  /** The value of the secret named by a "secret" field; throws when it is missing. */
  secret(name: string): string
  htmlToMarkdown(html: string): string
  /** Pull every task of the team rather than only the configured assignees. */
  teamMode: boolean
}

/** A task tracker the plugin can pull tasks from. */
export interface Provider {
  id: string
  name: string
  defaults: Options
  fields: Field[]
  fetch(options: Options, ctx: FetchContext): Promise<TaskGroup[]>
}

export function str(options: Options, key: string): string {
  const value = options[key]
  return typeof value === "string" ? value.trim() : ""
}

export function bool(options: Options, key: string): boolean {
  return options[key] === true
}

/** "https://host/path/" or "host/path" → "https://host/path". */
export function baseUrl(value: string, fallback = ""): string {
  const url = (value || fallback).trim().replace(/\/+$/, "")
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}
