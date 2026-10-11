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
import { normalizeSettings, schedule, type Settings, type SourceConfig } from "./settings"
import { summary, SyncRunner, type SyncResult } from "./sync"
import { SyncTasksSettingTab } from "./ui/settings-tab"
import { VaultStore } from "./vault"

export default class SyncTasksPlugin extends Plugin {
  declare settings: Settings
  runner!: SyncRunner
  private timers: number[] = []
  private sourceCommands: string[] = []

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
    this.applySettings()
  }

  override onunload() {
    this.clearTimers()
  }

  /** Re-arms the timers and the per-source commands after any settings change. */
  private applySettings() {
    this.clearTimers()
    for (const [minutes, ids] of schedule(this.settings)) {
      const timer = window.setInterval(() => {
        void this.sync(
          this.settings.sources.filter((source) => ids.includes(source.id)),
          true,
        )
      }, minutes * 60_000)
      this.timers.push(timer)
      this.registerInterval(timer)
    }

    for (const id of this.sourceCommands) this.removeCommand(id)
    this.sourceCommands = []
    for (const source of this.settings.sources) {
      // removeCommand takes the id without the plugin prefix that addCommand adds.
      const id = `sync-source-${source.id}`
      this.addCommand({
        id,
        name: `Sync ${source.name || source.provider}`,
        checkCallback: (checking) => {
          const current = this.settings.sources.find((s) => s.id === source.id)
          if (!current?.enabled) return false
          if (!checking) void this.sync([current])
          return true
        },
      })
      this.sourceCommands.push(id)
    }
  }

  private clearTimers() {
    for (const timer of this.timers) window.clearInterval(timer)
    this.timers = []
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
    this.applySettings()
  }
}
