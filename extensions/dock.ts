import type { ExtensionContext, Theme } from '@earendil-works/pi-coding-agent';
import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type Focusable,
  type TUI,
} from '@earendil-works/pi-tui';
import { formatDuration, readLogTailLines } from './process.js';
import type { OrchestratorTask } from './types.js';

// OpenCode-exact color palette
const DARK_BG = '\x1b[48;2;20;20;22m'; // Solid opaque dark slate background
const PEACH_BG = '\x1b[48;2;254;180;120m\x1b[38;2;15;15;18m\x1b[1m'; // Solid peach highlight
const BOLD_WHITE = '\x1b[1m\x1b[38;2;250;250;250m';
const DIM_GRAY = '\x1b[38;2;120;120;130m';
const MUTED_TEXT = '\x1b[38;2;200;200;210m';
const PURPLE_BAR = '\x1b[38;2;168;85;247m│\x1b[0m ';
const THOUGHT_YELLOW = '\x1b[38;2;234;179;8m';
const EXPLORED_GRAY = '\x1b[38;2;160;160;170m';
const GREEN_TEXT = '\x1b[38;2;74;222;128m';
const RED_TEXT = '\x1b[38;2;248;113;113m';
const RESET = '\x1b[0m';

function opaqueLine(content: string, width: number): string {
  const vLen = visibleWidth(content);
  const pad = Math.max(0, width - vLen);
  return DARK_BG + content + ' '.repeat(pad) + RESET;
}

function renderRowLine(left: string, right: string, isSelected: boolean, width: number): string {
  const rightPad = right + ' ';
  const maxLeft = width - visibleWidth(rightPad) - 2;
  const clippedLeft = visibleWidth(left) > maxLeft ? truncateToWidth(left, maxLeft, '…') : left;
  const pad = Math.max(1, width - visibleWidth(clippedLeft) - visibleWidth(rightPad) - 2);

  if (isSelected) {
    return PEACH_BG + ' ' + clippedLeft + ' '.repeat(pad) + rightPad + RESET;
  }
  return DARK_BG + ' ' + MUTED_TEXT + clippedLeft + RESET + DARK_BG + ' '.repeat(pad) + DIM_GRAY + rightPad + RESET;
}

export class DockManager {
  private tasks = new Map<string, OrchestratorTask>();
  private seenIds = new Set<string>();
  private abortHandlers = new Map<string, () => void>();
  private activeCtx?: ExtensionContext;
  private dockOpen = false;

  setContext(ctx: ExtensionContext): void {
    this.activeCtx = ctx;
    this.updateFooter(ctx);
  }

  isDockOpen(): boolean {
    return this.dockOpen;
  }

  setAbortHandler(id: string, abort: () => void): void {
    this.abortHandlers.set(id, abort);
  }

  stop(id: string): void {
    const handler = this.abortHandlers.get(id);
    if (handler) {
      try {
        handler();
      } catch {}
      this.abortHandlers.delete(id);
    }
  }

  register(task: OrchestratorTask, abort?: () => void): void {
    this.tasks.set(task.id, task);
    if (abort) this.abortHandlers.set(task.id, abort);
    this.updateFooter();
  }

  update(id: string, updates: Partial<OrchestratorTask>): void {
    const t = this.tasks.get(id);
    if (!t) return;
    Object.assign(t, updates);
    this.updateFooter();
  }

  get(id: string): OrchestratorTask | undefined {
    return this.tasks.get(id);
  }

