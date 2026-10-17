import {
  createAgentSession,
  getAgentDir,
  SessionManager,
  SettingsManager,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { generateTaskId } from './process.js';
import type { OrchestratorTask, SubagentInput } from './types.js';

const MAX_OUTPUT_CHARS = 12000;

export interface SubagentRunnerEvents {
  onRegister: (task: OrchestratorTask, abort?: () => void) => void;
  onUpdate: (id: string, updates: Partial<OrchestratorTask>) => void;
  onFinish: (task: OrchestratorTask) => void;
}

function buildSummaryActionText(task: OrchestratorTask): string {
  if (task.role === 'explore') {
    const parts: string[] = [];
    if (task.readsCount > 0) parts.push(`${task.readsCount} read${task.readsCount === 1 ? '' : 's'}`);
    if (task.searchesCount > 0) parts.push(`${task.searchesCount} search${task.searchesCount === 1 ? '' : 'es'}`);
    return parts.length > 0 ? `→ Explored: ${parts.join(', ')}` : '→ Explored';
  }
  if (task.role === 'review') {
    const parts: string[] = [];
    if (task.readsCount > 0) parts.push(`${task.readsCount} file${task.readsCount === 1 ? '' : 's'}`);
    if (task.searchesCount > 0) parts.push(`${task.searchesCount} search${task.searchesCount === 1 ? '' : 'es'}`);
    return parts.length > 0 ? `→ Reviewed: ${parts.join(', ')}` : '→ Reviewed';
  }
  const parts: string[] = [];
  if (task.editsCount > 0) parts.push(`${task.editsCount} edit${task.editsCount === 1 ? '' : 's'}`);
  if (task.commandsCount > 0) parts.push(`${task.commandsCount} command${task.commandsCount === 1 ? '' : 's'}`);
  return parts.length > 0 ? `→ Executed: ${parts.join(', ')}` : '→ Executed';
}

export class SubagentRunner {
  private activeSubagents = new Map<string, { abort: () => void }>();

  async execute(
    ctx: ExtensionContext,
    params: SubagentInput,
    signal: AbortSignal | undefined,
    onProgress: ((message: string) => void) | undefined,
    events: SubagentRunnerEvents,
  ): Promise<{ text: string; task: OrchestratorTask }> {
    const id = generateTaskId('sub');
    const role = params.role ?? 'explore';
    const isBackground = params.background === true;

    // Layer 2: Tool allowlist per role
    const roleTools =
      role === 'execute'
        ? ['read', 'edit', 'write', 'bash']
        : ['read', 'grep', 'find', 'ls']; // explore and review are strictly read-only

    // Layer 2: System persona per role (OpenCode prompts adapted to Pi tool surface)
    const systemInstructions =
      role === 'review'
        ? `You are a senior code reviewer subagent working for a parent agent in Pi.
The delegated review request comes from the parent agent, and your result is returned directly to that parent agent. Do not address the end user, send conversational pleasantries, ask follow-up questions, or offer unsolicited advice.

Your tools:
- read: Read file contents with line offset/limit
- grep: Search file contents using regex
- find: Locate files matching glob patterns
- ls: List directory contents

Guidelines:
- Inspect the requested code, diffs, and implementations for bugs, edge cases, security vulnerabilities, and regressions.
- Order findings strictly by severity:
  1. [CRITICAL]: Broken logic, security vulnerabilities, data loss risks, or syntax errors.
  2. [WARNING]: Edge cases, performance bottlenecks, unhandled exceptions, or missing validations.
  3. [SUGGESTION]: Code hygiene, readability, or minor idiomatic improvements.
- Cite exact file paths and line numbers for every finding.
- If no issues are found, state that clearly in one sentence.`
        : role === 'execute'
          ? `You are a full-capability general-purpose subagent working for a parent agent in Pi. A parent agent has delegated a bounded task to you. Own that task and complete it end to end.
The tools exposed in this turn are the source of truth. Use any of them needed for the assignment:
- read: Inspect file contents
- edit: Make targeted, exact string replacements in existing files
- write: Create new files or overwrite files completely
- bash: Execute shell commands, tests, or scripts to verify your changes

Guidelines:
- Make only the necessary changes requested in the task.
- Follow the project's existing architecture, formatting, and coding conventions.
- Verify your changes (e.g. running tests or build checks via bash when appropriate).
- Do not address the end user directly; return a factual, concise completion summary to the parent agent.`
          : `You are a file search and codebase exploration specialist working for a parent agent in Pi. You excel at thoroughly navigating and exploring codebases.
The delegated search request comes from the parent agent, and your result is returned directly to that parent agent. Do not address the end user, send user-facing progress updates, ask the end user questions, or offer unsolicited follow-up work.

Your strengths & tools:
- find: Rapidly finding files using glob patterns (e.g. pattern: "*.ts", path: "src")
- grep: Searching code and text with powerful regex patterns across files
- ls: Listing directory entries to understand folder layouts
- read: Reading and analyzing specific file contents (with offset and limit)

Guidelines:
- Use find and ls when exploring directory structures or locating files by name or extension.
- Use grep when searching for symbol declarations, function calls, imports, or error strings.
- Use read when you know the specific file path and need to examine its implementation.
- Answer directly and factually; quote exact file paths and line numbers.
- Provide a structured, concise synthesis of your findings for the parent agent. Do not dump raw file contents or boilerplate.`;

    // Model resolution: default is the same model as the parent session
    let targetModel = ctx.model;
    if (params.model?.trim()) {
      const parts = params.model.trim().split('/');
      if (parts.length >= 2) {
        const prov = parts[0]!;
        const modelId = parts.slice(1).join('/');
        const found = ctx.modelRegistry?.getModel(prov, modelId);
        if (found) targetModel = found;
      }
    }

    const task: OrchestratorTask = {
      id,
      kind: 'subagent',
      name: params.description,
      commandOrPrompt: params.prompt,
      role,
      status: 'running',
      startTime: Date.now(),
      context: params.context,
      toolCallCount: 0,
      history: [],
      background: isBackground,
      model: targetModel?.id,
      readsCount: 0,
      searchesCount: 0,
      editsCount: 0,
      commandsCount: 0,
      summaryActionText: '→ Explored: 0 reads, 0 searches',
    };

    const agentDir = getAgentDir();
    const settingsManager = SettingsManager.create(ctx.cwd, agentDir, {
      projectTrusted: ctx.isProjectTrusted(),
    });
    // 100% in-memory session (zero disk littering)
    const sessionManager = SessionManager.inMemory();

    let session: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined;
    let toolCallCount = 0;
    const history: OrchestratorTask['history'] = [];

    const setupSession = async () => {
      const sessionResult = await createAgentSession({
        cwd: ctx.cwd,
        agentDir,
        model: targetModel,
        thinkingLevel: ctx.getThinkingLevel?.() ?? 'medium',
        sessionManager,
        settingsManager,
        tools: roleTools,
      });
      session = sessionResult.session;

      this.activeSubagents.set(id, {
        abort: () => {
          task.status = 'cancelled';
          void session?.abort();
        },
      });

      events.onRegister(task, () => this.abort(id));

      session.subscribe((event) => {
        if (event.type === 'tool_execution_start') {
          toolCallCount++;
          task.toolCallCount = toolCallCount;

          if (!task.thoughtDurationMs) {
            task.thoughtDurationMs = Date.now() - task.startTime;
          }

          if (event.toolName === 'read') task.readsCount++;
          else if (event.toolName === 'find' || event.toolName === 'grep') task.searchesCount++;
          else if (event.toolName === 'edit' || event.toolName === 'write') task.editsCount++;
          else if (event.toolName === 'bash') task.commandsCount++;

          task.summaryActionText = buildSummaryActionText(task);

          const preview =
            event.args && typeof event.args === 'object'
              ? JSON.stringify(event.args).slice(0, 50)
              : '';
          const actionText = `${event.toolName}(${preview})`;

          history.push({ tool: event.toolName, args: event.args, time: Date.now() });
          task.history = [...history];
          task.liveAction = actionText;
          task.toolCallCount = toolCallCount;

          events.onUpdate(id, {
            toolCallCount,
            liveAction: actionText,
            history: [...history],
            thoughtDurationMs: task.thoughtDurationMs,
            readsCount: task.readsCount,
            searchesCount: task.searchesCount,
            editsCount: task.editsCount,
            commandsCount: task.commandsCount,
            summaryActionText: task.summaryActionText,
          });

          onProgress?.(`[subagent:${role}] Running ${actionText}...`);

          // Safety guard: prevent runaway infinite loops
          if (toolCallCount === 8) {
            void session?.steer(
              'You have executed 8 tool calls. Stop exploring and synthesize your findings into the final response now.',
            );
          }
        }
      });
    };

    const runSubagentPrompt = async (): Promise<string> => {
      if (signal) {
        if (signal.aborted) {
          session?.dispose();
          task.status = 'cancelled';
          task.endTime = Date.now();
          events.onUpdate(id, { status: 'cancelled', endTime: task.endTime });
          events.onFinish(task);
          return 'Subagent was cancelled before execution.';
        }
        signal.addEventListener(
          'abort',
          () => {
            task.status = 'cancelled';
            void session?.abort();
          },
          { once: true },
        );
      }

      // Layer 3: 4-Layer Context Envelope composition
      const promptSections = [
        systemInstructions,
        params.context?.trim() ? `\n### Seed Context & Known Facts:\n${params.context.trim()}` : '',
        `\n### Task Objective:\n${params.prompt.trim()}`,
        '\n### Expected Deliverable:\n- Be concise, direct, and factual.\n- Cite exact file paths and line numbers where relevant.\n- Do NOT dump raw file contents; distill the answer directly.',
      ].filter(Boolean);

      await session!.prompt(promptSections.join('\n'));

      // Layer 4: Distillation boundary & output bounding
      let rawText = '';
      const lastAssistant = [...session!.messages].reverse().find((m) => m.role === 'assistant');
      if (lastAssistant && Array.isArray(lastAssistant.content)) {
        for (const c of lastAssistant.content) {
          if (c.type === 'text' && c.text) {
            rawText += c.text;
          }
        }
      }
      if (!rawText.trim()) {
        rawText = session!.getLastAssistantText() || '[Subagent completed without producing text output]';
      }

      task.status = task.status === 'cancelled' ? 'cancelled' : 'completed';
      task.endTime = Date.now();
      task.resultText = rawText; // Retain full text for Dock inspection
      if (!task.thoughtDurationMs) {
        task.thoughtDurationMs = Math.max(100, task.endTime - task.startTime);
      }
      task.summaryActionText = buildSummaryActionText(task);

      events.onUpdate(id, {
        status: task.status,
        endTime: task.endTime,
        resultText: rawText,
        toolCallCount,
        thoughtDurationMs: task.thoughtDurationMs,
        summaryActionText: task.summaryActionText,
      });
      events.onFinish(task);

      // Protect parent context window if output is massive
      if (rawText.length > MAX_OUTPUT_CHARS) {
        return `${rawText.slice(0, MAX_OUTPUT_CHARS)}\n\n[... Output bounded (${rawText.length} characters) to protect conversation runway. Complete output viewable in Tasks Dock ...]`;
      }
      return rawText;
    };

    await setupSession();

    if (isBackground) {
      // Run asynchronously in the background
      void (async () => {
        try {
          await runSubagentPrompt();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          task.status = 'failed';
          task.endTime = Date.now();
          task.error = message;
          events.onUpdate(id, { status: 'failed', endTime: task.endTime, error: message });
          events.onFinish(task);
        } finally {
          this.activeSubagents.delete(id);
          session?.dispose();
        }
      })();

      const bgNotice = `Started background subagent "${task.name}" (${task.id}).\nRole: ${role}\nModel: ${targetModel?.id ?? 'default'}\nStatus: running in background\nNote: You will be automatically notified when this subagent completes. Do not poll.`;
      return { text: bgNotice, task };
    }

    // Foreground execution (blocks until completion)
    try {
      const text = await runSubagentPrompt();
      return { text, task };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      task.status = 'failed';
      task.endTime = Date.now();
      task.error = message;

      events.onUpdate(id, {
        status: 'failed',
        endTime: task.endTime,
        error: message,
      });
      events.onFinish(task);

      return {
        text: `[Subagent Notice]: Subagent encountered an issue: ${message}. Continuing directly in the main conversation.`,
        task,
      };
    } finally {
      this.activeSubagents.delete(id);
      session?.dispose();
    }
  }

  abort(id: string): void {
    const handle = this.activeSubagents.get(id);
    if (handle) handle.abort();
  }

  abortAll(): void {
    for (const [id] of this.activeSubagents) {
      this.abort(id);
    }
  }
}
