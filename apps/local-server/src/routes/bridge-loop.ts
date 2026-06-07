import type {
  AgentAdapter,
} from '../adapters/AgentAdapter.ts';
import type {
  CreateBridgeLoopInput,
  CreatePendingPromptFromChatGptInput,
  InMemoryBridgeLoopStore,
} from '../storage/bridge-loop-store.ts';

export function createBridgeLoopFromCodexOutput(
  store: InMemoryBridgeLoopStore,
  input: CreateBridgeLoopInput,
) {
  return store.createFromCodexOutput(input);
}

export function markBridgeLoopChatGptFilled(
  store: InMemoryBridgeLoopStore,
  loopId: string,
  now?: number,
) {
  return store.markChatGptFilled(loopId, now);
}

export function createBridgeLoopPendingPromptFromChatGpt(
  store: InMemoryBridgeLoopStore,
  loopId: string,
  input: CreatePendingPromptFromChatGptInput,
) {
  return store.createPendingPromptFromChatGpt(loopId, input);
}

export function confirmBridgeLoopPendingPrompt(
  store: InMemoryBridgeLoopStore,
  loopId: string,
  now?: number,
) {
  return store.confirmPendingPrompt(loopId, now);
}

export function deliverBridgeLoopConfirmedPrompt(
  store: InMemoryBridgeLoopStore,
  loopId: string,
  adapter: AgentAdapter,
  now?: number,
) {
  return store.deliverConfirmedPrompt(loopId, adapter, now);
}
