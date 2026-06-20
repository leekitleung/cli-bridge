import { createHash } from 'node:crypto';

import {
  assertRunEndpointBinding,
} from '../../../../packages/shared/src/schemas.ts';
import type {
  AgentEndpoint,
  AutomationExecutionTier,
  AutomationReasoningTier,
  RunEndpointBinding,
  RunEndpointBindingEndpointRef,
} from '../../../../packages/shared/src/types.ts';
import type { InMemoryEndpointRegistry } from '../endpoints/endpoint-registry.ts';

export interface AutomationBindingStoreOptions {
  endpointRegistry: InMemoryEndpointRegistry;
  projectExists: (projectRef: string) => boolean;
}

export interface CreateAutomationBindingInput {
  goalId: string;
  planId: string;
  parentPlanId?: string;
  reasoningEndpointId: string;
  executionEndpointId: string;
  reasoningTier: AutomationReasoningTier;
  executionTier: AutomationExecutionTier;
  executionPermissionProfile: string;
  executionWorkingDirectoryRef: string;
  maxSteps: number;
  maxReasoningRounds: number;
  deadlineAt: string;
  now?: number;
}

export interface UpdateAutomationBindingInput {
  reasoningEndpointId?: string;
  executionEndpointId?: string;
  reasoningTier?: AutomationReasoningTier;
  executionTier?: AutomationExecutionTier;
  executionPermissionProfile?: string;
  executionWorkingDirectoryRef?: string;
  maxSteps?: number;
  maxReasoningRounds?: number;
  deadlineAt?: string;
  now?: number;
}

