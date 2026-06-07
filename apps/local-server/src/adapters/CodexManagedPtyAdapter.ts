import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';

import type {
  AgentDeliveryResult,
} from '../../../../packages/shared/src/types.ts';
import type {
  AgentAdapter,
} from './AgentAdapter.ts';

type ManagedProcess = Pick<ChildProcessWithoutNullStreams, 'stdin' | 'stdout' | 'stderr' | 'pid'>;

export type SpawnManagedCodex = () => ManagedProcess;

export interface CodexManagedPtyStatus {
  started: boolean;
  pid?: number;
  recentOutput: string;
}

const MAX_OUTPUT_BUFFER = 16_000;

function defaultSpawnManagedCodex(): ManagedProcess {
  return spawn('codex', [], {
    stdio: 'pipe',
    shell: false,
  });
}

export class CodexManagedPtyAdapter implements AgentAdapter {
  readonly name = 'codex-managed-pty';
  private process: ManagedProcess | null = null;
  private outputBuffer = '';
  private readonly spawnManagedCodex: SpawnManagedCodex;

  constructor(spawnManagedCodex: SpawnManagedCodex = defaultSpawnManagedCodex) {
    this.spawnManagedCodex = spawnManagedCodex;
  }

  start(): CodexManagedPtyStatus {
    if (this.process) {
      return this.getStatus();
    }

    const managedProcess = this.spawnManagedCodex();
    this.process = managedProcess;
    managedProcess.stdout.on('data', (chunk: Buffer | string) => {
      this.appendOutput(String(chunk));
    });
    managedProcess.stderr.on('data', (chunk: Buffer | string) => {
      this.appendOutput(String(chunk));
    });

    return this.getStatus();
  }

  async sendPrompt(prompt: string): Promise<AgentDeliveryResult> {
    if (!this.process) {
      this.start();
    }

    if (!this.process?.stdin.writable) {
      return {
        ok: false,
        transport: 'managed-pty',
        failureReason: 'managed-pty-unavailable',
      };
    }

    this.process.stdin.write(`${prompt}\n`);
    return {
      ok: true,
      transport: 'managed-pty',
      deliveredPrompt: prompt,
    };
  }

  getStatus(): CodexManagedPtyStatus {
    return {
      started: this.process !== null,
      pid: this.process?.pid,
      recentOutput: this.outputBuffer,
    };
  }

  readRecentOutput(): string {
    return this.outputBuffer;
  }

  private appendOutput(output: string): void {
    this.outputBuffer = `${this.outputBuffer}${output}`.slice(-MAX_OUTPUT_BUFFER);
  }
}
