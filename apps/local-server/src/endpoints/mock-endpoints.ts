import type {
  AgentEndpoint,
} from '../../../../packages/shared/src/types.ts';

export const MOCK_REVIEW_ENDPOINT: AgentEndpoint = {
  id: 'mock-review-agent',
  label: 'Mock Review Agent',
  transport: 'mock',
  risk: 'low',
  capabilities: {
    canAcceptPrompt: false,
    canReturnOutput: true,
    canReview: true,
    canExecute: false,
    canSummarize: false,
  },
  adapterName: 'mock-review-agent',
};

export const CLAUDE_CODE_REVIEW_ENDPOINT: AgentEndpoint = {
  id: 'claude-code',
  label: 'Claude Code Review',
  transport: 'clipboard',
  risk: 'medium',
  capabilities: {
    canAcceptPrompt: false,
    canReturnOutput: true,
    canReview: true,
    canExecute: false,
    canSummarize: false,
  },
  adapterName: 'claude-code-review-clipboard',
};

export const CODEX_FEASIBILITY_REVIEW_ENDPOINT: AgentEndpoint = {
  id: 'codex-feasibility',
  label: 'Codex Feasibility Review',
  transport: 'clipboard',
  risk: 'medium',
  capabilities: {
    canAcceptPrompt: false,
    canReturnOutput: true,
    canReview: true,
    canExecute: false,
    canSummarize: false,
  },
  adapterName: 'codex-feasibility-review-clipboard',
};

export const CLAUDE_CODE_REVIEW_COMMAND_ENDPOINT: AgentEndpoint = {
  id: 'claude-code-command',
  label: 'Claude Code Review (command transport)',
  transport: 'command',
  risk: 'medium',
  capabilities: {
    canAcceptPrompt: false,
    canReturnOutput: true,
    canReview: true,
    canExecute: false,
    canSummarize: false,
  },
  adapterName: 'claude-code-review-command',
};

export const CODEX_REVIEW_COMMAND_ENDPOINT: AgentEndpoint = {
  id: 'codex-command',
  label: 'Codex Review (command transport)',
  transport: 'command',
  risk: 'medium',
  capabilities: {
    canAcceptPrompt: false,
    canReturnOutput: true,
    canReview: true,
    canExecute: false,
    canSummarize: false,
  },
  adapterName: 'codex-review-command',
};

// Manual / local E2E only. This endpoint exists so a real-browser inbound
// routing E2E can be exercised without making any REAL executor inbound-capable.
// It is deliberately NOT part of DEFAULT_AGENT_ENDPOINTS: codex-cli / clipboard /
// chatgpt-web stay inbound-incapable by default (ADR-gated capability). It is
// registered into the runtime registry alongside the review-only endpoints so
// that POST /bridge/outbound can target it and extract-return can route the
// reviewed reply into the inbound queue for manual verification.
//
// It does not enable auto-send, terminal injection, or managed PTY writeback;
// it only marks the endpoint as able to receive an inbound return message that
// an executor pull client (not implemented here) would later consume.
export const MOCK_INBOUND_AGENT_ENDPOINT: AgentEndpoint = {
  id: 'mock-inbound-agent',
  label: 'Mock Inbound Agent (manual E2E)',
  transport: 'mock',
  risk: 'low',
  capabilities: {
    canAcceptPrompt: true,
    canReturnOutput: true,
    canReview: false,
    canExecute: false,
    canSummarize: false,
    canReceiveInbound: true,
  },
  adapterName: 'mock-agent',
};

// WorkBuddy execution endpoint — registered through endpoint registry with
// pull-based inbox/result protocol. canExecute remains false until EX-4
// gates are met (inbox/result protocol + adapter). This endpoint exists in
// the registry so pairing discovery can surface it; execution dispatch
// rejects it until EX-4.
export const WORKBUDDY_ENDPOINT: AgentEndpoint = {
  id: 'workbuddy',
  label: 'WorkBuddy Executor',
  transport: 'workbuddy',
  risk: 'medium',
  capabilities: {
    canAcceptPrompt: true,
    canReturnOutput: true,
    canReview: true,
    canExecute: false,
    canSummarize: false,
  },
  adapterName: 'workbuddy-execution',
  experimental: true,
};

export const DEFAULT_AGENT_ENDPOINTS: AgentEndpoint[] = [
  {
    id: 'mock-agent',
    label: 'Mock Agent',
    transport: 'mock',
    risk: 'low',
    capabilities: {
      canAcceptPrompt: true,
      canReturnOutput: false,
      canReview: false,
      canExecute: false,
      canSummarize: false,
    },
    adapterName: 'mock-agent',
  },
  {
    id: 'clipboard',
    label: 'Clipboard',
    transport: 'clipboard',
    risk: 'low',
    capabilities: {
      canAcceptPrompt: true,
      canReturnOutput: false,
      canReview: false,
      canExecute: false,
      canSummarize: false,
    },
  },
  {
    id: 'chatgpt-web',
    label: 'ChatGPT Web',
    transport: 'web-dom',
    risk: 'medium',
    capabilities: {
      canAcceptPrompt: true,
      canReturnOutput: true,
      canReview: false,
      canExecute: false,
      canSummarize: true,
    },
  },
  {
    id: 'codex-cli',
    label: 'Codex CLI',
    transport: 'managed-pty',
    risk: 'experimental',
    capabilities: {
      canAcceptPrompt: true,
      canReturnOutput: true,
      canReview: false,
      canExecute: false,
      canSummarize: false,
    },
    adapterName: 'codex-managed-pty',
    experimental: true,
  },
];
