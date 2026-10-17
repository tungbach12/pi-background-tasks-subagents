import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  Theme,
} from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { DockManager } from './dock.js';
import { formatDuration, ProcessRunner, readBoundedLog } from './process.js';
import { SubagentRunner } from './subagent.js';
import {
  BgKillParams,
  BgLogsParams,
  BgRunParams,
  BgStatusParams,
  SubagentParams,
  type BgKillInput,
  type BgLogsInput,
  type BgRunInput,
  type BgStatusInput,
  type OrchestratorTask,
  type SubagentInput,
} from './types.js';

export default function orchestratorExtension(pi: ExtensionAPI): void {
  const dock = new DockManager();
  const processRunner = new ProcessRunner();
  const subagentRunner = new SubagentRunner();

  let currentCtx: ExtensionContext | undefined;

  // Session lifecycle hooks
  pi.on('session_start', async (_event, ctx) => {
    currentCtx = ctx;
    dock.setContext(ctx);

    // Terminal input listener:
    // Mouse click: open dock when clicking on the bottom footer bar area!
    ctx.ui.onTerminalInput((data) => {
      // Mouse click: open dock when clicking the footer status bar
      if (data.startsWith('\x1b[<')) {
        const match = data.match(/^\x1b\[<(\d+);(\d+);(\d+)([mM])/);
        if (match) {
          const button = parseInt(match[1]!, 10);
          const row = parseInt(match[3]!, 10);
          const isPress = match[4] === 'M';
          const termRows = process.stdout.rows || 24;
          if (button === 0 && isPress && row >= termRows - 2) {
            if (!dock.isDockOpen()) {
              void dock.openDock(ctx);
              return { consume: true };
            }
          }
        }
      }
      return undefined;
    });
  });

  pi.on('session_shutdown', async () => {
    processRunner.killAll();
    subagentRunner.abortAll();
  });

  // Transcript notification card renderer
  pi.registerMessageRenderer<OrchestratorTask>(
    'background-task-notification',
    (message, _options, theme: Theme) => {
      const task = message.details;
      const status = task?.status ?? 'completed';
      const color =
        status === 'completed'
          ? theme.fg('success', `[bg ${status}]`)
          : status === 'failed'
            ? theme.fg('error', `[bg ${status}]`)
            : theme.fg('warning', `[bg ${status}]`);

      const name = task?.name ? theme.fg('accent', task.name) : 'Task';
      const id = task?.id ? theme.fg('dim', `(${task.id})`) : '';
      const dur = task?.endTime && task?.startTime ? theme.fg('dim', `· ${formatDuration(task.endTime - task.startTime)}`) : '';
      const output = task?.outputPath ? `\n${theme.fg('dim', `Log: ${task.outputPath}`)}` : '';
      const err = task?.error ? `\n${theme.fg('error', `Error: ${task.error}`)}` : '';

      return new Text(`${color} ${name} ${id} ${dur}${output}${err}`, 0, 0);
    },
  );

  // Directional shortcut: Shift+Down opens the Task Dock!
  // Normal Up/Down arrow keys remain completely free for session picker, chat bar autocomplete & history.
  pi.registerShortcut('shift+down', {
    description: 'Open background tasks & subagents dock',
    handler: async (ctx) => {
      await dock.openDock(ctx);
    },
  });

  // Tool 1: bg_run
  pi.registerTool<typeof BgRunParams, { task: OrchestratorTask }>({
    name: 'bg_run',
    label: 'Background Run',
    description:
      'Start a long-running shell command in the background. Returns immediately with a task ID and log path. When the task finishes, an automatic notification wakes a follow-up agent turn. Never poll or sleep to wait for background tasks.',
    promptSnippet: 'Start a long-running command in the background; you will be notified automatically upon completion',
    promptGuidelines: [
      'Use bg_run instead of bash for any command expected to take a long time (e.g. dev servers, test suites, builds, watchers, downloads, or long background jobs).',
      'bg_run returns immediately with the task ID and output log path. Do NOT call sleep, bash, or loop with bg_status/bg_logs merely to wait for it.',
      'The system delivers a background-task-notification and wakes a follow-up turn automatically when the task finishes.',
      'After launching bg_run, proceed with independent tasks if any, or acknowledge the launch and end your turn so the user can continue talking.',
    ],
    parameters: BgRunParams,
    async execute(_toolCallId, params: BgRunInput, _signal, _onUpdate, ctx) {
      currentCtx = ctx;
      dock.setContext(ctx);

      const task = await processRunner.launch(
        ctx,
        params.command,
        { name: params.name, timeoutSeconds: params.timeoutSeconds },
        {
          onRegister: (t) => dock.register(t, () => processRunner.kill(t.id)),
          onUpdate: (id, u) => dock.update(id, u),
          onFinish: (t) => {
            const duration = t.endTime && t.startTime ? formatDuration(t.endTime - t.startTime) : '0s';
            const exitText = t.exitCode !== undefined && t.exitCode !== null ? `Exit code: ${t.exitCode}` : (t.error ?? t.status);

            try {
              pi.sendMessage(
                {
                  customType: 'background-task-notification',
                  content: `Background task "${t.name}" (${t.id}) ${t.status} in ${duration}. ${exitText}.\nLog file: ${t.outputPath}\nUse bg_logs with taskId "${t.id}" if you need the detailed command output.`,
                  display: true,
                  details: t,
                },
                { triggerTurn: true, deliverAs: 'followUp' },
              );
            } catch {
              // Session closed or non-interactive mode
            }
          },
        },
      );

      const message = [
        `Started background task "${task.name}" (${task.id})`,
        `PID: ${task.pid ?? 'unknown'}`,
        `Status: ${task.status}`,
        `Log path: ${task.outputPath}`,
        `Command: ${task.commandOrPrompt}`,
        `Note: You will be automatically notified when this command finishes. Do not poll.`,
      ].join('\n');

      return {
        content: [{ type: 'text', text: message }],
        details: { task },
      };
    },
    renderCall(args, theme) {
      const title = theme.fg('toolTitle', theme.bold('bg_run '));
      const desc = theme.fg('muted', args.name ? `${args.name} (${args.command})` : args.command);
      return new Text(`${title}${desc}`, 0, 0);
    },
    renderResult(result, _options, theme) {
      const task = result.details.task;
      return new Text(
        `${theme.fg('success', '✓ started')} ${theme.fg('accent', task.name)} ${theme.fg('dim', `(${task.id})`)}\n${theme.fg('dim', `Log: ${task.outputPath}`)}`,
        0,
        0,
      );
    },
  });

  // Tool 2: subagent
  pi.registerTool<typeof SubagentParams, { task: OrchestratorTask; role: string }>(
    {
      name: 'subagent',
      label: 'Subagent Delegate',
      description:
        'Delegate broad codebase research, multi-file exploration, or verification to an autonomous subagent running in an isolated in-memory context window. Intermediate tool outputs stay inside the subagent, preventing context bloat in the main conversation.',
      promptSnippet:
        'Delegate multi-file research, codebase exploration, or code review to an isolated subagent',
      promptGuidelines: [
        'DELEGATION CRITERIA (Adopted from OpenCode):',
        '  - Handle directly in main conversation: 1-2 known files, single-step lookups, or targeted in-place edits. Never spawn a subagent for simple tasks, quick edits, or single-file reads.',
        '  - Delegate autonomously to subagent: Broad codebase exploration across multiple directories, multi-file pattern searches, tracing unfamiliar architecture, or pre-flight code reviews.',
        'EXECUTION MODES (OpenCode Pattern):',
        '  - background: false (default): Foreground synchronous execution. Blocks until the subagent completes and returns the findings directly into your turn so you can use them immediately to continue working.',
        '  - background: true: Asynchronous execution. Returns a task ID immediately, allowing you to continue responding to the user. You will be automatically awakened with a notification when the subagent completes.',
        'ROLE SPECIALIZATION & PI TOOLS:',
        '  - "explore" (default): Read-only codebase discovery using find, grep, ls, read.',
        '  - "review": Read-only adversarial code review citing exact line numbers and severity levels.',
        '  - "execute": Full-capability implementation subagent using read, edit, write, bash.',
        'SEED CONTEXT: Pass any already-known file paths, error messages, or symbol names via the `context` parameter to ground the subagent immediately so it avoids redundant searches.',
        'WORKFLOW PRESERVATION: A subagent operates in an isolated in-memory context and returns only its synthesized conclusion. You (the primary agent) maintain full conversational continuity and perform final edits or answers directly.',
      ],
      parameters: SubagentParams,
      async execute(_toolCallId, params: SubagentInput, signal, onUpdate, ctx) {
        currentCtx = ctx;
        dock.setContext(ctx);

        let currentTask: OrchestratorTask | undefined;

        const { text, task } = await subagentRunner.execute(
          ctx,
          params,
          signal,
          (progressMsg) => {
            onUpdate?.({
              content: [{ type: 'text', text: progressMsg }],
              details: { task: currentTask, role: params.role ?? 'explore' },
            });
          },
          {
            onRegister: (t, abort) => {
              currentTask = t;
              dock.register(t, abort);
            },
            onUpdate: (id, u) => {
              if (currentTask) Object.assign(currentTask, u);
              dock.update(id, u);
            },
            onFinish: (t) => {
              dock.update(t.id, { status: t.status, endTime: t.endTime, resultText: t.resultText });
              if (t.background) {
                const dur = t.endTime && t.startTime ? formatDuration(t.endTime - t.startTime) : '0s';
                try {
                  pi.sendMessage(
                    {
                      customType: 'background-task-notification',
                      content: `Background subagent "${t.name}" (${t.id}) ${t.status} in ${dur}.\nRole: ${t.role}\n\nFindings:\n${t.resultText}`,
                      display: true,
                      details: t,
                    },
                    { triggerTurn: true, deliverAs: 'followUp' },
                  );
                } catch {
                  // Session closed or non-interactive mode
                }
              }
            },
          },
        );

        return {
          content: [{ type: 'text', text }],
          details: { task, role: params.role ?? 'explore' },
        };
      },
      renderCall(args, theme) {
        const THOUGHT_YELLOW = '\x1b[38;2;234;179;8m';
        const EXPLORED_GRAY = '\x1b[38;2;160;160;170m';
        const RESET = '\x1b[0m';

        const desc = args.description ? ` · ${args.description}` : '';
        const thoughtLine = `${THOUGHT_YELLOW}● Thought · running...${RESET}`;
        const actionLine = `${EXPLORED_GRAY}→ Starting subagent [${args.role ?? 'explore'}]${desc}${RESET}`;

        return new Text(`${thoughtLine}\n\n${actionLine}`, 0, 0);
      },
      renderResult(result, options, theme) {
        const { expanded, isPartial } = (options ?? {}) as { expanded?: boolean; isPartial?: boolean };
        const task = (result.details as any)?.task as OrchestratorTask | undefined;

        const THOUGHT_YELLOW = '\x1b[38;2;234;179;8m';
        const EXPLORED_GRAY = '\x1b[38;2;160;160;170m';
        const PURPLE_BAR = '\x1b[38;2;168;85;247m│\x1b[0m ';
        const DIM_GRAY = '\x1b[38;2;120;120;130m';
        const RESET = '\x1b[0m';

        const durationMs = task
          ? (task.endTime ? task.endTime - task.startTime : Date.now() - task.startTime)
          : 0;
        const thoughtMs = task?.thoughtDurationMs ?? durationMs;
        const durStr = thoughtMs < 1000 ? `${thoughtMs}ms` : `${(thoughtMs / 1000).toFixed(1)}s`;

        const thoughtSymbol = isPartial ? '●' : (expanded ? '-' : '+');
        const thoughtLine = `${THOUGHT_YELLOW}${thoughtSymbol} Thought · ${durStr}${RESET}`;

        let actionLine = '';
        if (isPartial) {
          if (task?.liveAction) {
            actionLine = `${EXPLORED_GRAY}→ Exploring: ${task.readsCount} reads, ${task.searchesCount} searches (${task.liveAction})${RESET}`;
          } else {
            actionLine = `${EXPLORED_GRAY}→ Exploring...${RESET}`;
          }
        } else {
          const summary = task?.summaryActionText ?? `→ Explored: ${task?.readsCount ?? 0} reads, ${task?.searchesCount ?? 0} searches`;
          actionLine = `${EXPLORED_GRAY}${summary}${RESET}`;
        }

        let contentText = `${thoughtLine}\n\n${actionLine}`;

        if (expanded && task) {
          contentText += '\n';

          const promptLines = (task.commandOrPrompt || '').split('\n').slice(0, 8);
          for (const pl of promptLines) {
            contentText += `\n  ${PURPLE_BAR}${theme.fg('muted', pl)}`;
          }

          if (task.history && task.history.length > 0) {
            contentText += `\n\n  ${theme.bold('Tool History:')}`;
            task.history.forEach((h, idx) => {
              const argPreview = h.args && typeof h.args === 'object' ? JSON.stringify(h.args).slice(0, 60) : '';
              contentText += `\n    ${DIM_GRAY}${idx + 1}. ${h.tool}(${argPreview})${RESET}`;
            });
          }

          const output = result.content
            .map((c) => (c.type === 'text' ? c.text : ''))
            .join('\n');
          if (output) {
            contentText += `\n\n  ${theme.bold('Findings:')}\n${theme.fg('toolOutput', output.slice(0, 3000))}`;
          }
        }

        return new Text(contentText, 0, 0);
      },
    },
  );

  // Tool 3: bg_status
  pi.registerTool<typeof BgStatusParams, { tasks: OrchestratorTask[] }>({
    name: 'bg_status',
    label: 'Background Status',
    description: 'Check point-in-time status of one or all background processes and subagents.',
    parameters: BgStatusParams,
    async execute(_toolCallId, params: BgStatusInput) {
      const all = dock.getAll();
      const matches = params.taskId
        ? all.filter((t) => t.id.toLowerCase().startsWith(params.taskId!.trim().toLowerCase()))
        : all;

      if (matches.length === 0) {
        return {
          content: [{ type: 'text', text: 'No background tasks or subagents found.' }],
          details: { tasks: [] },
        };
      }

      const lines = matches.map((t) => {
        const age = formatDuration((t.endTime ?? Date.now()) - t.startTime);
        const statusText = t.exitCode !== undefined && t.exitCode !== null ? `exit ${t.exitCode}` : (t.error ?? t.status);
        return `[${t.kind.toUpperCase()}:${t.status.toUpperCase()}] ${t.id} - "${t.name}" (${age}, ${statusText})\n  ${t.kind === 'process' ? `Command: ${t.commandOrPrompt}\n  Log: ${t.outputPath}` : `Prompt: ${t.commandOrPrompt}`}`;
      });

      return {
        content: [{ type: 'text', text: lines.join('\n\n') }],
        details: { tasks: matches },
      };
    },
  });

  // Tool 4: bg_logs
  pi.registerTool<typeof BgLogsParams, { taskId: string; bytesRead: number; totalBytes: number }>({
    name: 'bg_logs',
    label: 'Background Logs',
    description: 'Read bounded output logs from a background process on-demand.',
    parameters: BgLogsParams,
    async execute(_toolCallId, params: BgLogsInput) {
      const all = dock.getAll();
      const task = all.find((t) => t.id.toLowerCase().startsWith(params.taskId.trim().toLowerCase()));
      if (!task) {
        return {
          content: [{ type: 'text', text: `Task "${params.taskId}" not found.` }],
          details: { taskId: params.taskId, bytesRead: 0, totalBytes: 0 },
        };
      }

      if (task.kind === 'subagent') {
        const historyText = task.history.map((h, i) => `${i + 1}. ${h.tool}(${JSON.stringify(h.args)})`).join('\n');
        const text = `Subagent ${task.name} (${task.id}):\nStatus: ${task.status}\nTool calls (${task.history.length}):\n${historyText}\n\nFinal Result:\n${task.resultText ?? '(no result yet)'}`;
        return {
          content: [{ type: 'text', text }],
          details: { taskId: task.id, bytesRead: text.length, totalBytes: text.length },
        };
      }

      const log = readBoundedLog(task.outputAbsPath ?? '', params.maxBytes ?? 8192, params.tail ?? true);
      return {
        content: [{ type: 'text', text: log.text }],
        details: { taskId: task.id, bytesRead: log.bytesRead, totalBytes: log.totalBytes },
      };
    },
  });

  // Tool 5: bg_kill
  pi.registerTool<typeof BgKillParams, { taskId: string; stopped: boolean }>({
    name: 'bg_kill',
    label: 'Background Kill',
    description: 'Stop a running background process or subagent by task ID.',
    parameters: BgKillParams,
    async execute(_toolCallId, params: BgKillInput) {
      const all = dock.getAll();
      const task = all.find((t) => t.id.toLowerCase().startsWith(params.taskId.trim().toLowerCase()));
      if (!task) {
        return {
          content: [{ type: 'text', text: `Task "${params.taskId}" not found.` }],
          details: { taskId: params.taskId, stopped: false },
        };
      }

      if (task.status !== 'running') {
        return {
          content: [{ type: 'text', text: `Task "${task.name}" (${task.id}) is already ${task.status}.` }],
          details: { taskId: task.id, stopped: false },
        };
      }

      task.abort?.();
      dock.stop(task.id);
      return {
        content: [{ type: 'text', text: `Stopped task "${task.name}" (${task.id}).` }],
        details: { taskId: task.id, stopped: true },
      };
    },
  });

  // Slash commands
  pi.registerCommand('bg', {
    description: 'Start a command in the background: /bg [--name "Task name"] <command>',
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      try {
        let name: string | undefined;
        let command = args.trim();

        const nameMatch = command.match(/^--name\s+("([^"]+)"|'([^']+)'|(\S+))\s+(.*)$/i);
        if (nameMatch) {
          name = nameMatch[2] || nameMatch[3] || nameMatch[4];
          command = nameMatch[5]?.trim() ?? '';
        }

        if (!command) {
          ctx.ui.notify('Usage: /bg [--name "Task name"] <command>', 'error');
          return;
        }

        const task = await processRunner.launch(
          ctx,
          command,
          { name },
          {
            onRegister: (t) => dock.register(t),
            onUpdate: (id, u) => dock.update(id, u),
            onFinish: (t) => {
              const dur = t.endTime && t.startTime ? formatDuration(t.endTime - t.startTime) : '0s';
              pi.sendMessage(
                {
                  customType: 'background-task-notification',
                  content: `Background task "${t.name}" (${t.id}) ${t.status} in ${dur}.\nLog: ${t.outputPath}`,
                  display: true,
                  details: t,
                },
                { triggerTurn: true, deliverAs: 'followUp' },
              );
            },
          },
        );

        ctx.ui.notify(
          `Started background task "${task.name}" (${task.id})\nLog: ${task.outputPath}\nPID: ${task.pid ?? 'unknown'}`,
          'info',
        );
      } catch (err) {
        ctx.ui.notify(`Failed to start task: ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    },
  });

  const openDockHandler = async (_args: string, ctx: ExtensionCommandContext) => {
    await dock.openDock(ctx);
  };

  pi.registerCommand('tasks', {
    description: 'Open the background tasks & subagents dock',
    handler: openDockHandler,
  });

  pi.registerCommand('jobs', {
    description: 'Open the background tasks & subagents dock',
    handler: openDockHandler,
  });

  pi.registerCommand('logs', {
    description: 'Show output from a task: /logs <taskId> [maxBytes]',
    handler: (args: string, ctx: ExtensionCommandContext) => {
      try {
        const [id, bytesStr] = args.trim().split(/\s+/, 2);
        if (!id) {
          ctx.ui.notify('Usage: /logs <taskId> [maxBytes]', 'error');
          return Promise.resolve();
        }
        const all = dock.getAll();
        const task = all.find((t) => t.id.toLowerCase().startsWith(id.toLowerCase()));
        if (!task) {
          ctx.ui.notify(`Task "${id}" not found.`, 'error');
          return Promise.resolve();
        }

        if (task.kind === 'subagent') {
          const historyText = task.history.map((h, i) => `${i + 1}. ${h.tool}(${JSON.stringify(h.args)})`).join('\n');
          ctx.ui.notify(`Subagent ${task.name} (${task.id}):\nStatus: ${task.status}\nTool calls:\n${historyText}`, 'info');
          return Promise.resolve();
        }

        const bytes = bytesStr ? parseInt(bytesStr, 10) : 8192;
        const log = readBoundedLog(task.outputAbsPath ?? '', bytes, true);
        ctx.ui.notify(`Log for ${task.name} (${task.id}):\n\n${log.text}`, 'info');
      } catch (err) {
        ctx.ui.notify(`Logs error: ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
      return Promise.resolve();
    },
  });

  pi.registerCommand('kill', {
    description: 'Stop a running task: /kill <taskId>',
    handler: (args: string, ctx: ExtensionCommandContext) => {
      const id = args.trim();
      if (!id) {
        ctx.ui.notify('Usage: /kill <taskId>', 'error');
        return Promise.resolve();
      }
      const all = dock.getAll();
      const task = all.find((t) => t.id.toLowerCase().startsWith(id.toLowerCase()));
      if (!task) {
        ctx.ui.notify(`Task "${id}" not found.`, 'error');
        return Promise.resolve();
      }
      if (task.status !== 'running') {
        ctx.ui.notify(`Task "${task.name}" is already ${task.status}.`, 'warning');
        return Promise.resolve();
      }

      dock.stop(task.id);
      ctx.ui.notify(`Stopped task "${task.name}" (${task.id}).`, 'info');
      return Promise.resolve();
    },
  });

  pi.registerCommand('bg-clear', {
    description: 'Clear finished task badges from the footer status bar',
    handler: (_args: string, ctx: ExtensionCommandContext) => {
      dock.clearFinished();
      ctx.ui.notify('Cleared finished task notices.', 'info');
      return Promise.resolve();
    },
  });
}
