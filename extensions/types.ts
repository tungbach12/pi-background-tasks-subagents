import { Type, type Static } from 'typebox';

export type TaskKind = 'process' | 'subagent';
export type TaskStatus = 'running' | 'completed' | 'failed' | 'killed' | 'cancelled';

export interface TaskToolRecord {
  tool: string;
  args: unknown;
  time: number;
}

export interface OrchestratorTask {
  id: string;
  kind: TaskKind;
  name: string;
  commandOrPrompt: string;
  role?: 'explore' | 'review' | 'execute';
  status: TaskStatus;
  startTime: number;
  endTime?: number;
  pid?: number;
  exitCode?: number | null;
  outputPath?: string; // Relative for display, e.g. .pi/tasks/fed3d248.log
  outputAbsPath?: string;
  context?: string; // Seed context for subagents
  toolCallCount: number;
  liveAction?: string;
  history: TaskToolRecord[];
  resultText?: string;
  error?: string;
  background?: boolean;
  model?: string;

  // OpenCode telemetry & metrics
  thoughtDurationMs?: number;
  readsCount: number;
  searchesCount: number;
  editsCount: number;
  commandsCount: number;
  summaryActionText?: string; // e.g. "→ Explored: 4 reads, 4 searches"
}

// Schemas for Tools
export const BgRunParams = Type.Object({
  command: Type.String({
    description: 'Shell command to execute in the background',
  }),
  name: Type.Optional(
    Type.String({
      description: 'Short 2-5 word human-readable name for the task (e.g. "Dev server", "Test suite")',
    }),
  ),
  timeoutSeconds: Type.Optional(
    Type.Number({
      description: 'Optional timeout in seconds after which the task will be automatically killed',
    }),
  ),
});

export const SubagentParams = Type.Object({
  description: Type.String({
    description: 'Concise 2-6 word label for the subagent mission (e.g. "Trace auth middleware", "Search API routes")',
  }),
  prompt: Type.String({
    description: 'Detailed, self-contained instructions for the subagent. Specify exact objectives, questions to answer, or files to inspect.',
  }),
  context: Type.Optional(
    Type.String({
      description: 'Optional seed context: error stack traces, known symbol names, relevant file snippets, or background facts discovered so far to ground the subagent without bloating its context.',
    }),
  ),
  role: Type.Optional(
    Type.Union(
      [
        Type.Literal('explore'),
        Type.Literal('review'),
        Type.Literal('execute'),
      ],
      {
        description: 'Subagent role. "explore" (default): read-only exploration (read, grep, find, ls). "review": read-only code review persona. "execute": full editing capabilities (read, edit, write, bash).',
      },
    ),
  ),
  background: Type.Optional(
    Type.Boolean({
      description:
        'Run the subagent asynchronously in the background and return immediately. Default is false (foreground, blocks until finished). When background=true, you are notified automatically when it completes.',
    }),
  ),
  model: Type.Optional(
    Type.String({
      description:
        'Optional model override (e.g. "provider/modelId"). Defaults to the current session model.',
    }),
  ),
  maxSteps: Type.Optional(
    Type.Number({
      description:
        'Maximum tool calls before forcing text-only response (default: Infinity / unlimited, matching OpenCode). Set only if you wish to enforce a cost/step ceiling.',
    }),
  ),
});

export const BgStatusParams = Type.Object({
  taskId: Type.Optional(
    Type.String({
      description: 'Task ID or prefix to inspect. If omitted, returns all tasks.',
    }),
  ),
});

export const BgLogsParams = Type.Object({
  taskId: Type.String({
    description: 'Task ID or prefix to read logs from',
  }),
  maxBytes: Type.Optional(
    Type.Number({
      description: 'Maximum bytes to read (default: 8192, cap: 65536)',
    }),
  ),
  tail: Type.Optional(
    Type.Boolean({
      description: 'Read from end of log when true (default: true)',
    }),
  ),
});

export const BgKillParams = Type.Object({
  taskId: Type.String({
    description: 'Task ID or prefix to stop',
  }),
});

export type BgRunInput = Static<typeof BgRunParams>;
export type SubagentInput = Static<typeof SubagentParams>;
export type BgStatusInput = Static<typeof BgStatusParams>;
export type BgLogsInput = Static<typeof BgLogsParams>;
export type BgKillInput = Static<typeof BgKillParams>;
