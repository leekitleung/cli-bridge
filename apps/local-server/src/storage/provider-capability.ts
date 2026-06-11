// v2.3 Provider capability declaration — static, read-only, non-executing.
// Used only for TeamSpec create validation. No runtime provider discovery.

export interface ProviderCapabilityDeclaration {
  provider: string;
  canExecute: boolean;
  bridgeGovernedParallelSlots: boolean;
  maxConcurrentBridgeSlots: number;
  supportedIsolations: string[];
  supportedModes: string[];
  description: string;
}

/** Static map of known provider capabilities. */
export const KNOWN_PROVIDER_CAPABILITIES: Record<string, ProviderCapabilityDeclaration> = {
  'claude': {
    provider: 'claude',
    canExecute: true,
    bridgeGovernedParallelSlots: false,
    maxConcurrentBridgeSlots: 1,
    supportedIsolations: ['patch-only'],
    supportedModes: ['sequential'],
    description: 'Claude Code CLI — single-session, sequential-only via bridge governance',
  },
  'codex': {
    provider: 'codex',
    canExecute: true,
    bridgeGovernedParallelSlots: false,
    maxConcurrentBridgeSlots: 1,
    supportedIsolations: ['patch-only'],
    supportedModes: ['sequential'],
    description: 'Codex CLI — single-session, sequential-only via bridge governance',
  },
  'workbuddy': {
    provider: 'workbuddy',
    canExecute: false,
    bridgeGovernedParallelSlots: false,
    maxConcurrentBridgeSlots: 0,
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
