import { normalizePath, Notice, PluginSettingTab, SecretComponent, Setting, type App } from "obsidian"
import { fromAgileTaskNotes, LEGACY_DATA } from "../legacy"
import type SyncTasksPlugin from "../main"
import { PROVIDERS, providerMap } from "../providers"
import type { Field, Options } from "../providers/provider"
import { newSource, type SourceConfig } from "../settings"
import { TEMPLATE_VARIABLES } from "../template"
import { newId } from "../util"

const VARIABLES_HELP = `Variables: ${TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(", ")}, plus provider extras such as {{TASK_CRITERIA}}, {{TASK_TESTS}} (Azure DevOps) or {{TASK_PRIORITY}}.`

export class SyncTasksSettingTab extends PluginSettingTab {
  /** Sources whose details stay expanded across re-renders. */
  private open = new Set<string>()
  private newProvider = PROVIDERS[0]?.id ?? ""

  constructor(
    app: App,
    private plugin: SyncTasksPlugin,
  ) {
    super(app, plugin)
  }

  override display(): void {
    const { containerEl } = this
    containerEl.empty()
    this.general(containerEl)
    this.sources(containerEl)
  }

  private save = () => this.plugin.saveSettings()

  private general(el: HTMLElement) {
    const settings = this.plugin.settings
    new Setting(el).setName("Sync on startup").addToggle((t) =>
      t.setValue(settings.syncOnStartup).onChange(async (v) => {
        settings.syncOnStartup = v
        await this.save()
      }),
    )
    new Setting(el)
      .setName("Task details in frontmatter")
      .setDesc("Keep task-state, task-assignee, task-due, task-url and task-done up to date in each note's properties, for Dataview or Bases.")
      .addToggle((t) =>
        t.setValue(settings.frontmatter).onChange(async (v) => {
          settings.frontmatter = v
          await this.save()
        }),
      )
    new Setting(el)
      .setName("Overview note")
      .setDesc("Path of a note listing the open tasks of every source, e.g. Tasks/Overview.md. Empty for none.")
      .addText((t) =>
        t
          .setPlaceholder("Tasks/Overview.md")
          .setValue(settings.overviewNote)
          .onChange(async (v) => {
            settings.overviewNote = v.trim()
            await this.save()
          }),
      )
    new Setting(el)
      .setName("Sync interval")
      .setDesc("Minutes between automatic syncs of every source. 0 syncs only on demand. A source can override it.")
      .addText((t) =>
        t
          .setPlaceholder("0")
          .setValue(String(settings.intervalMinutes))
          .onChange(async (v) => {
            settings.intervalMinutes = Math.max(0, Number.parseInt(v, 10) || 0)
            await this.save()
          }),
      )
    new Setting(el)
      .setName("Note name")
      .setDesc("File name of each new task note, e.g. {{TASK_TYPE}} - {{TASK_ID}} or {{TASK_ID}} {{TASK_NAME}}.")
      .addText((t) =>
        t.setValue(settings.noteName).onChange(async (v) => {
          settings.noteName = v
          await this.save()
        }),
      )
    new Setting(el)
      .setName("Note template")
      .setDesc(`Initial content of each new task note. ${VARIABLES_HELP}`)
      .addTextArea((t) => {
        t.setValue(settings.noteTemplate).onChange(async (v) => {
          settings.noteTemplate = v
          await this.save()
        })
        t.inputEl.rows = 10
        t.inputEl.addClass("sync-tasks-wide")
      })
  }

  private sources(el: HTMLElement) {
    new Setting(el).setName("Sources").setHeading()
    new Setting(el)
      .setName("Add a source")
      .setDesc("Each source syncs into its own folder; add as many as you need, of any kind.")
      .addDropdown((d) => {
        for (const provider of PROVIDERS) d.addOption(provider.id, provider.name)
        d.setValue(this.newProvider).onChange((v) => (this.newProvider = v))
      })
      .addButton((b) =>
        b
          .setButtonText("Add")
          .setCta()
          .onClick(async () => {
            const provider = providerMap.get(this.newProvider)
            if (!provider) return
            const count = this.plugin.settings.sources.filter((s) => s.provider === provider.id).length
            const name = count ? `${provider.name} ${count + 1}` : provider.name
            const source = newSource(newId(), provider.id, name, provider.defaults)
            this.plugin.settings.sources.push(source)
            this.open.add(source.id)
            await this.save()
            this.display()
          }),
      )

    new Setting(el)
      .setName("Import from Agile Task Notes")
      .setDesc("Add sources from that plugin's settings. Its tokens move into Obsidian's keychain, and its notes are picked up by name.")
      .addButton((b) => b.setButtonText("Import").onClick(() => void this.importLegacy()))

    for (const source of this.plugin.settings.sources) this.source(el, source)
  }

  private async importLegacy() {
    const path = normalizePath(`${this.app.vault.configDir}/${LEGACY_DATA}`)
    if (!(await this.app.vault.adapter.exists(path))) {
      new Notice("Sync Tasks: no Agile Task Notes settings found in this vault.")
      return
    }
    let imported
    try {
      imported = fromAgileTaskNotes(JSON.parse(await this.app.vault.adapter.read(path)), newId)
    } catch (e) {
      new Notice(`Sync Tasks: could not read Agile Task Notes settings: ${e instanceof Error ? e.message : e}`)
      return
    }
    for (const { name, value } of imported.secrets) this.app.secretStorage.setSecret(name, value)
    for (const source of imported.sources) {
      this.plugin.settings.sources.push(source)
      this.open.add(source.id)
    }
    await this.save()
    this.display()
    new Notice(
      `Sync Tasks: imported ${imported.sources.length} source(s).` +
        (imported.secrets.length ? " Their tokens are in Obsidian's keychain now; the old plugin's data.json still holds them in plain text." : ""),
      10000,
    )
  }

