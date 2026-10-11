import { describe, expect, test } from "bun:test"
import type { FetchContext, Provider } from "../src/providers/provider"
import { DEFAULT_SETTINGS, newSource, normalizeSettings, effectiveInterval, schedule } from "../src/settings"
import { legacyMatch, summary, syncSource, SyncRunner } from "../src/sync"
import type { TaskGroup } from "../src/types"
import { task } from "./helpers"
import { MemoryStore } from "./memory-store"

const ctx: FetchContext = {
  request: async () => ({}) as never,
  secret: () => "",
  htmlToMarkdown: (html) => html,
  teamMode: false,
}

function provider(groups: () => TaskGroup[] | Promise<TaskGroup[]>, id = "fake"): Provider {
  return { id, name: "Fake", defaults: {}, fields: [], fetch: async () => groups() }
}

const settings = { ...DEFAULT_SETTINGS, noteTemplate: "# {{TASK_TITLE}}" }

describe("syncSource", () => {
  test("creates notes and a board in the group folder", async () => {
    const store = new MemoryStore()
    const source = newSource("s1", "fake", "Work", {})
    const groups = [{ folder: "sprint-1", board: { name: "sprint-1", columns: ["To Do"] }, tasks: [task()] }]

    const result = await syncSource(source, provider(() => groups), ctx, store, settings)

    expect(result).toMatchObject({ tasks: 1, created: 1, boards: 1 })
    expect(store.files.get("Work/sprint-1/Bug - PROJ-1.md")).toEqual({
      content: "# Fix the login page",
      source: "s1",
      id: "PROJ-1",
    })
    expect(store.files.get("Work/sprint-1/sprint-1-Board.md")?.content).toContain(
      "[[Work/sprint-1/Bug - PROJ-1|Bug - PROJ-1]]",
    )
  })

  test("never recreates a note, even after it moved to an old sprint folder", async () => {
    const store = new MemoryStore()
    const source = newSource("s1", "fake", "Work", {})
    let folder = "sprint-1"
    const p = provider(() => [{ folder, tasks: [task()] }])

    await syncSource(source, p, ctx, store, settings)
    folder = "sprint-2"
    const again = await syncSource(source, p, ctx, store, settings)

    expect(again.created).toBe(0)
    expect([...store.files.keys()]).toEqual(["Work/sprint-1/Bug - PROJ-1.md"])
  })

  test("keeps two sources with the same task id apart", async () => {
    const store = new MemoryStore()
    const p = provider(() => [{ folder: "", tasks: [task({ id: "12" })] }])
    const a = { ...newSource("a", "fake", "A", {}), folder: "Tasks" }
    const b = { ...newSource("b", "fake", "B", {}), folder: "Tasks" }

    await syncSource(a, p, ctx, store, settings)
    const second = await syncSource(b, p, ctx, store, settings)

    expect(second.created).toBe(1)
    expect([...store.files.keys()].sort()).toEqual(["Tasks/Bug - 12 1.md", "Tasks/Bug - 12.md"])
  })

  test("moves notes in and out of Completed when the group splits them", async () => {
    const store = new MemoryStore()
    const source = newSource("s1", "fake", "Work", {})
    let done = false
    const p = provider(() => [{ folder: "", splitCompleted: true, tasks: [task({ done })] }])

    await syncSource(source, p, ctx, store, settings)
    done = true
    expect((await syncSource(source, p, ctx, store, settings)).moved).toBe(1)
    expect(store.files.has("Work/Completed/Bug - PROJ-1.md")).toBe(true)
    done = false
    await syncSource(source, p, ctx, store, settings)
    expect(store.files.has("Work/Bug - PROJ-1.md")).toBe(true)
  })

  test("leaves notes the user filed elsewhere where they are", async () => {
    const store = new MemoryStore()
    store.files.set("Work/Archive/Bug - PROJ-1.md", { content: "", source: "s1", id: "PROJ-1" })
    const source = newSource("s1", "fake", "Work", {})
    const p = provider(() => [{ folder: "", splitCompleted: true, tasks: [task({ done: true })] }])

    expect((await syncSource(source, p, ctx, store, settings)).moved).toBe(0)
  })

  test("adopts notes from before frontmatter identity by their name", async () => {
    const store = new MemoryStore()
    store.files.set("Work/sprint-1/Bug - PROJ-1.md", { content: "mine" })
    const source = newSource("s1", "fake", "Work", {})
    const p = provider(() => [{ folder: "sprint-2", tasks: [task()] }])

    const result = await syncSource(source, p, ctx, store, settings)

    expect(result.created).toBe(0)
    expect(store.files.get("Work/sprint-1/Bug - PROJ-1.md")).toEqual({ content: "mine", source: "s1", id: "PROJ-1" })
  })

  test("does not rewrite an unchanged board", async () => {
    const store = new MemoryStore()
    const source = newSource("s1", "fake", "Work", {})
    const p = provider(() => [{ folder: "", board: { name: "b", columns: ["To Do"] }, tasks: [task()] }])
    await syncSource(source, p, ctx, store, settings)
    expect((await syncSource(source, p, ctx, store, settings)).boards).toBe(0)
    expect(store.writes).toBe(1)
  })

  test("uses the source's own templates over the global ones", async () => {
    const store = new MemoryStore()
    const source = { ...newSource("s1", "fake", "Work", {}), noteName: "{{TASK_ID}}", noteTemplate: "{{SOURCE_NAME}}" }
    await syncSource(source, provider(() => [{ folder: "", tasks: [task()] }]), ctx, store, settings)
    expect(store.files.get("Work/PROJ-1.md")?.content).toBe("Work")
  })
})

