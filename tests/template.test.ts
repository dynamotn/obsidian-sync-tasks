import { describe, expect, test } from "bun:test"
import { noteContent, noteName, render } from "../src/template"
import { base64, dateFolder, isoDate, joinPath, safeFileName, slug, splitList, uniqueBy } from "../src/util"
import { task } from "./helpers"

const source = { name: "Work", provider: "jira" }

describe("noteName", () => {
  test("uses the default name when the template is empty", () => {
    expect(noteName("", task(), source)).toBe("Bug - PROJ-1")
  })

  test("TASK_NAME is the title made safe for a file name", () => {
    const t = task({ title: 'Crash: "null" in a/b?' })
    expect(noteName("{{TASK_ID}} {{TASK_NAME}}", t, source)).toBe('PROJ-1 Crash- -null- in a-b-')
  })

  test("falls back to the id when the template renders empty", () => {
    expect(noteName("{{TASK_NOPE}}", task(), source)).toBe("PROJ-1")
  })

  test("strips spaces from the type", () => {
    expect(noteName("{{TASK_TYPE}}", task({ type: "User Story" }), source)).toBe("UserStory")
  })
})

describe("noteContent", () => {
  test("fills task, source and extra field variables", () => {
    const t = task({ tags: ["needs review", "ui"], fields: { criteria: "It works" } })
    const out = noteContent("{{TASK_TAGS}}|{{SOURCE_NAME}}|{{SOURCE_TYPE}}|{{TASK_CRITERIA}}", t, source)
    expect(out).toBe("needs-review ui|Work|jira|It works")
  })

  test("unknown and missing variables become empty", () => {
    expect(render("a{{ TASK_DUEDATE }}b{{X}}c", { TASK_DUEDATE: "" })).toBe("abc")
  })
})

describe("util", () => {
  test("joinPath", () => {
    expect(joinPath("", "Tasks/", "/sprint 1", "", "a\\b")).toBe("Tasks/sprint 1/a/b")
  })

  test("safeFileName and slug", () => {
    expect(safeFileName("a#b[c]|d")).toBe("a-b-c--d")
    expect(slug(" Sprint 12 (Q4) ")).toBe("Sprint-12-Q4")
  })

  test("splitList takes commas and newlines", () => {
    expect(splitList("a, b\n\nc,")).toEqual(["a", "b", "c"])
  })

  test("isoDate and dateFolder", () => {
    expect(isoDate("2026-10-11T09:00:00.000Z")).toBe("2026-10-11")
    expect(isoDate("2026-10-11")).toBe("2026-10-11")
    expect(isoDate("nope")).toBe("")
    expect(dateFolder("2026-10-11T09:00:00Z")).toBe("2026/Q4/October")
  })

  test("base64 handles non-ASCII", () => {
    expect(base64("nam@ví.dụ:t")).toBe(Buffer.from("nam@ví.dụ:t").toString("base64"))
  })

  test("uniqueBy keeps the first", () => {
    expect(uniqueBy([{ k: 1 }, { k: 2 }, { k: 1 }], (x) => String(x.k))).toEqual([{ k: 1 }, { k: 2 }])
  })
})
