import type {
  AgentAdapter,
} from '../adapters/AgentAdapter.ts';
import type {
  CreatePendingPromptInput,
  InMemoryPendingPromptStore,
} from '../storage/pending-prompt-store.ts';

export function createPendingPrompt(
  store: InMemoryPendingPromptStore,
  input: CreatePendingPromptInput,
) {
  return store.createPendingPrompt(input);
}

export function previewPendingPrompt(
  store: InMemoryPendingPromptStore,
  promptId: string,
) {
  return store.previewPrompt(promptId);
}

export function confirmPendingPrompt(
  store: InMemoryPendingPromptStore,
  promptId: string,
) {
  return store.confirmPrompt(promptId);
}

export function cancelPendingPrompt(
  store: InMemoryPendingPromptStore,
  promptId: string,
) {
  return store.cancelPrompt(promptId);
}

export async function sendConfirmedPendingPrompt(
  store: InMemoryPendingPromptStore,
  promptId: string,
  adapter: AgentAdapter,
) {
  return store.sendConfirmedPrompt(promptId, adapter);
}
