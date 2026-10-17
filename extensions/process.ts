import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  createWriteStream,
  existsSync,
  fstatSync,
  openSync,
  readSync,
  type WriteStream,
} from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { OrchestratorTask } from './types.js';

const DEFAULT_LOG_BYTES = 8192;
const MAX_LOG_BYTES = 65536;
const MAX_OUTPUT_FILE_BYTES = 50 * 1024 * 1024; // 50MB protection cap

export function generateTaskId(prefix = ''): string {
  const hex = randomBytes(4).toString('hex');
  return prefix ? `${prefix}-${hex}` : hex;
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  return `${minutes}m ${remSeconds}s`;
}

export function deriveTaskName(command: string): string {
  const trimmed = command.trim();
  const firstWord = trimmed.split(/\s+/)[0] ?? 'task';
  const cleanWord = firstWord.replace(/[^\w.-]/g, '');
  return cleanWord ? `Run ${cleanWord}` : 'Background task';
}

export function getShellCommand(command: string): {
  shell: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
} {
  if (process.platform === 'win32') {
    const override = process.env.PI_BG_SHELL_PATH;
    if (override && existsSync(override)) {
      return { shell: override, args: ['-c', command] };
    }

    const programFiles = process.env.ProgramFiles;
    const programFilesX86 = process.env['ProgramFiles(x86)'];
    const candidates = [
      programFiles ? join(programFiles, 'Git', 'bin', 'bash.exe') : '',
      programFilesX86 ? join(programFilesX86, 'Git', 'bin', 'bash.exe') : '',
      programFiles ? join(programFiles, 'Git', 'usr', 'bin', 'bash.exe') : '',
    ].filter(Boolean);

    for (const p of candidates) {
      if (existsSync(p)) {
        return { shell: p, args: ['-c', command] };
      }
    }

    const comSpec = process.env.ComSpec || 'cmd.exe';
    return {
      shell: comSpec,
      args: ['/d', '/s', '/c', command],
      windowsVerbatimArguments: true,
    };
  }

  if (existsSync('/bin/bash')) {
    return { shell: '/bin/bash', args: ['-c', command] };
  }
  return { shell: 'sh', args: ['-c', command] };
}

export function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    try {
      const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
      const child = spawn(taskkill, ['/F', '/T', '/PID', String(pid)], {
        stdio: 'ignore',
        windowsHide: true,
      });
      child.once('error', () => {});
    } catch {
      // Ignore errors
    }
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already dead
      }
    }
  }
}

export function readBoundedLog(
  filePath: string,
  maxBytes = DEFAULT_LOG_BYTES,
  tail = true,
): { text: string; bytesRead: number; totalBytes: number; truncated: boolean } {
  if (!existsSync(filePath)) {
    return { text: '[Log file does not exist yet]', bytesRead: 0, totalBytes: 0, truncated: false };
  }

  const fd = openSync(filePath, 'r');
  try {
    const stat = fstatSync(fd);
    const totalBytes = stat.size;
    if (totalBytes === 0) {
      return { text: '[Log is empty]', bytesRead: 0, totalBytes: 0, truncated: false };
    }

    const clampedMaxBytes = Math.min(MAX_LOG_BYTES, Math.max(128, maxBytes));
    const bytesToRead = Math.min(totalBytes, clampedMaxBytes);
    const buffer = Buffer.alloc(bytesToRead);
    const startPosition = tail ? Math.max(0, totalBytes - bytesToRead) : 0;
    readSync(fd, buffer, 0, bytesToRead, startPosition);
    const content = buffer.toString('utf8');
    const truncated = totalBytes > bytesToRead;
    const prefix = truncated
      ? `[... Output truncated: showing ${tail ? 'last' : 'first'} ${bytesToRead} bytes of ${totalBytes} total bytes ...]\n`
      : '';
    return {
      text: prefix + content,
      bytesRead: bytesToRead,
      totalBytes,
      truncated,
    };
  } finally {
    closeSync(fd);
  }
}

export function readLogTailLines(filePath: string, maxBytes = 32768): string[] {
  if (!existsSync(filePath)) return ['[Output log not created yet]'];
  try {
    const fd = openSync(filePath, 'r');
    const stat = fstatSync(fd);
    const size = stat.size;
    if (size === 0) {
      closeSync(fd);
      return ['[Log is empty]'];
    }
    const toRead = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(toRead);
    readSync(fd, buffer, 0, toRead, Math.max(0, size - toRead));
    closeSync(fd);
    const content = buffer.toString('utf8');
    return content.replace(/\r/g, '').split('\n').filter((l, i, arr) => l.length > 0 || i < arr.length - 1);
  } catch (err) {
    return [`[Error reading log: ${err instanceof Error ? err.message : String(err)}]`];
  }
}

