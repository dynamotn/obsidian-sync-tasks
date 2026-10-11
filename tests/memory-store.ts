import type { IndexedNote, NoteRef, NoteStore } from "../src/sync"

interface File {
  content: string
  source?: string
  id?: string
}

/** An in-memory vault for exercising the sync engine. */
export class MemoryStore implements NoteStore {
  files = new Map<string, File>()
  folders = new Set<string>()
  writes = 0

  private ref(path: string): NoteRef {
    return { path, basename: path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "") }
  }

  async list(folder: string): Promise<IndexedNote[]> {
    const prefix = folder ? `${folder}/` : ""
    return [...this.files.entries()]
      .filter(([path]) => path.startsWith(prefix) && path.endsWith(".md"))
      .map(([path, file]) => ({ ...this.ref(path), source: file.source, id: file.id }))
  }

  async ensureFolder(path: string) {
    this.folders.add(path)
  }

  async create(path: string, content: string, source: string, id: string) {
    let free = path
    for (let n = 1; this.files.has(free); n++) free = path.replace(/\.md$/, ` ${n}.md`)
    this.files.set(free, { content, source, id })
    return this.ref(free)
  }

  async stamp(note: NoteRef, source: string, id: string) {
    const file = this.files.get(note.path)!
    file.source = source
    file.id = id
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