export interface DeriveAutomationBindingInput extends Partial<CreateAutomationBindingInput> {
  parentPlanId: string;
  goalId: string;
  planId: string;
  now?: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function endpointRef(endpoint: AgentEndpoint): RunEndpointBindingEndpointRef {
  return {
    id: endpoint.id,
    label: endpoint.label,
    transport: endpoint.transport,
    capabilities: {
      canExecute: endpoint.capabilities.canExecute,
    },
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashBindingFields(binding: Omit<RunEndpointBinding, 'bindingHash'>): string {
  const authorityFields = {
    goalId: binding.goalId,
    planId: binding.planId,
    parentPlanId: binding.parentPlanId,
    reasoningEndpointId: binding.reasoningEndpointId,
    executionEndpointId: binding.executionEndpointId,
    reasoningTier: binding.reasoningTier,
    executionTier: binding.executionTier,
    executionPermissionProfile: binding.executionPermissionProfile,
    executionWorkingDirectoryRef: binding.executionWorkingDirectoryRef,
    maxSteps: binding.maxSteps,
    maxReasoningRounds: binding.maxReasoningRounds,
    deadlineAt: binding.deadlineAt,
  };
  return `sha256:${createHash('sha256').update(stableJson(authorityFields)).digest('hex')}`;
}

export function computeAutomationBindingHash(
  binding: Omit<RunEndpointBinding, 'bindingHash'>,
): string {
  return hashBindingFields(binding);
}

export class InMemoryAutomationBindingStore {
  private readonly bindingsByPlan = new Map<string, RunEndpointBinding>();
  private readonly endpointRegistry: InMemoryEndpointRegistry;
  private readonly projectExists: (projectRef: string) => boolean;

  constructor(options: AutomationBindingStoreOptions) {
    this.endpointRegistry = options.endpointRegistry;
    this.projectExists = options.projectExists;
  }

  createBinding(input: CreateAutomationBindingInput): RunEndpointBinding {
    if (this.bindingsByPlan.has(input.planId)) {
      return this.updateBinding(input.planId, input);
    }
    const binding = this.buildBinding(input);
    this.bindingsByPlan.set(binding.planId, clone(binding));
    return clone(binding);
  }

  updateBinding(planId: string, input: UpdateAutomationBindingInput): RunEndpointBinding {
    const existing = this.bindingsByPlan.get(planId);
    if (!existing) {
      throw new Error('binding not found');
    }
    if (existing.lockedAt !== undefined) {
      throw new Error('binding is locked');
    }
    const binding = this.buildBinding({
      ...existing,
      ...input,
      goalId: existing.goalId,
      planId: existing.planId,
      parentPlanId: existing.parentPlanId,
      now: input.now ?? Date.now(),
    });
    this.bindingsByPlan.set(planId, clone(binding));
    return clone(binding);
  }

  lockBinding(planId: string, now: number = Date.now()): RunEndpointBinding | undefined {
    const binding = this.bindingsByPlan.get(planId);
    if (!binding) {
      return undefined;
    }
    if (binding.lockedAt !== undefined) {
      return clone(binding);
    }
    const locked = { ...binding, lockedAt: now, updatedAt: now };
    assertRunEndpointBinding(locked);
    if (locked.bindingHash !== hashBindingFields(locked)) {
      throw new Error('binding hash mismatch');
    }
    this.bindingsByPlan.set(planId, clone(locked));
    return clone(locked);
  }

  deriveBinding(input: DeriveAutomationBindingInput): RunEndpointBinding {
    return this.commitBinding(this.previewDerivedBinding(input));
  }

  previewDerivedBinding(input: DeriveAutomationBindingInput): RunEndpointBinding {
    const parent = this.bindingsByPlan.get(input.parentPlanId);
    if (!parent) {
      throw new Error('parent binding not found');
    }
    return this.buildBinding({
      goalId: input.goalId,
      planId: input.planId,
      parentPlanId: input.parentPlanId,
      reasoningEndpointId: input.reasoningEndpointId ?? parent.reasoningEndpointId,
      executionEndpointId: input.executionEndpointId ?? parent.executionEndpointId,
      reasoningTier: input.reasoningTier ?? parent.reasoningTier,
      executionTier: input.executionTier ?? parent.executionTier,
      executionPermissionProfile: input.executionPermissionProfile ?? parent.executionPermissionProfile,
      executionWorkingDirectoryRef: input.executionWorkingDirectoryRef ?? parent.executionWorkingDirectoryRef,
      maxSteps: input.maxSteps ?? parent.maxSteps,
      maxReasoningRounds: input.maxReasoningRounds ?? parent.maxReasoningRounds,
      deadlineAt: input.deadlineAt ?? parent.deadlineAt,
      now: input.now,
    });
  }

  commitBinding(binding: RunEndpointBinding): RunEndpointBinding {
    assertRunEndpointBinding(binding);
    if (binding.bindingHash !== hashBindingFields(binding)) {
      throw new Error('binding hash mismatch');
    }
    const existing = this.bindingsByPlan.get(binding.planId);
    if (existing?.lockedAt !== undefined) {
      throw new Error('binding is locked');
    }
    this.bindingsByPlan.set(binding.planId, clone(binding));
    return clone(binding);
  }

  getBinding(planId: string): RunEndpointBinding | undefined {
    const binding = this.bindingsByPlan.get(planId);
    return binding ? clone(binding) : undefined;
  }

  listBindings(): RunEndpointBinding[] {
    return Array.from(this.bindingsByPlan.values(), clone);
  }

  exportBindings(): RunEndpointBinding[] {
    return this.listBindings();
  }

  hydrateBinding(binding: RunEndpointBinding): boolean {
    try {
      assertRunEndpointBinding(binding);
      if (binding.bindingHash !== hashBindingFields(binding)) {
        return false;
      }
      this.bindingsByPlan.set(binding.planId, clone(binding));
      return true;
    } catch {
      return false;
    }
  }

  private buildBinding(input: CreateAutomationBindingInput): RunEndpointBinding {
    this.validateInput(input);
    const reasoningEndpoint = this.endpointRegistry.get(input.reasoningEndpointId);
    if (!reasoningEndpoint) {
      throw new Error('reasoning endpoint not found');
    }
    const executionEndpoint = this.endpointRegistry.get(input.executionEndpointId);
    if (!executionEndpoint) {
      throw new Error('execution endpoint not found');
    }
    if (
      !reasoningEndpoint.capabilities.canAcceptPrompt &&
      !reasoningEndpoint.capabilities.canReview &&
      !reasoningEndpoint.capabilities.canSummarize
    ) {
      throw new Error('reasoning endpoint lacks reasoning capability');
    }
    if (!executionEndpoint.capabilities.canExecute) {
      throw new Error('execution endpoint must have canExecute=true');
    }

    const now = input.now ?? Date.now();
    const withoutHash: Omit<RunEndpointBinding, 'bindingHash'> = {
      goalId: input.goalId,
      planId: input.planId,
      parentPlanId: input.parentPlanId,
      reasoningEndpointId: input.reasoningEndpointId,
      executionEndpointId: input.executionEndpointId,
      reasoningEndpoint: endpointRef(reasoningEndpoint),
      executionEndpoint: endpointRef(executionEndpoint),
      reasoningTier: input.reasoningTier,
      executionTier: input.executionTier,
      executionPermissionProfile: input.executionPermissionProfile,
      executionWorkingDirectoryRef: input.executionWorkingDirectoryRef,
      maxSteps: input.maxSteps,
      maxReasoningRounds: input.maxReasoningRounds,
      deadlineAt: input.deadlineAt,
      createdAt: now,
      updatedAt: now,
    };
    const binding = {
      ...withoutHash,
      bindingHash: hashBindingFields(withoutHash),
    };
    assertRunEndpointBinding(binding);
    return binding;
  }

  private validateInput(input: CreateAutomationBindingInput): void {
    for (const key of [
      'goalId',
      'planId',
      'reasoningEndpointId',
      'executionEndpointId',
      'executionPermissionProfile',
      'executionWorkingDirectoryRef',
      'deadlineAt',
    ] as const) {
      if (typeof input[key] !== 'string' || input[key].trim().length === 0) {
        throw new Error(`${key} is required`);
      }
    }
    if (input.reasoningTier !== 'high') {
      throw new Error('reasoningTier must be high');
    }
    if (input.executionTier !== 'medium' && input.executionTier !== 'low') {
      throw new Error('executionTier must be medium or low');
    }
    if (!this.projectExists(input.executionWorkingDirectoryRef)) {
      throw new Error('project reference is unknown');
    }
    if (!Number.isInteger(input.maxSteps) || input.maxSteps < 1 || input.maxSteps > 50) {
      throw new Error('maxSteps must be between 1 and 50');
    }
    if (
      !Number.isInteger(input.maxReasoningRounds) ||
      input.maxReasoningRounds < 1 ||
      input.maxReasoningRounds > 20
    ) {
      throw new Error('maxReasoningRounds must be between 1 and 20');
    }
    if (Number.isNaN(Date.parse(input.deadlineAt))) {
      throw new Error('deadlineAt must be an ISO date string');
    }
  }
}