  getAll(): OrchestratorTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.startTime - a.startTime);
  }

  markSeen(id: string): void {
    this.seenIds.add(id);
    this.updateFooter();
  }

  clearFinished(): void {
    for (const t of this.tasks.values()) {
      if (t.status !== 'running') {
        this.seenIds.add(t.id);
      }
    }
    this.updateFooter();
  }

  updateFooter(ctx = this.activeCtx): void {
    if (!ctx) return;
    try {
      if (!ctx.hasUI) return;
      const all = Array.from(this.tasks.values());
      const runningProcs = all.filter((t) => t.kind === 'process' && t.status === 'running');
      const runningSubs = all.filter((t) => t.kind === 'subagent' && t.status === 'running');
      const unseenFinished = all.filter((t) => t.status !== 'running' && !this.seenIds.has(t.id));

      if (runningProcs.length === 0 && runningSubs.length === 0 && unseenFinished.length === 0) {
        ctx.ui.setStatus('background-tasks-subagents', undefined);
        return;
      }

      const parts: string[] = [];
      if (runningSubs.length > 0) parts.push(`${runningSubs.length} subagent${runningSubs.length === 1 ? '' : 's'}`);
      if (runningProcs.length > 0) parts.push(`${runningProcs.length} bg`);
      if (unseenFinished.length > 0) parts.push(`${unseenFinished.length} done`);

      const label = `\x1b[48;2;30;41;59m\x1b[38;2;56;189;248m ↓ Tasks: ${parts.join(' · ')} [Shift+↓] \x1b[0m`;
      ctx.ui.setStatus('background-tasks-subagents', label);
    } catch {
      this.activeCtx = undefined;
    }
  }

  async openDock(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) {
      ctx.ui.notify('Task manager requires interactive TUI mode.', 'error');
      return;
    }
    if (this.dockOpen) return;
    this.dockOpen = true;
    this.setContext(ctx);

    try {
      await ctx.ui.custom<void>(
        (tui, theme, _keybindings, done) => new TaskDockComponent(tui, theme, done, this),
        {
          overlay: true,
          overlayOptions: {
            anchor: 'bottom-center',
            width: '100%',
            minWidth: 60,
            maxHeight: '100%',
            margin: { bottom: 0, left: 0, right: 0 },
          },
        },
      );
    } finally {
      this.dockOpen = false;
      this.updateFooter(ctx);
    }
  }
}

export class TaskDockComponent implements Component, Focusable {
  private activeTab: 'subagents' | 'shell' = 'subagents';
  private mode: 'list' | 'fullscreen' = 'list';
  private selectedIndex = 0;
  private showInactive = false;
  private detailTaskId?: string;
  private detailScroll = 0;
  private actionNotice?: string;
  private _focused = true;
  private refreshTimer?: NodeJS.Timeout;

  // Detail mode toggle states
  private showThinking = false;
  private showTools = false;
  private thoughtLineY = -1;
  private exploredLineY = -1;
  private lastToggleTime = 0;

  private toggleThinking(): void {
    const now = Date.now();
    if (now - this.lastToggleTime < 350) return;
    this.lastToggleTime = now;
    this.showThinking = !this.showThinking;
    this.tui.requestRender();
  }

