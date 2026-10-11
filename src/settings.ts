import type { Options } from "./providers/provider"
import { DEFAULT_NOTE_NAME, DEFAULT_NOTE_TEMPLATE } from "./template"

/** One configured tracker connection; several may use the same provider. */
export interface SourceConfig {
  id: string
  name: string
  provider: string
  enabled: boolean
  /** Vault folder for this source's notes and boards. */
  folder: string
  /** Pull the whole team's tasks and show assignees on the board. */
  teamMode: boolean
  createBoard: boolean
  /** Minutes between automatic syncs; null follows the global interval. */
  intervalMinutes: number | null
  /** Overrides of the global templates; "" uses the global one. */
  noteName: string
  noteTemplate: string
  options: Options
}

export interface Settings {
  sources: SourceConfig[]
  noteName: string
  noteTemplate: string
  /** Minutes between automatic syncs of every source; 0 syncs only on demand. */
  intervalMinutes: number
  syncOnStartup: boolean
  /** Keep the task's state, assignee, due date and link in its note's frontmatter. */
  frontmatter: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  sources: [],
  noteName: DEFAULT_NOTE_NAME,
  noteTemplate: DEFAULT_NOTE_TEMPLATE,
  intervalMinutes: 0,
  syncOnStartup: false,
  frontmatter: true,
}

export function newSource(id: string, provider: string, name: string, defaults: Options): SourceConfig {
  return {
    id,
    name,
    provider,
    enabled: true,
    folder: name,
    teamMode: false,
    createBoard: true,
    intervalMinutes: null,
    noteName: "",
    noteTemplate: "",
    options: { ...defaults },
  }
}

/** Fills in anything missing from saved data, so older data keeps loading. */
export function normalizeSettings(raw: unknown): Settings {
  const data = (raw && typeof raw === "object" ? raw : {}) as Partial<Settings>
  const settings: Settings = { ...DEFAULT_SETTINGS, ...data, sources: [] }
  for (const source of Array.isArray(data.sources) ? data.sources : []) {
    if (!source || typeof source !== "object" || !source.id || !source.provider) continue
    settings.sources.push({ ...newSource(source.id, source.provider, source.name ?? "", {}), ...source })
  }
  return settings
}

/** The interval a source actually syncs at, in minutes; 0 means never on its own. */
export function effectiveInterval(source: SourceConfig, settings: Settings): number {
  const minutes = source.intervalMinutes ?? settings.intervalMinutes
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0
}

/** Enabled sources grouped by interval, so sources on the same beat sync together. */
export function schedule(settings: Settings): Map<number, string[]> {
  const groups = new Map<number, string[]>()
  for (const source of settings.sources) {
    const minutes = effectiveInterval(source, settings)
    if (!source.enabled || minutes === 0) continue
    groups.set(minutes, [...(groups.get(minutes) ?? []), source.id])
  }
  return groups
}
