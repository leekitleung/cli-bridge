import { createHash, randomUUID } from 'node:crypto';

import { assertExecutionProposal } from '../../../../packages/shared/src/schemas.ts';
import type {
  ExecutionProposal,
  ReasoningArtifact,
  RunEndpointBinding,
  Plan,
} from '../../../../packages/shared/src/types.ts';
import {
  validateCommandExecution,
  type AllowedCommand,
} from '../adapters/command-runner.ts';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function proposalContentHash(input: {
  artifactId: string;
  artifactContentHash: string;
  preview: string;
  command: AllowedCommand;
  args: string[];
  stdin: string;
}): string {
  return `sha256:${createHash('sha256').update(stableJson(input)).digest('hex')}`;
}

export interface CreateExecutionProposalInput {
  binding: RunEndpointBinding;
  plan: Plan;
  stepId: string;
  artifact: ReasoningArtifact;
  preview: string;
  command: AllowedCommand;
  args: string[];
  stdin: string;
  expiresAt: number;
  now?: number;
  supersedesProposalId?: string;
}

export interface ConfirmExecutionProposalInput {
  proposalId: string;
  planId: string;
  stepId: string;
  artifactId: string;
  contentHash: string;
  bindingHash: string;
  executionEndpointId: string;
  executionPermissionProfile: string;
  projectId: string;
  now?: number;
}

export type ConfirmExecutionProposalResult =
  | { ok: true; proposal: ExecutionProposal }
  | { ok: false; failureReason: string };

export class InMemoryExecutionProposalStore {
  private readonly proposals = new Map<string, ExecutionProposal>();

  createDraft(input: CreateExecutionProposalInput): ExecutionProposal {
    const commandValidation = validateCommandExecution({
      command: input.command,
      args: input.args,
      stdin: input.stdin,
    });
    if (!commandValidation.ok) {
      throw new Error(commandValidation.failureReason ?? 'command-invalid');
    }
    const step = input.plan.steps.find(item => item.id === input.stepId);
    if (!step) throw new Error('step-not-found');
    if (input.artifact.kind !== 'execution-proposal') throw new Error('artifact-kind-invalid');
    if (input.artifact.planId !== input.plan.id || input.artifact.goalId !== input.plan.goalId) {
      throw new Error('artifact-plan-mismatch');
    }
    if (input.binding.planId !== input.plan.id || input.binding.goalId !== input.plan.goalId) {
      throw new Error('binding-plan-mismatch');
    }
    if (step.targetEndpointId !== input.binding.executionEndpointId) {
      throw new Error('step-endpoint-mismatch');
    }
    if (step.tier !== input.binding.executionPermissionProfile) {
      throw new Error('step-permission-profile-mismatch');
    }

    const now = input.now ?? Date.now();
    const proposal: ExecutionProposal = {
      id: randomUUID(),
      goalId: input.plan.goalId,
      planId: input.plan.id,
      stepId: input.stepId,
      artifactId: input.artifact.artifactId,
      contentHash: proposalContentHash({
        artifactId: input.artifact.artifactId,
        artifactContentHash: input.artifact.contentHash,
        preview: input.preview,
        command: input.command,
        args: input.args,
        stdin: input.stdin,
      }),
      bindingHash: input.binding.bindingHash,
      executionEndpointId: input.binding.executionEndpointId,
      executionPermissionProfile: input.binding.executionPermissionProfile,
      projectId: input.binding.executionWorkingDirectoryRef,
      preview: input.preview,
      command: input.command,
      args: [...input.args],
      stdin: input.stdin,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      expiresAt: input.expiresAt,
      supersedesProposalId: input.supersedesProposalId,
    };
    assertExecutionProposal(proposal);
    this.proposals.set(proposal.id, clone(proposal));
    return clone(proposal);
  }

  requestConfirmation(proposalId: string, now: number = Date.now()): ExecutionProposal {
    const proposal = this.requireProposal(proposalId);
    if (proposal.status !== 'draft') {
      throw new Error('proposal-not-draft');
    }
    proposal.status = 'awaiting-confirmation';
    proposal.updatedAt = now;
    proposal.confirmationNonce = randomUUID();
    return this.save(proposal);
  }

  confirm(input: ConfirmExecutionProposalInput): ConfirmExecutionProposalResult {
    const proposal = this.proposals.get(input.proposalId);
    if (!proposal) return { ok: false, failureReason: 'proposal-not-found' };
    const now = input.now ?? Date.now();
    if (proposal.status === 'cancelled') return { ok: false, failureReason: 'proposal-cancelled' };
    if (proposal.status === 'paused') return { ok: false, failureReason: 'proposal-paused' };
    if (proposal.status !== 'awaiting-confirmation') {
      return { ok: false, failureReason: 'proposal-not-awaiting-confirmation' };
    }
    if (now > proposal.expiresAt) {
      proposal.status = 'timed-out';
      proposal.timedOutAt = now;
      proposal.updatedAt = now;
      this.save(proposal);
      return { ok: false, failureReason: 'confirmation-expired' };
    }
    if (input.planId !== proposal.planId) return { ok: false, failureReason: 'confirmation-plan-mismatch' };
    if (input.stepId !== proposal.stepId) return { ok: false, failureReason: 'confirmation-step-mismatch' };
    if (input.artifactId !== proposal.artifactId) return { ok: false, failureReason: 'confirmation-artifact-mismatch' };
    if (input.contentHash !== proposal.contentHash) return { ok: false, failureReason: 'confirmation-content-mismatch' };
    if (input.bindingHash !== proposal.bindingHash) return { ok: false, failureReason: 'confirmation-binding-mismatch' };
    if (input.executionEndpointId !== proposal.executionEndpointId) {
      return { ok: false, failureReason: 'confirmation-endpoint-mismatch' };
    }
    if (input.executionPermissionProfile !== proposal.executionPermissionProfile) {
      return { ok: false, failureReason: 'confirmation-permission-profile-mismatch' };
    }
    if (input.projectId !== proposal.projectId) return { ok: false, failureReason: 'confirmation-project-mismatch' };

    proposal.status = 'confirmed';
    proposal.confirmedAt = now;
    proposal.updatedAt = now;
    return { ok: true, proposal: this.save(proposal) };
  }

