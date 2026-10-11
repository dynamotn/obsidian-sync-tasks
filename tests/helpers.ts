import type { Task } from "../src/types"

/** A task with every required field filled, overridable per test. */
export function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "PROJ-1",
    title: "Fix the login page",
    state: "To Do",
    type: "Bug",
    assignee: "Ann",
    url: "https://example.com/PROJ-1",
    description: "",
    due: "",
    created: "",
    tags: [],
    done: false,
    ...overrides,
  }
}
