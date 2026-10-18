# pi-background-tasks-subagents

> **Zero-Bloat Background Tasks & Autonomous Subagents for [Pi](https://github.com/earendil-works/pi)**  
> *Sleek OpenCode-style TUI dock · 100% in-memory child sessions · Zero disk clutter · Ultra lightweight (~20 KB)*

[![npm version](https://img.shields.io/npm/v/pi-background-tasks-subagents.svg?color=cb3837)](https://www.npmjs.com/package/pi-background-tasks-subagents)
[![license](https://img.shields.io/npm/l/pi-background-tasks-subagents.svg?color=22c55e)](https://github.com/tungbach12/pi-background-tasks-subagents/blob/main/LICENSE)
[![package size](https://img.shields.io/badge/package%20size-~20KB-blue.svg)](https://www.npmjs.com/package/pi-background-tasks-subagents)
[![pi catalog](https://img.shields.io/badge/pi.dev-catalog%20live-blueviolet.svg)](https://pi.dev/packages/pi-background-tasks-subagents)

---

## 🖥️ OpenCode Fullscreen Transcript View

Press **`Shift+Down`** anywhere to open the Dock, then press **`Enter`** on any task to inspect its full transcript:

```text
  ← Back (esc/←)   Deep multi-repo architecture analysis                     Running

  │ You are a subagent spawned by another session.
  │ Conduct a comprehensive, multi-step investigation of the workspace...
  │ Please perform the following:
  │ 1. Thoroughness level: very thorough.
  │ 2. Read and analyze:
  │    - SmartDroneInspection-docs/project-reference/business-flows.md

  + Thought · 270ms                                         [click or press 't']

  → Explored: 4 reads, 4 searches                           [click or press 'e']

  Synthesis Findings:
    The backend is structured as Spring Modulith with Java 21...

  back esc/←  scroll wheel/↑/↓  thinking t/click  tools e/click  interrupt ctrl+d
```

---

## ⚡ Design Philosophy: Lean, Focused & Zero-Disk

Complex multi-agent frameworks often introduce unnecessary overhead:
- **Excessive prompt preambles** that consume tens of thousands of tokens before your task even begins.
- **Over-engineered agent committees** that debate minor code edits, adding latency and burning rate limits.
- **Persistent disk clutter** storing hundreds of megabytes of temporary `.jsonl` session files across runs.
- **Runaway exploration loops** where subagents wander without bounded stopping criteria.

**`pi-background-tasks-subagents` adheres strictly to Pi's minimalist, high-performance philosophy:**

| Architectural Aspect | Conventional Agent Plugins | `pi-background-tasks-subagents` |
|---|---|---|
| **Package Size** | Heavy multi-megabyte dependencies (1,000+ files) | **~20 KB** (clean TypeScript, boots in <5ms) |
| **System Prompt** | Hundreds of lines injected into every turn | **Zero prompt overhead** on the primary session |
| **Disk Footprint** | Persistent session logs created for every task | **Zero disk footprint**: 100% in-memory via `SessionManager.inMemory()` |
| **Token Consumption** | Thousands of tokens burned on preamble and meta-prompts | **Minimal tokens**: Strictly bounded 4-layer context envelope |
| **Agent Paradigm** | Forces multi-agent delegation on every trivial task | **Fast native Bash** by default; subagents called *only when needed* |
| **Context Protection** | Massive outputs blow up your context window | **12k runway truncation** + full output retained in TUI dock |
| **Loop Runaway Guard** | Agents can wander indefinitely | **OpenCode standard (`Infinity` by default)**: explores autonomously until model chooses to stop |

---

## ✨ Features

- **Sleek OpenCode TUI Dock**: Solid opaque dark slate background (`#141416`) hiding chat history behind it, peach cursor (`#feb478`), and tabs (`Subagents` / `Shell`).
- **Interactive Fullscreen Mode**: 
  - **Live Streaming**: Real-time timer and tool execution counters update smoothly as the subagent runs.
  - **Click-to-Expand Accordions**: Click `+ Thought` (or press **`t`**) and `→ Explored` (or press **`e`**) to toggle thought details and tool history without glitches.
  - **Smooth Mouse Wheel Scrolling**: Scroll the viewport directly with your mouse wheel or keyboard.
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

### Inside the Dock List View
- **`↓` / `j`**: Move selection down.
- **`↑` / `k`**: Move selection up.
- **`↑` at row 0 (top of list)**: Exits the dock back to the main chat!
- **`←` / `→` / `Tab`**: Switch tabs (`Subagents` ↔ `Shell`).
- **`Enter` / `Space`**: Opens the Fullscreen detail view.
- **`ctrl+d` / `x`**: Interrupts the selected task or subagent.
- **`ctrl+a`**: Toggles visibility of inactive/completed tasks.
- **`Esc` / `q`**: Closes the dock.

### Inside Fullscreen Transcript View
- **Mouse Wheel / `↑` / `↓` / `PageUp` / `PageDown`**: Scrolls transcript or log output.
- **Click `+ Thought` / Press `t`**: Expands or collapses reasoning thoughts.
- **Click `→ Explored` / Press `e`**: Expands or collapses tool history.
- **Click `← Back` / Press `Esc` / `←`**: Returns to the dock list view.
- **`c`**: Copies task result or log file path.
- **`ctrl+d`**: Interrupts running subagent or process.
- **`q`**: Exits dock back to main terminal.

---

## 🛠️ Tools Exposed

| Tool | Parameters | Description |
|---|---|---|
| `subagent` | `description`, `prompt`, `background?`, `role?`, `maxSteps?`, `model?`, `context?` | Autonomous subagent delegation (unlimited depth by default, matching OpenCode). |
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
