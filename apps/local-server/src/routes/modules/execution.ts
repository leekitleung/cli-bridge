// Execution API routes - extracted from bridge-api.ts
// Handles execution proposals and command dispatch

import type { IncomingMessage } from 'node:http';
import type { BridgeRuntime, BridgeAuthContext } from '../bridge-api.ts';
import type { BridgeResult } from '../shared.ts';
import {
  ok,
  created,
  badRequest,
  notFound,
  readJsonBody,
  requireString,
  isRecord,
} from '../shared.ts';
import { validateExecutionInvocation } from '../../execution/execution-dispatcher.ts';
import { KNOWN_PROVIDER_CAPABILITIES } from '../../storage/provider-capability.ts';
import type { AllowedCommand } from '../../adapters/command-runner.ts';

/**
 * Check if pathname is execution endpoint
 */
export function isExecutionPath(pathname: string): boolean {
  return pathname.startsWith('/bridge/execution');
}

/**
 * Dispatch execution proposal
 * POST /bridge/execution/proposals
 */
export async function handleExecutionProposals(
  runtime: BridgeRuntime,
  method: string,
  pathname: string,
  request: IncomingMessage,
  _authContext: BridgeAuthContext,
): Promise<BridgeResult | null> {
  if (method !== 'POST' || pathname !== '/bridge/execution/proposals') {
    return null;
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return badRequest(parsed.message ?? 'Invalid request body');
  }

  const body = parsed.body;
  if (!isRecord(body)) {
    return badRequest('Request body must be an object');
  }

  const planId = requireString(body, 'planId');
  const stepId = requireString(body, 'stepId');
  const artifactId = requireString(body, 'artifactId');
  const preview = requireString(body, 'preview');
  const command = requireString(body, 'command');
  const stdin = requireString(body, 'stdin');
  const args = Array.isArray(body.args)
    ? body.args.filter((arg: unknown): arg is string => typeof arg === 'string')
    : null;
  const expiresAt = typeof body.expiresAt === 'number' ? body.expiresAt : Date.now() + 15 * 60_000;

  if (!planId || !stepId || !artifactId || !preview || !command || !stdin || !args) {
    return badRequest('planId, stepId, artifactId, preview, command, args and stdin are required');
  }

  const binding = runtime.automationBindingStore.getBinding(planId);
  const plan = runtime.goalStore.getPlanById(planId);
  const artifact = runtime.reasoningArtifactStore.list({ planId })
    .find(item => item.artifactId === artifactId);
  if (!binding || !plan || !artifact) {
    return notFound('Plan binding or artifact not found');
  }

  const providerCapability = Object.values(KNOWN_PROVIDER_CAPABILITIES)
    .find(capability => capability.endpointId === binding.executionEndpointId);
  const invocationFailure = validateExecutionInvocation(
    providerCapability,
    command as AllowedCommand,
    args,
  );
  if (invocationFailure) {
    return badRequest(invocationFailure);
  }

  const draft = runtime.executionProposalStore.createDraft({
    binding,
    plan,
    stepId,
    artifact,
    preview,
    command: command as AllowedCommand,
    args,
    stdin,
    expiresAt,
  });
  const proposal = runtime.executionProposalStore.requestConfirmation(draft.id);
  runtime.persist();

  return created({ proposal });
}

/**
 * Get execution proposal
 * GET /bridge/execution/proposals/:proposalId
 */
export async function handleExecutionProposalGet(
  runtime: BridgeRuntime,
  method: string,
  pathname: string,
  _request: IncomingMessage,
  _authContext: BridgeAuthContext,
): Promise<BridgeResult | null> {
  const match = pathname.match(/^\/bridge\/execution\/proposals\/([^/]+)$/);
  if (!match) {
    return null;
  }

  if (method !== 'GET') {
    return null;
  }

  const proposalId = match[1];
  const proposal = runtime.executionProposalStore.get(proposalId);

  if (!proposal) {
    return notFound(`Execution proposal ${proposalId} not found`);
  }

  return ok({ proposal });
}

/**
 * Execute approved proposal
 * POST /bridge/execution/proposals/:proposalId/execute
 */
export async function handleExecutionProposalExecute(
  runtime: BridgeRuntime,
  method: string,
  pathname: string,
  request: IncomingMessage,
  _authContext: BridgeAuthContext,
): Promise<BridgeResult | null> {
  const match = pathname.match(/^\/bridge\/execution\/proposals\/([^/]+)\/execute$/);
  if (!match) {
    return null;
  }

  if (method !== 'POST') {
    return null;
  }

  const proposalId = match[1];
  const proposal = runtime.executionProposalStore.get(proposalId);

  if (!proposal) {
    return notFound(`Execution proposal ${proposalId} not found`);
  }

  if (proposal.status !== 'confirmed') {
    return badRequest(`Proposal must be confirmed, current status: ${proposal.status}`);
  }

  runtime.executionProposalStore.markDispatching(proposalId);
  runtime.persist();

  return ok({ proposal: runtime.executionProposalStore.get(proposalId) });
}

/**
 * Register all execution routes
 */
export async function handleExecutionRequest(
  runtime: BridgeRuntime,
  method: string,
  pathname: string,
  request: IncomingMessage,
  authContext: BridgeAuthContext,
): Promise<BridgeResult | null> {
  return (
    (await handleExecutionProposals(runtime, method, pathname, request, authContext)) ??
    (await handleExecutionProposalGet(runtime, method, pathname, request, authContext)) ??
    (await handleExecutionProposalExecute(runtime, method, pathname, request, authContext)) ??
    null
  );
}
