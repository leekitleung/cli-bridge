// v2.3 Provider capability declaration — static, read-only, non-executing.
// Used only for TeamSpec create validation. No runtime provider discovery.

export interface ProviderCapabilityDeclaration {
  provider: string;
  providerId: string;
  endpointId: string;
  kind: string;
  label: string;
  canExecute: boolean;
  canReview: boolean;
  canProposePatch: boolean;
  canVerify: boolean;
  canUseModelApi: boolean;
  productNativeParallelism: 'confirmed' | 'reported' | 'unknown';
  productNativeParallelismEvidenceTier: 1 | 2 | 3 | 4;
  bridgeGovernedParallelSlots: boolean;
  maxConcurrentBridgeSlots: number;
  isolationModes: string[];
  supportedIsolations: string[];
  supportedModes: string[];
  description: string;
}

/** Static map of known provider capabilities. */
export const KNOWN_PROVIDER_CAPABILITIES: Record<string, ProviderCapabilityDeclaration> = {
  'claude': {
    provider: 'claude',
    providerId: 'claude',
    endpointId: 'claude-code-command',
    kind: 'claude',
    label: 'Claude Code',
    canExecute: true,
    canReview: true,
    canProposePatch: true,
    canVerify: true,
    canUseModelApi: false,
    productNativeParallelism: 'reported',
    productNativeParallelismEvidenceTier: 3,
    bridgeGovernedParallelSlots: false,
    maxConcurrentBridgeSlots: 1,
    isolationModes: ['patch-only'],
    supportedIsolations: ['patch-only'],
    supportedModes: ['sequential'],
    description: 'Claude Code CLI — single-session, sequential-only via bridge governance',
  },
  'codex': {
    provider: 'codex',
    providerId: 'codex',
    endpointId: 'codex-command',
    kind: 'codex',
    label: 'Codex',
    canExecute: true,
    canReview: true,
    canProposePatch: true,
    canVerify: true,
    canUseModelApi: false,
    productNativeParallelism: 'unknown',
    productNativeParallelismEvidenceTier: 4,
    bridgeGovernedParallelSlots: false,
    maxConcurrentBridgeSlots: 1,
    isolationModes: ['patch-only'],
    supportedIsolations: ['patch-only'],
    supportedModes: ['sequential'],
    description: 'Codex CLI — single-session, sequential-only via bridge governance',
  },
  'codex-medium': {
    provider: 'codex-medium',
    providerId: 'codex-medium',
    endpointId: 'codex-medium',
    kind: 'codex',
    label: 'Codex Medium',
    canExecute: true,
    canReview: true,
    canProposePatch: true,
    canVerify: true,
    canUseModelApi: false,
    productNativeParallelism: 'unknown',
    productNativeParallelismEvidenceTier: 4,
    bridgeGovernedParallelSlots: false,
    maxConcurrentBridgeSlots: 1,
    isolationModes: ['patch-only'],
    supportedIsolations: ['patch-only'],
    supportedModes: ['sequential'],
    description: 'Codex CLI medium execution endpoint — single-session, sequential-only via bridge governance',
  },
  'workbuddy': {
    provider: 'workbuddy',
    providerId: 'workbuddy',
    endpointId: 'workbuddy',
    kind: 'workbuddy',
    label: 'WorkBuddy',
    canExecute: false,
    canReview: false,
    canProposePatch: false,
    canVerify: false,
    canUseModelApi: false,
    productNativeParallelism: 'unknown',
    productNativeParallelismEvidenceTier: 4,
    bridgeGovernedParallelSlots: false,
    maxConcurrentBridgeSlots: 0,
    isolationModes: [],
    supportedIsolations: [],
    supportedModes: [],
    description: 'WorkBuddy — non-executing task source/result sink',
  },
};

export interface ProviderValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateProviderCapability(
  provider: string,
  requestedMode: string,
  requestedIsolation: string,
  requestedMaxSlots: number,
  requestedEndpointId?: string,
): ProviderValidationResult {
  const errors: string[] = [];
  const cap = KNOWN_PROVIDER_CAPABILITIES[provider];
  if (!cap) {
    errors.push('Unknown provider: ' + provider);
    return { ok: false, errors };
  }
  if (!cap.canExecute) {
    errors.push('Provider ' + provider + ' cannot execute');
  }
  if (requestedEndpointId && requestedEndpointId !== cap.endpointId) {
    errors.push('Provider ' + provider + ' must use endpointId ' + cap.endpointId);
  }
  if (cap.bridgeGovernedParallelSlots !== false) {
    errors.push('Provider ' + provider + ' must declare bridgeGovernedParallelSlots=false in v2.4b');
  }
  if (cap.maxConcurrentBridgeSlots !== 1 && cap.canExecute) {
    errors.push('Provider ' + provider + ' must declare maxConcurrentBridgeSlots=1 in v2.4b');
  }
  if (!cap.isolationModes.includes('patch-only') && cap.canExecute) {
    errors.push('Provider ' + provider + ' must support patch-only isolation');
  }
  if (cap.supportedModes.length > 0 && !cap.supportedModes.includes(requestedMode)) {
    errors.push('Provider does not support mode: ' + requestedMode);
  }
  if (cap.supportedIsolations.length > 0 && !cap.supportedIsolations.includes(requestedIsolation)) {
    errors.push('Provider does not support isolation: ' + requestedIsolation);
  }
  if (requestedMaxSlots > cap.maxConcurrentBridgeSlots) {
    errors.push('Requested ' + requestedMaxSlots + ' slots, provider supports ' + cap.maxConcurrentBridgeSlots);
  }
  return { ok: errors.length === 0, errors };
}
