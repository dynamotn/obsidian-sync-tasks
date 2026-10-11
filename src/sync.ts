import { boardMarkdown, type BoardCard } from "./kanban"
import type { FetchContext, Provider } from "./providers/provider"
import type { Settings, SourceConfig } from "./settings"
import { noteContent, noteName } from "./template"
import type { Task } from "./types"
import { joinPath, safeFileName } from "./util"

/** A markdown file in the vault. */
export interface NoteRef {
  path: string
  basename: string
}

/** A note under a source folder, with the task identity stamped in its frontmatter if any. */
export interface IndexedNote extends NoteRef {
  source?: string
  id?: string
}

/** Frontmatter keys that tie a note to its task. */
export const SOURCE_KEY = "task-source"
export const ID_KEY = "task-id"

export type Frontmatter = Record<string, string | boolean>

/** The task's current details, kept in its note's frontmatter when enabled. */
export function taskFrontmatter(task: Task): Frontmatter {
  return {
    "task-title": task.title,
    "task-state": task.state,
    "task-assignee": task.assignee,
    "task-url": task.url,
    "task-due": task.due,
    "task-done": task.done,
  }
}

/** Everything the engine needs from the vault, so it can run against a fake one in tests. */
export interface NoteStore {
  /** Markdown notes under a folder, recursively. */
  list(folder: string): Promise<IndexedNote[]>
  ensureFolder(path: string): Promise<void>
  /** Creates a note, picking a free name if the path is taken, with these frontmatter keys set. */
  create(path: string, content: string, frontmatter: Frontmatter): Promise<NoteRef>
  /** Sets frontmatter keys of a note, without writing when they already hold those values. */
  stamp(note: NoteRef, frontmatter: Frontmatter): Promise<void>
  move(note: NoteRef, folder: string): Promise<NoteRef>
  /** Writes a file unless it already has that content; returns whether it wrote. */
  write(path: string, content: string): Promise<boolean>
}

export interface SyncResult {
  source: SourceConfig
  tasks: number
  created: number
  moved: number
  boards: number
  /** Every task with the note it links to, for the overview. */
  cards: BoardCard[]
  error?: string
}

const COMPLETED = "Completed"

function parentOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
}

/**
 * Notes made before the identity was kept in frontmatter (or by Agile Task
 * Notes) are recognised by the task id in their name, as a whole word, so
 * "PROJ-1" does not claim "PROJ-12".
 */
export function legacyMatch(notes: IndexedNote[], id: string): IndexedNote | undefined {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_-])${escaped}($|[^\\p{L}\\p{N}_-])`, "u")
  return notes.find((note) => note.id === undefined && pattern.test(note.basename))
}

/** Pulls one source and brings its notes and boards up to date. */
export async function syncSource(
  source: SourceConfig,
  provider: Provider,
  ctx: FetchContext,
  store: NoteStore,
  settings: Settings,
): Promise<SyncResult> {
  const result: SyncResult = { source, tasks: 0, created: 0, moved: 0, boards: 0, cards: [] }
  const groups = await provider.fetch(source.options, ctx)
  const root = joinPath(source.folder)
  const meta = { name: source.name, provider: source.provider }

  const notes = await store.list(root)
  const byId = new Map<string, NoteRef>()
  for (const note of notes) if (note.source === source.id && note.id) byId.set(note.id, note)
  const unstamped = notes.filter((note) => note.id === undefined)

  for (const group of groups) {
    const groupFolder = joinPath(root, group.folder)
    const cards: BoardCard[] = []

    for (const task of group.tasks) {
      result.tasks++
      const target = joinPath(groupFolder, task.folder ?? "", group.splitCompleted && task.done ? COMPLETED : "")
      const identity: Frontmatter = { [SOURCE_KEY]: source.id, [ID_KEY]: task.id }
      const frontmatter = settings.frontmatter ? { ...identity, ...taskFrontmatter(task) } : identity
      let note = byId.get(task.id)

      if (note) {
        if (settings.frontmatter) await store.stamp(note, frontmatter)
      } else {
        const legacy = legacyMatch(unstamped, task.id)
        if (legacy) {
          await store.stamp(legacy, frontmatter)
          unstamped.splice(unstamped.indexOf(legacy), 1)
          note = legacy
        }
      }

      if (!note) {
        await store.ensureFolder(target)
        const name = noteName(source.noteName || settings.noteName, task, meta)
        const content = noteContent(source.noteTemplate || settings.noteTemplate, task, meta)
        note = await store.create(joinPath(target, `${name}.md`), content, frontmatter)
        result.created++
      } else if (group.splitCompleted) {
        // Only move notes that sit where the plugin put them; leave hand-filed ones alone.
        const parent = parentOf(note.path)
        const home = joinPath(groupFolder, task.folder ?? "")
        if (parent !== target && (parent === home || parent === joinPath(home, COMPLETED))) {
          await store.ensureFolder(target)
          note = await store.move(note, target)
          result.moved++
        }
      }

      byId.set(task.id, note)
      cards.push({ task, link: linkTo(note) })
    }

    result.cards.push(...cards)
    if (source.createBoard && group.board) {
      await store.ensureFolder(groupFolder)
      const path = joinPath(groupFolder, `${safeFileName(group.board.name)}-Board.md`)
      if (await store.write(path, boardMarkdown(group.board.columns, cards, source.teamMode))) result.boards++
    }
  }
  return result
}

/** A wikilink to a note by full path, so same-named notes of other sources never clash. */
function linkTo(note: NoteRef): string {
  return `${note.path.replace(/\.md$/, "")}|${note.basename}`
}

export interface Engine {
  providers: Map<string, Provider>
  store: NoteStore
  context(source: SourceConfig): FetchContext
  settings(): Settings
}

/** Runs sources concurrently, never the same source twice at once. */
export class SyncRunner {
  private running = new Set<string>()

  constructor(private engine: Engine) {}

  isRunning(sourceId: string): boolean {
    return this.running.has(sourceId)
  }

  /** Syncs the given sources in parallel; one failing source does not stop the others. */
  async run(sources: SourceConfig[], onDone?: (result: SyncResult) => void): Promise<SyncResult[]> {
    const todo = sources.filter((source) => !this.running.has(source.id))
    return Promise.all(
      todo.map(async (source) => {
        this.running.add(source.id)
        let result: SyncResult
        try {
          const provider = this.engine.providers.get(source.provider)
          if (!provider) throw new Error(`Unknown provider "${source.provider}"`)
          result = await syncSource(
            source,
            provider,
            this.engine.context(source),
            this.engine.store,
            this.engine.settings(),
          )
        } catch (e) {
          result = {
            source,
            tasks: 0,
            created: 0,
            moved: 0,
            boards: 0,
            cards: [],
            error: e instanceof Error ? e.message : String(e),
          }
        } finally {
          this.running.delete(source.id)
        }
        onDone?.(result)
        return result
      }),
    )
  }
}

/** One line per source for a notice: "Work: 12 tasks, 3 new". */
export function summary(results: SyncResult[]): string {
  if (results.length === 0) return "Nothing to sync"
  return results
    .map(({ source, tasks, created, moved, error }) => {
      if (error) return `${source.name}: failed, ${error}`
      const parts = [`${tasks} ${tasks === 1 ? "task" : "tasks"}`]
      if (created) parts.push(`${created} new`)
      if (moved) parts.push(`${moved} moved`)
      return `${source.name}: ${parts.join(", ")}`
    })
    .join("\n")
}