  edit(proposalId: string, input: {
    preview: string;
    stdin: string;
    artifact: ReasoningArtifact;
    now?: number;
  }): ExecutionProposal {
    const previous = this.requireProposal(proposalId);
    if (previous.status === 'returned' || previous.status === 'dispatching') {
      throw new Error('proposal-not-editable');
    }
    const now = input.now ?? Date.now();
    previous.status = 'cancelled';
    previous.cancelledAt = now;
    previous.updatedAt = now;
    this.save(previous);

    const proposal: ExecutionProposal = {
      ...previous,
      id: randomUUID(),
      artifactId: input.artifact.artifactId,
      contentHash: proposalContentHash({
        artifactId: input.artifact.artifactId,
        artifactContentHash: input.artifact.contentHash,
        preview: input.preview,
        command: previous.command,
        args: previous.args,
        stdin: input.stdin,
      }),
      preview: input.preview,
      stdin: input.stdin,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      confirmationNonce: undefined,
      confirmedAt: undefined,
      dispatchingAt: undefined,
      returnedAt: undefined,
      failedAt: undefined,
      pausedAt: undefined,
      cancelledAt: undefined,
      timedOutAt: undefined,
      failureReason: undefined,
      result: undefined,
      supersedesProposalId: previous.id,
      supersededByProposalId: undefined,
    };
    previous.supersededByProposalId = proposal.id;
    this.save(previous);
    return this.save(proposal);
  }

  markDispatching(proposalId: string, now: number = Date.now()): ExecutionProposal {
    const proposal = this.requireProposal(proposalId);
    if (proposal.status !== 'confirmed') throw new Error('proposal-not-confirmed');
    proposal.status = 'dispatching';
    proposal.dispatchingAt = now;
    proposal.updatedAt = now;
    return this.save(proposal);
  }

  markReturned(
    proposalId: string,
    result: { stdout: string; stderr: string; exitCode: number | null },
    now: number = Date.now(),
  ): ExecutionProposal {
    const proposal = this.requireProposal(proposalId);
    proposal.status = 'returned';
    proposal.returnedAt = now;
    proposal.updatedAt = now;
    proposal.result = result;
    return this.save(proposal);
  }

  markFailed(proposalId: string, reason: string, now: number = Date.now()): ExecutionProposal {
    const proposal = this.requireProposal(proposalId);
    proposal.status = 'failed';
    proposal.failedAt = now;
    proposal.failureReason = reason;
    proposal.updatedAt = now;
    return this.save(proposal);
  }

  pause(proposalId: string, reason: string, now: number = Date.now()): ExecutionProposal {
    const proposal = this.requireProposal(proposalId);
    proposal.status = 'paused';
    proposal.pausedAt = now;
    proposal.failureReason = reason;
    proposal.updatedAt = now;
    return this.save(proposal);
  }

  resume(proposalId: string, now: number = Date.now()): ExecutionProposal {
    const proposal = this.requireProposal(proposalId);
    if (proposal.status !== 'paused') throw new Error('proposal-not-paused');
    proposal.status = proposal.confirmedAt === undefined ? 'awaiting-confirmation' : 'confirmed';
    proposal.failureReason = undefined;
    proposal.updatedAt = now;
    return this.save(proposal);
  }

  cancel(proposalId: string, now: number = Date.now()): ExecutionProposal {
    const proposal = this.requireProposal(proposalId);
    proposal.status = 'cancelled';
    proposal.cancelledAt = now;
    proposal.updatedAt = now;
    return this.save(proposal);
  }

  get(proposalId: string): ExecutionProposal | undefined {
    const proposal = this.proposals.get(proposalId);
    return proposal ? clone(proposal) : undefined;
  }

  list(query: { planId?: string; goalId?: string } = {}): ExecutionProposal[] {
    return Array.from(this.proposals.values())
      .filter(proposal => query.planId === undefined || proposal.planId === query.planId)
      .filter(proposal => query.goalId === undefined || proposal.goalId === query.goalId)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map(clone);
  }

  private requireProposal(proposalId: string): ExecutionProposal {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error('proposal-not-found');
    return clone(proposal);
  }

  private save(proposal: ExecutionProposal): ExecutionProposal {
    assertExecutionProposal(proposal);
    this.proposals.set(proposal.id, clone(proposal));
    return clone(proposal);
  }
}
