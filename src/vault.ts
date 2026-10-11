import { normalizePath, TFile, TFolder, Vault, type App } from "obsidian"
import type { IndexedNote, NoteRef, NoteStore } from "./sync"

/** Frontmatter keys that tie a note to its task. */
export const SOURCE_KEY = "task-source"
export const ID_KEY = "task-id"

/** The sync engine's view of the vault. */
export class VaultStore implements NoteStore {
  constructor(private app: App) {}

  async list(folder: string): Promise<IndexedNote[]> {
    const root = folder ? this.app.vault.getFolderByPath(normalizePath(folder)) : this.app.vault.getRoot()
    if (!root) return []
    const notes: IndexedNote[] = []
    Vault.recurseChildren(root, (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter
      const id = fm?.[ID_KEY]
      const source = fm?.[SOURCE_KEY]
      notes.push({
        path: file.path,
        basename: file.basename,
        id: id === undefined || id === null ? undefined : String(id),
        source: source === undefined || source === null ? undefined : String(source),
      })
    })
    return notes
  }

  async ensureFolder(path: string): Promise<void> {
    let current = ""
    for (const part of normalizePath(path).split("/").filter(Boolean)) {
      current = current ? `${current}/${part}` : part
      const existing = this.app.vault.getAbstractFileByPath(current)
      if (existing instanceof TFolder) continue
      if (existing) throw new Error(`"${current}" is a file, not a folder`)
      try {
        await this.app.vault.createFolder(current)
      } catch (e) {
        // Another source may have created it meanwhile.
        if (!(this.app.vault.getAbstractFileByPath(current) instanceof TFolder)) throw e
      }
    }
  }

  async create(path: string, content: string, source: string, id: string): Promise<NoteRef> {
    const file = await this.app.vault.create(this.freePath(normalizePath(path)), content)
    await this.stamp(file, source, id)
    return file
  }

  async stamp(note: NoteRef, source: string, id: string): Promise<void> {
    await this.app.fileManager.processFrontMatter(this.file(note), (fm) => {
      fm[SOURCE_KEY] = source
      fm[ID_KEY] = id
    })
  }

  async move(note: NoteRef, folder: string): Promise<NoteRef> {
    const file = this.file(note)
    await this.app.fileManager.renameFile(file, this.freePath(normalizePath(`${folder}/${file.name}`)))
    return file
  }

  async write(path: string, content: string): Promise<boolean> {
    const normalized = normalizePath(path)
    const existing = this.app.vault.getAbstractFileByPath(normalized)
    if (existing instanceof TFile) {
      if ((await this.app.vault.read(existing)) === content) return false
      await this.app.vault.modify(existing, content)
    } else {
      await this.app.vault.create(normalized, content)
    }
    return true
  }

  private file(note: NoteRef): TFile {
    const file = this.app.vault.getAbstractFileByPath(note.path)
    if (!(file instanceof TFile)) throw new Error(`Note "${note.path}" is gone`)
    return file
  }

  /** The path itself if free, else "name 1.md", "name 2.md", … */
  private freePath(path: string): string {
    const base = path.replace(/\.md$/, "")
    let candidate = path
    for (let n = 1; this.app.vault.getAbstractFileByPath(candidate); n++) candidate = `${base} ${n}.md`
    return candidate
  }
}