export interface ProcessRunnerEvents {
  onRegister: (task: OrchestratorTask) => void;
  onUpdate: (id: string, updates: Partial<OrchestratorTask>) => void;
  onFinish: (task: OrchestratorTask) => void;
}

export class ProcessRunner {
  private activeProcesses = new Map<string, { child: ChildProcess; stream: WriteStream; timeoutHandle?: NodeJS.Timeout }>();

  async launch(
    ctx: ExtensionContext,
    command: string,
    options: { name?: string; timeoutSeconds?: number },
    events: ProcessRunnerEvents,
  ): Promise<OrchestratorTask> {
    const normalizedCommand = command.trim();
    if (!normalizedCommand) throw new Error('Background command cannot be empty');

    const tasksDir = join(ctx.cwd, '.pi', 'tasks');
    await mkdir(tasksDir, { recursive: true });

    const id = generateTaskId();
    const outputAbsPath = join(tasksDir, `${id}.log`);
    const metadataAbsPath = join(tasksDir, `${id}.json`);
    const outputPath = `.pi/tasks/${id}.log`;

    const taskName = options.name?.trim() || deriveTaskName(normalizedCommand);
    const timeoutSeconds =
      typeof options.timeoutSeconds === 'number' && options.timeoutSeconds > 0
        ? Math.floor(options.timeoutSeconds)
        : undefined;

    const task: OrchestratorTask = {
      id,
      kind: 'process',
      name: taskName,
      commandOrPrompt: normalizedCommand,
      status: 'running',
      startTime: Date.now(),
      outputPath,
      outputAbsPath,
      toolCallCount: 0,
      history: [],
      readsCount: 0,
      searchesCount: 0,
      editsCount: 0,
      commandsCount: 1,
      summaryActionText: `→ Executed: 1 command`,
    };

    events.onRegister(task);

    const stream = createWriteStream(outputAbsPath, { flags: 'a', encoding: 'utf8' });
    let bytesWritten = 0;

    const shell = getShellCommand(normalizedCommand);
    const child = spawn(shell.shell, shell.args, {
      cwd: ctx.cwd,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      windowsHide: true,
      windowsVerbatimArguments: shell.windowsVerbatimArguments,
    });

    task.pid = child.pid;
    events.onUpdate(id, { pid: child.pid });

    let timeoutHandle: NodeJS.Timeout | undefined;
    if (timeoutSeconds) {
      timeoutHandle = setTimeout(() => {
        if (task.status === 'running') {
          task.status = 'failed';
          task.error = `Timed out after ${timeoutSeconds}s`;
          if (child.pid) killProcessTree(child.pid);
        }
      }, timeoutSeconds * 1000);
    }

    this.activeProcesses.set(id, { child, stream, timeoutHandle });

    child.stdout?.on('data', (chunk: Buffer) => {
      bytesWritten += chunk.length;
      stream.write(chunk);

      if (bytesWritten > MAX_OUTPUT_FILE_BYTES && task.status === 'running') {
        task.status = 'failed';
        task.error = `Output exceeded limit of ${Math.round(MAX_OUTPUT_FILE_BYTES / 1024 / 1024)}MB`;
        stream.write(`\n[Process terminated: output exceeded cap]\n`);
        if (child.pid) killProcessTree(child.pid);
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      bytesWritten += chunk.length;
      stream.write(chunk);
    });

    child.on('error', (err) => {
      task.status = 'failed';
      task.error = err.message;
      stream.write(`\n[Spawn error: ${err.message}]\n`);
      stream.end();
      this.finalize(task, events);
    });

    child.on('close', (code, signal) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      stream.end();

      if (task.status === 'running') {
        if (code === 0) {
          task.status = 'completed';
          task.exitCode = 0;
        } else {
          task.status = 'failed';
          task.exitCode = code;
          task.error = `Exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}`;
        }
      }

      task.endTime = Date.now();
      this.finalize(task, events);
    });

    // Write initial JSON metadata
    void writeFile(metadataAbsPath, JSON.stringify({ ...task, abort: undefined }, null, 2)).catch(() => {});
    return task;
  }

  kill(id: string): void {
    const handle = this.activeProcesses.get(id);
    if (!handle) return;
    if (handle.timeoutHandle) clearTimeout(handle.timeoutHandle);
    if (handle.child.pid) {
      killProcessTree(handle.child.pid);
    }
  }

  killAll(): void {
    for (const [id] of this.activeProcesses) {
      this.kill(id);
    }
  }

  private finalize(task: OrchestratorTask, events: ProcessRunnerEvents): void {
    this.activeProcesses.delete(task.id);
    events.onUpdate(task.id, {
      status: task.status,
      endTime: task.endTime,
      exitCode: task.exitCode,
      error: task.error,
    });
    events.onFinish(task);
  }
}
