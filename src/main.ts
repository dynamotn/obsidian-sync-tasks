/**
 * Sync Tasks for Obsidian: pull tasks from many task trackers at once into
 * task notes and Kanban boards.
 *
 * Each configured source names a provider (Jira, GitLab, …) and a folder. A
 * sync asks the provider for its tasks grouped by folder and board, then the
 * engine (sync.ts) creates the notes that are missing and rewrites the boards.
 */
import { Notice, Plugin } from "obsidian"
import { fetchContext } from "./http"
import { providerMap } from "./providers"
import { normalizeSettings, type Settings, type SourceConfig } from "./settings"
import { summary, SyncRunner, type SyncResult } from "./sync"
import { SyncTasksSettingTab } from "./ui/settings-tab"
import { VaultStore } from "./vault"

export default class SyncTasksPlugin extends Plugin {
  declare settings: Settings
  runner!: SyncRunner

  override async onload() {
    await this.loadSettings()
    this.runner = new SyncRunner({
      providers: providerMap,
      store: new VaultStore(this.app),
      context: (source) => fetchContext(this.app, source),
      settings: () => this.settings,
    })

    this.addSettingTab(new SyncTasksSettingTab(this.app, this))
    this.addRibbonIcon("refresh-cw", "Sync tasks from all sources", () => void this.syncAll())
    this.addCommand({
      id: "sync-all",
      name: "Sync all sources",
      callback: () => void this.syncAll(),
    })

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.syncOnStartup) void this.syncAll(true)
    })
  }

  /** Syncs every enabled source; quiet runs only speak up on failure. */
  async syncAll(quiet = false): Promise<SyncResult[]> {
    return this.sync(
      this.settings.sources.filter((source) => source.enabled),
      quiet,
    )
  }

  async sync(sources: SourceConfig[], quiet = false): Promise<SyncResult[]> {
    if (sources.length === 0) {
      if (!quiet) new Notice("Sync Tasks: no enabled source. Add one in the settings.")
      return []
    }
    const results = await this.runner.run(sources)
    const failed = results.some((result) => result.error)
    for (const result of results) {
      if (result.error) console.error(`Sync Tasks: ${result.source.name}: ${result.error}`)
    }
    if (!quiet || failed) new Notice(`Sync Tasks\n${summary(results)}`, failed ? 10000 : 5000)
    return results
  }

  async loadSettings() {
    this.settings = normalizeSettings(await this.loadData())
  }

  async saveSettings() {
    await this.saveData(this.settings)
  }
}