  private source(el: HTMLElement, source: SourceConfig) {
    const provider = providerMap.get(source.provider)
    const details = el.createEl("details", { cls: "sync-tasks-source" })
    details.open = this.open.has(source.id)
    details.addEventListener("toggle", () => (details.open ? this.open.add(source.id) : this.open.delete(source.id)))
    const summary = details.createEl("summary")
    const title = summary.createSpan({ cls: "sync-tasks-source-name" })
    const label = () => title.setText(`${source.name || "Untitled"} · ${provider?.name ?? source.provider}`)
    label()
    summary.toggleClass("is-disabled", !source.enabled)
    const body = details.createDiv()

    new Setting(body)
      .setName("Enabled")
      .addToggle((t) =>
        t.setValue(source.enabled).onChange(async (v) => {
          source.enabled = v
          summary.toggleClass("is-disabled", !v)
          await this.save()
        }),
      )
      .addExtraButton((b) =>
        b
          .setIcon("refresh-cw")
          .setTooltip("Sync this source now")
          .onClick(() => void this.plugin.sync([source])),
      )
      .addExtraButton((b) =>
        b
          .setIcon("trash")
          .setTooltip("Remove this source (its notes stay)")
          .onClick(async () => {
            if (!confirm(`Remove the source "${source.name}"? Its notes stay in the vault.`)) return
            this.plugin.settings.sources.remove(source)
            await this.save()
            this.display()
          }),
      )
    new Setting(body).setName("Name").addText((t) =>
      t.setValue(source.name).onChange(async (v) => {
        source.name = v
        label()
        await this.save()
      }),
    )
    new Setting(body)
      .setName("Folder")
      .setDesc("Vault folder for this source's notes and boards.")
      .addText((t) =>
        t.setValue(source.folder).onChange(async (v) => {
          source.folder = v
          await this.save()
        }),
      )
    new Setting(body)
      .setName("Team mode")
      .setDesc("Pull the tasks of the whole team instead of the listed assignees, and show assignees on the board.")
      .addToggle((t) =>
        t.setValue(source.teamMode).onChange(async (v) => {
          source.teamMode = v
          await this.save()
        }),
      )
    new Setting(body)
      .setName("Kanban board")
      .setDesc("Generate a board for the Kanban community plugin. It is rewritten on each sync.")
      .addToggle((t) =>
        t.setValue(source.createBoard).onChange(async (v) => {
          source.createBoard = v
          await this.save()
        }),
      )
    new Setting(body)
      .setName("Sync interval")
      .setDesc("Minutes between automatic syncs of this source. Empty follows the global interval, 0 never.")
      .addText((t) =>
        t
          .setPlaceholder(String(this.plugin.settings.intervalMinutes))
          .setValue(source.intervalMinutes === null ? "" : String(source.intervalMinutes))
          .onChange(async (v) => {
            const minutes = Number.parseInt(v, 10)
            source.intervalMinutes = v.trim() === "" || Number.isNaN(minutes) ? null : Math.max(0, minutes)
            await this.save()
          }),
      )

    if (!provider) {
      body.createEl("p", { text: `Unknown provider "${source.provider}".`, cls: "mod-warning" })
      return
    }
    new Setting(body).setName(`${provider.name} connection`).setHeading()
    for (const field of provider.fields) {
      if (field.when && !field.when(source.options)) continue
      this.field(body, field, source.options)
    }

    new Setting(body).setName("Templates").setHeading()
    new Setting(body)
      .setName("Note name")
      .setDesc("Empty uses the global note name.")
      .addText((t) =>
        t
          .setPlaceholder(this.plugin.settings.noteName)
          .setValue(source.noteName)
          .onChange(async (v) => {
            source.noteName = v
            await this.save()
          }),
      )
    new Setting(body)
      .setName("Note template")
      .setDesc("Empty uses the global note template.")
      .addTextArea((t) => {
        t.setValue(source.noteTemplate).onChange(async (v) => {
          source.noteTemplate = v
          await this.save()
        })
        t.inputEl.rows = 6
        t.inputEl.addClass("sync-tasks-wide")
      })
  }

  private field(el: HTMLElement, field: Field, options: Options) {
    const setting = new Setting(el).setName(field.name)
    if (field.desc) setting.setDesc(field.desc)
    const value = options[field.key]
    // Toggles and dropdowns redraw the tab, since other fields may show or hide with them.
    const set = async (v: string | boolean, redraw = false) => {
      options[field.key] = v
      await this.save()
      if (redraw) this.display()
    }

    switch (field.type) {
      case "toggle":
        setting.addToggle((t) => t.setValue(value === true).onChange((v) => set(v, true)))
        break
      case "dropdown":
        setting.addDropdown((d) => {
          for (const [key, label] of Object.entries(field.choices ?? {})) d.addOption(key, label)
          d.setValue(typeof value === "string" ? value : "").onChange((v) => set(v, true))
        })
        break
      case "secret":
        setting.addComponent((c) =>
          new SecretComponent(this.app, c).setValue(typeof value === "string" ? value : "").onChange((v) => set(v ?? "")),
        )
        break
      case "textarea":
        setting.addTextArea((t) => {
          t.setPlaceholder(field.placeholder ?? "")
            .setValue(typeof value === "string" ? value : "")
            .onChange((v) => set(v))
          t.inputEl.rows = 4
          t.inputEl.addClass("sync-tasks-wide")
        })
        break
      default:
        setting.addText((t) =>
          t
            .setPlaceholder(field.placeholder ?? "")
            .setValue(typeof value === "string" ? value : "")
            .onChange((v) => set(v)),
        )
    }
  }
}
