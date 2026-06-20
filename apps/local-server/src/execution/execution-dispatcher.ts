import type {
  Plan,
  RunEndpointBinding,
} from '../../../../packages/shared/src/types.ts';
import {
  runAllowlistedCommand,
  type AllowedCommand,
  type CommandRunOptions,
} from '../adapters/command-runner.ts';
import {
  CLAUDE_REVIEW_ARGS,
  CODEX_REVIEW_ARGS,
} from '../adapters/command-review-adapter.ts';
import type { ProviderCapabilityDeclaration } from '../storage/provider-capability.ts';
import type { InMemoryExecutionProposalStore } from '../storage/execution-proposal-store.ts';

export interface DispatchExecutionProposalInput extends CommandRunOptions {
  store: InMemoryExecutionProposalStore;
  proposalId: string;
  binding: RunEndpointBinding;
  plan: Plan;
  providerCapability: ProviderCapabilityDeclaration | undefined;
  now?: number;
}

export type DispatchExecutionProposalResult =
  | { ok: true; proposal: ReturnType<InMemoryExecutionProposalStore['get']> }
  | { ok: false; failureReason: string; proposal?: ReturnType<InMemoryExecutionProposalStore['get']> };

export function validateExecutionInvocation(
  providerCapability: ProviderCapabilityDeclaration | undefined,
  command: AllowedCommand,
  args: readonly string[],
): string | undefined {
  if (!providerCapability || !providerCapability.canExecute) {
    return 'execution-endpoint-cannot-execute';
  }
  const expected = providerCapability.kind === 'codex'
    ? { command: 'codex' as const, args: CODEX_REVIEW_ARGS }
    : providerCapability.kind === 'claude'
      ? { command: 'claude' as const, args: CLAUDE_REVIEW_ARGS }
      : undefined;
  if (!expected || command !== expected.command) return 'proposal-command-mismatch';
  if (args.length !== expected.args.length || args.some((arg, index) => arg !== expected.args[index])) {
    return 'proposal-argv-mismatch';
  }
  return undefined;
}

export async function dispatchExecutionProposal(
  input: DispatchExecutionProposalInput,
): Promise<DispatchExecutionProposalResult> {
  const now = input.now ?? Date.now();
  const proposal = input.store.get(input.proposalId);
  if (!proposal) return { ok: false, failureReason: 'proposal-not-found' };
  if (proposal.status !== 'confirmed') {
    return { ok: false, failureReason: 'proposal-not-confirmed', proposal };
  }
  if (input.plan.status === 'paused') {
    return { ok: false, failureReason: 'plan-paused', proposal: input.store.pause(proposal.id, 'plan-paused', now) };
  }
  if (input.plan.status === 'cancelled') {
    return { ok: false, failureReason: 'plan-cancelled', proposal: input.store.cancel(proposal.id, now) };
  }
  if (
    proposal.planId !== input.binding.planId ||
    proposal.goalId !== input.binding.goalId ||
    proposal.bindingHash !== input.binding.bindingHash
  ) {
    return {
      ok: false,
      failureReason: 'proposal-binding-mismatch',
      proposal: input.store.pause(proposal.id, 'proposal-binding-mismatch', now),
    };
  }
  if (proposal.executionEndpointId !== input.binding.executionEndpointId) {
    return {
      ok: false,
      failureReason: 'proposal-endpoint-mismatch',
      proposal: input.store.pause(proposal.id, 'proposal-endpoint-mismatch', now),
    };
  }
  if (!input.providerCapability || !input.providerCapability.canExecute) {
    return {
      ok: false,
      failureReason: 'execution-endpoint-cannot-execute',
      proposal,
    };
  }
  if (input.providerCapability.endpointId !== input.binding.executionEndpointId) {
    return {
      ok: false,
      failureReason: 'provider-endpoint-mismatch',
      proposal: input.store.pause(proposal.id, 'provider-endpoint-mismatch', now),
    };
  }
  const invocationFailure = validateExecutionInvocation(
    input.providerCapability,
    proposal.command,
    proposal.args,
  );
  if (invocationFailure) {
    return {
      ok: false,
      failureReason: invocationFailure,
      proposal: input.store.pause(proposal.id, invocationFailure, now),
    };
  }
  const step = input.plan.steps.find(item => item.id === proposal.stepId);
  if (!step || step.targetEndpointId !== proposal.executionEndpointId) {
    return {
      ok: false,
      failureReason: 'proposal-step-mismatch',
      proposal: input.store.pause(proposal.id, 'proposal-step-mismatch', now),
    };
  }

  input.store.markDispatching(proposal.id, now);
  const result = await runAllowlistedCommand({
    command: proposal.command,
    args: proposal.args,
    stdin: proposal.stdin,
  }, {
    timeoutMs: input.timeoutMs,
    maxOutputBytes: input.maxOutputBytes,
    runner: input.runner,
    launcherResolver: input.launcherResolver,
  });

  if (!result.ok) {
    const reason = result.failureReason ?? 'execution-dispatch-failed';
    const paused = input.store.pause(proposal.id, reason, Date.now());
    return { ok: false, failureReason: reason, proposal: paused };
  }

  return {
    ok: true,
    proposal: input.store.markReturned(proposal.id, {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    }, Date.now()),
  };
}
