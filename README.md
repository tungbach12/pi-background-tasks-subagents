# pi-background-tasks-subagents

> **Zero-Bloat Background Tasks & Autonomous Subagents for [Pi](https://github.com/earendil-works/pi)**  
> *Sleek OpenCode-style TUI dock · 100% in-memory child sessions · Zero disk clutter · Ultra lightweight (~20 KB)*

[![npm version](https://img.shields.io/npm/v/pi-background-tasks-subagents.svg)](https://www.npmjs.com/package/pi-background-tasks-subagents)
[![license](https://img.shields.io/npm/l/pi-background-tasks-subagents.svg)](https://github.com/tungbach12/pi-background-tasks-subagents/blob/main/LICENSE)
[![package size](https://img.shields.io/badge/size-~20KB-success.svg)](https://www.npmjs.com/package/pi-background-tasks-subagents)

---

## ⚡ The Anti-Bloat Manifesto: Why This Package?

Many modern AI agent harnesses (such as OMP / `oh-my-opencode`) have become massive bloatware:
- ❌ **50,000+ token preambles** and 1,400+ lines of system prompt per request.
- ❌ **"Council of 7 divine agents"** debating each other and burning through your API limits just to fix a single line of code.
- ❌ **Dozens of intrusive hooks** modifying your turns, causing latency and unpredictable behavior.
- ❌ **Hundreds of megabytes of `.jsonl` session clutter** polluting your disk.

**`pi-background-tasks-subagents` is built with a strictly opposite philosophy:**

| Feature | Bloated Harnesses (OMP / Heavy Plugins) | `pi-background-tasks-subagents` |
|---|---|---|
| **Package Size** | Heavy multi-megabyte dependencies (1,000+ files) | **~20 KB** (clean TypeScript, boots in <5ms) |
| **System Prompt** | 1,400+ lines injected into every turn | **Zero prompt bloat** on the main session |
| **Disk Footprint** | Heavy persistent `.jsonl` sessions for every run | **Zero disk footprint**: 100% in-memory via `SessionManager.inMemory()` |
| **Token Consumption** | 30k – 50k tokens burned before inspecting code | **Minimal tokens**: Strictly bounded 4-layer context envelope |
| **Agent Paradigm** | Forces multi-agent debate on every trivial task | **Fast native Bash** by default; subagents called *only when needed* |
| **Context Protection** | Massive outputs blow up your context window | **12k runway truncation** + full output retained in TUI dock |
| **Loop Runaway Guard** | Agents can wander infinitely | **Auto-steers to synthesis** after 8 exploration tool calls |

---

## ✨ Features

- **Sleek OpenCode TUI Dock**: Solid opaque dark slate background (`#141416`) hiding chat history behind it, peach cursor (`#feb478`), and tabs (`Subagents` / `Shell`).
- **Fullscreen Transcript View**: Press `Enter` on any subagent or process to inspect its prompt (with purple bar `│`), reasoning thought time (`+ Thought · 270ms`), categorized summary (`→ Explored: X reads, Y searches`), tool call history, and findings.
- **Zero Disk Footprint**: In-memory execution leaves 0 orphan session files or cache junk on disk. When a subagent finishes, its memory is freed immediately.
- **Conflict-Free Shortcut**: Press `Shift+Down` (`Shift+↓`) anywhere in the terminal to toggle the dock without interfering with prompt cursor movement, chat history, or slash (`/`) autocomplete menus.
- **Asynchronous & Synchronous Execution**:
  - `background: false` (default): Blocks synchronously, returning the distilled answer directly into the active turn.
  - `background: true`: Launches asynchronously, returns immediately, and automatically wakes the parent turn via synthetic inbox notification when finished.

---

## 🎮 Navigation & Controls

### Opening the Dock
- Press **`Shift+Down`** (`Shift+↓`) anywhere in the terminal.
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
- **`c`**: Copies task result or log file path.
- **`ctrl+d`**: Interrupts running subagent or process.
- **`Esc` / `←`**: Returns to the dock list view.

---

## 🛠️ Tools Exposed

| Tool | Parameters | Description |
|---|---|---|
| `subagent` | `description`, `prompt`, `background?`, `role?`, `model?`, `context?` | Autonomous subagent delegation with isolated context and loop runaway cap. |
| `bg_run` | `command`, `name?`, `timeoutSeconds?` | Runs shell command in the background with auto turn wake-up upon completion. |
| `bg_status` | `taskId?` | Point-in-time status of all tasks and subagents. |
| `bg_logs` | `taskId`, `maxBytes?`, `tail?` | Reads bounded log output from disk or subagent history. |
| `bg_kill` | `taskId` | Stops or terminates a task or subagent. |

---

## 📦 Installation

### Via NPM (Recommended)
```bash
pi install npm:pi-background-tasks-subagents
```

### Via Git
```bash
pi install git:github.com/tungbach12/pi-background-tasks-subagents
```

### Local Development
Link or specify in your `~/.pi/agent/settings.json`:
```json
{
  "packages": [
    "../packages/pi-background-tasks-subagents"
  ]
}
```

---

## 📄 License

MIT © [tungbach12](https://github.com/tungbach12)
