import { describe, expect, mock, test } from "bun:test"

// Obsidian is not available outside the app; http.ts only needs these exports to load.
mock.module("obsidian", () => ({ htmlToMarkdown: (s: string) => s, requestUrl: async () => ({}) }))
const { errorDetail, redact } = await import("../src/http")

describe("http", () => {
  test("redact drops the query string", () => {
    expect(redact("https://api.trello.com/1/boards/x?key=k&token=t")).toBe("https://api.trello.com/1/boards/x")
  })

  test("errorDetail reads the error shape of each tracker", () => {
    expect(errorDetail({ errorMessages: ["Board does not exist"] })).toBe("Board does not exist")
    expect(errorDetail({ message: "401 Unauthorized" })).toBe("401 Unauthorized")
    expect(errorDetail({ errors: [{ message: "Authentication required" }] })).toBe("Authentication required")
    expect(errorDetail({ errors: { summary: "required" } })).toBe("required")
    expect(errorDetail("nope")).toBe("")
  })
})
