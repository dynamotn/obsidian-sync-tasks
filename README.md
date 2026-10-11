# Sync Tasks for Obsidian

Pull your tasks from several task trackers at once into Obsidian: one note per
task to take notes and keep a todo list in, and a board per sprint for the
[Kanban](https://github.com/mgmeyers/obsidian-kanban) plugin.

A rewrite of [Agile Task Notes](https://github.com/BoxThatBeat/obsidian-agile-task-notes)
2.1.0, which syncs one tracker at a time. Here each tracker connection is a
*source*, and you can add as many as you like, of any kind, each into its own
folder. They all sync together.

| Tracker | What a source pulls |
| --- | --- |
| **Jira** | The active sprint of a board, or the whole Kanban board |
| **Azure DevOps** | The current iteration of a team |
| **GitLab** | The active milestone of a project, every issue of a project, or your issues across every project (in Year/Quarter/Month folders) |
| **GitHub** | Issues and pull requests matching a search, e.g. `is:open assignee:@me` |
| **Linear** | Your issues, or a team's, optionally the active cycle only |
| **Todoist** | The active tasks of a project (a column per section) or of a filter |
| **Trello** | Your cards on a board, or every card |
| **ClickUp** | The tasks of a list (or sprint), or across a workspace |

## Use

- **Sync all sources**: the ribbon button, the command, or a click on the
  status bar, which shows progress (`Tasks: syncing 2/5`) and the last result.
- **Sync one source**: the *Sync &lt;source&gt;* command, or the button next to
  the source in the settings.
- **Automatically**: a global interval, which each source may override or turn
  off, and optionally at startup. Interval changes apply at once.

Each sync creates notes for new tasks, from your template, and leaves existing
notes alone: what you write in them is never overwritten. In modes that split
finished tasks off (Jira Kanban, GitLab Board, GitHub, Linear, Todoist,
ClickUp), notes
move in and out of a `Completed` folder as tasks close and reopen; notes you
filed elsewhere stay where you put them.

Boards are rewritten on each sync, and only when something changed, so an open
board is not reloaded for nothing. Tasks whose state is not a configured column
get a column of their own rather than vanishing from the board.

### Settings

Per source: the tracker connection, a folder, **team mode** (pull the whole
team's tasks and show assignees on the board), the board on or off, a sync
interval, and optionally its own note name and template.

Globally:

- **Note name** and **note template** with these variables: `{{TASK_ID}}`,
  `{{TASK_TITLE}}`, `{{TASK_NAME}}` (the title, safe for a file name),
  `{{TASK_TYPE}}`, `{{TASK_STATE}}`, `{{TASK_ASSIGNEDTO}}`, `{{TASK_LINK}}`,
  `{{TASK_DESCRIPTION}}`, `{{TASK_DUEDATE}}`, `{{TASK_CREATED}}`,
  `{{TASK_TAGS}}`, `{{SOURCE_NAME}}`, `{{SOURCE_TYPE}}`, and per tracker:
  `{{TASK_PRIORITY}}` (Jira, Azure DevOps, Linear, Todoist, ClickUp),
  `{{TASK_CRITERIA}}` and `{{TASK_TESTS}}` (Azure DevOps), `{{TASK_MILESTONE}}`
  (GitLab, GitHub), `{{TASK_REPO}}` (GitHub), `{{TASK_PROJECT}}` (Linear,
  Todoist), `{{TASK_TEAM}}` (Linear), `{{TASK_DEADLINE}}` (Todoist),
  `{{TASK_LIST}}` (ClickUp).
- **Task details in frontmatter**: keeps `task-state`, `task-assignee`,
  `task-due`, `task-url`, `task-title` and `task-done` current in each note's
  properties, for Dataview or Bases.
- **Overview note**: one note listing the open tasks of every source, soonest
  due first.

### Credentials

Tokens are kept in Obsidian's keychain, not in the plugin's `data.json`: a
credential field holds only the name of a secret, which you pick or create
from the field itself. The same secret can serve several sources.

### Coming from Agile Task Notes

*Import from Agile Task Notes* in the settings turns that plugin's
configuration into sources and moves its tokens into the keychain. Existing
task notes are recognised by name and keep their content; from then on each
note carries `task-source` and `task-id` in its frontmatter, so it is found
even after a rename, and `PROJ-1` no longer gets mixed up with `PROJ-12`.

Differences from 2.1.0: dates are ISO (`2026-10-11`), Azure DevOps rich text is
converted to Markdown, and a missing description is left empty instead of
"No description provided".

## Install

With [BRAT](https://github.com/TfTHacker/obsidian42-brat), or by hand: copy
`main.js`, `manifest.json` and `styles.css` of a release to
`<vault>/.obsidian/plugins/sync-tasks/`, then enable *Sync Tasks*. It needs
Obsidian 1.11.4 or later, and runs on mobile too.

## Develop

```sh
bun install
bun test           # unit tests, including each tracker against recorded API shapes
bun run check      # type check
bun run build      # main.js
```

A tracker is a `Provider` (`src/providers/provider.ts`): its settings fields
and a `fetch` that returns tasks grouped by folder and board. The engine
(`src/sync.ts`) does the rest. Add the new provider to `src/providers/index.ts`.

## License

MIT, like Agile Task Notes, from which it started.
