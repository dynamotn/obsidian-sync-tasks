import { describe, expect, test } from "bun:test"
import { boardMarkdown } from "../src/kanban"
import { task } from "./helpers"

describe("boardMarkdown", () => {
  const cards = [
    { task: task({ id: "A-1", title: "One", state: "To Do" }), link: "Bug - A-1" },
    { task: task({ id: "A-2", title: "Two", state: "Doing", column: "In Progress" }), link: "Bug - A-2" },
    { task: task({ id: "A-3", title: "Three", state: "Done", done: true }), link: "Bug - A-3" },
  ]

  test("places cards under their column, done ones checked", () => {
    const md = boardMarkdown(["To Do", "In Progress", "Done"], cards, false)
    expect(md.startsWith("---\n\nkanban-plugin: board\n\n---\n")).toBe(true)
    expect(md).toContain("## To Do\n\n- [ ] [[Bug - A-1]] \n One\n")
    expect(md).toContain("## In Progress\n\n- [ ] [[Bug - A-2]] \n Two\n")
    expect(md).toContain("## Done\n\n- [x] [[Bug - A-3]] \n Three\n")
    expect(md.trimEnd().endsWith("%%")).toBe(true)
  })

  test("shows the assignee in team mode", () => {
    expect(boardMarkdown(["To Do"], cards.slice(0, 1), true)).toContain("- [ ] [[Bug - A-1]] \n Ann \n One")
  })

  test("adds columns for states that are not configured", () => {
    const md = boardMarkdown(["To Do"], cards, false)
    expect(md.indexOf("## To Do")).toBeLessThan(md.indexOf("## In Progress"))
    expect(md).toContain("## Done")
  })
})
