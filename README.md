# pi-background-tasks-subagents

Unified background shell execution (`bg_run`), autonomous in-memory subagents (`subagent`), and an OpenCode-style directional TUI dock for [Pi](https://github.com/earendil-works/pi).

## Features

- **OpenCode TUI Styling**: Solid dark slate background (`#141416`), peach selected bar (`#feb478`), `Subagents` / `Shell` tabs.
- **Fullscreen Transcript View**: Press `Enter` on any subagent or background task to inspect its prompt (with purple bar), thought duration, action summaries (`→ Explored: X reads, Y searches`), tool execution history, and findings.
- **Zero Disk Footprint for Subagents**: Child agent sessions execute 100% in-memory via `SessionManager.inMemory()` — zero `.jsonl` files or cache clutter on disk.
- **Conflict-Free Shortcut**: Press `Shift+Down` (`Shift+↓`) anywhere in the terminal to toggle the dock without interfering with prompt cursor navigation, history, or `/` autocomplete.
- **Strict Anti-Bloat Architecture**: Subagents follow OpenCode's strict parent-delegation system prompt (no pleasantries, line-cited reporting directly to parent).

## Navigation & Controls

### Opening the Dock
- Press **`Shift+Down`** (`Shift+↓`) in the terminal.
- Or type `/tasks`.

### Inside the Dock
- **`↓` / `j`**: Move selection down.
- **`↑` / `k`**: Move selection up.
- **`↑` at row 0 (top of list)**: Exits the dock back to the main chat!
- **`←` / `→` / `Tab`**: Switch tabs (`Subagents` ↔ `Shell`).
- **`Enter` / `Space`**: Opens the Fullscreen detail view.
- **`ctrl+d` / `x`**: Interrupts the selected task or subagent.
- **`ctrl+a`**: Toggles visibility of inactive/completed tasks.
- **`Esc` / `q`**: Closes the dock.

### Inside Fullscreen View
- **`↑` / `↓` / `PageUp` / `PageDown`**: Scrolls transcript or log output.
- **`c`**: Copies task info or log file path.
- **`ctrl+d`**: Interrupts running subagent or process.
- **`Esc` / `←`**: Returns to the dock list view.

## Tools Exposed

| Tool | Parameters | Description |
|---|---|---|
| `subagent` | `description`, `prompt`, `background?`, `role?`, `model?`, `context?` | Autonomous subagent delegation with isolated context. |
| `bg_run` | `command`, `name?`, `timeoutSeconds?` | Runs shell command in the background with auto turn wake-up upon completion. |
| `bg_status` | `taskId?` | Point-in-time status of all tasks and subagents. |
| `bg_logs` | `taskId`, `maxBytes?`, `tail?` | Reads bounded log output from disk or subagent history. |
| `bg_kill` | `taskId` | Stops or terminates a task or subagent. |

## Installation

### Via NPM (Recommended)
```bash
pi install npm:pi-background-tasks-subagents
```

### Via Git
```bash
pi install git:github.com/tungbach12/pi-background-tasks-subagents
```

### Local Development
Clone or link in your `~/.pi/agent/settings.json`:
```json
{
  "packages": [
    "../packages/pi-background-tasks-subagents"
  ]
}
```

## License

MIT
