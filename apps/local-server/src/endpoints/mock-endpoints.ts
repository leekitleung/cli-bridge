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
