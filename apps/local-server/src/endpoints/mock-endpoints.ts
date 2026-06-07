import type {
  AgentEndpoint,
} from '../../../../packages/shared/src/types.ts';

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