describe("legacyMatch", () => {
  const notes = [
    { path: "a/Bug - PROJ-12.md", basename: "Bug - PROJ-12" },
    { path: "a/Bug - PROJ-1.md", basename: "Bug - PROJ-1" },
  ]

  test("matches the id as a whole word", () => {
    expect(legacyMatch(notes, "PROJ-1")?.basename).toBe("Bug - PROJ-1")
    expect(legacyMatch(notes, "PROJ-12")?.basename).toBe("Bug - PROJ-12")
    expect(legacyMatch(notes, "OJ-1")).toBeUndefined()
  })

  test("ignores notes that already belong to a task", () => {
    expect(legacyMatch([{ ...notes[1]!, id: "X", source: "s" }], "PROJ-1")).toBeUndefined()
  })
})

describe("SyncRunner", () => {
  test("syncs sources in parallel and reports failures per source", async () => {
    const store = new MemoryStore()
    let inFlight = 0
    let peak = 0
    const slow = provider(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return [{ folder: "", tasks: [task()] }]
    }, "slow")
    const broken = provider(() => {
      throw new Error("HTTP 401")
    }, "broken")
    const runner = new SyncRunner({
      providers: new Map([
        ["slow", slow],
        ["broken", broken],
      ]),
      store,
      context: () => ctx,
      settings: () => settings,
    })

    const results = await runner.run([
      newSource("a", "slow", "A", {}),
      newSource("b", "slow", "B", {}),
      newSource("c", "broken", "C", {}),
      newSource("d", "missing", "D", {}),
    ])

    expect(peak).toBe(2)
    expect(results.map((r) => r.error)).toEqual([undefined, undefined, "HTTP 401", 'Unknown provider "missing"'])
    expect(summary(results)).toBe('A: 1 task, 1 new\nB: 1 task, 1 new\nC: failed, HTTP 401\nD: failed, Unknown provider "missing"')
  })

  test("skips a source that is still syncing", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const p = provider(async () => {
      await gate
      return []
    })
    const runner = new SyncRunner({
      providers: new Map([["fake", p]]),
      store: new MemoryStore(),
      context: () => ctx,
      settings: () => settings,
    })
    const source = newSource("a", "fake", "A", {})
    const first = runner.run([source])
    expect(runner.isRunning("a")).toBe(true)
    expect(await runner.run([source])).toEqual([])
    release()
    expect(await first).toHaveLength(1)
  })
})

describe("settings", () => {
  test("normalizeSettings fills defaults and drops broken sources", () => {
    const s = normalizeSettings({ intervalMinutes: 5, sources: [{ id: "a", provider: "jira", name: "J" }, { name: "x" }] })
    expect(s.intervalMinutes).toBe(5)
    expect(s.sources).toHaveLength(1)
    expect(s.sources[0]).toMatchObject({ id: "a", enabled: true, createBoard: true, intervalMinutes: null })
  })

  test("effectiveInterval follows the global one unless overridden", () => {
    const s = { ...DEFAULT_SETTINGS, intervalMinutes: 30 }
    const source = newSource("a", "jira", "J", {})
    expect(effectiveInterval(source, s)).toBe(30)
    expect(effectiveInterval({ ...source, intervalMinutes: 0 }, s)).toBe(0)
    expect(effectiveInterval({ ...source, intervalMinutes: 5 }, s)).toBe(5)
  })
})

describe("schedule", () => {
  test("groups enabled sources by interval", () => {
    const s = {
      ...DEFAULT_SETTINGS,
      intervalMinutes: 30,
      sources: [
        newSource("a", "jira", "A", {}),
        { ...newSource("b", "jira", "B", {}), intervalMinutes: 5 },
        newSource("c", "jira", "C", {}),
        { ...newSource("d", "jira", "D", {}), enabled: false },
        { ...newSource("e", "jira", "E", {}), intervalMinutes: 0 },
      ],
    }
    expect([...schedule(s)]).toEqual([
      [30, ["a", "c"]],
      [5, ["b"]],
    ])
  })
})
