import type { Frontmatter, IndexedNote, NoteRef, NoteStore } from "../src/sync"

interface File {
  content: string
  fm?: Frontmatter
}

/** An in-memory vault for exercising the sync engine. */
export class MemoryStore implements NoteStore {
  files = new Map<string, File>()
  folders = new Set<string>()
  /** Board writes and frontmatter changes, to check that unchanged data is not rewritten. */
  writes = 0

  private ref(path: string): NoteRef {
    return { path, basename: path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "") }
  }

  async list(folder: string): Promise<IndexedNote[]> {
    const prefix = folder ? `${folder}/` : ""
    return [...this.files.entries()]
      .filter(([path]) => path.startsWith(prefix) && path.endsWith(".md"))
      .map(([path, file]) => ({
        ...this.ref(path),
        source: file.fm?.["task-source"] as string | undefined,
        id: file.fm?.["task-id"] as string | undefined,
      }))
  }

  async ensureFolder(path: string) {
    this.folders.add(path)
  }

  async create(path: string, content: string, fm: Frontmatter) {
    let free = path
    for (let n = 1; this.files.has(free); n++) free = path.replace(/\.md$/, ` ${n}.md`)
    this.files.set(free, { content, fm: { ...fm } })
    return this.ref(free)
  }

  async stamp(note: NoteRef, fm: Frontmatter) {
    const file = this.files.get(note.path)!
    if (Object.entries(fm).every(([k, v]) => file.fm?.[k] === v)) return
    file.fm = { ...file.fm, ...fm }
    this.writes++
  }

  async move(note: NoteRef, folder: string) {
    const to = `${folder}/${note.basename}.md`
    this.files.set(to, this.files.get(note.path)!)
    this.files.delete(note.path)
    return this.ref(to)
  }

  async write(path: string, content: string) {
    if (this.files.get(path)?.content === content) return false
    this.files.set(path, { content })
    this.writes++
    return true
  }
}