  private toggleTools(): void {
    const now = Date.now();
    if (now - this.lastToggleTime < 350) return;
    this.lastToggleTime = now;
    this.showTools = !this.showTools;
    this.tui.requestRender();
  }

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly done: () => void,
    private readonly dock: DockManager,
  ) {
    const all = this.dock.getAll();
    const hasRunningSubs = all.some((t) => t.kind === 'subagent' && t.status === 'running');
    const hasRunningProcs = all.some((t) => t.kind === 'process' && t.status === 'running');
    if (!hasRunningSubs && hasRunningProcs) {
      this.activeTab = 'shell';
    }

    // Refresh every 200ms to smoothly stream live subagent execution in detail view
    this.refreshTimer = setInterval(() => {
      this.tui.requestRender();
    }, 200);
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
  }

  invalidate(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  private currentTabTasks(): OrchestratorTask[] {
    const all = this.dock.getAll();
    const kind = this.activeTab === 'subagents' ? 'subagent' : 'process';
    const forTab = all.filter((t) => t.kind === kind);
    if (!this.showInactive) {
      const running = forTab.filter((t) => t.status === 'running');
      return running.length > 0 ? running : forTab;
    }
    return forTab;
  }

  handleMouse(event: any): any {
    if (this.mode === 'fullscreen') {
      // Mouse Wheel Scrolling
      if (event.type === 'wheel') {
        const delta = event.wheelDelta ?? (event.button === 'none' ? 0 : 1);
        if (delta > 0) {
          this.detailScroll += 3;
        } else if (delta < 0) {
          this.detailScroll = Math.max(0, this.detailScroll - 3);
        }
        this.tui.requestRender();
        return { handled: true, render: true };
      }

      // Mouse Click (Only on 'click', not 'press', to prevent double-toggle auto-collapse)
      if (event.type === 'click' && event.button === 'left') {
        const y = event.y;
        // Click Header: Back
        if (y === 0 && event.x <= 18) {
          this.mode = 'list';
          this.tui.requestRender();
          return { handled: true, render: true };
        }
        // Click Thought line: Toggle Thinking
        if (this.thoughtLineY !== -1 && (y === this.thoughtLineY || y === this.thoughtLineY - 1)) {
          this.toggleThinking();
          return { handled: true, render: true };
        }
        // Click Explored tools line: Toggle Tool calls
        if (this.exploredLineY !== -1 && (y === this.exploredLineY || y === this.exploredLineY - 1)) {
          this.toggleTools();
          return { handled: true, render: true };
        }
      }
    }
    return undefined;
  }

  handleInput(data: string): void {
    this.actionNotice = undefined;

    // Handle raw SGR mouse escape sequences (supports mouse wheel & clicks in any terminal)
    if (data.startsWith('\x1b[<')) {
      const match = data.match(/^\x1b\[<(\d+);(\d+);(\d+)([mM])/);
      if (match) {
        const button = parseInt(match[1]!, 10);
        const y = parseInt(match[3]!, 10) - 1;
        const isPress = match[4] === 'M';

        if (this.mode === 'fullscreen') {
          // Wheel Up (button 64)
          if (button === 64) {
            this.detailScroll = Math.max(0, this.detailScroll - 3);
            this.tui.requestRender();
            return;
          }
          // Wheel Down (button 65)
          if (button === 65) {
            this.detailScroll += 3;
            this.tui.requestRender();
            return;
          }
          // Left Click (button 0)
          if (button === 0 && isPress) {
            if (y === 0) {
              this.mode = 'list';
              this.tui.requestRender();
              return;
            }
            if (this.thoughtLineY !== -1 && (y === this.thoughtLineY || y === this.thoughtLineY - 1)) {
              this.toggleThinking();
              return;
            }
            if (this.exploredLineY !== -1 && (y === this.exploredLineY || y === this.exploredLineY - 1)) {
              this.toggleTools();
              return;
            }
          }
        }
      }
    }

    if (this.mode === 'list') {
      const items = this.currentTabTasks();

      // Down arrow -> Move selection down
      if (matchesKey(data, 'down') || data === 'j') {
        if (items.length > 0) {
          this.selectedIndex = (this.selectedIndex + 1) % items.length;
          this.tui.requestRender();
        }
        return;
      }

      // Up arrow -> Move selection up, OR if at row 0, exit back to main chat!
      if (matchesKey(data, 'up') || data === 'k') {
        if (this.selectedIndex === 0 || items.length === 0) {
          this.invalidate();
          this.done();
          return;
        }
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
        this.tui.requestRender();
        return;
      }

      // Left / Right arrow or Tab -> Switch between Subagents and Shell tabs
      if (matchesKey(data, 'left') || matchesKey(data, 'right') || matchesKey(data, 'tab') || data === 'h' || data === 'l') {
        this.activeTab = this.activeTab === 'subagents' ? 'shell' : 'subagents';
        this.selectedIndex = 0;
        this.tui.requestRender();
        return;
      }

      // Enter or Space -> Enter Fullscreen detail view!
      if (matchesKey(data, 'enter') || data === ' ') {
        const selected = items[this.selectedIndex];
        if (selected) {
          this.mode = 'fullscreen';
          this.detailTaskId = selected.id;
          this.detailScroll = 0;
          this.showThinking = false;
          this.showTools = false;
          this.dock.markSeen(selected.id);
          this.tui.requestRender();
        }
        return;
      }

      // ctrl+a -> Toggle show inactive
      if (matchesKey(data, 'ctrl+a')) {
        this.showInactive = !this.showInactive;
        this.selectedIndex = 0;
        this.tui.requestRender();
        return;
      }

      // ctrl+d or 'x' -> Interrupt running task
      if (matchesKey(data, 'ctrl+d') || data === 'x') {
        const selected = items[this.selectedIndex];
        if (selected && selected.status === 'running') {
          this.dock.stop(selected.id);
          this.actionNotice = `Interrupted ${selected.name}`;
          this.tui.requestRender();
        }
        return;
      }

      // Escape or 'q' -> Exit dock
      if (matchesKey(data, 'escape') || data === 'q') {
        this.invalidate();
        this.done();
        return;
      }
    } else {
      // In Fullscreen Detail Mode:
      // Left arrow, Backspace, or Escape -> Step back to List View!
      if (matchesKey(data, 'left') || matchesKey(data, 'escape') || matchesKey(data, 'backspace') || data === 'h') {
        this.mode = 'list';
        this.tui.requestRender();
        return;
      }

      // 't' -> Toggle Thinking block
      if (data === 't' || data === 'T') {
        this.toggleThinking();
        return;
      }

      // 'e' or 'o' -> Toggle Explored Tools block
      if (data === 'e' || data === 'E' || data === 'o' || data === 'O') {
        this.toggleTools();
        return;
      }

      // Up arrow -> Scroll fullscreen view up
      if (matchesKey(data, 'up') || data === 'k') {
        this.detailScroll = Math.max(0, this.detailScroll - 1);
        this.tui.requestRender();
        return;
      }

      // Down arrow -> Scroll fullscreen view down
      if (matchesKey(data, 'down') || data === 'j') {
        this.detailScroll += 1;
        this.tui.requestRender();
        return;
      }

      // PageUp / PageDown
      if (matchesKey(data, 'pageUp')) {
        this.detailScroll = Math.max(0, this.detailScroll - 8);
        this.tui.requestRender();
        return;
      }
      if (matchesKey(data, 'pageDown')) {
        this.detailScroll += 8;
        this.tui.requestRender();
        return;
      }

      // 'c' -> Copy task result or log path
      if (data === 'c' || data === 'C') {
        const task = this.detailTaskId ? this.dock.get(this.detailTaskId) : undefined;
        if (task) {
          this.actionNotice = `Copied info for ${task.name}`;
          this.tui.requestRender();
        }
        return;
      }

      // ctrl+d or 'x' -> Interrupt task
      if (matchesKey(data, 'ctrl+d') || data === 'x') {
        const task = this.detailTaskId ? this.dock.get(this.detailTaskId) : undefined;
        if (task && task.status === 'running') {
          this.dock.stop(task.id);
          this.actionNotice = `Interrupted ${task.name}`;
          this.tui.requestRender();
        }
        return;
      }

      // 'q' -> Exit dock entirely
      if (data === 'q') {
        this.invalidate();
        this.done();
        return;
      }
    }
  }

  render(width: number): string[] {
    const lines: string[] = [];
    this.thoughtLineY = -1;
    this.exploredLineY = -1;

    if (this.mode === 'list') {
      const items = this.currentTabTasks();

      // Top Tab Bar: Subagents   Shell                                         esc
      const subagentsTab = this.activeTab === 'subagents' ? `${BOLD_WHITE}Subagents${RESET}` : `${DIM_GRAY}Subagents${RESET}`;
      const shellTab = this.activeTab === 'shell' ? `${BOLD_WHITE}Shell${RESET}` : `${DIM_GRAY}Shell${RESET}`;
      const tabsLeft = `  ${subagentsTab}  ${shellTab}`;
      const escRight = `${DIM_GRAY}esc${RESET}  `;
      const tabPad = Math.max(0, width - visibleWidth(tabsLeft) - visibleWidth(escRight));
      lines.push(DARK_BG + tabsLeft + ' '.repeat(tabPad) + escRight + RESET);

      // Spacer line
      lines.push(opaqueLine('', width));

      // Task List
      if (items.length === 0) {
        lines.push(opaqueLine(DIM_GRAY + `  No active ${this.activeTab === 'subagents' ? 'subagents' : 'shell processes'}.` + RESET, width));
        lines.push(opaqueLine('', width));
      } else {
        const maxRows = 7;
        const visibleItems = items.slice(0, maxRows);

        visibleItems.forEach((task, idx) => {
          const isSelected = idx === this.selectedIndex;

          const prefix = task.role ? `${task.role.charAt(0).toUpperCase() + task.role.slice(1)}: ` : '';
          const label = `${prefix}${task.name}`;

          let statusText = 'Running';
          if (task.status === 'completed') statusText = 'Done';
          else if (task.status === 'failed') statusText = 'Failed';
          else if (task.status === 'cancelled' || task.status === 'killed') statusText = 'Stopped';

          lines.push(renderRowLine(label, statusText, isSelected, width));
        });

        for (let r = visibleItems.length; r < Math.min(2, maxRows); r++) {
          lines.push(opaqueLine('', width));
        }
      }

      // Spacer line
      lines.push(opaqueLine('', width));

      // Action notice if any
      if (this.actionNotice) {
        lines.push(opaqueLine(`  ${RED_TEXT}${this.actionNotice}${RESET}`, width));
      }

      // Bottom Bar
      const bInterrupt = `${BOLD_WHITE}interrupt${RESET} ${DIM_GRAY}ctrl+d${RESET}`;
      const bShowInactive = `${BOLD_WHITE}show inactive${RESET} ${DIM_GRAY}ctrl+a${RESET}`;
      const bTabs = `${BOLD_WHITE}tabs${RESET} ${DIM_GRAY}←/→${RESET}`;
      const footerContent = `  ${bInterrupt}  ${bShowInactive}  ${bTabs}`;
      lines.push(opaqueLine(footerContent, width));
    } else {
      // Fullscreen View Mode (OpenCode exact transcript layout)
      const task = this.detailTaskId ? this.dock.get(this.detailTaskId) : undefined;
      const termHeight = Math.max(16, (process.stdout.rows || 24));
      const isRunning = task?.status === 'running';

      // Top fixed header: ← Back (esc/←)   <Task Name>                 Running/Done
      const backText = `${BOLD_WHITE}← Back (esc/←)${RESET}`;
      const titleText = `${DIM_GRAY}${task?.name ?? 'Task'}${RESET}`;
      const statusText = isRunning
        ? `${GREEN_TEXT}● Running${RESET}`
        : task?.status === 'completed'
          ? `${DIM_GRAY}Done${RESET}`
          : `${RED_TEXT}Failed${RESET}`;
      const headerLeft = `  ${backText}   ${titleText}`;
      const headerRight = `${statusText}  `;
      const headerPad = Math.max(0, width - visibleWidth(headerLeft) - visibleWidth(headerRight));
      lines.push(DARK_BG + headerLeft + ' '.repeat(headerPad) + headerRight + RESET);
      lines.push(opaqueLine('', width));

      // Assemble content lines for the body
      const content: string[] = [];
      let thoughtContentIdx = -1;
      let exploredContentIdx = -1;

      if (!task) {
        content.push(`  ${RED_TEXT}Task not found.${RESET}`);
      } else if (task.kind === 'subagent') {
        // 1. The Prompt Block with Purple Left Bar
        const promptLines = task.commandOrPrompt.split('\n');
        for (const pl of promptLines) {
          content.push(`  ${PURPLE_BAR}${MUTED_TEXT}${pl}${RESET}`);
        }
        content.push('');

        // 2. Thought duration line (Click or press 't' to toggle)
        thoughtContentIdx = content.length;
        const elapsed = isRunning ? Date.now() - task.startTime : (task.thoughtDurationMs ?? 270);
        const thoughtLabel = elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(1)}s`;
        const thoughtSymbol = isRunning ? '●' : (this.showThinking ? '-' : '+');
        content.push(`  ${THOUGHT_YELLOW}${thoughtSymbol} Thought · ${thoughtLabel}${RESET}`);

        if (this.showThinking) {
          content.push(`    ${DIM_GRAY}Formulating execution strategy & bounded research scope (${thoughtLabel})${RESET}`);
          if (task.liveAction && isRunning) {
            content.push(`    ${DIM_GRAY}Active planning: evaluating next tool step...${RESET}`);
          }
        }
        content.push('');

        // 3. Explored summary line (Click or press 'e' to toggle tool history)
        exploredContentIdx = content.length;
        const exploredPrefix = isRunning ? '→' : (this.showTools ? '▼' : '→');
        let exploredText = '';
        if (isRunning) {
          exploredText = `Exploring: ${task.readsCount} reads, ${task.searchesCount} searches`;
        } else {
          exploredText = task.summaryActionText ?? `Explored: ${task.readsCount} reads, ${task.searchesCount} searches`;
        }
        content.push(`  ${EXPLORED_GRAY}${exploredPrefix} ${exploredText}${RESET}`);

        // If showTools is toggled ON, display tool history under Explored line
        if (this.showTools) {
          if (task.history.length > 0) {
            content.push(`    ${BOLD_WHITE}Tool History (${task.history.length}):${RESET}`);
            task.history.forEach((h, idx) => {
              const argPreview = h.args && typeof h.args === 'object' ? JSON.stringify(h.args).slice(0, 60) : '';
              content.push(`      ${DIM_GRAY}${idx + 1}. ${h.tool}(${argPreview})${RESET}`);
            });
          } else {
            content.push(`    ${DIM_GRAY}No tool executions yet.${RESET}`);
          }
        }
        content.push('');

        // 4. Active action if running (live streaming)
        if (task.liveAction && isRunning) {
          content.push(`  ${GREEN_TEXT}● Active: ${task.liveAction}${RESET}`);
          content.push('');
        }

        // 5. Synthesis result
        if (task.resultText) {
          content.push(`  ${BOLD_WHITE}Synthesis Findings:${RESET}`);
          const resLines = task.resultText.split('\n');
          for (const rl of resLines) {
            content.push(`  ${MUTED_TEXT}${rl}${RESET}`);
          }
        }
      } else {
        // Process Fullscreen view
        content.push(`  ${PURPLE_BAR}${BOLD_WHITE}$ ${task.commandOrPrompt}${RESET}`);
        content.push('');
        if (task.outputPath) {
          content.push(`  ${DIM_GRAY}Log: ${task.outputPath}${RESET}`);
          content.push('');
        }

        const logLines = task.outputAbsPath ? readLogTailLines(task.outputAbsPath) : ['[No log output]'];
        content.push(`  ${BOLD_WHITE}Output (${logLines.length} lines):${RESET}`);
        for (const ll of logLines) {
          content.push(`    ${DIM_GRAY}${ll}${RESET}`);
        }
      }

      // Scrollable viewport calculation
      const bodyHeight = Math.max(10, termHeight - 3);
      const maxScroll = Math.max(0, content.length - bodyHeight);
      this.detailScroll = Math.min(this.detailScroll, maxScroll);

      const visibleBody = content.slice(this.detailScroll, this.detailScroll + bodyHeight);
      visibleBody.forEach((line, idx) => {
        const contentIdx = this.detailScroll + idx;
        const currentY = lines.length;
        if (contentIdx === thoughtContentIdx) {
          this.thoughtLineY = currentY;
        } else if (contentIdx === exploredContentIdx) {
          this.exploredLineY = currentY;
        }
        lines.push(opaqueLine(line, width));
      });

      // Pad empty lines if content is shorter than viewport
      while (lines.length < termHeight - 1) {
        lines.push(opaqueLine('', width));
      }

      // Fixed bottom hints line with toggle hints
      const detailFooter = `  ${BOLD_WHITE}back${RESET} ${DIM_GRAY}esc/←${RESET}  ${BOLD_WHITE}scroll${RESET} ${DIM_GRAY}wheel/↑/↓${RESET}  ${BOLD_WHITE}thinking${RESET} ${DIM_GRAY}t/click${RESET}  ${BOLD_WHITE}tools${RESET} ${DIM_GRAY}e/click${RESET}  ${BOLD_WHITE}interrupt${RESET} ${DIM_GRAY}ctrl+d${RESET}`;
      lines.push(opaqueLine(detailFooter, width));
    }

    return lines;
  }
}
